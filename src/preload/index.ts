/** 受限 preload：唯一跨进程入口。不暴露 ipcRenderer、Node、SQL、shell 或任意 URL。 */

import { contextBridge, ipcRenderer } from 'electron';
import type { ApiResult, BookKeepApi } from '../shared/api';
import { CONTRACT_VERSION } from '../shared/constants';
import type { AppErrorPayload } from '../shared/errors';
import { IPC } from '../shared/ipc';
import type { SaveSecretInput, ProviderCapabilitiesInput } from '../shared/ipc';
import type {
  AiSettingsView,
  MockRecognitionInput,
  MockRecognitionView,
  ProviderCapabilitiesView,
  SecretSaveResult,
  SecretStatusView,
} from '../shared/dto';
import { newUuidV4 } from './uuid';

interface RawEnvelope<T> {
  readonly ok: boolean;
  readonly requestId: string;
  readonly contractVersion: string;
  readonly dataEpoch: string | null;
  readonly dataRevision: number;
  readonly data?: T;
  readonly error?: AppErrorPayload;
}

/** 启动读取允许 epoch 为 null；主进程返回非空 epoch 时由桥接层接管。 */
let currentEpoch: string | null = null;

const FALLBACK_ERROR: AppErrorPayload = {
  code: 'INTERNAL_ERROR',
  message: 'INTERNAL_ERROR',
  fieldErrors: [],
  details: {},
  retryable: false,
  retryAfterMs: null,
};

async function invoke<T>(
  channel: string,
  payload: unknown,
  options: { readonly mutation: boolean },
): Promise<ApiResult<T>> {
  const request: Record<string, unknown> = {
    contractVersion: CONTRACT_VERSION,
    requestId: newUuidV4(),
    dataEpoch: currentEpoch,
    payload,
  };
  if (options.mutation) request.mutationId = newUuidV4();

  let envelope: RawEnvelope<T>;
  try {
    envelope = (await ipcRenderer.invoke(channel, request)) as RawEnvelope<T>;
  } catch {
    // 通道未注册或进程已退出：不回显内部细节。
    return { ok: false, error: FALLBACK_ERROR };
  }

  if (envelope && typeof envelope.dataEpoch === 'string') currentEpoch = envelope.dataEpoch;
  if (envelope && envelope.ok === true) return { ok: true, data: envelope.data as T };
  return { ok: false, error: envelope?.error ?? FALLBACK_ERROR };
}

const api: BookKeepApi = {
  contractVersion: CONTRACT_VERSION,
  skeletonStage: 'S04',
  settings: {
    readAi: (): Promise<ApiResult<AiSettingsView>> => invoke(IPC.settingsReadAi, {}, { mutation: false }),
    readStatus: (): Promise<ApiResult<SecretStatusView>> =>
      invoke(IPC.settingsReadStatus, {}, { mutation: false }),
    saveSecret: (input: SaveSecretInput): Promise<ApiResult<SecretSaveResult>> =>
      invoke(IPC.settingsSaveSecret, input, { mutation: true }),
  },
  provider: {
    capabilities: (input: ProviderCapabilitiesInput): Promise<ApiResult<ProviderCapabilitiesView>> =>
      invoke(IPC.providerCapabilities, input, { mutation: false }),
  },
  skeleton: {
    mockRecognition: (input: MockRecognitionInput): Promise<ApiResult<MockRecognitionView>> =>
      invoke(IPC.skeletonMockRecognition, input, { mutation: false }),
  },
};

contextBridge.exposeInMainWorld('bookkeep', Object.freeze(api));
