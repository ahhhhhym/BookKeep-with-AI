/**
 * 确定性规范化与摘要（docs/CONTRACTS.md §6 末尾）。
 * 用于幂等收据的 payloadHash 与安全 token 绑定：固定键序、无多余空白、null 显式保留。
 */

import { createHash } from 'node:crypto';

function compareCodePoints(left: string, right: string): number {
  const leftIterator = left[Symbol.iterator]();
  const rightIterator = right[Symbol.iterator]();
  for (;;) {
    const leftStep = leftIterator.next();
    const rightStep = rightIterator.next();
    if (leftStep.done && rightStep.done) return 0;
    if (leftStep.done) return -1;
    if (rightStep.done) return 1;
    const leftCode = leftStep.value.codePointAt(0) ?? 0;
    const rightCode = rightStep.value.codePointAt(0) ?? 0;
    if (leftCode !== rightCode) return leftCode < rightCode ? -1 : 1;
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    // 非法金额（NaN/Infinity）仍要能参与幂等键计算，最终由业务校验拒绝。
    return JSON.stringify(Number.isFinite(value) ? value : String(value));
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareCodePoints);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new Error('UNSERIALIZABLE_VALUE');
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashPayload(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function shortHash(value: unknown, length = 16): string {
  return hashPayload(value).slice(0, length);
}
