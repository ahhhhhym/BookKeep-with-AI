import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { ReviewService } from '../../../src/main/services/review-service';
import { ImageService } from '../../../src/main/services/image-service';
import { cleanupLayout, createTestLayout, storeOptions, transactionInput } from './helpers';
import { source, proposal, confirmed, approve } from './review-fixture';
import type { StatisticsPeriod } from '../../../src/shared/statistics';

let layout: ReturnType<typeof createTestLayout>, store: LedgerStore, now: number;
beforeEach(() => { layout = createTestLayout(); now = Date.parse('2027-01-04T04:00:00Z'); store = LedgerStore.open(storeOptions(layout, () => now)); });
afterEach(() => { store.close(); cleanupLayout(layout); });
const scope = (period: StatisticsPeriod, anchorDate = '2026-12-31') => ({ period, anchorDate, categoryIds: [], snapshotRevision: null });
const add = (amountFen: number, occurredDate: string, categoryId: string, name: string) => store.createTransaction(transactionInput({ amountFen, occurredDate, categoryId, name }), randomUUID()).transaction;
const count = (table: string) => store.withImports(false, c => c.db.prepare<{ n: number }>(`SELECT count(*) n FROM ${table}`).get()!.n);

describe('S16 independent arithmetic and persisted invariants', () => {
  // Expected literals are hand calculated: 999999999*3+1=2999999998, no production sum/format helper.
  it.each<StatisticsPeriod>(['week', 'month', 'year'])('%s sums beyond signed 32-bit without losing a fen', period => {
    add(999999999, '2026-12-30', 'cat_food', '边界一');
    add(999999999, '2026-12-31', 'cat_food', '边界二');
    add(999999999, '2026-12-31', 'cat_repair', '边界三');
    add(1, '2026-12-31', 'cat_fruit', '一分钱');
    const result = store.statisticsSummary(scope(period));
    expect(result).toMatchObject({ totalFen: '2999999998', count: 4 });
    expect(result.categoryTotals.map(c => [c.categoryId, c.totalFen])).toEqual([['cat_food', '1999999998'], ['cat_repair', '999999999'], ['cat_fruit', '1']]);
    expect(store.statisticsTopTransactions({ ...scope('month'), pointDate: '2026-12-31' }).items.map(c => c.amountFen)).toEqual(['999999999', '999999999', '1']);
    const series = store.statisticsSeries(scope(period));
    expect(series.points.map(p => p.amountFen)).toEqual(period === 'week' ? ['0', '0', '999999999', '1999999999', '0', '0', '0'] : period === 'year' ? ['0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '2999999998'] : [...Array<string>(29).fill('0'), '999999999', '1999999999']);
  });

  it('Shanghai leap-day midnight changes current denominator and admits March without changing revision', () => {
    add(1, '2024-02-29', 'cat_food', '闰日一分'); add(199, '2024-03-01', 'cat_fruit', '三月一元九角九分');
    now = Date.parse('2024-02-29T15:59:59.999Z');
    const before = store.statisticsSummary(scope('year', '2024-02-29'));
    expect(before).toMatchObject({ totalFen: '1', dailyAverage: { denominatorDays: 60, displayYuan: '0.00' }, scope: { today: '2024-02-29' } });
    now += 1;
    const after = store.statisticsSummary(scope('year', '2024-03-01'));
    expect(after).toMatchObject({ totalFen: '200', dailyAverage: { denominatorDays: 61, displayYuan: '0.03' }, scope: { today: '2024-03-01' } });
    expect(after.scope.revision).toBe(before.scope.revision); expect(after.scope.scopeId).not.toBe(before.scope.scopeId);
    expect(store.statisticsSeries(scope('month', '2024-02-29')).points.map(p => p.amountFen)).toEqual([...Array<string>(28).fill('0'), '1']);
    expect(store.statisticsTopCategories({ ...scope('year', '2024-03-01'), pointMonth: '2024-03' }).items.map(c => [c.categoryId, c.totalFen])).toEqual([['cat_fruit', '199']]);
  });

  it('cross-year edit/delete/restore and reopen keep independent period totals', () => {
    let tx = add(101, '2026-12-31', 'cat_food', '跨年消费'); add(202, '2027-01-01', 'cat_fruit', '元旦消费');
    const totals = () => ['2026-12-31', '2027-01-01'].map(d => store.statisticsSummary(scope('month', d)).totalFen);
    expect(totals()).toEqual(['101', '202']);
    tx = store.updateTransaction({ id: tx.id, expectedVersion: tx.version, patch: { amountFen: 303, occurredDate: '2027-01-02', categoryId: 'cat_repair' } }, randomUUID()).transaction;
    expect(totals()).toEqual(['0', '505']);
    tx = store.softDeleteTransaction({ id: tx.id, expectedVersion: tx.version }, randomUUID()).transaction;
    expect(totals()).toEqual(['0', '202']);
    store.restoreTransaction({ id: tx.id, expectedVersion: tx.version }, randomUUID());
    store.close(); store = LedgerStore.open(storeOptions(layout, () => now));
    expect(totals()).toEqual(['0', '505']);
    expect(store.statisticsTopCategories({ ...scope('year', '2027-01-01'), pointMonth: '2027-01' }).items.map(c => [c.categoryId, c.totalFen])).toEqual([['cat_repair', '303'], ['cat_fruit', '202']]);
  });

  it('stale edit and reused mutation with different payload leave revision and receipts unchanged', () => {
    const key = randomUUID(), input = transactionInput({ amountFen: 17 });
    const tx = store.createTransaction(input, key).transaction;
    const changed = store.updateTransaction({ id: tx.id, expectedVersion: tx.version, patch: { amountFen: 29 } }, randomUUID()).transaction;
    const revision = store.currentRevision, receipts = count('mutation_receipt');
    expect(() => store.updateTransaction({ id: tx.id, expectedVersion: tx.version, patch: { amountFen: 99 } }, randomUUID())).toThrowError('VERSION_CONFLICT');
    expect(() => store.createTransaction({ ...input, amountFen: 31 }, key)).toThrow();
    expect(store.currentRevision).toBe(revision); expect(count('mutation_receipt')).toBe(receipts);
    expect(store.statisticsSummary(scope('month', '2026-09-08')).totalFen).toBe('29'); expect(changed.version).toBe(2);
  });

  it('third batch audit failure rolls back all rows and receipts across reopen; same id retries only once', async () => {
    const src = await source(store, [proposal({ name: '甲', amountFen: 101 }), proposal({ name: '乙', amountFen: 202 }), proposal({ name: '丙', amountFen: 303 })]);
    const items = src.candidates.map(c => confirmed(src.review.get(c.id))), key = randomUUID();
    const before = { revision: store.currentRevision, receipts: count('mutation_receipt'), events: count('review_event') };
    store.withImports(true, c => c.db.exec(`CREATE TRIGGER s16_fail_third BEFORE INSERT ON review_event WHEN NEW.action='approve' AND NEW.candidate_id='${items[2]!.id}' BEGIN SELECT RAISE(ABORT,'S16_SYNTHETIC_FAILURE'); END;`));
    const preview = src.review.preview(items); expect(preview.totalFen).toBe('606');
    expect(() => src.review.approve({ mode: 'commit', previewToken: preview.previewToken! }, key)).toThrow();
    store.close(); store = LedgerStore.open(storeOptions(layout, () => now));
    expect(count('"transaction"')).toBe(0); expect(count('review_posting')).toBe(0);
    expect(count('review_event')).toBe(before.events); expect(count('mutation_receipt')).toBe(before.receipts); expect(store.currentRevision).toBe(before.revision);
    const review = new ReviewService(store, new ImageService(store, () => 1), () => 1, () => now);
    expect(items.map(c => review.get(c.id).reviewState)).toEqual(['pending_review', 'pending_review', 'pending_review']);
    store.withImports(true, c => c.db.exec('DROP TRIGGER s16_fail_third'));
    // Preview tokens are process-local: explicitly review afresh after reopen, same failed mutation id is safe.
    const fresh = review.preview(items.map(c => confirmed(review.get(c.id))));
    review.approve({ mode: 'commit', previewToken: fresh.previewToken! }, key);
    for (const c of items) expect(approve(review, c.id).alreadyApproved).toBe(true);
    expect(count('"transaction"')).toBe(3); expect(count('review_posting')).toBe(3);
    expect(store.statisticsSummary(scope('month', '2026-09-09')).totalFen).toBe('606');
    expect(store.withImports(false, c => c.db.pragma('quick_check'))).toEqual([{ quick_check: 'ok' }]);
    expect(store.withImports(false, c => c.db.pragma('foreign_key_check'))).toEqual([]);
  });
});
