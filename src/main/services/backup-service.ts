/**
 * 备份与恢复基础（docs/CONTRACTS.md §6、docs/ARCHITECTURE.md §7）。
 *
 * 创建：VACUUM INTO 一致快照 → 写入清单 → 校验 → 原子改名 → 同一事务登记 BackupRecord。
 * 恢复：预览只读校验（hash/清单/schema/完整性）→ commit 再校验 + 备份当前数据 →
 * 解压到新 generation staging → staging 迁移/校验 → 原子切换 active 指针 → 新 dataEpoch。
 * 任何阶段失败都保留旧 active 与 pre_restore 快照；损坏/不兼容档案拒绝且不覆盖当前数据。
 */

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { CONTRACT_VERSION } from '../../shared/constants';
import type {
  BackupArtifactView,
  BackupCreateResult,
  BackupKind,
  BackupListResult,
  BackupRecordView,
  BackupRestorePreviewResult,
  BackupRestoreResult,
} from '../../shared/entities';
import { AppError } from '../../shared/errors';
import { isUuidV4 } from '../../shared/validation';
import { readAppMeta, migrateDatabase, type Migration, updateAppMeta } from '../db/migrations';
import { getDefaultLedger, readDataRevision } from '../db/ledger-repo';
import { mapBackupRecord, type BackupRecordRow } from '../db/rows';
import { findReceipt, insertReceipt } from '../db/receipt-repo';
import { collectBusinessViolations } from '../db/integrity';
import { openSqlite, runInTransaction, type SqliteDb } from '../db/sqlite';
import {
  BACKUP_MANIFEST_VERSION,
  createBackupArchive,
  inspectBackupArchive,
  sha256File,
  stageArchiveDatabase,
} from '../storage/backup-archive';
import {
  removeBackupCatalogEntry,
  upsertBackupCatalogEntry,
  type BackupCatalogEntry,
} from '../storage/backup-catalog';
import { backupArchivePath, backupArchiveRef, generationDatabasePath, type StoragePaths } from '../storage/layout';
import { findLastCommittedRestore, readRestoreLog } from '../storage/restore-log';
import { hashPayload } from './canonical';
import type { TokenCodec } from './signed-token';

const RESTORE_TOKEN_TTL_MS = 5 * 60_000;

export interface BackupEnvironment {
  readonly db: SqliteDb;
  readonly paths: StoragePaths;
  readonly appVersion: string;
  readonly clock: () => number;
}

function nowIso(clock: () => number): string {
  return new Date(clock()).toISOString();
}

/** 恢复令牌只信任持久事实源（AppMeta epoch + Ledger.dataRevision），不用 store 缓存。 */
function currentBackupFacts(db: SqliteDb, ledgerId: string): { epoch: string; revision: number } {
  const meta = readAppMeta(db);
  const ledger = getDefaultLedger(db);
  if (!meta || !ledger || ledger.id !== ledgerId) {
    throw new AppError('INTEGRITY_ERROR', { details: { reason: 'LEDGER_FACTS_MISSING' } });
  }
  return { epoch: meta.dataEpoch, revision: ledger.data_revision };
}

const BACKUP_COLUMNS = `id, ledger_id, kind, status, manifest_version, db_schema_version, app_version,
  archive_hash, archive_ref, error_code, finished_at, version, created_at, updated_at`;

export function getBackupRow(db: SqliteDb, backupId: string): BackupRecordRow | null {
  const row = db
    .prepare<BackupRecordRow>(`SELECT ${BACKUP_COLUMNS} FROM backup_record WHERE id = ?`)
    .get(backupId);
  return row ?? null;
}

export function listBackupRows(db: SqliteDb): BackupRecordRow[] {
  return db
    .prepare<BackupRecordRow>(
      `SELECT ${BACKUP_COLUMNS} FROM backup_record ORDER BY created_at DESC, id ASC`,
    )
    .all();
}

