import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { checkedTotal, MAX_TOTAL_FEN, roundedRatio } from '../../../src/main/services/statistics-service';
import type { StatisticsInput, StatisticsPeriod } from '../../../src/shared/statistics';
import { AppError } from '../../../src/shared/errors';
import { createTestLayout, cleanupLayout, transactionInput, storeOptions, openWritable, openReadOnly } from './helpers';
import type { StorageLayout } from '../../../src/main/paths';
import type { TransactionInput } from '../../../src/shared/entities';
import type { BookKeepApi, ApiResult } from '../../../src/shared/api';
import { readStatistics } from '../../../src/renderer/lib/statistics';
import { CHANNEL_SPECS } from '../../../src/shared/ipc';
import { validateIpcRequest } from '../../../src/main/ipc/validate-request';

let layout: StorageLayout; let store: LedgerStore; let now: number;
beforeEach(() => { layout = createTestLayout(); now = Date.parse('2026-10-20T04:00:00Z'); store = LedgerStore.open(storeOptions(layout, () => now)); });
afterEach(() => { store.close(); cleanupLayout(layout); });
const scope = (period: StatisticsPeriod = 'month', anchorDate = '2026-09-08', categoryIds: string[] = []): StatisticsInput => ({ period, anchorDate, categoryIds, snapshotRevision: null });
const add = (amountFen: number, occurredDate: string, categoryId = 'cat_food', name = '测试支出', extra: Partial<TransactionInput> = {}) => store.createTransaction(transactionInput({ amountFen, occurredDate, categoryId, name, ...extra }), randomUUID()).transaction;
function f02(): void {
  add(1800, '2026-09-08', 'cat_food', '午餐'); add(1626, '2026-09-08', 'cat_fruit', '购买水果'); add(1000, '2026-09-08', 'cat_food', '晚餐');
  add(85000, '2026-09-09', 'cat_repair', 'iPad维修'); add(5554, '2026-09-09', 'cat_digital', 'iPad保护膜'); add(1550, '2026-09-09', 'cat_food', '午餐');
}
/** 分别核对各视图、每个有效图点、全分类排行及明细账全范围整数合计（与分页行无关）。 */
function reconcile(input: StatisticsInput): string {
  const series = store.statisticsSeries(input); const bound = { ...input, snapshotRevision: series.scope.revision };
  const summary = store.statisticsSummary(bound); const ranking = store.statisticsTopCategories({ ...bound, pointMonth: null });
  const list = store.listTransactions({ filter: { dateStart: series.scope.start, dateEnd: series.scope.effectiveEnd, categoryIds: input.categoryIds, nameQuery: null, deleted: 'active' }, page: { limit: 1, cursor: null } });
  expect(summary.totalFen).toBe(series.totalFen); expect(list.filteredTotalFen).toBe(series.totalFen); expect(list.totalCount).toBe(summary.count);
  expect(ranking.totalFen).toBe(series.totalFen); expect(checkedTotal(series.points.map((point) => point.amountFen)).toString()).toBe(series.totalFen);
  expect(checkedTotal(ranking.items.map((item) => item.totalFen)).toString()).toBe(series.totalFen);
  expect([summary.scope.scopeId, ranking.scope.scopeId]).toEqual([series.scope.scopeId, series.scope.scopeId]);
  for (const point of series.points.filter((point) => !point.isFuture)) {
    const detail = input.period === 'year' ? store.statisticsTopCategories({ ...bound, pointMonth: point.pointKey }) : store.statisticsTopTransactions({ ...bound, pointDate: point.pointKey });
    expect('pointTotalFen' in detail ? detail.pointTotalFen : detail.totalFen).toBe(point.amountFen);
    const pointList = store.listTransactions({ filter: { dateStart: point.start, dateEnd: point.end < series.scope.effectiveEnd ? point.end : series.scope.effectiveEnd, categoryIds: input.categoryIds, nameQuery: null, deleted: 'active' }, page: { limit: 1, cursor: null } });
    expect(pointList.filteredTotalFen).toBe(point.amountFen);
  }
  return series.totalFen;
}
function expectCode(fn: () => unknown, code: string): void { try { fn(); throw new Error('expected rejection'); } catch (error) { expect(error).toBeInstanceOf(AppError); expect((error as AppError).code).toBe(code); } }

