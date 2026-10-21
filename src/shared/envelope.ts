/**
 * IPC 信封（docs/CONTRACTS.md §1）。
 * 成功：ok=true + data；失败：ok=false + error；两者共同字段完全相同。
 */

import type { AppErrorPayload } from './errors.js';

export interface EnvelopeBase {
  requestId: string;
  contractVersion: string;
  dataEpoch: string | null;
  dataRevision: number;
}

export interface OkEnvelope<T> extends EnvelopeBase {
  ok: true;
  data: T;
}

export interface ErrorEnvelope extends EnvelopeBase {
  ok: false;
  error: AppErrorPayload;
}

export type Envelope<T> = OkEnvelope<T> | ErrorEnvelope;

/** 渲染层 → 主进程的请求本体（由受限 preload 构造，UI 不直接接触 ipcRenderer）。 */
export interface IpcRequest<P = unknown> {
  contractVersion: string;
  requestId: string;
  dataEpoch: string | null;
  mutationId?: string;
  payload: P;
}

export interface RequestSpec<TPayload> {
  /** 必需 payload 键。 */
  required: readonly string[];
  /** 可选 payload 键；出现未知键即拒绝。 */
  optional?: readonly string[];
  /** 是否允许 dataEpoch 为 null（仅启动读取类操作）。 */
  allowNullEpoch?: boolean;
  /** 是否必须携带 mutationId（变更类操作）。 */
  requireMutationId?: boolean;
  /** 附加语义校验，返回字段问题。 */
  validatePayload?: (payload: Record<string, unknown>) => { path: string; code: string }[];
  /** 把合法 payload 转换为强类型值。 */
  cast?: (payload: Record<string, unknown>) => TPayload;
}

export function buildOkEnvelope<T>(base: EnvelopeBase, data: T): OkEnvelope<T> {
  return { ...base, ok: true, data };
}

export function buildErrorEnvelope(base: EnvelopeBase, error: AppErrorPayload): ErrorEnvelope {
  return { ...base, ok: false, error };
}
