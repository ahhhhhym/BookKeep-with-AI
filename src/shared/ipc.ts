/**
 * IPC 通道白名单与请求规格（docs/CONTRACTS.md §1/§3/§6）。
 *
 * S05 在 S04 的最小集合上加入账本、分类、交易与备份通道：
 *  - 结构/类型/未知键在信封校验阶段拒绝（PAYLOAD_INVALID / FIELD_INVALID）；
 *  - 金额、日期、分类可用性等领域语义由主进程服务层校验并给出专用错误码；
 *  - 变更通道必须携带 mutationId，读取通道不要求；dataEpoch 仅启动读取类允许 null。
 */

import type { RequestSpec } from './envelope.js';
import type {
  BackupCreateInput,
  BackupRestoreInput,
  CategoryCreateInput,
  CategoryDisableInput,
  CategoryUpdateInput,
  LedgerEnsureDefaultView,
  PageInput,
  TransactionFilter,
  TransactionInput,
  TransactionListInput,
  TransactionUpdateInput,
  TransactionVersionedInput,
} from './entities.js';
import type { MockRecognitionInput, ProviderId } from './dto.js';
import { SECRET_MAX_LENGTH, SECRET_MIN_LENGTH } from './constants.js';
import { isPlainRecord, isSafeIntegerInRange, isUuidV4 } from './validation.js';

export const IPC = {
  settingsReadAi: 'settings.ai',
  settingsReadStatus: 'settings.readStatus',
  settingsSaveSecret: 'settings.saveSecret',
  providerCapabilities: 'provider.capabilities',
  skeletonMockRecognition: 'skeleton.mockRecognition',
  ledgerEnsureDefault: 'ledger.ensureDefault',
  categoryList: 'category.list',
  categoryCreate: 'category.create',
  categoryUpdate: 'category.update',
  categoryDisable: 'category.disable',
  transactionCreate: 'transaction.create',
  transactionUpdate: 'transaction.update',
  transactionSoftDelete: 'transaction.softDelete',
  transactionRestore: 'transaction.restore',
  transactionList: 'transaction.list',
  backupCreate: 'backup.create',
  backupList: 'backup.list',
  backupRestore: 'backup.restore',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** 权限标签沿用 CONTRACTS §1。 */
export type PermissionTag = 'R' | 'W' | 'F' | 'U' | 'S' | 'D';

export interface ChannelSpec<TPayload = unknown> {
  readonly channel: IpcChannel;
  readonly permission: PermissionTag;
  /** true 表示 S04 专有诊断通道，不属于业务契约。 */
  readonly skeletonOnly: boolean;
  readonly request: RequestSpec<TPayload>;
}

export interface SaveSecretInput {
  action: 'save' | 'remove';
  secret?: string;
  persistence?: 'encrypted' | 'session';
}

export interface ProviderCapabilitiesInput {
  providerId: ProviderId;
}

export interface CategoryListInput {
  includeDisabled?: boolean;
}

export interface BackupListInput {
  readonly none?: never;
}

interface Issue {
  path: string;
  code: string;
}

const PROVIDER_IDS: readonly string[] = ['deepseek', 'mock'];

/** Category/Task 等业务 Id：UUID v4 或系统稳定 ASCII Id（1～64）。 */
export function isIdLike(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function checkKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  issues: Issue[],
): Record<string, unknown> | null {
  if (!isPlainRecord(value)) {
    issues.push({ path, code: 'EXPECTED_OBJECT' });
    return null;
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      issues.push({ path: `${path}.${key}`, code: 'MISSING_KEY' });
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, code: 'UNKNOWN_KEY' });
    } else if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      issues.push({ path: `${path}.${key}`, code: 'PROTOTYPE_KEY' });
    }
  }
  return value;
}

function checkString(value: unknown, path: string, issues: Issue[], maxLength = 2048): void {
  if (typeof value !== 'string') {
    issues.push({ path, code: 'EXPECTED_STRING' });
  } else if (value.length > maxLength) {
    issues.push({ path, code: 'STRING_TOO_LONG' });
  }
}

function checkNullableString(value: unknown, path: string, issues: Issue[], maxLength = 2048): void {
  if (value === null) return;
  checkString(value, path, issues, maxLength);
}