describe('S07 固定账本和同源聚合', () => {
  it.each<StatisticsPeriod>(['week', 'month', 'year'])('F02 %s：96530分与每个点/全范围明细/排行一致', (period) => { f02(); expect(reconcile(scope(period))).toBe('96530'); });
  it('F02 日Top3交易和年9月Top3分类、历史/当前日均、精确占比', () => {
    f02(); const summary = store.statisticsSummary(scope());
    expect(summary.dailyAverage).toEqual({ numeratorFen: '96530', denominatorDays: 30, displayYuan: '32.18' });
    expect(summary.categoryTotals.map((row) => [row.categoryId, row.totalFen, row.ratioPercent])).toEqual([['cat_repair', '85000', '88.06'], ['cat_digital', '5554', '5.75'], ['cat_food', '4350', '4.51'], ['cat_fruit', '1626', '1.68']]);
    expect(store.statisticsTopTransactions({ ...scope(), pointDate: '2026-09-08' }).items.map((item) => [item.name, item.amountFen])).toEqual([['午餐', '1800'], ['购买水果', '1626'], ['晚餐', '1000']]);
    expect(store.statisticsTopTransactions({ ...scope(), pointDate: '2026-09-09' }).pointTotalFen).toBe('92104');
    const top = store.statisticsTopCategories({ ...scope('year'), pointMonth: '2026-09' });
    expect(top.totalFen).toBe('96530'); expect(top.items.map((item) => item.categoryId)).toEqual(['cat_repair', 'cat_digital', 'cat_food']);
    expect(store.statisticsSummary(scope('week')).dailyAverage.displayYuan).toBe('137.90');
    expect(store.statisticsSummary(scope('year')).dailyAverage).toMatchObject({ denominatorDays: 293, displayYuan: '3.29' });
  });
  it('F03-A：第四笔计总额、多日同类先聚合、少于三项不补假行', () => {
    f02(); add(800, '2026-09-08', 'cat_food', '早餐'); add(2000, '2026-09-10', 'cat_food', '晚餐');
    const day = store.statisticsTopTransactions({ ...scope(), pointDate: '2026-09-08' });
    expect(day.pointTotalFen).toBe('5226'); expect(day.items.map((item) => item.amountFen)).toEqual(['1800', '1626', '1000']);
    expect(store.statisticsTopTransactions({ ...scope(), pointDate: '2026-09-10' }).items).toHaveLength(1);
    expect(store.statisticsTopCategories({ ...scope('year'), pointMonth: '2026-09' }).items.map((item) => [item.categoryId, item.totalFen])).toEqual([['cat_repair', '85000'], ['cat_food', '7150'], ['cat_digital', '5554']]);
    expect(reconcile(scope('year'))).toBe('99330'); expect(store.statisticsSummary(scope()).dailyAverage.displayYuan).toBe('33.11');
  });
  it('F03-B：跨月周、年内多个月与各月分类不串额', () => {
    f02(); add(12000, '2026-08-31', 'cat_travel'); add(1000, '2026-09-01', 'cat_fruit'); add(3000, '2026-10-01'); add(2000, '2026-10-02', 'cat_fruit');
    expect(reconcile(scope('week', '2026-08-31'))).toBe('13000'); expect(reconcile(scope('month', '2026-09-01'))).toBe('97530'); expect(reconcile(scope('year'))).toBe('114530');
    expect(store.statisticsTopCategories({ ...scope('year'), pointMonth: '2026-09' }).items[2]?.totalFen).toBe('4350');
    expect(store.statisticsTopCategories({ ...scope('year'), pointMonth: '2026-10' }).items.map((item) => item.totalFen)).toEqual(['3000', '2000']);
  });
  it('F03-S：日Top3同额已知优先/时刻降序/id升序，与createdAt不同', () => {
    const times = ['18:00', '18:00', '12:00', null, null];
    times.forEach((time, i) => {
      const item = add(1000, '2026-09-11', 'cat_food', `T20${i + 1}消费`, { occurredTime: time, timePrecision: time ? 'minute' : 'date' });
      openWritable(store.diagnostics().databasePath, (db) => db.prepare('UPDATE "transaction" SET id=?, created_at=? WHERE id=?').run(`T20${i + 1}`, `2026-09-12T00:00:0${i + 1}.000Z`, item.id));
    });
    const top = store.statisticsTopTransactions({ ...scope(), pointDate: '2026-09-11' });
    expect(top.pointTotalFen).toBe('5000'); expect(top.items.map((item) => item.transactionId)).toEqual(['T201', 'T202', 'T203']);
    const list = store.listTransactions({ filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' }, page: { limit: 50, cursor: null } });
    expect(list.items.map((item) => item.id)).toEqual(['T202', 'T201', 'T203', 'T205', 'T204']);
    expect(reconcile(scope())).toBe('5000');
  });
  it('未知时间同额直接id升序，不引入创建时间', () => {
    const records = [add(100, '2026-09-11'), add(100, '2026-09-11'), add(100, '2026-09-11'), add(100, '2026-09-11')];
    expect(store.statisticsTopTransactions({ ...scope(), pointDate: '2026-09-11' }).items.map((item) => item.transactionId)).toEqual(records.map((row) => row.id).sort().slice(0, 3));
  });
  it('F03-C：分类并列按ID、改名/调顺序/停用仍保持历史分类金额', () => {
    add(2000, '2026-09-12', 'cat_books'); add(2000, '2026-09-12', 'cat_study'); add(1000, '2026-09-13'); add(1000, '2026-09-13', 'cat_fruit');
    let category = store.listCategories(true).categories.find((row) => row.id === 'cat_books')!;
    category = store.updateCategory({ id: category.id, expectedVersion: category.version, patch: { name: '改名书籍', sortOrder: 9999 } }, randomUUID()).category;
    store.disableCategory({ id: category.id, expectedVersion: category.version }, randomUUID());
    const top = store.statisticsTopCategories({ ...scope('year'), pointMonth: '2026-09' });
    expect(top.items.map((row) => row.categoryId)).toEqual(['cat_books', 'cat_study', 'cat_food']); expect(top.items[0]?.name).toBe('改名书籍'); expect(reconcile(scope())).toBe('6000');
  });
  it('F03-L：闰年2月29点、普通2月28点、31日月、366/365年分母、跨年周7点', () => {
    add(2900, '2024-02-29', 'cat_books'); add(3100, '2024-03-01'); add(4000, '2024-12-31', 'cat_repair'); add(5000, '2025-01-01');
    expect(store.statisticsSeries(scope('month', '2024-02-29')).points).toHaveLength(29);
    expect(store.statisticsSeries(scope('month', '2025-02-01')).points).toHaveLength(28);
    expect(store.statisticsSeries(scope('month', '2024-03-01')).points).toHaveLength(31);
    expect(store.statisticsSummary(scope('month', '2024-02-29')).dailyAverage).toMatchObject({ denominatorDays: 29, displayYuan: '1.00' });
    expect(store.statisticsSummary(scope('year', '2024-02-29')).dailyAverage).toMatchObject({ denominatorDays: 366, displayYuan: '0.27' });
    expect(store.statisticsSummary(scope('year', '2025-01-01')).dailyAverage).toMatchObject({ denominatorDays: 365, displayYuan: '0.14' });
    const week = store.statisticsSeries(scope('week', '2025-01-01'));
    expect(week.scope).toMatchObject({ start: '2024-12-30', end: '2025-01-06' }); expect(week.points).toHaveLength(7);
    expect(reconcile(scope('week', '2025-01-01'))).toBe('9000'); expect(store.statisticsSummary(scope('week', '2025-01-01')).dailyAverage.displayYuan).toBe('12.86');
    expect(reconcile(scope('week', '2024-02-29'))).toBe('6000');
  });
  it.each<StatisticsPeriod>(['week', 'month', 'year'])('无交易 %s：完整补0、日均0.00、空Top3/排行', (period) => {
    const result = store.statisticsSeries(scope(period)); expect(result.points.every((point) => point.amountFen === '0')).toBe(true);
    expect(store.statisticsSummary(scope(period)).dailyAverage.displayYuan).toBe('0.00'); expect(store.statisticsTopCategories({ ...scope(period), pointMonth: null }).items).toEqual([]); expect(reconcile(scope(period))).toBe('0');
  });
  it('F03-F：当前周/月/年分母2/20/293，未来正式交易排除、未来点拒绝详情', () => {
    add(1000, '2026-10-19'); add(2000, '2026-10-20'); add(3000, '2026-10-21'); add(4000, '2026-11-01');
    for (const [period, days] of [['week', 2], ['month', 20], ['year', 293]] as const) {
      const input = scope(period, '2026-10-20'); expect(reconcile(input)).toBe('3000'); expect(store.statisticsSummary(input).dailyAverage.denominatorDays).toBe(days);
    }
    const series = store.statisticsSeries(scope('month', '2026-10-20'));
    expect(series.points[20]).toMatchObject({ amountFen: '0', isFuture: true }); expect(series.points[17]).toMatchObject({ amountFen: '0', isFuture: false });
    expectCode(() => store.statisticsTopTransactions({ ...scope('month', '2026-10-20'), pointDate: '2026-10-21' }), 'FUTURE_POINT');
    expectCode(() => store.statisticsTopCategories({ ...scope('year'), pointMonth: '2026-11' }), 'FUTURE_POINT');
    expect(store.listTransactions({ filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' }, page: { limit: 1, cursor: null } }).filteredTotalFen).toBe('10000');
  });
  it('上海午夜且revision不变时scopeId变化、今天和当前分母随日历更新', () => {
    add(5000, '2025-01-01'); now = Date.parse('2025-01-01T15:59:00Z');
    const first = store.statisticsSummary(scope('year', '2025-01-01')); expect(first.dailyAverage.denominatorDays).toBe(1);
    now = Date.parse('2025-01-01T16:01:00Z'); const next = store.statisticsSummary(scope('year', '2025-01-01'));
    expect(next.scope.revision).toBe(first.scope.revision); expect(next.scope.scopeId).not.toBe(first.scope.scopeId); expect(next.scope.today).toBe('2025-01-02'); expect(next.dailyAverage).toMatchObject({ denominatorDays: 2, displayYuan: '25.00' });
  });
  it('编辑/软删除/恢复刷新三种视图，旧revision拒绝、备份恢复世代切换', () => {
    f02(); const saved = store.statisticsSeries(scope());
    let tx = store.listTransactions({ filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: 'iPad维修', deleted: 'active' }, page: { limit: 1, cursor: null } }).items[0]!;
    const backup = store.createBackup({ kind: 'manual', containsPrivateDataAcknowledged: true }, randomUUID());
    tx = store.updateTransaction({ id: tx.id, expectedVersion: tx.version, patch: { amountFen: 86000 } }, randomUUID()).transaction;
    expectCode(() => store.statisticsSummary({ ...scope(), snapshotRevision: saved.scope.revision }), 'SNAPSHOT_STALE');
    for (const period of ['week', 'month', 'year'] as const) expect(reconcile(scope(period))).toBe('97530');
    tx = store.softDeleteTransaction({ id: tx.id, expectedVersion: tx.version }, randomUUID()).transaction;
    for (const period of ['week', 'month', 'year'] as const) expect(reconcile(scope(period))).toBe('11530');
    store.restoreTransaction({ id: tx.id, expectedVersion: tx.version }, randomUUID());
    for (const period of ['week', 'month', 'year'] as const) expect(reconcile(scope(period))).toBe('97530');
    const preview = store.restoreBackup({ mode: 'preview', backupId: backup.record.id }, null); if (!('restoreToken' in preview)) throw new Error('preview');
    store.restoreBackup({ mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true }, randomUUID());
    expect(store.statisticsSeries(scope()).scope.dataEpoch).not.toBe(saved.scope.dataEpoch);
    for (const period of ['week', 'month', 'year'] as const) expect(reconcile(scope(period))).toBe('96530');
  });
  it('统计分类筛选独立于分页/名称；读取不写revision，DB保持完整', () => {
    f02(); store.listTransactions({ filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: '午餐', deleted: 'active' }, page: { limit: 1, cursor: null } });
    const revision = store.currentRevision; expect(reconcile(scope('month', '2026-09-08', ['cat_food']))).toBe('4350'); expect(reconcile(scope())).toBe('96530');
    expect(store.currentRevision).toBe(revision); openReadOnly(store.diagnostics().databasePath, (db) => { expect(db.pragma('quick_check')).toEqual([{ quick_check: 'ok' }]); expect(db.pragma('foreign_key_check')).toEqual([]); });
  });
  it('日期/未来周期/周期外点/非法月份/年图日详情均拒绝', () => {
    expectCode(() => store.statisticsSeries(scope('month', '2025-02-29')), 'DATE_INVALID'); expectCode(() => store.statisticsSeries(scope('month', '2026-10-21')), 'FUTURE_PERIOD');
    expectCode(() => store.statisticsTopTransactions({ ...scope(), pointDate: '2026-10-01' }), 'POINT_OUTSIDE_SCOPE'); expectCode(() => store.statisticsTopTransactions({ ...scope('year'), pointDate: '2026-09-08' }), 'POINT_OUTSIDE_SCOPE');
    expectCode(() => store.statisticsTopCategories({ ...scope('year'), pointMonth: '2026-13' }), 'POINT_OUTSIDE_SCOPE'); expectCode(() => store.statisticsTopCategories({ ...scope(), pointMonth: '2026-09' }), 'POINT_OUTSIDE_SCOPE');
    expectCode(() => store.statisticsTopCategories({ ...scope('year'), pointMonth: '2025-09' }), 'POINT_OUTSIDE_SCOPE');
  });
  it('整数64位边界/超限拒绝、超过JS安全整数仍精确、显示半入四舍五入', () => {
    expect(checkedTotal(['9007199254740993', '1'])).toBe(9007199254740994n); expect(checkedTotal([MAX_TOTAL_FEN.toString()])).toBe(MAX_TOTAL_FEN);
    expectCode(() => checkedTotal([MAX_TOTAL_FEN.toString(), '1']), 'AMOUNT_TOTAL_OVERFLOW'); expect(roundedRatio(1n, 2n)).toBe('0.01'); expect(roundedRatio(1n, 3n)).toBe('0.00'); expect(roundedRatio(0n, 0n)).toBe('0.00');
  });
  it('四个IPC严格白名单：拒绝名称/删除/伪scope/过量分类/非法revision，要求epoch', () => {
    const request = (payload: unknown) => ({ contractVersion: 'bookkeep.v1', requestId: randomUUID(), dataEpoch: store.currentEpoch, payload });
    for (const spec of [CHANNEL_SPECS.statisticsSeries, CHANNEL_SPECS.statisticsSummary, CHANNEL_SPECS.statisticsTopCategories, CHANNEL_SPECS.statisticsTopTransactions]) {
      const extra = spec.channel.endsWith('topCategories') ? { pointMonth: null } : spec.channel.endsWith('topTransactions') ? { pointDate: '2026-09-08' } : {};
      expect(validateIpcRequest(spec, request({ ...scope(), ...extra })).payload).toMatchObject(scope());
      expectCode(() => validateIpcRequest(spec, request({ ...scope(), ...extra, nameQuery: 'x' })), 'PAYLOAD_INVALID');
      expectCode(() => validateIpcRequest(spec, request({ ...scope(), ...extra, deleted: 'all' })), 'PAYLOAD_INVALID');
      expectCode(() => validateIpcRequest(spec, request({ ...scope(), ...extra, scopeId: 'fake' })), 'PAYLOAD_INVALID');
      expectCode(() => validateIpcRequest(spec, request({ ...scope(), ...extra, snapshotRevision: -1 })), 'FIELD_INVALID');
      expectCode(() => validateIpcRequest(spec, request({ ...scope(), ...extra, categoryIds: Array(501).fill('cat_food') })), 'FIELD_INVALID');
    }
  });
});

function apiForStore() {
  const wrap = <T>(fn: () => T): ApiResult<T> => { try { return { ok: true, data: fn(), dataEpoch: store.currentEpoch, dataRevision: store.currentRevision }; } catch (error) { if (!(error instanceof AppError)) throw error; return { ok: false, error: error.toPayload(), dataEpoch: store.currentEpoch, dataRevision: store.currentRevision }; } };
  return { statistics: { series: async (input: StatisticsInput) => wrap(() => store.statisticsSeries(input)), summary: async (input: StatisticsInput) => wrap(() => store.statisticsSummary(input)), topCategories: async (input: StatisticsInput & { pointMonth: string | null }) => wrap(() => store.statisticsTopCategories(input)) }, category: { list: async () => wrap(() => store.listCategories(true)) } } as BookKeepApi;
}
describe('S07 渲染快照读取器', () => {
  it('revision变动自动整组重读，不混入旧卡片或分类', async () => {
    f02(); const api = apiForStore(); const read = api.statistics.summary; let changed = false;
    api.statistics.summary = async (input) => { if (!changed) { changed = true; add(100, '2026-09-08'); } return read(input); };
    expect((await readStatistics(api, scope())).summary.totalFen).toBe('96630');
  });
  it('同revision跨午夜scope变化时自动重读', async () => {
    f02(); const api = apiForStore(); const read = api.statistics.summary; let changed = false;
    api.statistics.summary = async (input) => { if (!changed) { changed = true; now = Date.parse('2026-10-20T16:01:00Z'); } return read(input); };
    const result = await readStatistics(api, scope('year')); expect(result.summary.dailyAverage.denominatorDays).toBe(294); expect(result.series.scope.today).toBe('2026-10-21');
  });
  it('持续快照变化只重试3组并明确失败', async () => {
    const api = apiForStore(); const read = api.statistics.summary; let calls = 0;
    api.statistics.summary = async (input) => { calls++; add(1, '2026-09-08'); return read(input); };
    await expect(readStatistics(api, scope())).rejects.toMatchObject({ code: 'SNAPSHOT_STALE' }); expect(calls).toBe(3);
  });
  it('同revision但信封世代不同也整组重读，不能混用恢复前后结果', async () => {
    f02(); const api = apiForStore(); const read = api.statistics.summary; let calls = 0;
    api.statistics.summary = async (input) => { const reply = await read(input); calls++; return calls === 1 ? { ...reply, dataEpoch: randomUUID() } : reply; };
    expect((await readStatistics(api, scope())).summary.totalFen).toBe('96530'); expect(calls).toBe(2);
  });
  it('服务金额互不一致时明确完整性错误，不显示近似或0', async () => {
    f02(); const api = apiForStore(); const read = api.statistics.summary;
    api.statistics.summary = async (input) => { const reply = await read(input); return reply.ok ? { ...reply, data: { ...reply.data, totalFen: '96531' } } : reply; };
    await expect(readStatistics(api, scope())).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
  });
});
