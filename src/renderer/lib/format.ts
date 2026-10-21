/** 金额与时间的本地展示工具（整数分 → 两位小数；账本时区 Asia/Shanghai）。 */

export const LEDGER_TIMEZONE = 'Asia/Shanghai';

export function formatAmountFen(amountFen: number | null): string {
  if (amountFen === null || !Number.isInteger(amountFen)) return '—';
  const sign = amountFen < 0 ? '-' : '';
  const absolute = Math.abs(amountFen);
  const yuan = Math.floor(absolute / 100);
  const cents = String(absolute % 100).padStart(2, '0');
  return `${sign}¥${yuan}.${cents}`;
}

export function formatAmountYuanText(amountFen: number | null): string {
  if (amountFen === null || !Number.isInteger(amountFen)) return '—';
  const absolute = Math.abs(amountFen);
  return `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: LEDGER_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

export function todayInLedgerTimezone(now: Date = new Date()): string {
  return DATE_FORMATTER.format(now);
}

export function formatClock(isoString: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleTimeString('zh-CN', { hour12: false })}`;
}
