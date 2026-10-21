/**
 * 主进程签发的短期不透明 token（分页游标、恢复预览 token）。
 * 只由主进程 HMAC-SHA256 签发；渲染层不能构造或修改内容。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TokenCodec {
  sign(payload: Record<string, unknown>): string;
  verify(token: string, maxLength?: number): TokenVerifyResult;
}

export type TokenVerifyResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'TOKEN_FORMAT' | 'TOKEN_SIGNATURE' | 'TOKEN_EXPIRED' | 'TOKEN_PAYLOAD' };

const DEFAULT_MAX_LENGTH = 2048;

export function createTokenCodec(secret: Buffer, clock: () => number = Date.now): TokenCodec {
  function signatureOf(body: string): string {
    return createHmac('sha256', secret).update(body, 'utf8').digest('base64url');
  }

  return {
    sign(payload: Record<string, unknown>): string {
      const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      return `${body}.${signatureOf(body)}`;
    },
    verify(token: string, maxLength = DEFAULT_MAX_LENGTH): TokenVerifyResult {
      if (typeof token !== 'string' || token.length === 0 || token.length > maxLength) {
        return { ok: false, reason: 'TOKEN_FORMAT' };
      }
      const separator = token.indexOf('.');
      if (separator <= 0 || separator === token.length - 1) return { ok: false, reason: 'TOKEN_FORMAT' };
      const body = token.slice(0, separator);
      const signature = token.slice(separator + 1);
      const expected = signatureOf(body);
      const actualBuffer = Buffer.from(signature, 'utf8');
      const expectedBuffer = Buffer.from(expected, 'utf8');
      if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
        return { ok: false, reason: 'TOKEN_SIGNATURE' };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return { ok: false, reason: 'TOKEN_PAYLOAD' };
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, reason: 'TOKEN_PAYLOAD' };
      }
      const payload = parsed as Record<string, unknown>;
      if (payload.v !== 1) return { ok: false, reason: 'TOKEN_PAYLOAD' };
      const expiresAt = payload.x;
      if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || clock() > expiresAt) {
        return { ok: false, reason: 'TOKEN_EXPIRED' };
      }
      return { ok: true, payload };
    },
  };
}
