import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '../../src/shared/constants';
import {
  AppError,
  ERROR_CODES,
  errorPayload,
  isErrorCode,
  notImplemented,
  sanitizeDetails,
} from '../../src/shared/errors';

const REQUIRED_CODES = [
  'CONTRACT_VERSION_UNSUPPORTED',
  'PAYLOAD_INVALID',
  'PERMISSION_DENIED',
  'STALE_EPOCH',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'AMOUNT_INVALID',
  'AMOUNT_TOTAL_OVERFLOW',
  'DATE_INVALID',
  'CATEGORY_PROTECTED',
  'IMAGE_IN_USE',
  'REVIEW_INCOMPLETE',
  'SECRET_REQUIRED',
  'SECRET_RATE_LIMIT',
  'PROVIDER_AUTH',
  'NETWORK_ERROR',
  'REQUEST_TIMEOUT',
  'OUTPUT_SCHEMA_INVALID',
  'INTERRUPTED',
  'CANCELLED',
  'DB_BUSY',
  'STORAGE_UNAVAILABLE',
  'SCHEMA_TOO_NEW',
  'BACKUP_INVALID',
  'USER_CANCELLED',
  'SPEC_NOT_READY',
  'UNSUPPORTED',
  'NOT_IMPLEMENTED',
  'INTERNAL_ERROR',
] as const;

describe('契约版本与错误码字典', () => {
  it('契约版本固定为 bookkeep.v1', () => {
    expect(CONTRACT_VERSION).toBe('bookkeep.v1');
  });

  it('错误码唯一并覆盖 CONTRACTS §8 的关键分支', () => {
    expect(ERROR_CODES.length).toBeGreaterThan(70);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of REQUIRED_CODES) {
      expect(isErrorCode(code)).toBe(true);
    }
    expect(isErrorCode('NOT_A_CODE')).toBe(false);
    expect(isErrorCode(123)).toBe(false);
  });

  it('失败载荷只包含安全 details 键', () => {
    const payload = errorPayload('PAYLOAD_INVALID', {
      details: { maxBytes: 262144, stack: 'secret', absolutePath: 'C:\\Users\\x', nested: { a: 1 } },
      fieldErrors: [{ path: 'payload.action', code: 'EXPECTED_SAVE_OR_REMOVE' }],
    });
    expect(payload.details).toEqual({ maxBytes: 262144 });
    expect(payload.fieldErrors).toEqual([{ path: 'payload.action', code: 'EXPECTED_SAVE_OR_REMOVE' }]);
    expect(payload.message).toBe('PAYLOAD_INVALID');
    expect(payload.retryable).toBe(false);
  });

  it('只有明确可重试的错误默认可重试', () => {
    expect(errorPayload('NETWORK_ERROR').retryable).toBe(true);
    expect(errorPayload('DB_BUSY').retryable).toBe(true);
    expect(errorPayload('SECRET_INVALID').retryable).toBe(false);
    expect(errorPayload('NOT_IMPLEMENTED').retryable).toBe(false);
  });

  it('未实现入口返回 NOT_IMPLEMENTED 且带能力标识', () => {
    const error = notImplemented('settings.saveSecret.save', 'S09');
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('NOT_IMPLEMENTED');
    expect(error.details).toEqual({ capability: 'settings.saveSecret.save', step: 'S09' });
  });

  it('sanitizeDetails 拒绝原型相关键且不污染原型', () => {
    const details = JSON.parse('{"__proto__":{"polluted":true},"reason":"ok"}') as Record<string, unknown>;
    expect(sanitizeDetails(details)).toEqual({ reason: 'ok' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
