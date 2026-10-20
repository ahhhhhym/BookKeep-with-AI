/** 受限 preload：唯一跨进程入口。不暴露 ipcRenderer、Node、SQL、shell 或任意 URL。 */

import { contextBridge, ipcRenderer } from 'electron';
import type { ApiResult, BookKeepApi } from '../shared/api';
import { CONTRACT_VERSION } from '../shared/constants';
import type { AppErrorPayload } from '../shared/errors';
import { IPC } from '../shared/ipc';
import type { CategoryListInput, ProviderCapabilitiesInput, SaveSecretInput } from '../shared/ipc';
import type { AiSettingsView, MockRecognitionInput, MockRecognitionView, ProviderCapabilitiesView, SecretSaveResult, SecretStatusView } from '../shared/dto';
import type {
  BackupCreateInput,
  BackupCreateResult,
  BackupListResult,
  BackupRestoreInput,
  BackupRestorePreviewResult,
  BackupRestoreResult,
  CategoryCreateInput,
  CategoryDisableInput,
  CategoryListResult,
  CategoryMutationResult,
  CategoryUpdateInput,
  LedgerEnsureDefaultView,
  MutationOptions,
  TransactionInput,
  TransactionListInput,
  TransactionListResult,
  TransactionMutationResult,
  TransactionUpdateInput,
  TransactionVersionedInput,
} from '../shared/entities';
import { isUuidV4 } from '../shared/validation';
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

function invalidMutationId(): AppErrorPayload {
  return {
    code: 'PAYLOAD_INVALID',
    message: 'PAYLOAD_INVALID',
    fieldErrors: [{ path: 'mutationId', code: 'EXPECTED_UUID_V4' }],
    details: {},
    retryable: false,
    retryAfterMs: null,
  };
}

/** 启动读取允许 null epoch 的通道（CONTRACTS §1）。 */
const EPOCH_OPTIONAL_CHANNELS: ReadonlySet<string> = new Set([
  IPC.settingsReadAi,
  IPC.settingsReadStatus,
  IPC.providerCapabilities,
  IPC.skeletonMockRecognition,
  IPC.ledgerEnsureDefault,
]);

let epochBootstrap: Promise<void> | null = null;

/** 首次业务请求前确保已从主进程取得 dataEpoch，避免启动竞态导致 EPOCH_REQUIRED。 */
async function ensureEpoch(): Promise<void> {
  if (currentEpoch !== null) return;
  if (epochBootstrap === null) {
    epochBootstrap = invoke(IPC.settingsReadAi, {}, { mutation: false }).then(() => undefined);
  }
  await epochBootstrap;
}

async function invoke<T>(
  channel: string,
  payload: unknown,
  options: { readonly mutation: boolean; readonly mutationId?: string; readonly dataEpoch?: string },
): Promise<ApiResult<T>> {
  if (currentEpoch === null && !EPOCH_OPTIONAL_CHANNELS.has(channel)) {
    await ensureEpoch();
  }
  const request: Record<string, unknown> = {
    contractVersion: CONTRACT_VERSION,
    requestId: newUuidV4(),
    dataEpoch: options.dataEpoch ?? currentEpoch,
    payload,
  };
  if (options.mutation) {
    if (options.mutationId !== undefined && !isUuidV4(options.mutationId)) {
      return { ok: false, error: invalidMutationId() };
    }
    request.mutationId = options.mutationId ?? newUuidV4();
  }

  let envelope: RawEnvelope<T>;
  try {
    envelope = (await ipcRenderer.invoke(channel, request)) as RawEnvelope<T>;
  } catch {
    // 通道未注册或进程已退出：不回显内部细节。
    return { ok: false, error: FALLBACK_ERROR };
  }

  if (envelope && typeof envelope.dataEpoch === 'string' && (currentEpoch === null || currentEpoch === request.dataEpoch)) currentEpoch = envelope.dataEpoch;
  const metadata = { dataEpoch: envelope?.dataEpoch ?? null, dataRevision: envelope?.dataRevision };
  if (envelope && envelope.ok === true) return { ok: true, data: envelope.data as T, ...metadata };
  return { ok: false, error: envelope?.error ?? FALLBACK_ERROR, ...metadata };
}

