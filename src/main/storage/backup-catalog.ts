/**
 * 独立备份目录（S05-R1/R2，CONTRACTS §10.2 / ARCHITECTURE §11）。
 *
 * 备份档案位于 generation 之外的 `backups/`，因此恢复旧账本不会让已保留档案失去入口。
 * `backups/catalog.json` 记录每份档案的受限元数据（不含路径外内容、不含密钥）；
 * 恢复切换新 generation 时把目录合并回当前 DB 的 backup_record，使列表/预览/再次恢复
 * 在恢复后与重启后仍然可用。合并只写维护元数据，绝不复制旧交易或审计。
 *
 * S05-R2/BK-S05-003：`archiveHash` 是已知创建基准。启动时先把当前 generation 的
 * backup_record（可信创建记录）导入目录，再扫描未知档案；扫描得到的当前文件 hash 只可
 * 作为“无创建基准的独立档案”的初始基准（origin=discovered），绝不能覆盖 DB/目录中已有
 * 的创建基准。DB 与目录同为 created 且 hash 不一致时标记 conflict，预览/恢复明确拒绝，
 * 不按扫描/读取顺序静默选择。
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
import {PREPARED_VERSION,verifyPreparedBackup,readVerifiedCompletion} from './backup-success';
import {AppError} from '../../shared/errors';

export const BACKUP_CATALOG_VERSION = 'bk-backup-catalog.v1';

export type BackupCatalogOrigin = 'created' | 'discovered';
export type BackupCatalogIntegrity = 'ok' | 'conflict';

export interface BackupCatalogEntry {
  readonly id: string;
  readonly ledgerId: string;
  readonly kind: BackupKind;
  readonly status: BackupStatus;
  readonly manifestVersion: typeof BACKUP_MANIFEST_VERSION;
  readonly dbSchemaVersion: number;
  readonly appVersion: string;
  /** 已知创建基准；扫描得到的当前文件 hash 不得覆盖它（除非该条仅为 discovered）。 */
  readonly archiveHash: string;
  readonly archiveRef: string;
  readonly errorCode: string | null;
  readonly finishedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly origin: BackupCatalogOrigin;
  readonly integrity: BackupCatalogIntegrity;
  readonly conflictCode: string | null;
  /** 冲突时另一侧（DB）记录提供的 hash，仅供诊断；不代表可接受基准。 */
  readonly conflictingHash: string | null;
}

interface BackupCatalogFile {
  readonly manifestVersion: typeof BACKUP_CATALOG_VERSION;
  readonly updatedAt: string;
  readonly entries: readonly BackupCatalogEntry[];
}

export const CATALOG_CONFLICT_DB_HASH = 'CATALOG_DB_HASH_MISMATCH';

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

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * 校验并规范化目录条目。R1 生成的旧条目没有 origin/integrity 字段：
 * 视为 created/ok（R1 只由创建路径写入），以保持旧目录可读。
 */
function parseCatalogEntry(value: unknown): BackupCatalogEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !isUuidV4(record.id) ||
    typeof record.ledgerId !== 'string' ||
    record.ledgerId.length === 0 ||
    !isKind(record.kind) ||
    !isStatus(record.status) ||
    record.manifestVersion !== BACKUP_MANIFEST_VERSION ||
    typeof record.dbSchemaVersion !== 'number' ||
    !Number.isSafeInteger(record.dbSchemaVersion) ||
    record.dbSchemaVersion < 1 ||
    typeof record.appVersion !== 'string' ||
    !isHash(record.archiveHash) ||
    record.archiveRef !== backupArchiveRef(record.id as string) ||
    (record.errorCode !== null && typeof record.errorCode !== 'string') ||
    (record.finishedAt !== null && typeof record.finishedAt !== 'string') ||
    typeof record.version !== 'number' ||
    !Number.isSafeInteger(record.version) ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null;
  }
  const origin: BackupCatalogOrigin = record.origin === 'discovered' ? 'discovered' : 'created';
  const integrity: BackupCatalogIntegrity = record.integrity === 'conflict' ? 'conflict' : 'ok';
  return {
    id: record.id,
    ledgerId: record.ledgerId,
    kind: record.kind,
    status: record.status,
    manifestVersion: BACKUP_MANIFEST_VERSION,
    dbSchemaVersion: record.dbSchemaVersion,
    appVersion: record.appVersion,
    archiveHash: record.archiveHash,
    archiveRef: record.archiveRef,
    errorCode: record.errorCode,
    finishedAt: record.finishedAt,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    origin,
    integrity,
    conflictCode: typeof record.conflictCode === 'string' ? record.conflictCode : null,
    conflictingHash: isHash(record.conflictingHash) ? record.conflictingHash : null,
  };
}

