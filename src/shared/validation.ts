/**
 * 运行时载荷校验原语（不可信输入一律先校验，不依赖 TypeScript 类型断言）。
 * 规则来源 docs/CONTRACTS.md §2：缺键=格式错误、未知键拒绝、null 必须显式。
 */

import { MAX_IPC_PAYLOAD_BYTES } from './constants.js';
import type { FieldIssue } from './errors.js';

export type PlainRecord = Record<string, unknown>;

export function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Unicode 码点长度（不是 UTF-16 单元数）。 */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function isBoundedString(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string') return false;
  const length = codePointLength(value);
  return length >= min && length <= max;
}

/** 密钥类输入禁止任何控制字符（含换行与制表符），不做 trim/NFC 改写。 */
export function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

export function isSafeIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function typeNameOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * 校验对象键集合：必需键必须存在（值可为 null），可选键若存在则必须已声明，未知键一律拒绝。
 */
export function validateObjectKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  path = 'payload',
): FieldIssue[] {
  if (!isPlainRecord(value)) {
    return [{ path, code: `EXPECTED_OBJECT_GOT_${typeNameOf(value).toUpperCase()}` }];
  }
  const issues: FieldIssue[] = [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      issues.push({ path: `${path}.${key}`, code: 'MISSING_KEY' });
    }
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'UNKNOWN_KEY' });
    } else if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      issues.push({ path: `${path}.${key}`, code: 'PROTOTYPE_KEY' });
    }
  }
  return issues;
}

/** 拒绝超过通用 IPC 载荷上限的请求（按 UTF-8 字节计算）。 */
export function exceedsPayloadLimit(value: unknown): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? '';
  } catch {
    return true;
  }
  return utf8ByteLength(serialized) > MAX_IPC_PAYLOAD_BYTES;
}

export function summarizeIssues(issues: FieldIssue[], max = 20): FieldIssue[] {
  return issues.slice(0, max);
}
