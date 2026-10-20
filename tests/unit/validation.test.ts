import { describe, expect, it } from 'vitest';
import {
  codePointLength,
  exceedsPayloadLimit,
  hasControlCharacters,
  isBoundedString,
  isPlainRecord,
  isSafeIntegerInRange,
  isUuidV4,
  validateObjectKeys,
} from '../../src/shared/validation';
import { MAX_IPC_PAYLOAD_BYTES } from '../../src/shared/constants';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('运行时校验原语', () => {
  it('只接受普通对象', () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord(Object.create(null))).toBe(true);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord(new Date())).toBe(false);
  });

  it('UUID v4 校验拒绝对应格式以外的值', () => {
    expect(isUuidV4(UUID)).toBe(true);
    expect(isUuidV4(UUID.toUpperCase())).toBe(false);
    expect(isUuidV4('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false);
    expect(isUuidV4('not-a-uuid')).toBe(false);
  });

  it('按码点统计长度而不是 UTF-16 单元', () => {
    expect(codePointLength('午餐')).toBe(2);
    expect(codePointLength('😀')).toBe(1);
    expect(isBoundedString('午餐', 1, 2)).toBe(true);
    expect(isBoundedString('   ', 1, 3)).toBe(true);
    expect(isBoundedString('', 1, 3)).toBe(false);
  });

  it('密钥输入禁止控制字符', () => {
    expect(hasControlCharacters('sk-abc123')).toBe(false);
    expect(hasControlCharacters('sk-abc\n123')).toBe(true);
    expect(hasControlCharacters('sk-abc\t123')).toBe(true);
    expect(hasControlCharacters('sk\u0000abc')).toBe(true);
  });

  it('未知键与缺键都被显式报告', () => {
    expect(validateObjectKeys({ a: 1 }, ['a'])).toEqual([]);
    expect(validateObjectKeys({ a: 1, b: 2 }, ['a'])).toEqual([{ path: 'payload.b', code: 'UNKNOWN_KEY' }]);
    expect(validateObjectKeys({}, ['a'])).toEqual([{ path: 'payload.a', code: 'MISSING_KEY' }]);
    expect(validateObjectKeys([], ['a'])).toEqual([{ path: 'payload', code: 'EXPECTED_OBJECT_GOT_ARRAY' }]);
  });

  it('可选键出现时校验，未声明键仍拒绝', () => {
    expect(validateObjectKeys({ a: 1, extra: true }, ['a'], ['b'])).toEqual([
      { path: 'payload.extra', code: 'UNKNOWN_KEY' },
    ]);
  });

  it('整数范围校验拒绝浮点与字符串', () => {
    expect(isSafeIntegerInRange(1, 1, 10)).toBe(true);
    expect(isSafeIntegerInRange(1.5, 1, 10)).toBe(false);
    expect(isSafeIntegerInRange('1', 1, 10)).toBe(false);
    expect(isSafeIntegerInRange(11, 1, 10)).toBe(false);
  });

  it('超过 256KiB 的载荷被拒绝', () => {
    expect(exceedsPayloadLimit({ a: 'x'.repeat(1000) })).toBe(false);
    expect(exceedsPayloadLimit({ a: 'x'.repeat(MAX_IPC_PAYLOAD_BYTES) })).toBe(true);
  });
});
