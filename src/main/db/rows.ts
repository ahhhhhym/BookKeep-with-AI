/** SQLite 行 → 受限 DTO 的映射（不把内部列泄漏给渲染层）。 */

import type {
  BackupKind,
  BackupRecordView,
  BackupStatus,
  CategoryView,
  LedgerView,
  TransactionView,
  TransactionDeletedFilter,
} from '../../shared/entities';
import type { TimePrecision } from '../../shared/date';

export interface LedgerRow {
  id: string;
  name: string;
  currency: 'CNY';
  timezone: 'Asia/Shanghai';
  default_key: string;
  data_revision: number;
  dataset_revision: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  ledger_id: string;
  name: string;
  normalized_name: string;
  icon_key: string;
  sort_order: number;
  enabled: number;
  system_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  ledger_id: string;
  amount_fen: number;
  currency: 'CNY';
  occurred_date: string;
  occurred_time: string | null;
  time_precision: TimePrecision;
  name: string;
  category_id: string;
  merchant: string | null;
  note: string | null;
  source: 'manual' | 'ai';
  source_candidate_id: string | null;
  deleted_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface BackupRecordRow {
  id: string;
  ledger_id: string;
  kind: BackupKind;
  status: BackupStatus;
  manifest_version: 'bk-backup.v1';
  db_schema_version: number;
  app_version: string;
  archive_hash: string | null;
  archive_ref: string | null;
  error_code: string | null;
  finished_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export const PROTECTED_SYSTEM_KEY = 'other';

export function mapLedger(row: LedgerRow): LedgerView {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    timezone: row.timezone,
    dataRevision: row.data_revision,
    datasetRevision: row.dataset_revision,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCategory(row: CategoryRow): CategoryView {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    name: row.name,
    iconKey: row.icon_key,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
    systemKey: row.system_key,
    protected: row.system_key === PROTECTED_SYSTEM_KEY,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTransaction(row: TransactionRow): TransactionView {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    amountFen: row.amount_fen,
    currency: row.currency,
    occurredDate: row.occurred_date,
    occurredTime: row.occurred_time,
    timePrecision: row.time_precision,
    name: row.name,
    categoryId: row.category_id,
    merchant: row.merchant,
    note: row.note,
    source: row.source,
    sourceCandidateId: row.source_candidate_id,
    deletedAt: row.deleted_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapBackupRecord(row: BackupRecordRow): BackupRecordView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    manifestVersion: row.manifest_version,
    dbSchemaVersion: row.db_schema_version,
    appVersion: row.app_version,
    archiveHash: row.archive_hash,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    artifact:
      row.archive_hash !== null && row.archive_ref !== null
        ? {
            artifactId: row.id,
            displayName: `BookKeepAI-backup-${row.created_at.slice(0, 10)}.bkdb`,
            sha256: row.archive_hash,
            byteSize: 0,
            recordCount: null,
            createdAt: row.created_at,
          }
        : null,
  };
}

/** 交易删除状态过滤 → SQL 片段（只允许三种已声明值）。 */
export function deletedFilterSql(filter: TransactionDeletedFilter): string {
  if (filter === 'active') return 't.deleted_at IS NULL';
  if (filter === 'deleted') return 't.deleted_at IS NOT NULL';
  return '1 = 1';
}