function checkIdLike(value: unknown, path: string, issues: Issue[]): void {
  if (!isIdLike(value)) issues.push({ path, code: 'EXPECTED_ID' });
}

function checkVersion(value: unknown, path: string, issues: Issue[]): void {
  if (!isSafeIntegerInRange(value, 1, 2_147_483_647)) {
    issues.push({ path, code: 'EXPECTED_VERSION' });
  }
}

const TRANSACTION_INPUT_KEYS = [
  'amountFen',
  'occurredDate',
  'occurredTime',
  'timePrecision',
  'name',
  'categoryId',
  'merchant',
  'note',
] as const;

function checkTransactionInputShape(
  value: unknown,
  path: string,
  issues: Issue[],
  { partial }: { partial: boolean },
): Record<string, unknown> | null {
  const required = partial ? [] : TRANSACTION_INPUT_KEYS;
  const record = checkKeys(value, required, TRANSACTION_INPUT_KEYS, path, issues);
  if (!record) return null;
  if (partial && Object.keys(record).length === 0) {
    issues.push({ path, code: 'PATCH_EMPTY' });
  }
  if ('amountFen' in record && typeof record.amountFen !== 'number') {
    // 具体金额范围/整数语义由服务层返回 AMOUNT_INVALID；此处只做结构类型。
    issues.push({ path: `${path}.amountFen`, code: 'EXPECTED_NUMBER' });
  }
  if ('occurredDate' in record) checkString(record.occurredDate, `${path}.occurredDate`, issues, 10);
  if ('occurredTime' in record) checkNullableString(record.occurredTime, `${path}.occurredTime`, issues, 5);
  if ('timePrecision' in record && record.timePrecision !== 'date' && record.timePrecision !== 'minute') {
    issues.push({ path: `${path}.timePrecision`, code: 'EXPECTED_DATE_OR_MINUTE' });
  }
  if ('name' in record) checkString(record.name, `${path}.name`, issues, 100);
  if ('categoryId' in record) checkIdLike(record.categoryId, `${path}.categoryId`, issues);
  if ('merchant' in record) checkNullableString(record.merchant, `${path}.merchant`, issues, 100);
  if ('note' in record) checkNullableString(record.note, `${path}.note`, issues, 500);
  return record;
}

function checkTransactionFilter(value: unknown, issues: Issue[]): void {
  const filter = checkKeys(
    value,
    [],
    ['dateStart', 'dateEnd', 'categoryIds', 'nameQuery', 'deleted'],
    'payload.filter',
    issues,
  );
  if (!filter) return;
  if ('dateStart' in filter) checkNullableString(filter.dateStart, 'payload.filter.dateStart', issues, 10);
  if ('dateEnd' in filter) checkNullableString(filter.dateEnd, 'payload.filter.dateEnd', issues, 10);
  if ('nameQuery' in filter) checkNullableString(filter.nameQuery, 'payload.filter.nameQuery', issues, 100);
  if ('deleted' in filter && filter.deleted !== 'active' && filter.deleted !== 'deleted' && filter.deleted !== 'all') {
    issues.push({ path: 'payload.filter.deleted', code: 'EXPECTED_ACTIVE_DELETED_ALL' });
  }
  if (!('categoryIds' in filter)) return;
  const ids = filter.categoryIds;
  if (!Array.isArray(ids)) {
    issues.push({ path: 'payload.filter.categoryIds', code: 'EXPECTED_ARRAY' });
    return;
  }
  if (ids.length > 500) {
    issues.push({ path: 'payload.filter.categoryIds', code: 'ARRAY_TOO_LONG' });
  }
  for (const [index, id] of ids.entries()) {
    if (!isIdLike(id)) {
      issues.push({ path: `payload.filter.categoryIds.${index}`, code: 'EXPECTED_ID' });
    }
  }
}

function checkPage(value: unknown, issues: Issue[]): void {
  const page = checkKeys(value, [], ['limit', 'cursor'], 'payload.page', issues);
  if (!page) return;
  if ('limit' in page && !isSafeIntegerInRange(page.limit, 1, 100)) {
    issues.push({ path: 'payload.page.limit', code: 'EXPECTED_LIMIT' });
  }
  if ('cursor' in page && page.cursor !== null) checkString(page.cursor, 'payload.page.cursor', issues, 2048);
}

