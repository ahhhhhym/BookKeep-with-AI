import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import type { ApiResult, BookKeepApi } from '../../../src/shared/api';
import type { CategoryView, TransactionListInput, TransactionListResult } from '../../../src/shared/entities';
import { AppError } from '../../../src/shared/errors';
import { todayInShanghai } from '../../../src/shared/date';
import { dateGroupLabel, displayFen, EMPTY_FILTER, expenseDraft, LedgerReader, MutationAttempt, untilShanghaiMidnight, validateExpense } from '../../../src/renderer/lib/ledger';
import { cleanupLayout, createTestLayout, fixedClock, openReadOnly, storeOptions, transactionInput } from './helpers';

const resources: { layout: ReturnType<typeof createTestLayout>; store: LedgerStore }[] = [];
function setup() {
  const layout = createTestLayout(); const clock = fixedClock();
  const options = storeOptions(layout, clock.clock);
  const store = LedgerStore.open(options);
  resources.push({ layout, store }); return { layout, store, options };
}
function page(store: LedgerStore, input: Partial<TransactionListInput> = {}) {
  return store.listTransactions({ filter: EMPTY_FILTER, page: { limit: 100, cursor: null }, ...input });
}
function result<T>(fn: () => T): Promise<ApiResult<T>> {
  try { return Promise.resolve({ ok: true, data: fn() }); }
  catch (error) { const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR'; return Promise.resolve({ ok: false, error: { code, message: code, fieldErrors: [], details: {}, retryable: true, retryAfterMs: null } }); }
}
function apiFor(store: LedgerStore): BookKeepApi {
  const withEpoch = async <T>(promise: Promise<ApiResult<T>>): Promise<ApiResult<T>> => ({ ...await promise, dataEpoch: store.ensureDefault().dataEpoch });
  const api = { category: { list: () => withEpoch(result(() => store.listCategories(true))) }, transaction: { list: (input: TransactionListInput) => withEpoch(result(() => store.listTransactions(input))) } } as BookKeepApi;
  vi.stubGlobal('window', { bookkeep: api }); return api;
}
afterEach(() => { vi.unstubAllGlobals(); for (const { store, layout } of resources.splice(0)) { store.close(); cleanupLayout(layout); } });

describe('S06 表单与真实SQLite联动', () => {
  it('F01 输入→分→显示→编辑→软删→恢复→关闭重开始终一致，原键不重复', () => {
    const { store, options } = setup();
    const values = [['双荟', '4.80', '18:00'], ['晚餐', '15', '19:00'], ['午餐', '13.50', '12:00']];
    const categories = store.listCategories(true).categories;
    const records = values.map(([name, amount, time]) => {
      const draft = { ...expenseDraft(null), date: '2026-09-27', name: name!, amount: amount!, categoryId: 'cat_food', knownTime: true, time: time! };
      const input = validateExpense(draft, categories, null).input!;
      const attempt = new MutationAttempt(randomUUID); const id = attempt.forPayload(input);
      const created = store.createTransaction(input, id).transaction;
      expect(store.createTransaction(input, attempt.forPayload(input)).transaction.id).toBe(created.id);
      return created;
    });
    expect(page(store).filteredTotalFen).toBe('3330'); expect(displayFen(page(store).filteredTotalFen)).toBe('33.30');
    expect(page(store).items.map((row) => row.name)).toEqual(['晚餐', '双荟', '午餐']);
    const edited = store.updateTransaction({ id: records[0]!.id, expectedVersion: 1, patch: { amountFen: 500 } }, randomUUID());
    expect(edited.transaction.amountFen).toBe(500); expect(page(store).filteredTotalFen).toBe('3350');
    const deleted = store.softDeleteTransaction({ id: records[1]!.id, expectedVersion: 1 }, randomUUID()).transaction;
    expect(page(store).filteredTotalFen).toBe('1850');
    const restoreId = randomUUID(); const restore = { id: deleted.id, expectedVersion: deleted.version };
    store.restoreTransaction(restore, restoreId); store.restoreTransaction(restore, restoreId);
    expect(page(store).filteredTotalFen).toBe('3350'); expect(page(store).totalCount).toBe(3);
    store.updateTransaction({ id: records[0]!.id, expectedVersion: 2, patch: { amountFen: 480 } }, randomUUID());
    const dbTotal = openReadOnly(store.diagnostics().databasePath, (db) => db.prepare<{ total: number; count: number }>('SELECT SUM(amount_fen) AS total, COUNT(*) AS count FROM "transaction" WHERE deleted_at IS NULL').get());
    expect(dbTotal).toEqual({ total: 3330, count: 3 });
    store.close(); const restarted = LedgerStore.open(options);
    try { expect(page(restarted).filteredTotalFen).toBe('3330'); expect(displayFen(page(restarted).dateGroups[0]!.totalFen)).toBe('33.30'); }
    finally { restarted.close(); }
  });
  it('无效金额/名称/日期/分类不生成输入，不修改用户原始文本', () => {
    const { store } = setup(); const cats = store.listCategories(true).categories;
    for (const amount of ['', '0', '-1', '1.001', 'abc', '1e2', '10,000.00', '10000000.00']) {
      const draft = { ...expenseDraft(null), name: '午餐', categoryId: 'cat_food', amount };
      expect(validateExpense(draft, cats, null).errors.amount).toBeTruthy(); expect(draft.amount).toBe(amount);
    }
    const invalid = validateExpense({ ...expenseDraft(null), amount: '1', date: '2026-02-30' }, cats, null);
    expect(Object.keys(invalid.errors)).toEqual(['date', 'name', 'categoryId']);
    for (const amount of ['0.01', '9999999.99']) expect(validateExpense({ ...expenseDraft(null), amount, name: '边界', categoryId: 'cat_food' }, cats, null).input).not.toBeNull();
    expect(page(store).totalCount).toBe(0);
  });
  it('已停用原分类未改可保留，不能新增或改选停用分类；未知时间存null', () => {
    const { store } = setup(); const original = store.createTransaction(transactionInput(), randomUUID()).transaction;
    const old = store.listCategories(true).categories.find((item) => item.id === 'cat_food')!;
    store.disableCategory({ id: old.id, expectedVersion: old.version }, randomUUID());
    const cats = store.listCategories(true).categories;
    const draft = { ...expenseDraft(original), name: '午餐修改' };
    const input = validateExpense(draft, cats, original).input!;
    expect(input.occurredTime).toBeNull(); expect(input.timePrecision).toBe('date');
    expect(validateExpense(draft, cats, null).errors.categoryId).toBeTruthy();
    const updated = store.updateTransaction({ id: original.id, expectedVersion: original.version, patch: input }, randomUUID());
    expect(updated.transaction.categoryId).toBe('cat_food'); expect(page(store).filteredTotalFen).toBe('1800');
  });
  it('F02 搜索、日期含尾转换、分类和删除集独立；只用服务端汇总', () => {
    const { store } = setup();
    for (const [date, name, cat, amount] of [['2026-09-08', '午餐', 'cat_food', 1800], ['2026-09-08', '水果', 'cat_fruit', 1626], ['2026-09-08', '晚餐', 'cat_food', 1000], ['2026-09-09', '维修', 'cat_repair', 85000], ['2026-09-09', '膜', 'cat_digital', 5554], ['2026-09-09', '午餐', 'cat_food', 1550]] as const) {
      store.createTransaction(transactionInput({ name, occurredDate: date, categoryId: cat, amountFen: amount }), randomUUID());
    }
    expect(page(store).filteredTotalFen).toBe('96530');
    const searched = page(store, { filter: { ...EMPTY_FILTER, nameQuery: '午餐', dateStart: '2026-09-08', dateEnd: '2026-09-10' } });
    expect(searched.filteredTotalFen).toBe('3350'); expect(searched.dateGroups.map((group) => group.totalFen)).toEqual(['1550', '1800']);
    expect(page(store, { filter: { ...EMPTY_FILTER, categoryIds: ['cat_food'] } }).filteredTotalFen).toBe('4350');
  });
});

describe('S06 快照读取及日期', () => {
  it('超过一页同日记录合并组头，第一页小计即为完整组总额', async () => {
    const { store } = setup(); for (let index = 0; index < 57; index++) store.createTransaction(transactionInput({ amountFen: 1, name: `支出${index}` }), randomUUID());
    let output: TransactionListResult | null = null; const api = apiFor(store);
    const reader = new LedgerReader(api, (value) => { output = value; });
    await reader.read(EMPTY_FILTER); expect(output!.items.length).toBe(50); expect(output!.dateGroups).toHaveLength(1); expect(output!.dateGroups[0]!.totalFen).toBe('57');
    await reader.read(EMPTY_FILTER, true); expect(output!.items).toHaveLength(57); expect(new Set(output!.items.map((row) => row.id)).size).toBe(57); expect(output!.dateGroups).toHaveLength(1); expect(output!.filteredTotalFen).toBe('57');
  });
  it('分页期间发生写入使cursor失效，自动重读第一页且不拼接旧行', async () => {
    const { store } = setup(); for (let index = 0; index < 52; index++) store.createTransaction(transactionInput({ amountFen: 1 }), randomUUID());
    let output: TransactionListResult | null = null; const reader = new LedgerReader(apiFor(store), (value) => { output = value; });
    await reader.read(EMPTY_FILTER);
    store.createTransaction(transactionInput({ amountFen: 7 }), randomUUID());
    await reader.read(EMPTY_FILTER, true); expect(output!.items).toHaveLength(50); expect(output!.filteredTotalFen).toBe('59');
    await reader.read(EMPTY_FILTER, true); expect(output!.items).toHaveLength(53); expect(new Set(output!.items.map((row) => row.id)).size).toBe(53);
  });
  it('STALE_EPOCH只重试读，且旧筛选迟到响应不能盖过新筛选', async () => {
    const { store } = setup(); store.createTransaction(transactionInput(), randomUUID()); const api = apiFor(store);
    const realList = api.transaction.list; let failOnce = true;
    api.transaction.list = (input) => { if (failOnce) { failOnce = false; return result(() => { throw new AppError('STALE_EPOCH'); }); } return realList(input); };
    const outputs: TransactionListResult[] = []; const reader = new LedgerReader(api, (value) => outputs.push(value));
    await reader.read(EMPTY_FILTER); expect(outputs).toHaveLength(1);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    api.transaction.list = async (input) => { if (!input.filter.nameQuery) await barrier; return realList(input); };
    const slow = reader.read(EMPTY_FILTER); await reader.read({ ...EMPTY_FILTER, nameQuery: '找不到' }); release(); await slow;
    expect(outputs.at(-1)!.totalCount).toBe(0); expect(outputs.at(-1)!.filterEcho.nameQuery).toBe('找不到'); expect(outputs).toHaveLength(2);
  });
  it('上海午夜、跨年、星期与无时区漂移，未来/长名不伪造时刻', () => {
    const before = Date.parse('2026-12-31T15:59:59Z'); const after = before + 1000;
    expect(todayInShanghai(before)).toBe('2026-12-31'); expect(todayInShanghai(after)).toBe('2027-01-01');
    expect(untilShanghaiMidnight(before)).toBe(1025);
    expect(dateGroupLabel('2026-12-31', '2027-01-01')).toBe('昨天 · 2026年12月31日 星期四');
    expect(dateGroupLabel('2027-01-01', '2027-01-01')).toBe('今天 · 1月1日 星期五');
    expect(displayFen('900719925474099100')).toBe('9007199254740991.00');
    const cats = [{ id: 'cat_food', enabled: true }] as CategoryView[];
    const draft = { ...expenseDraft(null), name: '消费'.repeat(50), amount: '1', categoryId: 'cat_food', date: '2027-01-01' };
    expect(validateExpense(draft, cats, null).input?.occurredTime).toBeNull();
  });
});
