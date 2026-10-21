/**
 * 文本域（docs/ARCHITECTURE.md §2）：长度按 Unicode 码点；保存前 NFC、首尾空白去除；
 * 空可选文本转 null；拒绝 NUL 与控制字符（备注允许换行与 Tab）。
 */

import { codePointLength } from './validation.js';

export type TextIssueCode = 'TEXT_TYPE' | 'TEXT_EMPTY' | 'TEXT_TOO_LONG' | 'TEXT_CONTROL';

export type TextCheck = { ok: true; value: string } | { ok: false; code: TextIssueCode };
export type OptionalTextCheck = { ok: true; value: string | null } | { ok: false; code: TextIssueCode };

/** 普通文本：拒绝全部 C0/C1 控制字符（含换行与 Tab）。 */
const STRICT_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/** 备注：允许 Tab(09) 与换行(0A)，其余控制字符仍拒绝。 */
const NOTE_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

export function normalizeText(value: string): string {
  return value.normalize('NFC').trim();
}

/** 分类名唯一性比较：NFC + 首尾去空白 + ASCII 小写（不做中文大小写/全角转换）。 */
export function normalizeNameKey(value: string): string {
  return normalizeText(value).replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function hasStrictControl(value: string): boolean {
  return STRICT_CONTROL.test(value);
}

export function hasNoteControl(value: string): boolean {
  return NOTE_CONTROL.test(value);
}

export function checkRequiredText(value: unknown, maxLength: number): TextCheck {
  if (typeof value !== 'string') return { ok: false, code: 'TEXT_TYPE' };
  const normalized = normalizeText(value);
  if (normalized.length === 0) return { ok: false, code: 'TEXT_EMPTY' };
  if (hasStrictControl(normalized)) return { ok: false, code: 'TEXT_CONTROL' };
  if (codePointLength(normalized) > maxLength) return { ok: false, code: 'TEXT_TOO_LONG' };
  return { ok: true, value: normalized };
}

export interface OptionalTextOptions {
  readonly allowLineBreaks?: boolean;
}

export function checkOptionalText(
  value: unknown,
  maxLength: number,
  options: OptionalTextOptions = {},
): OptionalTextCheck {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, code: 'TEXT_TYPE' };
  const normalized = normalizeText(value);
  if (normalized.length === 0) return { ok: true, value: null };
  if (options.allowLineBreaks ? hasNoteControl(normalized) : hasStrictControl(normalized)) {
    return { ok: false, code: 'TEXT_CONTROL' };
  }
  if (codePointLength(normalized) > maxLength) return { ok: false, code: 'TEXT_TOO_LONG' };
  return { ok: true, value: normalized };
}
