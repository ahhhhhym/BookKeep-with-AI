/**
 * 错误码与安全错误对象（docs/CONTRACTS.md §8）。
 * message 字段是稳定文案键（默认等于 code），中文文案由渲染层本地映射。
 */

export const ERROR_CODES = [
  'CONTRACT_VERSION_UNSUPPORTED',
  'PAYLOAD_INVALID',
  'FIELD_INVALID',
  'PERMISSION_DENIED',
  'STALE_EPOCH',
  'SNAPSHOT_STALE',
  'TOKEN_EXPIRED',
  'REVIEW_STALE',
  'NOT_FOUND',
  'STATE_CONFLICT',
  'VERSION_CONFLICT',
  'VERSION_EXHAUSTED',
  'COUNTER_EXHAUSTED',
  'IDEMPOTENCY_CONFLICT',
  'AMOUNT_INVALID',
  'AMOUNT_TOTAL_OVERFLOW',
  'DATE_INVALID',
  'RANGE_INVALID',
  'FUTURE_PERIOD',
  'FUTURE_POINT',
  'POINT_OUTSIDE_SCOPE',
  'CATEGORY_DISABLED',
  'CATEGORY_NAME_EXISTS',
  'CATEGORY_PROTECTED',
  'CATEGORY_LIMIT',
  'ICON_INVALID',
  'TRANSACTION_DELETED',
  'IMAGE_FORMAT',
  'IMAGE_DECODE',
  'IMAGE_TOO_LARGE',
  'IMAGE_DIMENSION',
  'IMAGE_REGION_INVALID',
  'IMAGE_NOT_PREPARED',
  'BATCH_LIMIT',
  'IMAGE_IN_USE',
  'REVIEW_INCOMPLETE',
  'DUPLICATE_UNRESOLVED',
  'NON_EXPENSE',
  'EVIDENCE_MISSING',
  'SECRET_REQUIRED',
  'SECRET_INVALID',
  'SECRET_UNREADABLE',
  'SECRET_RATE_LIMIT',
  'CONSENT_REQUIRED',
  'PROVIDER_NOT_READY',
  'PROVIDER_AUTH',
  'PROVIDER_FORBIDDEN',
  'PROVIDER_BALANCE',
  'PROVIDER_INPUT',
  'PROVIDER_UNSUPPORTED',
  'NETWORK_ERROR',
  'PROVIDER_RATE_LIMIT',
  'PROVIDER_TEMPORARY',
  'REQUEST_TIMEOUT',
  'PROVIDER_ERROR',
  'OUTPUT_SCHEMA_INVALID',
  'OUTPUT_TOO_LARGE',
  'INTERRUPTED',
  'CANCELLED',
  'DB_BUSY',
  'FILE_BUSY',
  'STORAGE_FULL',
  'STORAGE_UNAVAILABLE',
  'INSTANCE_LOCKED',
  'MAINTENANCE_MODE',
  'INTEGRITY_ERROR',
  'SCHEMA_TOO_NEW',
  'SCHEMA_UNSUPPORTED',
  'MIGRATION_FAILED',
  'RECOVERY_REQUIRED',
  'BACKUP_INVALID',
  'BACKUP_LIMIT',
  'HASH_MISMATCH',
  'BACKUP_FAILED',
  'RESTORE_FAILED',
  'EXPORT_FAILED',
  'ARTIFACT_MISSING',
  'USER_CANCELLED',
  'DATASET_INVALID',
  'DATASET_WITHDRAWN',
  'DATASET_LOCKED',
  'LICENCE_REQUIRED',
  'SPLIT_LEAKAGE',
  'SPEC_NOT_READY',
  'UNSUPPORTED',
  'NOT_IMPLEMENTED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

/** 只有这些错误默认可重试（其余为永久错误，见 CONTRACTS §8）。 */
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'NETWORK_ERROR',
  'PROVIDER_RATE_LIMIT',
  'PROVIDER_TEMPORARY',
  'REQUEST_TIMEOUT',
  'DB_BUSY',
  'FILE_BUSY',
]);

/** 失败信封 details 只允许这些安全键，防止原值/路径/凭证回流 UI。 */
const SAFE_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'currentVersion',
  'missingFields',
  'warningCodes',
  'affectedIds',
  'maxBytes',
  'maxCount',
  'jobId',
  'providerStatus',
  'capability',
  'step',
  'reason',
]);

export interface FieldIssue {
  path: string;
  code: string;
}

export interface AppErrorPayload {
  code: ErrorCode;
  message: string;
  fieldErrors: FieldIssue[];
  details: Record<string, unknown>;
  retryable: boolean;
  retryAfterMs: number | null;
}

export interface AppErrorOptions {
  fieldErrors?: FieldIssue[];
  details?: Record<string, unknown>;
  retryable?: boolean;
  retryAfterMs?: number | null;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

function isSafeDetailKey(key: string): boolean {
  return SAFE_DETAIL_KEYS.has(key) && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

export function sanitizeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  if (!details) return clean;
  for (const [key, value] of Object.entries(details)) {
    if (!isSafeDetailKey(key)) continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      clean[key] = [...value];
    }
  }
  return clean;
}

/** 应用内部安全错误：只有它能跨 IPC 返回具体 code，未知异常统一 INTERNAL_ERROR。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors: FieldIssue[];
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.fieldErrors = options.fieldErrors ?? [];
    this.details = sanitizeDetails(options.details);
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    this.retryAfterMs = options.retryAfterMs ?? null;
  }

  toPayload(): AppErrorPayload {
    return {
      code: this.code,
      message: this.code,
      fieldErrors: this.fieldErrors.map((issue) => ({ path: issue.path, code: issue.code })),
      details: this.details,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

export function errorPayload(code: ErrorCode, options: AppErrorOptions = {}): AppErrorPayload {
  return new AppError(code, options).toPayload();
}

/** 未实现/未支持入口统一按 CONTRACTS §8 处理，绝不返回假成功。 */
export function notImplemented(capability: string, step: string): AppError {
  return new AppError('NOT_IMPLEMENTED', { details: { capability, step } });
}
