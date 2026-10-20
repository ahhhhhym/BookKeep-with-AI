import type { BookKeepApi } from '../../shared/api';
import type { CategoryView, TransactionFilter, TransactionInput, TransactionListResult, TransactionView } from '../../shared/entities';
import { parseAmountYuanToFen, formatFenToYuan } from '../../shared/amount';
import { isTransactionDate, isValidTimeString, todayInShanghai } from '../../shared/date';
import { checkOptionalText, checkRequiredText } from '../../shared/text';
import { BridgeError, errorCodeOf } from './bridge';

export const EMPTY_FILTER: TransactionFilter = { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' };

/** 聚合额跨IPC为十进制字符串，保持整数精度直到格式化完成。 */
export function displayFen(fen: string | number): string {
  const value = BigInt(fen);
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function dateGroupLabel(date: string, today = todayInShanghai()): string {
  const [year, month, day] = date.split('-');
  const relative = date === today ? '今天 · ' : date === shiftDate(today, -1) ? '昨天 · ' : '';
  const full = `${year !== today.slice(0, 4) ? `${year}年` : ''}${Number(month)}月${Number(day)}日`;
  const weekday = '日一二三四五六'[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${relative}${full} 星期${weekday}`;
}

/** 日历刷新定时器，非保存/进度计时器；UTC+8 无夏令时。 */
export function untilShanghaiMidnight(now = Date.now()): number {
  const day = 86_400_000;
  return day - ((now + 8 * 3_600_000) % day) + 25;
}

export interface ExpenseDraft {
  amount: string; date: string; name: string; categoryId: string;
  knownTime: boolean; time: string; merchant: string; note: string;
}

export function expenseDraft(transaction: TransactionView | null): ExpenseDraft {
  return transaction ? {
    amount: formatFenToYuan(transaction.amountFen), date: transaction.occurredDate,
    name: transaction.name, categoryId: transaction.categoryId,
    knownTime: transaction.timePrecision === 'minute', time: transaction.occurredTime ?? '',
    merchant: transaction.merchant ?? '', note: transaction.note ?? '',
  } : { amount: '', date: todayInShanghai(), name: '', categoryId: '', knownTime: false, time: '', merchant: '', note: '' };
}

export function validateExpense(draft: ExpenseDraft, categories: CategoryView[], original: TransactionView | null):
  { errors: Partial<Record<keyof ExpenseDraft, string>>; input: TransactionInput | null } {
  const errors: Partial<Record<keyof ExpenseDraft, string>> = {};
  const amount = parseAmountYuanToFen(draft.amount);
  if (!amount.ok) errors.amount = '请输入0.01～9,999,999.99元，最多两位小数。';
  if (!isTransactionDate(draft.date)) errors.date = '请选择有效的完整日期（1900-01-01～9998-12-31）。';
  const name = checkRequiredText(draft.name, 100);
  if (!name.ok) errors.name = draft.name.trim() ? '名称最多100字，不能含控制字符。' : '请填写购买物或服务名称。';
  const category = categories.find((item) => item.id === draft.categoryId);
  if (!category) errors.categoryId = '请选择消费分类。';
  else if (!category.enabled && original?.categoryId !== category.id) errors.categoryId = '该分类已停用，请选择启用中的分类。';
  if (draft.knownTime && !isValidTimeString(draft.time)) errors.time = '请输入有效时刻（00:00～23:59），未知请选仅日期。';
  const merchant = checkOptionalText(draft.merchant, 100);
  const note = checkOptionalText(draft.note, 500, { allowLineBreaks: true });
  if (!merchant.ok) errors.merchant = '商户最多100字，不能含控制字符。';
  if (!note.ok) errors.note = '备注最多500字，不能含非法控制字符。';
  if (Object.keys(errors).length || !amount.ok || !name.ok || !merchant.ok || !note.ok) return { errors, input: null };
  return { errors, input: { amountFen: amount.fen, occurredDate: draft.date, name: name.value,
    categoryId: draft.categoryId, timePrecision: draft.knownTime ? 'minute' : 'date',
    occurredTime: draft.knownTime ? draft.time : null, merchant: merchant.value, note: note.value } };
}

/** 相同载荷重试使用原键；UI在不确定结果期间锁定载荷。 */
export class MutationAttempt {
  private fingerprint = '';
  private id = '';
  constructor(private readonly uuid: () => string = () => crypto.randomUUID()) {}
  forPayload(payload: unknown): string {
    const fingerprint = JSON.stringify(payload);
    if (fingerprint !== this.fingerprint || !this.id) {
      this.fingerprint = fingerprint;
      this.id = this.uuid();
    }
    return this.id;
  }
  reset(): void { this.id = ''; this.fingerprint = ''; }
}

/** 保持服务端全序/完整组小计，不从页面行求和；拒绝混拼不同修订号。 */
export function mergePages(previous: TransactionListResult, next: TransactionListResult): TransactionListResult {
  if (previous.snapshotRevision !== next.snapshotRevision || JSON.stringify(previous.filterEcho) !== JSON.stringify(next.filterEcho)) {
    throw Object.assign(new Error('SNAPSHOT_STALE'), { code: 'SNAPSHOT_STALE' });
  }
  const ids = new Set(previous.items.map((item) => item.id));
  const groups = new Map(previous.dateGroups.map((group) => [group.date, group]));
  for (const group of next.dateGroups) groups.set(group.date, group);
  return { ...next, items: [...previous.items, ...next.items.filter((item) => !ids.has(item.id))], dateGroups: [...groups.values()] };
}

export class LedgerReader {
  private sequence = 0;
  private current: TransactionListResult | null = null;
  private epoch: string | null = null;
  constructor(private readonly api: BookKeepApi, private readonly publish: (result: TransactionListResult, categories: CategoryView[], reset: boolean, epoch: string) => void,
    private readonly onReset: () => void = () => undefined) {}
  cancel(): void { this.sequence++; }
  async read(filter: TransactionFilter, append = false): Promise<void> {
    const sequence = ++this.sequence;
    let previous = append ? this.current : null;
    for (let retry = 0; retry < 3; retry++) {
      try {
        const [response, categoryResponse] = await Promise.all([
          this.api.transaction.list({ filter, page: { limit: 50, cursor: previous?.nextCursor ?? null } }),
          this.api.category.list({ includeDisabled: true }),
        ]);
        if (sequence !== this.sequence) return;
        if (!response.ok) throw new BridgeError(response.error.code, response.error);
        if (!categoryResponse.ok) throw new BridgeError(categoryResponse.error.code, categoryResponse.error);
        const result = response.data; const categories = categoryResponse.data;
        if (!response.dataEpoch || categoryResponse.dataEpoch !== response.dataEpoch) { previous = null; this.onReset(); continue; }
        if (categories.revision !== result.snapshotRevision) { previous = null; this.onReset(); continue; }
        if (previous && this.epoch !== response.dataEpoch) { previous = null; this.onReset(); continue; }
        const merged = previous ? mergePages(previous, result) : result;
        this.current = merged;
        this.epoch = response.dataEpoch;
        this.publish(merged, categories.categories, !previous, response.dataEpoch);
        return;
      } catch (error) {
        if (sequence !== this.sequence) return;
        const code = errorCodeOf(error) === 'UNKNOWN' && typeof error === 'object' && error && 'code' in error ? error.code : errorCodeOf(error);
        if (!['SNAPSHOT_STALE', 'STALE_EPOCH', 'TOKEN_EXPIRED'].includes(String(code))) throw error;
        previous = null; this.onReset();
      }
    }
    throw Object.assign(new Error('SNAPSHOT_STALE'), { code: 'SNAPSHOT_STALE' });
  }
}