function artifactFor(paths: StoragePaths, row: BackupRecordRow): BackupArtifactView | null {
  if (row.archive_hash === null || row.archive_ref === null) return null;
  const archivePath = backupArchivePath(paths, row.id);
  // 文件缺失时返回 null：目录条目仍可见，但 UI 必须显示不可恢复，不能伪造大小/可用。
  if (!existsSync(archivePath)) return null;
  let byteSize = 0;
  try {
    byteSize = statSync(archivePath).size;
  } catch {
    return null;
  }
  return {
    artifactId: row.id,
    displayName: `BookKeepAI-backup-${row.created_at.slice(0, 10)}.bkdb`,
    sha256: row.archive_hash,
    byteSize,
    recordCount: null,
    createdAt: row.created_at,
  };
}

export function backupRecordView(paths: StoragePaths, row: BackupRecordRow): BackupRecordView {
  return { ...mapBackupRecord(row), artifact: artifactFor(paths, row) };
}

function insertBackupRecord(
  db: SqliteDb,
  record: {
    id: string;
    ledgerId: string;
    kind: BackupKind;
    dbSchemaVersion: number;
    appVersion: string;
    archiveHash: string;
    archiveRef: string;
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO backup_record
       (id, ledger_id, kind, status, manifest_version, db_schema_version, app_version,
        archive_hash, archive_ref, error_code, finished_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'completed', 'bk-backup.v1', ?, ?, ?, ?, NULL, ?, 1, ?, ?)`,
  ).run(
    record.id,
    record.ledgerId,
    record.kind,
    record.dbSchemaVersion,
    record.appVersion,
    record.archiveHash,
    record.archiveRef,
    record.now,
    record.now,
    record.now,
  );
}

export interface CreatedBackup {
  readonly row: BackupRecordRow;
  readonly artifact: BackupArtifactView;
}

/**
 * 生成档案并登记 BackupRecord。用于手工备份与 pre_restore/pre_migration 内部备份。
 * 文件已生成但登记失败时会删除档案，避免无记录孤儿。
 */
export function createBackupFiles(env: BackupEnvironment, kind: BackupKind): CreatedBackup {
  const ledger = getDefaultLedger(env.db);
  const meta = readAppMeta(env.db);
  if (!ledger || !meta) {
    throw new AppError('BACKUP_FAILED', { details: { step: 'read-meta' } });
  }
  const backupId = randomUUID();
  const now = nowIso(env.clock);
  const archive = createBackupArchive({
    db: env.db,
    paths: env.paths,
    backupId,
    appVersion: env.appVersion,
    contractVersion: CONTRACT_VERSION,
    now,
  });
  // 独立目录先于 generation 内记录落盘：恢复旧 generation 后目录仍可重建。
  const entry: BackupCatalogEntry = {
    id: backupId,
    ledgerId: ledger.id,
    kind,
    status: 'completed',
    manifestVersion: BACKUP_MANIFEST_VERSION,
    dbSchemaVersion: meta.dbSchemaVersion,
    appVersion: env.appVersion,
    archiveHash: archive.sha256,
    archiveRef: archive.archiveRef,
    errorCode: null,
    finishedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  try {
    upsertBackupCatalogEntry(env.paths, entry, now);
  } catch {
    removeArchive(env.paths, backupId);
    throw new AppError('BACKUP_FAILED', { details: { step: 'catalog' } });
  }
  try {
    runInTransaction(env.db, () => {
      insertBackupRecord(env.db, {
        id: backupId,
        ledgerId: ledger.id,
        kind,
        dbSchemaVersion: meta.dbSchemaVersion,
        appVersion: env.appVersion,
        archiveHash: archive.sha256,
        archiveRef: archive.archiveRef,
        now,
      });
    });
  } catch {
    try {
      removeBackupCatalogEntry(env.paths, backupId, now);
    } catch {
      // 目录补偿失败时保留条目；档案随后删除，预览会明确失败，不伪造可恢复。
    }
    removeArchive(env.paths, backupId);
    throw new AppError('BACKUP_FAILED', { details: { step: 'record' }, retryable: true });
  }
  const row = getBackupRow(env.db, backupId);
  if (!row) throw new AppError('BACKUP_FAILED', { details: { step: 'record-missing' } });
  const artifact = artifactFor(env.paths, row);
  if (!artifact) throw new AppError('BACKUP_FAILED', { details: { step: 'artifact' } });
  return { row, artifact };
}

function removeArchive(paths: StoragePaths, backupId: string): void {
  try {
    const archivePath = backupArchivePath(paths, backupId);
    if (existsSync(archivePath)) rmSync(archivePath, { force: true });
  } catch {
    // 清理失败不掩盖主错误；S15 负责孤儿清理。
  }
}

export interface StagedRestorePlan {
  readonly restoreId: string;
  readonly backupId: string;
  readonly backupHash: string;
  readonly generationId: string;
  readonly stagingDatabasePath: string;
  readonly newDataEpoch: string;
  readonly preRestore: CreatedBackup;
}

export interface BackupServiceDeps {
  readonly env: () => BackupEnvironment;
  readonly latestSchemaVersion: number;
  readonly migrations: readonly Migration[];
  readonly tokenCodec: TokenCodec;
  readonly ledgerId: () => string;
  /** store 负责关闭旧库、原子切换 active 指针、打开新库并登记恢复结果。 */
  readonly switchToStagedGeneration: (plan: StagedRestorePlan) => BackupRestoreResult;
}

export class BackupService {
  constructor(private readonly deps: BackupServiceDeps) {}

  create(input: { kind: 'manual' }, mutationId: string | null): BackupCreateResult {
    if (mutationId === null) throw new AppError('INTERNAL_ERROR', { details: { reason: 'MUTATION_ID_REQUIRED' } });
    const env = this.deps.env();
    const payloadHash = hashPayload({ operation: 'backup.create', payload: { kind: input.kind } });
    const existing = findReceipt(env.db, this.deps.ledgerId(), 'backup.create', mutationId);
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        throw new AppError('IDEMPOTENCY_CONFLICT', { details: { operation: 'backup.create' } });
      }
      return { ...(JSON.parse(existing.result_snapshot_json) as BackupCreateResult), replayed: true };
    }
    const created = createBackupFiles(env, 'manual');
    const result: BackupCreateResult = {
      record: backupRecordView(env.paths, created.row),
      artifact: created.artifact,
      replayed: false,
    };
    try {
      runInTransaction(env.db, () => {
        insertReceipt(env.db, {
          ledgerId: this.deps.ledgerId(),
          operation: 'backup.create',
          mutationId,
          payloadHash,
          resultType: 'backup',
          resultIds: [created.row.id],
          snapshot: result,
          revision: readDataRevision(env.db, this.deps.ledgerId()),
          now: nowIso(env.clock),
        });
      });
    } catch {
      // 收据失败：档案与记录已写入，返回成功会破坏幂等语义，故按失败上报并保留档案供人工核对。
      throw new AppError('BACKUP_FAILED', { details: { step: 'receipt' } });
    }
    return result;
  }

  list(): BackupListResult {
    const env = this.deps.env();
    return { records: listBackupRows(env.db).map((row) => backupRecordView(env.paths, row)) };
  }

  preview(backupId: string): BackupRestorePreviewResult {
    const env = this.deps.env();
    if (!isUuidV4(backupId)) {
      throw new AppError('BACKUP_INVALID', { details: { reason: 'BACKUP_ID' } });
    }
    const row = getBackupRow(env.db, backupId);
    if (!row || row.status !== 'completed') {
      throw new AppError('NOT_FOUND', { details: { reason: 'BACKUP_RECORD' } });
    }
    const archivePath = this.requireArchivePath(row);
    if (row.archive_hash === null) {
      throw new AppError('BACKUP_INVALID', { details: { reason: 'ARCHIVE_HASH_MISSING' } });
    }
    const actualHash = sha256File(archivePath);
    if (actualHash !== row.archive_hash) {
      throw new AppError('HASH_MISMATCH', { details: { reason: 'ARCHIVE_HASH' } });
    }
    const inspection = inspectBackupArchive(archivePath, {
      latestSchemaVersion: this.deps.latestSchemaVersion,
      contractVersion: CONTRACT_VERSION,
    });
    if (!inspection.ok) {
      throw new AppError(inspection.code, { details: { reason: inspection.reason } });
    }
    const compatibility =
      inspection.archive.dbSchemaVersion === this.deps.latestSchemaVersion
        ? 'current'
        : 'needs_migration';
    const expiresAt = env.clock() + RESTORE_TOKEN_TTL_MS;
    const facts = currentBackupFacts(env.db, this.deps.ledgerId());
    const restoreToken = this.deps.tokenCodec.sign({
      v: 1,
      k: 'restore',
      b: backupId,
      h: row.archive_hash,
      e: facts.epoch,
      r: facts.revision,
      x: expiresAt,
    });
    const lastAppliedRestoreId = findLastCommittedRestore(
      readRestoreLog(env.paths),
      row.archive_hash,
    );
    return {
      backupId,
      archiveHash: row.archive_hash,
      manifestVersion: 'bk-backup.v1',
      dbSchemaVersion: inspection.archive.dbSchemaVersion,
      schemaCompatibility: compatibility,
      ledgerId: inspection.archive.ledgerId,
      snapshotRevision: inspection.archive.snapshotRevision,
      createdAt: inspection.archive.manifest.createdAt,
      fileCount: inspection.archive.manifest.files.length,
      warnings: [
        'RESTORE_REPLACES_CURRENT_DATA',
        ...(compatibility === 'needs_migration' ? ['STAGING_MIGRATION_REQUIRED'] : []),
      ],
      restoreToken,
      lastAppliedRestoreId,
    };
  }

  private requireArchivePath(row: BackupRecordRow): string {
    const env = this.deps.env();
    const expectedRef = backupArchiveRef(row.id);
    if (row.archive_ref !== expectedRef) {
      throw new AppError('BACKUP_INVALID', { details: { reason: 'ARCHIVE_REF' } });
    }
    const archivePath = backupArchivePath(env.paths, row.id);
    if (!existsSync(archivePath)) {
      throw new AppError('BACKUP_INVALID', { details: { reason: 'ARCHIVE_MISSING' } });
    }
    return archivePath;
  }

  restoreCommit(input: { restoreToken: string }, mutationId: string | null): BackupRestoreResult {
    if (mutationId === null) throw new AppError('INTERNAL_ERROR', { details: { reason: 'MUTATION_ID_REQUIRED' } });
    const env = this.deps.env();
    const verified = this.deps.tokenCodec.verify(input.restoreToken, 2048);
    if (!verified.ok) {
      throw new AppError('TOKEN_EXPIRED', {
        details: { reason: verified.reason === 'TOKEN_EXPIRED' ? 'RESTORE_TOKEN_EXPIRED' : 'RESTORE_TOKEN_INVALID' },
      });
    }
    const payload = verified.payload;
    if (payload.k !== 'restore' || typeof payload.b !== 'string' || typeof payload.h !== 'string') {
      throw new AppError('TOKEN_EXPIRED', { details: { reason: 'RESTORE_TOKEN_KIND' } });
    }
    const commitFacts = currentBackupFacts(env.db, this.deps.ledgerId());
    if (payload.e !== commitFacts.epoch || payload.r !== commitFacts.revision) {
      throw new AppError('TOKEN_EXPIRED', { details: { reason: 'RESTORE_CONTEXT_STALE' } });
    }
    const row = getBackupRow(env.db, payload.b);
    if (!row || row.status !== 'completed' || row.archive_hash === null) {
      throw new AppError('NOT_FOUND', { details: { reason: 'BACKUP_RECORD' } });
    }
    if (row.archive_hash !== payload.h) {
      throw new AppError('HASH_MISMATCH', { details: { reason: 'TOKEN_HASH' } });
    }
    const archivePath = this.requireArchivePath(row);
    if (sha256File(archivePath) !== row.archive_hash) {
      throw new AppError('HASH_MISMATCH', { details: { reason: 'ARCHIVE_HASH' } });
    }
    const inspection = inspectBackupArchive(archivePath, {
      latestSchemaVersion: this.deps.latestSchemaVersion,
      contractVersion: CONTRACT_VERSION,
    });
    if (!inspection.ok) {
      throw new AppError(inspection.code, { details: { reason: inspection.reason } });
    }

    const preRestore = createBackupFiles(env, 'pre_restore');
    const generationId = randomUUID();
    const stagingDatabasePath = generationDatabasePath(env.paths, generationId);
    const newDataEpoch = randomUUID();
    try {
      stageArchiveDatabase(archivePath, stagingDatabasePath);
      this.prepareStagingDatabase(stagingDatabasePath, generationId, newDataEpoch);
    } catch (error) {
      this.removeStaging(env.paths, generationId);
      if (error instanceof AppError) throw error;
      throw new AppError('RESTORE_FAILED', { details: { step: 'staging' } });
    }

    return this.deps.switchToStagedGeneration({
      restoreId: mutationId,
      backupId: row.id,
      backupHash: row.archive_hash,
      generationId,
      stagingDatabasePath,
      newDataEpoch,
      preRestore,
    });
  }

  private prepareStagingDatabase(
    stagingDatabasePath: string,
    generationId: string,
    newDataEpoch: string,
  ): void {
    const env = this.deps.env();
    let staging: SqliteDb | null = null;
    try {
      staging = openSqlite(stagingDatabasePath);
      const migration = migrateDatabase(staging, {
        contractVersion: CONTRACT_VERSION,
        appVersion: env.appVersion,
        clock: env.clock,
        migrations: this.deps.migrations,
        requirePreMigrationBackup: false,
      });
      if (migration.state !== 'clean') {
        throw new AppError('RESTORE_FAILED', { details: { step: 'staging-migration' } });
      }
      runInTransaction(staging, () => {
        updateAppMeta(
          staging!,
          { dataEpoch: newDataEpoch, activeGeneration: generationId, migrationState: 'clean' },
          nowIso(env.clock),
        );
      });
      const violations = collectBusinessViolations(staging);
      if (violations.length > 0) {
        throw new AppError('BACKUP_INVALID', { details: { reason: 'STAGED_DATA_INVALID' } });
      }
      const ledger = getDefaultLedger(staging);
      if (!ledger) throw new AppError('BACKUP_INVALID', { details: { reason: 'STAGED_LEDGER_MISSING' } });
    } finally {
      try {
        staging?.close();
      } catch {
        // ignore
      }
    }
  }

  private removeStaging(paths: StoragePaths, generationId: string): void {
    try {
      const directory = path.dirname(generationDatabasePath(paths, generationId));
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // 保留 staging 供人工检查，不掩盖主错误。
    }
  }
}

/** 迁移前备份：不写幂等收据，返回 backupId；失败返回 null 由迁移器标记 recovery_required。 */
export function createPreMigrationBackup(env: BackupEnvironment): string | null {
  try {
    const created = createBackupFiles(env, 'pre_migration');
    return created.row.id;
  } catch {
    return null;
  }
}

/** 供 store 在恢复后登记 pre_restore 记录（新 generation 内）。 */
export function copyBackupRecordToNewDatabase(
  db: SqliteDb,
  record: BackupRecordRow,
  now: string,
  ledgerId: string,
): void {
  const existing = getBackupRow(db, record.id);
  if (existing) return;
  db.prepare(
    `INSERT INTO backup_record
       (id, ledger_id, kind, status, manifest_version, db_schema_version, app_version,
        archive_hash, archive_ref, error_code, finished_at, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    ledgerId,
    record.kind,
    record.status,
    record.manifest_version,
    record.db_schema_version,
    record.app_version,
    record.archive_hash,
    record.archive_ref,
    record.error_code,
    record.finished_at,
    record.version,
    record.created_at,
    now,
  );
}