function castTransactionList(payload: Record<string, unknown>): TransactionListInput {
  const filter = (payload.filter ?? {}) as Record<string, unknown>;
  const page = (payload.page ?? {}) as Record<string, unknown>;
  return {
    filter: {
      dateStart: (filter.dateStart as string | null | undefined) ?? null,
      dateEnd: (filter.dateEnd as string | null | undefined) ?? null,
      categoryIds: (filter.categoryIds as string[] | undefined) ?? [],
      nameQuery: (filter.nameQuery as string | null | undefined) ?? null,
      deleted: (filter.deleted as TransactionFilter['deleted'] | undefined) ?? 'active',
    },
    page: {
      limit: (page.limit as number | undefined) ?? 50,
      cursor: (page.cursor as string | null | undefined) ?? null,
    },
  };
}

function validateEmptyPayload(): Issue[] {
  return [];
}

function validateSecretPayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  const action = payload.action;
  if (action !== 'save' && action !== 'remove') {
    issues.push({ path: 'payload.action', code: 'EXPECTED_SAVE_OR_REMOVE' });
    return issues;
  }
  if (action === 'remove') {
    if ('secret' in payload) issues.push({ path: 'payload.secret', code: 'NOT_ALLOWED_ON_REMOVE' });
    if ('persistence' in payload) issues.push({ path: 'payload.persistence', code: 'NOT_ALLOWED_ON_REMOVE' });
    return issues;
  }
  const secret = payload.secret;
  if (typeof secret !== 'string') {
    issues.push({ path: 'payload.secret', code: 'EXPECTED_STRING' });
  } else {
    if (secret.length < SECRET_MIN_LENGTH || secret.length > SECRET_MAX_LENGTH) {
      issues.push({ path: 'payload.secret', code: 'SECRET_LENGTH' });
    }
    // 密钥为不透明输入：不做 trim/NFC 改写，含控制字符直接拒绝。
    if (/[\u0000-\u001f\u007f]/.test(secret)) {
      issues.push({ path: 'payload.secret', code: 'CONTROL_CHARACTER' });
    }
  }
  if (payload.persistence !== 'encrypted' && payload.persistence !== 'session') {
    issues.push({ path: 'payload.persistence', code: 'EXPECTED_ENCRYPTED_OR_SESSION' });
  }
  return issues;
}

function validateCapabilitiesPayload(payload: Record<string, unknown>): Issue[] {
  if (typeof payload.providerId !== 'string' || !PROVIDER_IDS.includes(payload.providerId)) {
    return [{ path: 'payload.providerId', code: 'UNKNOWN_PROVIDER' }];
  }
  return [];
}

function validateMockPayload(payload: Record<string, unknown>): Issue[] {
  if (
    payload.scenario !== 'paid-order' &&
    payload.scenario !== 'two-expenses' &&
    payload.scenario !== 'product-photo'
  ) {
    return [{ path: 'payload.scenario', code: 'UNKNOWN_SCENARIO' }];
  }
  return [];
}

function validateCategoryListPayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  if ('includeDisabled' in payload && typeof payload.includeDisabled !== 'boolean') {
    issues.push({ path: 'payload.includeDisabled', code: 'EXPECTED_BOOLEAN' });
  }
  return issues;
}

function validateCategoryCreatePayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  checkString(payload.name, 'payload.name', issues, 20);
  checkString(payload.iconKey, 'payload.iconKey', issues, 64);
  if ('sortOrder' in payload && !isSafeIntegerInRange(payload.sortOrder, 0, 999_999)) {
    issues.push({ path: 'payload.sortOrder', code: 'EXPECTED_SORT_ORDER' });
  }
  return issues;
}

function validateCategoryUpdatePayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  checkIdLike(payload.id, 'payload.id', issues);
  checkVersion(payload.expectedVersion, 'payload.expectedVersion', issues);
  const patch = checkKeys(
    payload.patch,
    [],
    ['name', 'iconKey', 'sortOrder', 'enabled'],
    'payload.patch',
    issues,
  );
  if (!patch) return issues;
  if (Object.keys(patch).length === 0) issues.push({ path: 'payload.patch', code: 'PATCH_EMPTY' });
  if ('name' in patch) checkString(patch.name, 'payload.patch.name', issues, 20);
  if ('iconKey' in patch) checkString(patch.iconKey, 'payload.patch.iconKey', issues, 64);
  if ('sortOrder' in patch && !isSafeIntegerInRange(patch.sortOrder, 0, 999_999)) {
    issues.push({ path: 'payload.patch.sortOrder', code: 'EXPECTED_SORT_ORDER' });
  }
  if ('enabled' in patch && patch.enabled !== true) {
    issues.push({ path: 'payload.patch.enabled', code: 'USE_DISABLE_OPERATION' });
  }
  return issues;
}

function validateCategoryDisablePayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  checkIdLike(payload.id, 'payload.id', issues);
  checkVersion(payload.expectedVersion, 'payload.expectedVersion', issues);
  return issues;
}

function validateTransactionCreatePayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  checkTransactionInputShape(payload, 'payload', issues, { partial: false });
  return issues;
}

function validateTransactionUpdatePayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  checkIdLike(payload.id, 'payload.id', issues);
  checkVersion(payload.expectedVersion, 'payload.expectedVersion', issues);
  checkTransactionInputShape(payload.patch, 'payload.patch', issues, { partial: true });
  return issues;
}

function validateTransactionVersionedPayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  checkIdLike(payload.id, 'payload.id', issues);
  checkVersion(payload.expectedVersion, 'payload.expectedVersion', issues);
  return issues;
}

function validateTransactionListPayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  if ('filter' in payload) checkTransactionFilter(payload.filter, issues);
  if ('page' in payload) checkPage(payload.page, issues);
  return issues;
}

function validateBackupCreatePayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  if (payload.kind !== 'manual') issues.push({ path: 'payload.kind', code: 'EXPECTED_MANUAL' });
  if (payload.containsPrivateDataAcknowledged !== true) {
    issues.push({ path: 'payload.containsPrivateDataAcknowledged', code: 'ACKNOWLEDGEMENT_REQUIRED' });
  }
  return issues;
}

function validateBackupRestorePayload(payload: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  if (payload.mode === 'preview') {
    if (!isUuidV4(payload.backupId)) {
      issues.push({ path: 'payload.backupId', code: 'EXPECTED_UUID_V4' });
    }
    return issues;
  }
  if (payload.mode === 'commit') {
    checkString(payload.restoreToken, 'payload.restoreToken', issues, 2048);
    if (payload.currentDataWillBeReplaced !== true) {
      issues.push({
        path: 'payload.currentDataWillBeReplaced',
        code: 'ACKNOWLEDGEMENT_REQUIRED',
      });
    }
    return issues;
  }
  issues.push({ path: 'payload.mode', code: 'EXPECTED_PREVIEW_OR_COMMIT' });
  return issues;
}

const EMPTY_SPEC: RequestSpec<Record<string, never>> = {
  required: [],
  optional: [],
  allowNullEpoch: true,
  requireMutationId: false,
  validatePayload: validateEmptyPayload,
  cast: () => ({}),
};

const EMPTY_MUTATION_SPEC: RequestSpec<Record<string, never>> = {
  required: [],
  optional: [],
  allowNullEpoch: true,
  requireMutationId: true,
  validatePayload: validateEmptyPayload,
  cast: () => ({}),
};

const READ_EPOCH_SPEC: RequestSpec<Record<string, never>> = {
  ...EMPTY_SPEC,
  allowNullEpoch: false,
};