function mutationOptions(options?: MutationOptions): { readonly mutation: true; readonly mutationId?: string; readonly dataEpoch?: string } {
  return { mutation: true, mutationId: options?.mutationId, dataEpoch: options?.dataEpoch };
}

const api: BookKeepApi = {
  contractVersion: CONTRACT_VERSION,
  skeletonStage: 'S05',
  settings: {
    readAi: (): Promise<ApiResult<AiSettingsView>> => invoke(IPC.settingsReadAi, {}, { mutation: false }),
    readStatus: (): Promise<ApiResult<SecretStatusView>> =>
      invoke(IPC.settingsReadStatus, {}, { mutation: false }),
    saveSecret: (input: SaveSecretInput): Promise<ApiResult<SecretSaveResult>> =>
      invoke(IPC.settingsSaveSecret, input, mutationOptions()),
  },
  provider: {
    capabilities: (input: ProviderCapabilitiesInput): Promise<ApiResult<ProviderCapabilitiesView>> =>
      invoke(IPC.providerCapabilities, input, { mutation: false }),
  },
  ledger: {
    ensureDefault: (options?: MutationOptions): Promise<ApiResult<LedgerEnsureDefaultView>> =>
      invoke(IPC.ledgerEnsureDefault, {}, mutationOptions(options)),
  },
  category: {
    list: (input?: CategoryListInput): Promise<ApiResult<CategoryListResult>> =>
      invoke(IPC.categoryList, input ?? {}, { mutation: false }),
    create: (input: CategoryCreateInput, options?: MutationOptions): Promise<ApiResult<CategoryMutationResult>> =>
      invoke(IPC.categoryCreate, input, mutationOptions(options)),
    update: (input: CategoryUpdateInput, options?: MutationOptions): Promise<ApiResult<CategoryMutationResult>> =>
      invoke(IPC.categoryUpdate, input, mutationOptions(options)),
    disable: (
      input: CategoryDisableInput,
      options?: MutationOptions,
    ): Promise<ApiResult<CategoryMutationResult>> =>
      invoke(IPC.categoryDisable, input, mutationOptions(options)),
  },
  transaction: {
    create: (input: TransactionInput, options?: MutationOptions): Promise<ApiResult<TransactionMutationResult>> =>
      invoke(IPC.transactionCreate, input, mutationOptions(options)),
    update: (
      input: TransactionUpdateInput,
      options?: MutationOptions,
    ): Promise<ApiResult<TransactionMutationResult>> =>
      invoke(IPC.transactionUpdate, input, mutationOptions(options)),
    softDelete: (
      input: TransactionVersionedInput,
      options?: MutationOptions,
    ): Promise<ApiResult<TransactionMutationResult>> =>
      invoke(IPC.transactionSoftDelete, input, mutationOptions(options)),
    restore: (
      input: TransactionVersionedInput,
      options?: MutationOptions,
    ): Promise<ApiResult<TransactionMutationResult>> =>
      invoke(IPC.transactionRestore, input, mutationOptions(options)),
    list: (input: TransactionListInput): Promise<ApiResult<TransactionListResult>> =>
      invoke(IPC.transactionList, input, { mutation: false }),
  },
  backup: {
    create: (input: BackupCreateInput, options?: MutationOptions): Promise<ApiResult<BackupCreateResult>> =>
      invoke(IPC.backupCreate, input, mutationOptions(options)),
    list: (): Promise<ApiResult<BackupListResult>> => invoke(IPC.backupList, {}, { mutation: false }),
    restore: (
      input: BackupRestoreInput,
      options?: MutationOptions,
    ): Promise<ApiResult<BackupRestorePreviewResult | BackupRestoreResult>> =>
      invoke(IPC.backupRestore, input, mutationOptions(options)),
  },
  skeleton: {
    mockRecognition: (input: MockRecognitionInput): Promise<ApiResult<MockRecognitionView>> =>
      invoke(IPC.skeletonMockRecognition, input, { mutation: false }),
  },
};

contextBridge.exposeInMainWorld('bookkeep', Object.freeze(api));
