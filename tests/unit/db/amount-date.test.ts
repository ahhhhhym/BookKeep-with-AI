import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_FEN,
  formatFenToYuan,
  isValidAmountFen,
  parseAmountYuanToFen,
} from '../../../src/shared/amount';
import {
  MAX_RANGE_END_SENTINEL,
  isIsoDateString,
  isPrecisionConsistent,
  isRangeBoundary,
  isTransactionDate,
  isValidDateRange,
  isValidTimeString,
  todayInShanghai,
} from '../../../src/shared/date';
import { normalizeNameKey, normalizeText } from '../../../src/shared/text';

describe('金额：整数分边界与非法输入', () => {
  it('0.01 元 = 1 分与上限 9,999,999.99 元 = 999,999,999 分', () => {
    expect(parseAmountYuanToFen('0.01')).toEqual({ ok: true, fen: 1 });
    expect(parseAmountYuanToFen('9999999.99')).toEqual({ ok: true, fen: MAX_AMOUNT_FEN });
    expect(parseAmountYuanToFen('1')).toEqual({ ok: true, fen: 100 });
    expect(parseAmountYuanToFen('0.1')).toEqual({ ok: true, fen: 10 });
    expect(formatFenToYuan(1)).toBe('0.01');
    expect(formatFenToYuan(MAX_AMOUNT_FEN)).toBe('9999999.99');
    expect(isValidAmountFen(1)).toBe(true);
    expect(isValidAmountFen(MAX_AMOUNT_FEN)).toBe(true);
  });

  it('拒绝 0、负数、空值、科学计数、千分位、超上限与三位小数', () => {
    const rejected: Array<[string, string]> = [
      ['', 'AMOUNT_EMPTY'],
      ['   ', 'AMOUNT_EMPTY'],
      ['0', 'AMOUNT_OUT_OF_RANGE'],
      ['0.00', 'AMOUNT_OUT_OF_RANGE'],
      ['-1', 'AMOUNT_FORMAT'],
      ['-0.01', 'AMOUNT_FORMAT'],
      ['+1', 'AMOUNT_FORMAT'],
      ['abc', 'AMOUNT_FORMAT'],
      ['1e2', 'AMOUNT_FORMAT'],
      ['10,000.00', 'AMOUNT_FORMAT'],
      ['10000000.00', 'AMOUNT_OUT_OF_RANGE'],
      ['1.001', 'AMOUNT_PRECISION'],
      ['0.000', 'AMOUNT_PRECISION'],
      ['1.', 'AMOUNT_FORMAT'],
      ['.5', 'AMOUNT_FORMAT'],
    ];
    for (const [input, reason] of rejected) {
      expect(parseAmountYuanToFen(input), input).toEqual({ ok: false, reason });
    }
    expect(parseAmountYuanToFen(1.5)).toEqual({ ok: false, reason: 'AMOUNT_FORMAT' });
    expect(isValidAmountFen(0)).toBe(false);
    expect(isValidAmountFen(-1)).toBe(false);
    expect(isValidAmountFen(1.5)).toBe(false);
    expect(isValidAmountFen(1_000_000_000)).toBe(false);
    expect(isValidAmountFen(Number.NaN)).toBe(false);
  });
});

describe('日期与精度', () => {
  it('接受真实公历日期并拒绝不存在的日期', () => {
    expect(isIsoDateString('2026-09-08')).toBe(true);
    expect(isIsoDateString('2024-02-29')).toBe(true);
    expect(isIsoDateString('2026-02-29')).toBe(false);
    expect(isIsoDateString('2026-02-30')).toBe(false);
    expect(isIsoDateString('2026-13-01')).toBe(false);
    expect(isIsoDateString('2026-9-8')).toBe(false);
    expect(isIsoDateString('20260908')).toBe(false);
  });

  it('交易日期范围 1900-01-01～9998-12-31，筛选结束哨兵 9999-01-01 只用于 end', () => {
    expect(isTransactionDate('1900-01-01')).toBe(true);
    expect(isTransactionDate('9998-12-31')).toBe(true);
    expect(isTransactionDate('1899-12-31')).toBe(false);
    expect(isTransactionDate('9999-01-01')).toBe(false);
    expect(isRangeBoundary(MAX_RANGE_END_SENTINEL, 'end')).toBe(true);
    expect(isRangeBoundary(MAX_RANGE_END_SENTINEL, 'start')).toBe(false);
    expect(isRangeBoundary(null, 'start')).toBe(true);
    expect(isValidDateRange('2026-09-08', '2026-09-10')).toBe(true);
    expect(isValidDateRange('2026-09-10', '2026-09-10')).toBe(false);
    expect(isValidDateRange('2026-09-11', '2026-09-10')).toBe(false);
  });

  it('时刻/精度互约束', () => {
    expect(isValidTimeString('00:00')).toBe(true);
    expect(isValidTimeString('23:59')).toBe(true);
    expect(isValidTimeString('24:00')).toBe(false);
    expect(isValidTimeString('12:60')).toBe(false);
    expect(isValidTimeString('12:5')).toBe(false);
    expect(isPrecisionConsistent('date', null)).toBe(true);
    expect(isPrecisionConsistent('date', '12:00')).toBe(false);
    expect(isPrecisionConsistent('minute', '12:00')).toBe(true);
    expect(isPrecisionConsistent('minute', null)).toBe(false);
    expect(isPrecisionConsistent('unknown', null)).toBe(false);
  });

  it('相对日使用 Asia/Shanghai，而不是 UTC 或 24 小时差', () => {
    // 2026-10-19T16:30:00Z = 2026-10-20 00:30 上海
    expect(todayInShanghai(Date.parse('2026-10-19T16:30:00.000Z'))).toBe('2026-10-20');
    expect(todayInShanghai(Date.parse('2026-10-20T15:59:59.000Z'))).toBe('2026-10-20');
    expect(todayInShanghai(Date.parse('2026-10-20T16:00:00.000Z'))).toBe('2026-10-21');
  });
});

describe('文本规范化', () => {
  it('NFC + 首尾去空白；分类重名比较按 ASCII 小写', () => {
    expect(normalizeText('  餐饮  ')).toBe('餐饮');
    expect(normalizeNameKey('  Coffee ')).toBe('coffee');
    expect(normalizeNameKey('COFFEE')).toBe(normalizeNameKey('coffee'));
    expect(normalizeText('e\u0301')).toBe('\u00e9');
  });
});
