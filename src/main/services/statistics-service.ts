/** S07：唯一正式交易事实源；每个接口一个DEFERRED只读快照，不读取候选或分页UI。 */
import { todayInShanghai, isTransactionDate } from '../../shared/date';
import { AppError } from '../../shared/errors';
import { isIdLike } from '../../shared/ipc';
import { calendarDays, calendarShift, periodRange } from '../../shared/statistics';
import type { CategoryTotal, StatisticsInput, StatisticsScope, StatisticsSeries, StatisticsSummary, TopCategoriesInput, TopCategoriesResult, TopTransactionsInput, TopTransactionsResult } from '../../shared/statistics';
import type { LedgerServiceContext } from './ledger-service';
import { readDataRevision } from '../db/ledger-repo';
import { translateSqliteError } from '../db/sqlite';
import { hashPayload } from './canonical';

export const MAX_TOTAL_FEN = 9_223_372_036_854_775_807n;
export function checkedTotal(values: Iterable<string>): bigint {
  let total = 0n;
  for (const value of values) {
    total += BigInt(value);
    if (total < 0n || total > MAX_TOTAL_FEN) throw new AppError('AMOUNT_TOTAL_OVERFLOW');
  }
  return total;
}
function twoPlaces(value: bigint): string { return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`; }
export function roundedRatio(numerator: bigint, denominator: bigint): string {
  return twoPlaces(denominator === 0n ? 0n : (numerator * 2n + denominator) / (denominator * 2n));
}
interface DayRow { date: string; amount: string; count: number }
interface Snapshot { scope: StatisticsScope; days: DayRow[]; total: bigint; where: string; params: unknown[] }

function read<T>(ctx: LedgerServiceContext, input: StatisticsInput, fn: (snapshot: Snapshot) => T): T {
  if (!isTransactionDate(input.anchorDate)) throw new AppError('DATE_INVALID');
  if (!['week', 'month', 'year'].includes(input.period)) throw new AppError('RANGE_INVALID');
  if (!Array.isArray(input.categoryIds) || input.categoryIds.length > 500 || !input.categoryIds.every(isIdLike)) throw new AppError('FIELD_INVALID');
  if (input.snapshotRevision !== null && (!Number.isSafeInteger(input.snapshotRevision) || input.snapshotRevision < 0)) throw new AppError('FIELD_INVALID');
  const today = todayInShanghai(ctx.clock());
  if (input.anchorDate > today) throw new AppError('FUTURE_PERIOD');
  const { start, end } = periodRange(input.period, input.anchorDate);
  const effectiveEnd = end < calendarShift(today, 1) ? end : calendarShift(today, 1);
  const ownTransaction = !ctx.db.inTransaction;
  let began = false;
  try {
    if (ownTransaction) { ctx.db.exec('BEGIN DEFERRED'); began = true; }
    const revision = readDataRevision(ctx.db, ctx.ledgerId);
    if (input.snapshotRevision !== null && revision !== input.snapshotRevision) throw new AppError('SNAPSHOT_STALE');
    const categoryIds = [...new Set(input.categoryIds)].sort();
    const normalized = { period: input.period, anchorDate: start, categoryIds, ledgerId: ctx.ledgerId, dataEpoch: ctx.epoch, revision, today, timezone: 'Asia/Shanghai' as const, start, end, effectiveEnd };
    const scope: StatisticsScope = { ...normalized, scopeId: hashPayload(normalized) };
    const where = `t.ledger_id = ? AND t.deleted_at IS NULL AND t.occurred_date >= ? AND t.occurred_date < ?${categoryIds.length ? ` AND t.category_id IN (${categoryIds.map(() => '?').join(',')})` : ''}`;
    const params: unknown[] = [ctx.ledgerId, start, effectiveEnd, ...categoryIds];
    const days = ctx.db.prepare<DayRow>(`SELECT t.occurred_date AS date, CAST(SUM(t.amount_fen) AS TEXT) AS amount, COUNT(*) AS count FROM "transaction" t WHERE ${where} GROUP BY t.occurred_date ORDER BY t.occurred_date`).all(...params);
    const total = checkedTotal(days.map((day) => day.amount));
    const result = fn({ scope, days, total, where, params });
    if (began) { ctx.db.exec('COMMIT'); began = false; }
    return result;
  } catch (error) {
    if (began) { try { ctx.db.exec('ROLLBACK'); } catch { /* 保留最初失败的安全错误。 */ } }
    if (error instanceof Error && error.message.includes('integer overflow')) throw new AppError('AMOUNT_TOTAL_OVERFLOW');
    throw translateSqliteError(error);
  }
}
function categories(ctx: LedgerServiceContext, snapshot: Snapshot, month: string | null = null): TopCategoriesResult {
  const { scope, where, params } = snapshot;
  const rows = ctx.db.prepare<{ categoryId: string; name: string; iconKey: string; totalFen: string }>(`SELECT t.category_id AS categoryId, c.name, c.icon_key AS iconKey, CAST(SUM(t.amount_fen) AS TEXT) AS totalFen FROM "transaction" t JOIN category c ON c.id=t.category_id AND c.ledger_id=t.ledger_id WHERE ${where}${month ? ' AND substr(t.occurred_date,1,7)=?' : ''} GROUP BY t.category_id ORDER BY SUM(t.amount_fen) DESC, t.category_id COLLATE BINARY ASC`).all(...params, ...(month ? [month] : []));
  const total = checkedTotal(rows.map((row) => row.totalFen));
  const items: CategoryTotal[] = rows.map((row) => ({ ...row, ratioPercent: roundedRatio(BigInt(row.totalFen) * 10_000n, total) }));
  return { scope, totalFen: total.toString(), items: month ? items.slice(0, 3) : items };
}
export function statisticsSeries(ctx: LedgerServiceContext, input: StatisticsInput): StatisticsSeries {
  return read(ctx, input, ({ scope, days, total }) => {
    const amounts = new Map<string, bigint>();
    for (const row of days) {
      const key = input.period === 'year' ? row.date.slice(0, 7) : row.date;
      amounts.set(key, (amounts.get(key) ?? 0n) + BigInt(row.amount));
    }
    const points = [];
    let start = scope.start;
    while (start < scope.end) {
      const end = input.period === 'year' ? periodRange('month', start).end : calendarShift(start, 1);
      const pointKey = input.period === 'year' ? start.slice(0, 7) : start;
      points.push({ pointKey, label: input.period === 'year' ? `${Number(start.slice(5, 7))}月` : `${Number(start.slice(5, 7))}/${Number(start.slice(8))}`, start, end, amountFen: (amounts.get(pointKey) ?? 0n).toString(), isFuture: start > scope.today });
      start = end;
    }
    return { scope, totalFen: total.toString(), points };
  });
}
export function statisticsSummary(ctx: LedgerServiceContext, input: StatisticsInput): StatisticsSummary {
  return read(ctx, input, (snapshot) => {
    const { scope, total, days } = snapshot;
    const denominatorDays = calendarDays(scope.start, scope.effectiveEnd);
    const count = days.reduce((sum, row) => sum + row.count, 0);
    if (!Number.isSafeInteger(count)) throw new AppError('COUNTER_EXHAUSTED');
    return { scope, totalFen: total.toString(), count, dailyAverage: { numeratorFen: total.toString(), denominatorDays, displayYuan: roundedRatio(total, BigInt(denominatorDays)) }, categoryTotals: categories(ctx, snapshot).items };
  });
}
export function statisticsTopTransactions(ctx: LedgerServiceContext, input: TopTransactionsInput): TopTransactionsResult {
  return read(ctx, input, ({ scope, days, where, params }) => {
    if (input.period === 'year' || !isTransactionDate(input.pointDate) || input.pointDate < scope.start || input.pointDate >= scope.end) throw new AppError('POINT_OUTSIDE_SCOPE');
    if (input.pointDate > scope.today) throw new AppError('FUTURE_POINT');
    const items = ctx.db.prepare<TopTransactionsResult['items'][number]>(`SELECT t.id AS transactionId, t.name, CAST(t.amount_fen AS TEXT) AS amountFen, t.occurred_time AS occurredTime, t.time_precision AS timePrecision FROM "transaction" t WHERE ${where} AND t.occurred_date=? ORDER BY t.amount_fen DESC, CASE WHEN t.occurred_time IS NULL THEN 1 ELSE 0 END, t.occurred_time DESC, t.id COLLATE BINARY ASC LIMIT 3`).all(...params, input.pointDate);
    return { scope, pointTotalFen: days.find((row) => row.date === input.pointDate)?.amount ?? '0', items };
  });
}
export function statisticsTopCategories(ctx: LedgerServiceContext, input: TopCategoriesInput): TopCategoriesResult {
  return read(ctx, input, (snapshot) => {
    if (input.pointMonth !== null) {
      if (input.period !== 'year' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.pointMonth) || `${input.pointMonth}-01` < snapshot.scope.start || `${input.pointMonth}-01` >= snapshot.scope.end) throw new AppError('POINT_OUTSIDE_SCOPE');
      if (input.pointMonth > snapshot.scope.today.slice(0, 7)) throw new AppError('FUTURE_POINT');
    }
    return categories(ctx, snapshot, input.pointMonth);
  });
}
