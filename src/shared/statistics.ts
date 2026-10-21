import { isTransactionDate, MAX_RANGE_END_SENTINEL, MIN_TRANSACTION_DATE } from './date';
import { AppError } from './errors';
import type { TimePrecision } from './date';

export type StatisticsPeriod = 'week' | 'month' | 'year';
export interface StatisticsInput {
  period: StatisticsPeriod;
  anchorDate: string;
  categoryIds: string[];
  snapshotRevision: number | null;
}
export interface StatisticsScope extends Omit<StatisticsInput, 'snapshotRevision'> {
  scopeId: string;
  ledgerId: string;
  dataEpoch: string;
  revision: number;
  today: string;
  timezone: 'Asia/Shanghai';
  start: string;
  end: string;
  effectiveEnd: string;
}
export interface StatisticsPoint {
  pointKey: string; label: string; start: string; end: string; amountFen: string; isFuture: boolean;
}
export interface StatisticsSeries { scope: StatisticsScope; totalFen: string; points: StatisticsPoint[] }
export interface CategoryTotal {
  categoryId: string; name: string; iconKey: string; totalFen: string; ratioPercent: string;
}
export interface StatisticsSummary {
  scope: StatisticsScope; totalFen: string; count: number;
  dailyAverage: { numeratorFen: string; denominatorDays: number; displayYuan: string };
  categoryTotals: CategoryTotal[];
}
export interface TopTransactionsInput extends StatisticsInput { pointDate: string }
export interface TopCategoriesInput extends StatisticsInput { pointMonth: string | null }
export interface TopTransaction {
  transactionId: string; name: string; amountFen: string; occurredTime: string | null; timePrecision: TimePrecision;
}
export interface TopTransactionsResult { scope: StatisticsScope; pointTotalFen: string; items: TopTransaction[] }
export interface TopCategoriesResult { scope: StatisticsScope; totalFen: string; items: CategoryTotal[] }

export function calendarShift(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function calendarDays(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}
export function periodRange(period: StatisticsPeriod, anchor: string): { start: string; end: string } {
  if (!isTransactionDate(anchor)) throw new AppError('DATE_INVALID');
  let start: string; let end: string;
  if (period === 'week') {
    const day = new Date(`${anchor}T00:00:00Z`).getUTCDay();
    start = calendarShift(anchor, -((day + 6) % 7)); end = calendarShift(start, 7);
  } else if (period === 'month') {
    start = `${anchor.slice(0, 7)}-01`;
    const value = new Date(`${start}T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() + 1);
    end = value.toISOString().slice(0, 10);
  } else if (period === 'year') {
    start = `${anchor.slice(0, 4)}-01-01`; end = `${Number(anchor.slice(0, 4)) + 1}-01-01`;
  } else throw new AppError('RANGE_INVALID');
  if (start < MIN_TRANSACTION_DATE || end > MAX_RANGE_END_SENTINEL) throw new AppError('RANGE_INVALID');
  return { start, end };
}
