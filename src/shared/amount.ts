/**
 * 金额域（docs/ARCHITECTURE.md §2、docs/CONTRACTS.md §2）。
 *
 * 正式金额一律为整数分：1～999,999,999 分（0.01～9,999,999.99 元）。
 * 用户金额文本只允许无千分位十进制正数、最多两位小数；精确换算，绝不四舍五入接受三位小数。
 */

export const MIN_AMOUNT_FEN = 1;
export const MAX_AMOUNT_FEN = 999_999_999;
export const MAX_AMOUNT_YUAN_LABEL = '9,999,999.99';

export type AmountParseFailure =
  | 'AMOUNT_EMPTY'
  | 'AMOUNT_FORMAT'
  | 'AMOUNT_PRECISION'
  | 'AMOUNT_OUT_OF_RANGE';

export type AmountParseResult = { ok: true; fen: number } | { ok: false; reason: AmountParseFailure };

/** 允许整数或 1～2 位小数；不接受前导 +、科学计数、千分位、负号与空白内部字符。 */
const AMOUNT_PATTERN = /^(?:0|[1-9][0-9]{0,8})(?:\.([0-9]{1,2}))?$/;
const THREE_DECIMALS = /^[0-9]{1,9}\.[0-9]{3,}$/;

export function parseAmountYuanToFen(input: unknown): AmountParseResult {
  if (typeof input !== 'string') return { ok: false, reason: 'AMOUNT_FORMAT' };
  const text = input.trim();
  if (text.length === 0) return { ok: false, reason: 'AMOUNT_EMPTY' };
  if (!AMOUNT_PATTERN.test(text)) {
    return { ok: false, reason: THREE_DECIMALS.test(text) ? 'AMOUNT_PRECISION' : 'AMOUNT_FORMAT' };
  }
  const dot = text.indexOf('.');
  const wholeText = dot === -1 ? text : text.slice(0, dot);
  const fractionText = dot === -1 ? '' : text.slice(dot + 1);
  const cents = Number(`${fractionText}00`.slice(0, 2));
  const fen = Number(wholeText) * 100 + cents;
  if (!Number.isSafeInteger(fen) || fen < MIN_AMOUNT_FEN || fen > MAX_AMOUNT_FEN) {
    return { ok: false, reason: 'AMOUNT_OUT_OF_RANGE' };
  }
  return { ok: true, fen };
}

/** 整数分 → 无符号两位小数字符串（仅用于展示，不参与业务计算）。 */
export function formatFenToYuan(fen: number): string {
  const absolute = Math.abs(fen);
  return `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function isValidAmountFen(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= MIN_AMOUNT_FEN &&
    value <= MAX_AMOUNT_FEN
  );
}
