/**
 * 账本、分类、交易与备份的受限 DTO（docs/CONTRACTS.md §2/§3/§6）。
 *
 * 只包含业务字段：不含数据库路径、SQL、图片字节、密钥或 provider 原文。
 * 金额以整数分跨 IPC；汇总金额使用十进制字符串（避免 JS 安全整数溢出）。
 */

import type { TimePrecision } from './date.js';

export interface LedgerView {
  id: string;
  name: string;
  currency: 'CNY';
  timezone: 'Asia/Shanghai';
  dataRevision: number;
  datasetRevision: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryView {
  id: string;
  ledgerId: string;
  name: string;
  iconKey: string;
  sortOrder: number;
  enabled: boolean;
  /** 系统分类稳定身份；自定义分类为 null。 */
  systemKey: string | null;
  /** 受保护分类（systemKey=other）：只允许改名/换图标，不允许停用。 */
  protected: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryListResult {
  categories: CategoryView[];
  revision: number;
}

export interface CategoryCreateInput {
  name: string;
  iconKey: string;
  /** 省略时由主进程按“初始 350，其后 +10”生成。 */
  sortOrder?: number;
}

export interface CategoryPatch {
  name?: string;
  iconKey?: string;
  sortOrder?: number;
  /** 只允许 true（重新启用）；停用必须走 category.disable。 */
  enabled?: true;
}

export interface CategoryUpdateInput {
  id: string;
  expectedVersion: number;
  patch: CategoryPatch;
}

export interface CategoryDisableInput {
  id: string;
  expectedVersion: number;
}

export interface LedgerEnsureDefaultView {
  ledger: LedgerView;
  categories: CategoryView[];
  /** 契约与数据库就绪状态；S05 起真实返回。 */
  readiness: 'ready' | 'recovery_required';
  dataEpoch: string;
}

export interface TransactionInput {
  amountFen: number;
  occurredDate: string;
  occurredTime: string | null;
  timePrecision: TimePrecision;
  name: string;
  categoryId: string;
  merchant: string | null;
  note: string | null;
}

/** update 的白名单 patch：省略表示不改，null 表示清空可空字段。 */
export type TransactionPatch = Partial<TransactionInput>;

export interface TransactionUpdateInput {
  id: string;
  expectedVersion: number;
  patch: TransactionPatch;
}

export interface TransactionVersionedInput {
  id: string;
  expectedVersion: number;
}

export type TransactionDeletedFilter = 'active' | 'deleted' | 'all';

export interface TransactionFilter {
  /** 包含边界；null 表示无该侧边界。 */
  dateStart: string | null;
  /** 不包含边界；允许 9999-01-01 哨兵；null 表示无该侧边界。 */
  dateEnd: string | null;
  /** 空数组表示不限；最多 500 项。 */
  categoryIds: string[];
  /** 字面子串（NFC，ASCII 大小写不敏感），不是通配符/正则。 */
  nameQuery: string | null;
  deleted: TransactionDeletedFilter;
}

export interface PageInput {
  limit: number;
  cursor: string | null;
}

export interface TransactionListInput {
  filter: TransactionFilter;
  page: PageInput;
}

export interface DateGroupView {
  date: string;
  count: number;
  totalFen: string;
}

export interface TransactionListResult {
  items: TransactionView[];
  nextCursor: string | null;
  totalCount: number;
  snapshotRevision: number;
  filteredTotalFen: string;
  dateGroups: DateGroupView[];
  filterEcho: TransactionFilter;
}

export interface TransactionView {
  id: string;
  ledgerId: string;
  amountFen: number;
  currency: 'CNY';
  occurredDate: string;
  occurredTime: string | null;
  timePrecision: TimePrecision;
  name: string;
  categoryId: string;
  merchant: string | null;
  note: string | null;
  source: 'manual' | 'ai';
  sourceCandidateId: string | null;
  deletedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type MutationReplayed = { replayed: boolean };

export interface TransactionMutationResult extends MutationReplayed {
  transaction: TransactionView;
}

export interface CategoryMutationResult extends MutationReplayed {
  category: CategoryView;
}

export interface BackupArtifactView {
  artifactId: string;
  displayName: string;
  sha256: string;
  byteSize: number;
  recordCount: number | null;
  createdAt: string;
}

export type BackupKind = 'manual' | 'pre_migration' | 'pre_restore';
export type BackupStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface BackupRecordView {
  id: string;
  kind: BackupKind;
  status: BackupStatus;
  manifestVersion: 'bk-backup.v1';
  dbSchemaVersion: number;
  appVersion: string;
  archiveHash: string | null;
  createdAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  artifact: BackupArtifactView | null;
}

export interface BackupCreateInput {
  kind: 'manual';
  containsPrivateDataAcknowledged: true;
}

export interface BackupCreateResult extends MutationReplayed {
  record: BackupRecordView;
  artifact: BackupArtifactView;
}

export interface BackupListResult {
  records: BackupRecordView[];
}

export interface BackupRestorePreviewInput {
  mode: 'preview';
  backupId: string;
}

export interface BackupRestoreCommitInput {
  mode: 'commit';
  restoreToken: string;
  currentDataWillBeReplaced: true;
}

export type BackupRestoreInput = BackupRestorePreviewInput | BackupRestoreCommitInput;

export interface BackupRestorePreviewResult {
  backupId: string;
  archiveHash: string;
  manifestVersion: 'bk-backup.v1';
  dbSchemaVersion: number;
  /** current=直接可用；needs_migration=恢复时在 staging 迁移。 */
  schemaCompatibility: 'current' | 'needs_migration';
  ledgerId: string;
  snapshotRevision: number;
  createdAt: string;
  fileCount: number;
  warnings: string[];
  restoreToken: string;
  /** 同档案此前已成功恢复过的 mutationId（来自持久恢复日志）。 */
  lastAppliedRestoreId: string | null;
}

export interface BackupRestoreResult extends MutationReplayed {
  ledgerId: string;
  newDataEpoch: string;
  revision: number;
  preRestoreBackupId: string;
  appliedBackupHash: string;
}

/** 变更操作的幂等选项：重试必须复用同一个 mutationId（docs/CONTRACTS.md §1）。 */
export interface MutationOptions {
  mutationId?: string;
}
