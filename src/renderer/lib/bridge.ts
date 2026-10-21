/** 渲染层桥接封装：把 ApiResult 转成可读结果，不把原始错误对象直接渲染。 */

import type { ApiResult, BookKeepApi } from '../../shared/api';
import type { AppErrorPayload, ErrorCode } from '../../shared/errors';

export class BridgeError extends Error {
  readonly code: ErrorCode | 'BRIDGE_UNAVAILABLE';
  readonly payload: AppErrorPayload | null;
  readonly fieldErrors: readonly { path: string; code: string }[];

  constructor(code: ErrorCode | 'BRIDGE_UNAVAILABLE', payload: AppErrorPayload | null) {
    super(code);
    this.name = 'BridgeError';
    this.code = code;
    this.payload = payload;
    this.fieldErrors = payload?.fieldErrors ?? [];
  }
}

const UNAVAILABLE: AppErrorPayload = {
  code: 'INTERNAL_ERROR',
  message: 'BRIDGE_UNAVAILABLE',
  fieldErrors: [],
  details: {},
  retryable: false,
  retryAfterMs: null,
};

export function getBridge(): BookKeepApi | null {
  if (typeof window === 'undefined') return null;
  return window.bookkeep ?? null;
}

export function bridgeAvailable(): boolean {
  return getBridge() !== null;
}

export async function call<T>(operation: (api: BookKeepApi) => Promise<ApiResult<T>>): Promise<T> {
  const api = getBridge();
  if (!api) throw new BridgeError('BRIDGE_UNAVAILABLE', UNAVAILABLE);
  const result = await operation(api);
  if (result.ok) return result.data;
  throw new BridgeError(result.error.code, result.error);
}

export function errorCodeOf(error: unknown): ErrorCode | 'BRIDGE_UNAVAILABLE' | 'UNKNOWN' {
  if (error instanceof BridgeError) return error.code;
  return 'UNKNOWN';
}
