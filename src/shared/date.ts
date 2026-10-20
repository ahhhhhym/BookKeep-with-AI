/**
 * 日期域（docs/ARCHITECTURE.md §2、docs/DECISIONS.md D14）。
 *
 * 交易日期为有效公历 YYYY-MM-DD，范围 1900-01-01～9998-12-31；
 * 区间筛选的结束哨兵允许 9999-01-01（仅作 exclusive end，不能作为交易日期）。
 * 时刻为 HH:mm；timePrecision=date 时必须无时刻，minute 时必须有有效时刻。
 */

export const MIN_TRANSACTION_DATE = '1900-01-01';
export const MAX_TRANSACTION_DATE = '9998-12-31';
export const MAX_RANGE_END_SENTINEL = '9999-01-01';

export type TimePrecision = 'date' | 'minute';

const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const TIME_PATTERN = /^([0-9]{2}):([0-9]{2})$/;

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function parseCalendarDate(value: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** 有效公历日期（不限制业务范围）。 */
export function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && parseCalendarDate(value) !== null;
}

export function isTransactionDate(value: unknown): value is string {
  return (
    isIsoDateString(value) &&
    value >= MIN_TRANSACTION_DATE &&
    value <= MAX_TRANSACTION_DATE
  );
}

/** 筛选区间端点：允许 null（无该侧边界）；end 额外允许 9999-01-01 哨兵。 */
export function isRangeBoundary(value: unknown, side: 'start' | 'end'): value is string | null {
  if (value === null) return true;
  if (side === 'end' && value === MAX_RANGE_END_SENTINEL) return true;
  return isTransactionDate(value);
}

export function isValidTimeString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = TIME_PATTERN.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function isValidDateRange(start: string | null, end: string | null): boolean {
  if (start === null || end === null) return true;
  return start < end;
}

/** 时刻/精度互约束：date=无时刻，minute=有效时刻。 */
export function isPrecisionConsistent(
  precision: unknown,
  occurredTime: unknown,
): precision is TimePrecision {
  if (precision === 'date') return occurredTime === null;
  if (precision === 'minute') return isValidTimeString(occurredTime);
  return false;
}

/** 返回上海时区当日 YYYY-MM-DD（账本时区固定 Asia/Shanghai）。 */
export function todayInShanghai(nowMs: number = Date.now()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(nowMs));
}
