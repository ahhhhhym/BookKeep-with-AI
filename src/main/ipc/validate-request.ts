/**
 * 请求信封与载荷校验（纯函数，便于单测）。
 * 任何格式问题都在写业务前拒绝，且不把危险原值带回渲染层。
 */

import { CONTRACT_VERSION, MAX_IPC_PAYLOAD_BYTES } from '../../shared/constants';
import { AppError, type FieldIssue } from '../../shared/errors';
import type { ChannelSpec } from '../../shared/ipc';
import { exceedsPayloadLimit, isUuidV4, validateObjectKeys } from '../../shared/validation';

export interface ValidatedRequest<TPayload> {
  readonly requestId: string;
  readonly dataEpoch: string | null;
  readonly mutationId: string | null;
  readonly payload: TPayload;
}

const ENVELOPE_REQUIRED = ['contractVersion', 'requestId', 'dataEpoch', 'payload'] as const;
const ENVELOPE_OPTIONAL = ['mutationId'] as const;

function reject(fieldErrors: FieldIssue[], code: 'PAYLOAD_INVALID' | 'FIELD_INVALID' = 'PAYLOAD_INVALID'): never {
  throw new AppError(code, { fieldErrors });
}

export interface ValidateRequestOptions {
  /** 主进程当前数据世代；请求携带的世代必须与之一致，否则 STALE_EPOCH。 */
  readonly expectedEpoch?: string | null;
}

export function validateIpcRequest<TPayload>(
  spec: ChannelSpec<TPayload>,
  raw: unknown,
  options: ValidateRequestOptions = {},
): ValidatedRequest<TPayload> {
  if (exceedsPayloadLimit(raw)) {
    throw new AppError('PAYLOAD_INVALID', {
      details: { maxBytes: MAX_IPC_PAYLOAD_BYTES },
      fieldErrors: [{ path: 'request', code: 'PAYLOAD_TOO_LARGE' }],
    });
  }

  const envelopeIssues = validateObjectKeys(raw, ENVELOPE_REQUIRED, ENVELOPE_OPTIONAL, 'request');
  if (envelopeIssues.length > 0) reject(envelopeIssues);

  const request = raw as Record<string, unknown>;

  if (request.contractVersion !== CONTRACT_VERSION) {
    throw new AppError('CONTRACT_VERSION_UNSUPPORTED', {
      fieldErrors: [{ path: 'request.contractVersion', code: 'UNSUPPORTED_CONTRACT' }],
      details: { reason: `expected=${CONTRACT_VERSION}` },
    });
  }

  if (!isUuidV4(request.requestId)) {
    reject([{ path: 'request.requestId', code: 'EXPECTED_UUID_V4' }]);
  }

  const dataEpoch = request.dataEpoch;
  if (dataEpoch === null) {
    if (!spec.request.allowNullEpoch) {
      reject([{ path: 'request.dataEpoch', code: 'EPOCH_REQUIRED' }]);
    }
  } else if (!isUuidV4(dataEpoch)) {
    reject([{ path: 'request.dataEpoch', code: 'EXPECTED_UUID_V4_OR_NULL' }]);
  } else if (options.expectedEpoch && dataEpoch !== options.expectedEpoch) {
    throw new AppError('STALE_EPOCH', {
      fieldErrors: [{ path: 'request.dataEpoch', code: 'EPOCH_MISMATCH' }],
      retryable: false,
    });
  }

  const hasMutationId = Object.prototype.hasOwnProperty.call(request, 'mutationId');
  if (spec.request.requireMutationId && !hasMutationId) {
    reject([{ path: 'request.mutationId', code: 'MUTATION_ID_REQUIRED' }]);
  }
  if (hasMutationId && !isUuidV4(request.mutationId)) {
    reject([{ path: 'request.mutationId', code: 'EXPECTED_UUID_V4' }]);
  }

  const payloadIssues = validateObjectKeys(
    request.payload,
    spec.request.required,
    spec.request.optional ?? [],
    'payload',
  );
  if (payloadIssues.length > 0) reject(payloadIssues);

  const payload = request.payload as Record<string, unknown>;
  if (spec.request.validatePayload) {
    const semanticIssues = spec.request.validatePayload(payload);
    // 取值/语义问题用 FIELD_INVALID；嵌套键结构问题仍按 PAYLOAD_INVALID 处理。
    const structuralCodes = new Set([
      'MISSING_KEY',
      'UNKNOWN_KEY',
      'PROTOTYPE_KEY',
      'EXPECTED_OBJECT',
      'EXPECTED_ARRAY',
    ]);
    if (semanticIssues.length > 0) {
      reject(
        semanticIssues,
        semanticIssues.some((issue) => structuralCodes.has(issue.code)) ? 'PAYLOAD_INVALID' : 'FIELD_INVALID',
      );
    }
  }

  const cast = spec.request.cast ? spec.request.cast(payload) : (payload as unknown as TPayload);

  return {
    requestId: request.requestId as string,
    dataEpoch: (dataEpoch as string | null) ?? null,
    mutationId: hasMutationId ? (request.mutationId as string) : null,
    payload: cast,
  };
}
