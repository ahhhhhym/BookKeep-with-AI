/**
 * 独立备份目录（S05-R1，CONTRACTS §10.2 / ARCHITECTURE §11）。
 *
 * 备份档案位于 generation 之外的 `backups/`，因此恢复旧账本不会让已保留档案失去入口。
 * `backups/catalog.json` 记录每份档案的受限元数据（不含路径外内容、不含密钥）；
 * 恢复切换新 generation 时把目录合并回当前 DB 的 backup_record，使列表/预览/再次恢复
 * 在恢复后与重启后仍然可用。合并只写维护元数据，绝不复制旧交易或审计。
 *
 * 启动时扫描 `backups/*.bkdb` 补偿“档案已写、目录未登记”的崩溃窗口；坏档案不伪造成功，
 * 仍保留历史条目，预览阶段返回 HASH_MISMATCH/BACKUP_INVALID。
 */

import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BackupKind, BackupStatus } from '../../shared/entities';
import { isUuidV4 } from '../../shared/validation';
import { runInTransaction, openSqlite, type SqliteDb } from '../db/sqlite';
import type { BackupRecordRow } from '../db/rows';
import {
  BACKUP_MANIFEST_TABLE,
  BACKUP_MANIFEST_VERSION,
  sha256File,
} from './backup-archive';
import { backupArchivePath, backupArchiveRef, type StoragePaths } from './layout';

export const BACKUP_CATALOG_VERSION = 'bk-backup-catalog.v1';

export interface BackupCatalogEntry {
  readonly id: string;
  readonly ledgerId: string;
  readonly kind: BackupKind;
  readonly status: BackupStatus;
  readonly manifestVersion: typeof BACKUP_MANIFEST_VERSION;
  readonly dbSchemaVersion: number;
  readonly appVersion: string;
  readonly archiveHash: string;
  readonly archiveRef: string;
  readonly errorCode: string | null;
  readonly finishedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface BackupCatalogFile {
  readonly manifestVersion: typeof BACKUP_CATALOG_VERSION;
  readonly updatedAt: string;
  readonly entries: readonly BackupCatalogEntry[];
}

function catalogPath(paths: StoragePaths): string {
  return path.join(paths.backups, 'catalog.json');
}

function isKind(value: unknown): value is BackupKind {
  return value === 'manual' || value === 'pre_migration' || value === 'pre_restore';
}

function isStatus(value: unknown): value is BackupStatus {
  return (
    value === 'queued' ||
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

function isCatalogEntry(value: unknown): value is BackupCatalogEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    isUuidV4(record.id) &&
    typeof record.ledgerId === 'string' &&
    record.ledgerId.length > 0 &&
    isKind(record.kind) &&
    isStatus(record.status) &&
    record.manifestVersion === BACKUP_MANIFEST_VERSION &&
    typeof record.dbSchemaVersion === 'number' &&
    Number.isSafeInteger(record.dbSchemaVersion) &&
    record.dbSchemaVersion >= 1 &&
    typeof record.appVersion === 'string' &&
    typeof record.archiveHash === 'string' &&
    /^[0-9a-f]{64}$/.test(record.archiveHash) &&
    record.archiveRef === backupArchiveRef(record.id as string) &&
    (record.errorCode === null || typeof record.errorCode === 'string') &&
    (record.finishedAt === null || typeof record.finishedAt === 'string') &&
    typeof record.version === 'number' &&
    Number.isSafeInteger(record.version) &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  );
}

export function readBackupCatalog(paths: StoragePaths): BackupCatalogEntry[] {
  const file = catalogPath(paths);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<BackupCatalogFile>;
    if (parsed.manifestVersion !== BACKUP_CATALOG_VERSION || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(isCatalogEntry);
  } catch {
    return [];
  }
}

function writeBackupCatalog(paths: StoragePaths, entries: readonly BackupCatalogEntry[], now: string): void {
  const file = catalogPath(paths);
  const temporary = path.join(paths.backups, `catalog.${process.pid}.${Date.now()}.tmp`);
  const payload: BackupCatalogFile = {
    manifestVersion: BACKUP_CATALOG_VERSION,
    updatedAt: now,
    entries: [...entries].sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
      return left.id < right.id ? -1 : 1;
    }),
  };
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  try {
    renameSync(temporary, file);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // 清理失败不掩盖主错误。
    }
    throw error;
  }
}

export function upsertBackupCatalogEntry(
  paths: StoragePaths,
  entry: BackupCatalogEntry,
  now: string,
): void {
  upsertBackupCatalogEntries(paths, [entry], now);
}

/** 批量补登记（目录先行于 generation 行）：已存在的 id 不覆盖。 */
export function upsertBackupCatalogEntries(
  paths: StoragePaths,
  entries: readonly BackupCatalogEntry[],
  now: string,
): number {
  const existing = readBackupCatalog(paths);
  const known = new Set(existing.map((entry) => entry.id));
  let added = 0;
  for (const entry of entries) {
    if (!isCatalogEntry(entry) || known.has(entry.id)) continue;
    existing.push(entry);
    known.add(entry.id);
    added += 1;
  }
  if (added > 0) writeBackupCatalog(paths, existing, now);
  return added;
}