export function readBackupCatalog(paths: StoragePaths): BackupCatalogEntry[] {
  const file = catalogPath(paths);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<BackupCatalogFile>;
    if (parsed.manifestVersion !== BACKUP_CATALOG_VERSION || !Array.isArray(parsed.entries)) return [];
    const entries: BackupCatalogEntry[] = [];
    const seen = new Set<string>();
    for (const raw of parsed.entries) {
      const entry = parseCatalogEntry(raw);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

function writeBackupCatalog(
  paths: StoragePaths,
  entries: readonly BackupCatalogEntry[],
  now: string,
): void {
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

/** 创建路径登记新档案；同 id 已存在时不覆盖任何既有基准。 */
export function upsertBackupCatalogEntry(
  paths: StoragePaths,
  entry: BackupCatalogEntry,
  now: string,
): void {
  const entries = readBackupCatalog(paths);
  if (entries.some((item) => item.id === entry.id)) return;
  entries.push(entry);
  writeBackupCatalog(paths, entries, now);
}

/**
 * 把当前 generation 的 backup_record（可信创建记录）导入目录。
 *
 * - 目录无该 id：新增 created 条目（DB hash 即创建基准）。
 * - 目录条目标记为 discovered 且 hash 不同：DB 创建记录优先，替换为 created；
 *   这正是 BK-S05-003 的修复点：目录丢失后扫描得到的当前 hash 不得压过 DB 原 hash。
 * - 目录/DB 都是 created 且 hash 不同：保留目录原基准，标记 conflict（不静默选择）。
 * - hash 相同：保留原条目；若原为 discovered，升级为 created（获得可信创建记录）。
 *
 * 返回变更条数（新增/升级/冲突标记）。
 */
export function upsertBackupCatalogEntries(
  paths: StoragePaths,
  entries: readonly BackupCatalogEntry[],
  now: string,
): number {
  const current = readBackupCatalog(paths);
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  let changed = 0;
  for (const candidate of entries) {
    if (candidate.origin !== 'created') continue;
    const existing = byId.get(candidate.id);
    if (candidate.integrity !== 'ok') {
      // 当前 generation 已把该条标为冲突（failed）：目录丢失时也要保留冲突，不得降级为可信。
      if (!existing) {
        byId.set(candidate.id, {
          ...candidate,
          origin: 'created',
          integrity: 'conflict',
          conflictCode: candidate.conflictCode ?? CATALOG_CONFLICT_DB_HASH,
          conflictingHash: candidate.conflictingHash,
        });
        changed += 1;
      }
      continue;
    }
    if (!existing) {
      byId.set(candidate.id, {
        ...candidate,
        origin: 'created',
        integrity: 'ok',
        conflictCode: null,
        conflictingHash: null,
      });
      changed += 1;
      continue;
    }
    if (existing.archiveHash === candidate.archiveHash) {
      if (existing.origin !== 'created') {
        byId.set(existing.id, {
          ...existing,
          origin: 'created',
          conflictCode: existing.integrity === 'ok' ? null : existing.conflictCode,
          conflictingHash: existing.integrity === 'ok' ? null : existing.conflictingHash,
        });
        changed += 1;
      }
      continue;
    }
    if (existing.origin === 'discovered' && existing.integrity === 'ok') {
      // 扫描暂存的当前 hash 不是创建基准；DB 创建记录优先。
      byId.set(existing.id, {
        ...candidate,
        origin: 'created',
        integrity: 'ok',
        conflictCode: null,
        conflictingHash: null,
      });
      changed += 1;
      continue;
    }
    if (existing.integrity !== 'conflict') {
      byId.set(existing.id, {
        ...existing,
        integrity: 'conflict',
        conflictCode: CATALOG_CONFLICT_DB_HASH,
        conflictingHash: candidate.archiveHash,
        updatedAt: now,
      });
      changed += 1;
    }
  }
  if (changed > 0) writeBackupCatalog(paths, [...byId.values()], now);
  return changed;
}

export function removeBackupCatalogEntry(paths: StoragePaths, id: string, now: string): void {
  const entries = readBackupCatalog(paths).filter((entry) => entry.id !== id);
  writeBackupCatalog(paths, entries, now);
}

/** Only the new protocol's verified completion can advance its mutable maintenance projection. */
export function projectBackupCompletion(paths:StoragePaths,id:string,archiveHash:string,finishedAt:string):void {
 const entries=readBackupCatalog(paths),entry=entries.find(e=>e.id===id);
 if(!entry||entry.archiveHash!==archiveHash||entry.integrity!=='ok'||(entry.finishedAt!==null&&entry.finishedAt!==finishedAt))throw new AppError('BACKUP_INVALID');
 if(entry.status==='completed'&&entry.finishedAt===finishedAt)return;
 writeBackupCatalog(paths,entries.map(e=>e.id===id?{...e,status:'completed',finishedAt,updatedAt:finishedAt,errorCode:null}:e),finishedAt);
}

export function catalogEntryFromRow(row: BackupRecordRow): BackupCatalogEntry | null {
  if (row.archive_hash === null || row.archive_ref === null) return null;
  // A v2 pending completion is a valid data-core registration, not a hash conflict.
  const completed = row.status === 'completed' || row.status === 'processing';
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
    origin: 'created',
    // 已标记 failed 的目录冲突行不是可信创建基准；目录丢失时也要保留其冲突状态。
    integrity: completed ? 'ok' : 'conflict',
    conflictCode: completed ? null : (row.error_code ?? CATALOG_CONFLICT_DB_HASH),
    conflictingHash: null,
  };
}

interface RawManifest {
  manifestVersion?: unknown;
  ledgerId?: unknown;
  dbSchemaVersion?: unknown;
  appVersion?: unknown;
  createdAt?: unknown;
  backupKind?: unknown;
  successVersion?: string;
  backupId?:string;
  verificationKey?:string;
}

/** 从无创建记录的独立档案读取内嵌 manifest；当前 hash 仅作为该档案的发现基准。 */
function discoverEntry(paths: StoragePaths, id: string): BackupCatalogEntry | null {
  const archivePath = backupArchivePath(paths, id);
  let db: SqliteDb | null = null;
  try {
    db = openSqlite(archivePath, { readonly: true, fileMustExist: true });
    const row = db
      .prepare<{ payload_json: string }>(
        `SELECT payload_json FROM ${BACKUP_MANIFEST_TABLE} WHERE id = 'manifest'`,
      )
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
    let finalTime:string|null=manifest.createdAt;
    if(manifest.successVersion===PREPARED_VERSION){
      const bytes=readFileSync(archivePath),m=manifest as {successVersion:string;backupKind:string;backupId:string;ledgerId:string;createdAt:string;verificationKey:string};
      verifyPreparedBackup(bytes,m);
      finalTime=readVerifiedCompletion(archivePath,bytes,m)?.succeededAt??null;
    }
    return {
      id,
      ledgerId: manifest.ledgerId,
      kind: manifest.backupKind==='pre_restore'||manifest.backupKind==='pre_migration'?manifest.backupKind:'manual',
      status: finalTime===null?'processing':'completed',
      manifestVersion: BACKUP_MANIFEST_VERSION,
      dbSchemaVersion: manifest.dbSchemaVersion,
      appVersion: manifest.appVersion,
      archiveHash: hash,
      archiveRef: backupArchiveRef(id),
      errorCode: null,
      finishedAt: finalTime,
      version: 1,
      createdAt: manifest.createdAt,
      updatedAt: manifest.createdAt,
      origin: 'discovered',
      integrity: 'ok',
      conflictCode: null,
      conflictingHash: null,
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
 * 扫描 backups/*.bkdb，仅为目录中尚无记录的独立档案补登记（origin=discovered）。
 * 已登记 id 一律跳过：已有创建基准（含 conflict）不得被扫描结果改写。
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
 * conflict 条目以 failed + 错误码登记，避免 UI/预览把它当可恢复。
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
    for (const raw of entries) {
      const entry = parseCatalogEntry(raw);
      if (!entry) continue;
      const conflict = entry.integrity === 'conflict';
      const status: BackupStatus = conflict ? 'failed' : entry.status;
      const errorCode = conflict ? (entry.conflictCode ?? CATALOG_CONFLICT_DB_HASH) : entry.errorCode;
      try {
        const result = insert.run(
          entry.id,
          ledgerId,
          entry.kind,
          status,
          entry.manifestVersion,
          entry.dbSchemaVersion,
          entry.appVersion,
          entry.archiveHash,
          entry.archiveRef,
          errorCode,
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