export const CHANNEL_SPECS: {
  readonly settingsReadAi: ChannelSpec<Record<string, never>>;
  readonly settingsReadStatus: ChannelSpec<Record<string, never>>;
  readonly settingsSaveSecret: ChannelSpec<SaveSecretInput>;
  readonly providerCapabilities: ChannelSpec<ProviderCapabilitiesInput>;
  readonly skeletonMockRecognition: ChannelSpec<MockRecognitionInput>;
  readonly ledgerEnsureDefault: ChannelSpec<Record<string, never>>;
  readonly categoryList: ChannelSpec<CategoryListInput>;
  readonly categoryCreate: ChannelSpec<CategoryCreateInput>;
  readonly categoryUpdate: ChannelSpec<CategoryUpdateInput>;
  readonly categoryDisable: ChannelSpec<CategoryDisableInput>;
  readonly transactionCreate: ChannelSpec<TransactionInput>;
  readonly transactionUpdate: ChannelSpec<TransactionUpdateInput>;
  readonly transactionSoftDelete: ChannelSpec<TransactionVersionedInput>;
  readonly transactionRestore: ChannelSpec<TransactionVersionedInput>;
  readonly transactionList: ChannelSpec<TransactionListInput>;
  readonly backupCreate: ChannelSpec<BackupCreateInput>;
  readonly backupList: ChannelSpec<BackupListInput>;
  readonly backupRestore: ChannelSpec<BackupRestoreInput>;
} = {
  settingsReadAi: {
    channel: IPC.settingsReadAi,
    permission: 'R',
    skeletonOnly: false,
    request: EMPTY_SPEC,
  },
  settingsReadStatus: {
    channel: IPC.settingsReadStatus,
    permission: 'R',
    skeletonOnly: false,
    request: EMPTY_SPEC,
  },
  settingsSaveSecret: {
    channel: IPC.settingsSaveSecret,
    permission: 'S',
    skeletonOnly: false,
    request: {
      required: ['action'],
      optional: ['secret', 'persistence'],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateSecretPayload,
      cast: (payload) => payload as unknown as SaveSecretInput,
    },
  },
  providerCapabilities: {
    channel: IPC.providerCapabilities,
    permission: 'R',
    skeletonOnly: false,
    request: {
      required: ['providerId'],
      optional: [],
      allowNullEpoch: true,
      requireMutationId: false,
      validatePayload: validateCapabilitiesPayload,
      cast: (payload) => payload as unknown as ProviderCapabilitiesInput,
    },
  },
  skeletonMockRecognition: {
    channel: IPC.skeletonMockRecognition,
    permission: 'R',
    skeletonOnly: true,
    request: {
      required: ['scenario'],
      optional: [],
      allowNullEpoch: true,
      requireMutationId: false,
      validatePayload: validateMockPayload,
      cast: (payload) => payload as unknown as MockRecognitionInput,
    },
  },
  ledgerEnsureDefault: {
    channel: IPC.ledgerEnsureDefault,
    permission: 'W',
    skeletonOnly: false,
    request: {
      ...EMPTY_MUTATION_SPEC,
      cast: () => ({} as Record<string, never>),
    },
  },
  categoryList: {
    channel: IPC.categoryList,
    permission: 'R',
    skeletonOnly: false,
    request: {
      required: [],
      optional: ['includeDisabled'],
      allowNullEpoch: false,
      requireMutationId: false,
      validatePayload: validateCategoryListPayload,
      cast: (payload) => payload as unknown as CategoryListInput,
    },
  },
  categoryCreate: {
    channel: IPC.categoryCreate,
    permission: 'W',
    skeletonOnly: false,
    request: {
      required: ['name', 'iconKey'],
      optional: ['sortOrder'],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateCategoryCreatePayload,
      cast: (payload) => payload as unknown as CategoryCreateInput,
    },
  },
  categoryUpdate: {
    channel: IPC.categoryUpdate,
    permission: 'W',
    skeletonOnly: false,
    request: {
      required: ['id', 'expectedVersion', 'patch'],
      optional: [],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateCategoryUpdatePayload,
      cast: (payload) => payload as unknown as CategoryUpdateInput,
    },
  },
  categoryDisable: {
    channel: IPC.categoryDisable,
    permission: 'W',
    skeletonOnly: false,
    request: {
      required: ['id', 'expectedVersion'],
      optional: [],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateCategoryDisablePayload,
      cast: (payload) => payload as unknown as CategoryDisableInput,
    },
  },
  transactionCreate: {
    channel: IPC.transactionCreate,
    permission: 'W',
    skeletonOnly: false,
    request: {
      required: [...TRANSACTION_INPUT_KEYS],
      optional: [],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateTransactionCreatePayload,
      cast: (payload) => payload as unknown as TransactionInput,
    },
  },
  transactionUpdate: {
    channel: IPC.transactionUpdate,
    permission: 'W',
    skeletonOnly: false,
    request: {
      required: ['id', 'expectedVersion', 'patch'],
      optional: [],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateTransactionUpdatePayload,
      cast: (payload) => payload as unknown as TransactionUpdateInput,
    },
  },
  transactionSoftDelete: {
    channel: IPC.transactionSoftDelete,
    permission: 'W',
    skeletonOnly: false,
    request: {
      required: ['id', 'expectedVersion'],
      optional: [],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateTransactionVersionedPayload,
      cast: (payload) => payload as unknown as TransactionVersionedInput,
    },
  },
  transactionRestore: {
    channel: IPC.transactionRestore,
    permission: 'W',
    skeletonOnly: false,
    request: {
      required: ['id', 'expectedVersion'],
      optional: [],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateTransactionVersionedPayload,
      cast: (payload) => payload as unknown as TransactionVersionedInput,
    },
  },
  transactionList: {
    channel: IPC.transactionList,
    permission: 'R',
    skeletonOnly: false,
    request: {
      // CONTRACTS §2/§3：filter 字段与 page.limit/cursor 均有默认值，允许省略。
      required: [],
      optional: ['filter', 'page'],
      allowNullEpoch: false,
      requireMutationId: false,
      validatePayload: validateTransactionListPayload,
      cast: castTransactionList,
    },
  },
  backupCreate: {
    channel: IPC.backupCreate,
    permission: 'W',
    skeletonOnly: false,
    request: {
      required: ['kind', 'containsPrivateDataAcknowledged'],
      optional: [],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateBackupCreatePayload,
      cast: (payload) => payload as unknown as BackupCreateInput,
    },
  },
  backupList: {
    channel: IPC.backupList,
    permission: 'R',
    skeletonOnly: false,
    request: READ_EPOCH_SPEC,
  },
  backupRestore: {
    channel: IPC.backupRestore,
    permission: 'W',
    skeletonOnly: false,
    request: {
      required: ['mode'],
      optional: ['backupId', 'restoreToken', 'currentDataWillBeReplaced'],
      allowNullEpoch: false,
      // preview 是只读校验；commit 的 mutationId 由 handler 强制（CONTRACTS §6：preview R，commit I）。
      requireMutationId: false,
      validatePayload: validateBackupRestorePayload,
      cast: (payload) => payload as unknown as BackupRestoreInput,
    },
  },
};