export function removeBackupCatalogEntry(paths: StoragePaths, id: string, now: string): void {
  const entries = readBackupCatalog(paths).filter((entry) => entry.id !== id);
  writeBackupCatalog(paths, entries, now);
}

export function catalogEntryFromRow(row: BackupRecordRow): BackupCatalogEntry | null {
  if (row.archive_hash === null || row.archive_ref === null) return null;
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    kind: row.kind,
    status: row.status,
    manifestVersion: row.manifest_version,
    dbSchemaVersion: row.db_schema_version,
    appVersion: row.app_version,
    archiveHash: row.archive_hash,
    archiveRef: row.archive_ref,
    errorCode: row.error_code,
    finishedAt: row.finished_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface RawManifest {
  manifestVersion?: unknown;
  ledgerId?: unknown;
  dbSchemaVersion?: unknown;
  appVersion?: unknown;
  createdAt?: unknown;
  snapshotRevision?: unknown;
}

/** 从孤儿档案读取内嵌 manifest（只读、无任意路径输入）。 */
function discoverEntry(paths: StoragePaths, id: string): BackupCatalogEntry | null {
  const archivePath = backupArchivePath(paths, id);
  let db: SqliteDb | null = null;
  try {
    db = openSqlite(archivePath, { readonly: true, fileMustExist: true });
    const row = db
      .prepare<{ payload_json: string }>(`SELECT payload_json FROM ${BACKUP_MANIFEST_TABLE} WHERE id = 'manifest'`)
      .get();
    if (!row) return null;
    const manifest = JSON.parse(row.payload_json) as RawManifest;
    if (
      manifest.manifestVersion !== BACKUP_MANIFEST_VERSION ||
      typeof manifest.ledgerId !== 'string' ||
      manifest.ledgerId.length === 0 ||
      typeof manifest.dbSchemaVersion !== 'number' ||
      !Number.isSafeInteger(manifest.dbSchemaVersion) ||
      manifest.dbSchemaVersion < 1 ||
      typeof manifest.appVersion !== 'string' ||
      typeof manifest.createdAt !== 'string'
    ) {
      return null;
    }
    const hash = sha256File(archivePath);
    return {
      id,
      ledgerId: manifest.ledgerId,
      kind: 'manual',
      status: 'completed',
      manifestVersion: BACKUP_MANIFEST_VERSION,
      dbSchemaVersion: manifest.dbSchemaVersion,
      appVersion: manifest.appVersion,
      archiveHash: hash,
      archiveRef: backupArchiveRef(id),
      errorCode: null,
      finishedAt: manifest.createdAt,
      version: 1,
      createdAt: manifest.createdAt,
      updatedAt: manifest.createdAt,
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

export interface CatalogReconcileResult {
  readonly entries: BackupCatalogEntry[];
  readonly discovered: number;
}

/**
 * 扫描 backups/*.bkdb，把尚未登记但 manifest 可读的档案补进目录。
 * 坏档案不加入（无合法 manifest），已有条目保留以便预览阶段报告错误。
 */
export function reconcileBackupCatalog(paths: StoragePaths, now: string): CatalogReconcileResult {
  const entries = readBackupCatalog(paths);
  const known = new Set(entries.map((entry) => entry.id));
  let discovered = 0;
  let files: string[] = [];
  try {
    files = readdirSync(paths.backups);
  } catch {
    return { entries, discovered: 0 };
  }
  for (const file of files) {
    if (!file.endsWith('.bkdb')) continue;
    const id = file.slice(0, -'.bkdb'.length);
    if (!isUuidV4(id) || known.has(id)) continue;
    const entry = discoverEntry(paths, id);
    if (!entry) continue;
    entries.push(entry);
    known.add(id);
    discovered += 1;
  }
  if (discovered > 0) writeBackupCatalog(paths, entries, now);
  return { entries, discovered };
}

/**
 * 把独立目录合并进当前 generation 的 backup_record（仅维护元数据）。
 * 使用当前 ledgerId 满足外键；不写交易/审计，不超范围改档案内容。
 */
export function mergeCatalogIntoDatabase(
  db: SqliteDb,
  ledgerId: string,
  entries: readonly BackupCatalogEntry[],
  now: string,
): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO backup_record
       (id, ledger_id, kind, status, manifest_version, db_schema_version, app_version,
        archive_hash, archive_ref, error_code, finished_at, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return runInTransaction(db, () => {
    let merged = 0;
    for (const entry of entries) {
      if (!isCatalogEntry(entry)) continue;
      try {
        const result = insert.run(
          entry.id,
          ledgerId,
          entry.kind,
          entry.status,
          entry.manifestVersion,
          entry.dbSchemaVersion,
          entry.appVersion,
          entry.archiveHash,
          entry.archiveRef,
          entry.errorCode,
          entry.finishedAt,
          entry.version,
          entry.createdAt,
          now,
        );
        merged += result.changes;
      } catch {
        // 单条目录损坏不应阻止启动；该条不进入当前会话目录。
      }
    }
    return merged;
  });
}