/** 业务契约通道（可出现在 CONTRACTS 中）；skeleton.* 不计入。 */
export const BUSINESS_CHANNELS: readonly IpcChannel[] = [
  IPC.settingsReadAi,
  IPC.settingsReadStatus,
  IPC.settingsSaveSecret,
  IPC.providerCapabilities,
  IPC.ledgerEnsureDefault,
  IPC.categoryList,
  IPC.categoryCreate,
  IPC.categoryUpdate,
  IPC.categoryDisable,
  IPC.transactionCreate,
  IPC.transactionUpdate,
  IPC.transactionSoftDelete,
  IPC.transactionRestore,
  IPC.transactionList,
  IPC.backupCreate,
  IPC.backupList,
  IPC.backupRestore,
];

export const SKELETON_CHANNELS: readonly IpcChannel[] = [IPC.skeletonMockRecognition];

export const ALL_CHANNELS: readonly IpcChannel[] = [...BUSINESS_CHANNELS, ...SKELETON_CHANNELS];

export function isKnownChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (ALL_CHANNELS as readonly string[]).includes(value);
}

/** settings.saveSecret 专用限流：每窗口每分钟 ≤5 次提交（CONTRACTS §1 S 权限）。 */
export const SECRET_SUBMIT_RATE_LIMIT = { limit: 5, windowMs: 60_000 } as const;

export function isSaveSecretPayload(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value);
}

/** 供 handler 与测试复用的输入别名。 */
export type { TransactionFilter, PageInput, LedgerEnsureDefaultView };
