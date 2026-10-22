/**
 * 数据库 schema 与单调迁移（docs/ARCHITECTURE.md §3/§7）。
 *
 * 版本规则：dbSchemaVersion 只能逐级上升；发现比应用新的 schema 报 SCHEMA_TOO_NEW，
 * 不初始化空库覆盖。迁移前必须先做一致快照备份；迁移失败回滚事务并标记 recovery_required，
 * 旧数据保持可读，业务写入停止，恢复走备份恢复路径。
 *
 * 本文件内嵌 DDL（不读取外部 .sql 文件），保证 esbuild 打包后迁移脚本仍随主进程产物分发。
 */

import { createHash, randomUUID } from 'node:crypto';
import { IMPORT_SQL } from './import-schema';
import { REVIEW_SQL } from './review-schema';
import { AppError } from '../../shared/errors';
import {
  listUserTables,
  readUserVersion,
  runInTransaction,
  tableExists,
  translateSqliteError,
  writeUserVersion,
  type SqliteDb,
} from './sqlite';

export type MigrationState = 'clean' | 'migrating' | 'recovery_required';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const V1_SQL = `
CREATE TABLE app_meta (
  id TEXT PRIMARY KEY CHECK (id = 'app'),
  db_schema_version INTEGER NOT NULL CHECK (db_schema_version >= 1),
  contract_version TEXT NOT NULL,
  data_epoch TEXT NOT NULL,
  active_generation TEXT NOT NULL,
  migration_state TEXT NOT NULL CHECK (migration_state IN ('clean','migrating','recovery_required')),
  last_migration_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  timezone TEXT NOT NULL CHECK (timezone = 'Asia/Shanghai'),
  default_key TEXT NOT NULL UNIQUE CHECK (default_key = 'default'),
  data_revision INTEGER NOT NULL DEFAULT 0 CHECK (data_revision >= 0),
  dataset_revision INTEGER NOT NULL DEFAULT 0 CHECK (dataset_revision >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE category (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 20),
  icon_key TEXT NOT NULL CHECK (length(icon_key) BETWEEN 1 AND 64),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 999999),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  system_key TEXT CHECK (system_key IS NULL OR length(system_key) BETWEEN 1 AND 64),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX ux_category_name ON category(ledger_id, normalized_name);
CREATE UNIQUE INDEX ux_category_system_key ON category(ledger_id, system_key) WHERE system_key IS NOT NULL;
CREATE UNIQUE INDEX ux_category_ledger_id ON category(ledger_id, id);
CREATE INDEX ix_category_order ON category(ledger_id, enabled, sort_order, id);

CREATE TABLE "transaction" (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  amount_fen INTEGER NOT NULL CHECK (amount_fen BETWEEN 1 AND 999999999),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  occurred_date TEXT NOT NULL CHECK (
    occurred_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND substr(occurred_date, 6, 2) BETWEEN '01' AND '12'
    AND substr(occurred_date, 9, 2) BETWEEN '01' AND '31'
  ),
  occurred_time TEXT CHECK (
    occurred_time IS NULL OR (
      occurred_time GLOB '[0-9][0-9]:[0-9][0-9]'
      AND CAST(substr(occurred_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
      AND CAST(substr(occurred_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
    )
  ),
  time_precision TEXT NOT NULL CHECK (time_precision IN ('date','minute')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  category_id TEXT NOT NULL,
  merchant TEXT CHECK (merchant IS NULL OR length(merchant) BETWEEN 1 AND 100),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  source TEXT NOT NULL CHECK (source IN ('manual','ai')),
  source_candidate_id TEXT,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (source = 'manual' AND source_candidate_id IS NULL)
    OR (source = 'ai' AND source_candidate_id IS NOT NULL AND length(source_candidate_id) BETWEEN 1 AND 64)
  ),
  CHECK (
    (time_precision = 'date' AND occurred_time IS NULL)
    OR (time_precision = 'minute' AND occurred_time IS NOT NULL)
  ),
  FOREIGN KEY (ledger_id) REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (ledger_id, category_id) REFERENCES category(ledger_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX ux_transaction_candidate ON "transaction"(source_candidate_id) WHERE source_candidate_id IS NOT NULL;
CREATE INDEX ix_transaction_list ON "transaction"(ledger_id, deleted_at, occurred_date, id);
CREATE INDEX ix_transaction_category ON "transaction"(ledger_id, category_id, deleted_at, occurred_date);

CREATE TABLE audit_event (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ledger','category','transaction','image','job','settings','backup','dataset','evaluation')),
  entity_id TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  actor TEXT NOT NULL CHECK (actor IN ('local_user','system')),
  diff_json TEXT NOT NULL,
  mutation_id TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX ix_audit_entity ON audit_event(entity_type, entity_id, created_at);

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_event
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

CREATE TABLE mutation_receipt (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  result_type TEXT NOT NULL,
  result_ids_json TEXT NOT NULL,
  result_snapshot_json TEXT NOT NULL,
  revision_at_commit INTEGER NOT NULL CHECK (revision_at_commit >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX ux_receipt_key ON mutation_receipt(ledger_id, operation, mutation_id);

CREATE TRIGGER trg_receipt_no_update BEFORE UPDATE ON mutation_receipt
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER trg_receipt_no_delete BEFORE DELETE ON mutation_receipt
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

CREATE TABLE backup_record (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('manual','pre_migration','pre_restore')),
  status TEXT NOT NULL CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  manifest_version TEXT NOT NULL CHECK (manifest_version = 'bk-backup.v1'),
  db_schema_version INTEGER NOT NULL CHECK (db_schema_version >= 1),
  app_version TEXT NOT NULL,
  archive_hash TEXT CHECK (archive_hash IS NULL OR length(archive_hash) = 64),
  archive_ref TEXT,
  error_code TEXT,
  finished_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    status <> 'completed'
    OR (archive_hash IS NOT NULL AND archive_ref IS NOT NULL AND finished_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX ix_backup_created ON backup_record(created_at, id);

CREATE TABLE migration_record (
  id TEXT PRIMARY KEY,
  from_version INTEGER NOT NULL CHECK (from_version >= 0),
  to_version INTEGER NOT NULL CHECK (to_version >= 1),
  app_version TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  backup_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX ux_migration_completed ON migration_record(to_version) WHERE status = 'completed';

CREATE TRIGGER trg_migration_no_update BEFORE UPDATE ON migration_record
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER trg_migration_no_delete BEFORE DELETE ON migration_record
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-ledger-schema',
    sql: V1_SQL,
  },
  { version: 2, name: 'image-job-candidate', sql: IMPORT_SQL },
  { version: 3, name: 'atomic-candidate-review', sql: REVIEW_SQL },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256').update(`${migration.name}\n${migration.sql}`, 'utf8').digest('hex');
}

export interface AppMetaRow {
  readonly dbSchemaVersion: number;
  readonly contractVersion: string;
  readonly dataEpoch: string;
  readonly activeGeneration: string;
  readonly migrationState: MigrationState;
  readonly lastMigrationId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RawAppMetaRow {
  db_schema_version: number;
  contract_version: string;
  data_epoch: string;
  active_generation: string;
  migration_state: MigrationState;
  last_migration_id: string | null;
  created_at: string;
  updated_at: string;
}

export function readAppMeta(db: SqliteDb): AppMetaRow | null {
  const row = db
    .prepare<RawAppMetaRow>(
      `SELECT db_schema_version, contract_version, data_epoch, active_generation, migration_state,
              last_migration_id, created_at, updated_at
         FROM app_meta WHERE id = 'app'`,
    )
    .get();
  if (!row) return null;
  return {
    dbSchemaVersion: row.db_schema_version,
    contractVersion: row.contract_version,
    dataEpoch: row.data_epoch,
    activeGeneration: row.active_generation,
    migrationState: row.migration_state,
    lastMigrationId: row.last_migration_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AppMetaUpdate {
  dbSchemaVersion?: number;
  migrationState?: MigrationState;
  lastMigrationId?: string | null;
  dataEpoch?: string;
  activeGeneration?: string;
}

export function updateAppMeta(db: SqliteDb, update: AppMetaUpdate, now: string): void {
  const assignments: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];
  if (update.dbSchemaVersion !== undefined) {
    assignments.push('db_schema_version = ?');
    values.push(update.dbSchemaVersion);
  }
  if (update.migrationState !== undefined) {
    assignments.push('migration_state = ?');
    values.push(update.migrationState);
  }
  if (update.lastMigrationId !== undefined) {
    assignments.push('last_migration_id = ?');
    values.push(update.lastMigrationId);
  }
  if (update.dataEpoch !== undefined) {
    assignments.push('data_epoch = ?');
    values.push(update.dataEpoch);
  }
  if (update.activeGeneration !== undefined) {
    assignments.push('active_generation = ?');
    values.push(update.activeGeneration);
  }
  const result = db
    .prepare(`UPDATE app_meta SET ${assignments.join(', ')} WHERE id = 'app'`)
    .run(...values);
  if (result.changes !== 1) {
    throw new AppError('INTEGRITY_ERROR', { details: { reason: 'APP_META_MISSING' } });
  }
}

function insertInitialAppMeta(
  db: SqliteDb,
  meta: { contractVersion: string; dataEpoch: string; generationId: string },
  now: string,
  version: number,
): void {
  db.prepare(
    `INSERT INTO app_meta
       (id, db_schema_version, contract_version, data_epoch, active_generation,
        migration_state, last_migration_id, created_at, updated_at)
     VALUES ('app', ?, ?, ?, ?, 'clean', NULL, ?, ?)`,
  ).run(version, meta.contractVersion, meta.dataEpoch, meta.generationId, now, now);
}

function insertMigrationRecord(
  db: SqliteDb,
  record: {
    fromVersion: number;
    toVersion: number;
    appVersion: string;
    checksum: string;
    status: 'completed' | 'failed';
    backupId: string | null;
    errorCode: string | null;
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO migration_record
       (id, from_version, to_version, app_version, checksum, status, backup_id, error_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    record.fromVersion,
    record.toVersion,
    record.appVersion,
    record.checksum,
    record.status,
    record.backupId,
    record.errorCode,
    record.now,
  );
}

interface CompletedMigrationRow {
  to_version: number;
  checksum: string;
}

function verifyAppliedChecksums(
  db: SqliteDb,
  currentVersion: number,
  migrations: readonly Migration[],
): void {
  const rows = db
    .prepare<CompletedMigrationRow>(
      "SELECT to_version, checksum FROM migration_record WHERE status = 'completed' ORDER BY to_version",
    )
    .all();
  const byVersion = new Map<number, string>();
  for (const row of rows) byVersion.set(row.to_version, row.checksum);
  for (const migration of migrations) {
    if (migration.version > currentVersion) continue;
    const recorded = byVersion.get(migration.version);
    if (recorded === undefined) {
      throw new AppError('INTEGRITY_ERROR', {
        details: { reason: 'MIGRATION_RECORD_MISSING' },
      });
    }
    if (recorded !== migrationChecksum(migration)) {
      throw new AppError('INTEGRITY_ERROR', {
        details: { reason: 'MIGRATION_CHECKSUM_MISMATCH' },
      });
    }
  }
}

export interface MigrateOptions {
  readonly contractVersion: string;
  readonly appVersion: string;
  readonly clock: () => number;
  readonly migrations?: readonly Migration[];
  /** 全新数据库初始化时需要：当前 generation 与新的 dataEpoch。 */
  readonly initialMeta?: { readonly generationId: string; readonly dataEpoch: string };
  /** 升级已有数据库前的一致快照；返回 backupId，null 表示备份失败。 */
  readonly preMigrationBackup?: (info: {
    readonly fromVersion: number;
    readonly toVersion: number;
  }) => string | null;
  /** 默认 true；恢复 staging 已有用户档案做保护时可为 false（档案本身即快照）。 */
  readonly requirePreMigrationBackup?: boolean;
}

export interface MigrationFailure {
  readonly toVersion: number;
  readonly backupId: string | null;
  readonly errorCode: 'MIGRATION_FAILED' | 'BACKUP_FAILED';
}

export interface MigrateResult {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly applied: readonly number[];
  readonly state: 'clean' | 'recovery_required';
  readonly failure: MigrationFailure | null;
}

function nowIso(clock: () => number): string {
  return new Date(clock()).toISOString();
}

export function migrateDatabase(db: SqliteDb, options: MigrateOptions): MigrateResult {
  const migrations = options.migrations ?? MIGRATIONS;
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  if (latest < 1) throw new AppError('INTERNAL_ERROR', { details: { reason: 'NO_MIGRATIONS' } });

  if (!tableExists(db, 'app_meta')) {
    const userTables = listUserTables(db);
    if (userTables.length > 0) {
      throw new AppError('INTEGRITY_ERROR', { details: { reason: 'MISSING_APP_META' } });
    }
    if (!options.initialMeta) {
      throw new AppError('INTERNAL_ERROR', { details: { reason: 'INITIAL_META_REQUIRED' } });
    }
    runInTransaction(db, () => {
      for (const migration of migrations) {
        try {
          db.exec(migration.sql);
        } catch (error) {
          throw translateSqliteError(error);
        }
        writeUserVersion(db, migration.version);
        insertMigrationRecord(db, {
          fromVersion: migration.version - 1,
          toVersion: migration.version,
          appVersion: options.appVersion,
          checksum: migrationChecksum(migration),
          status: 'completed',
          backupId: null,
          errorCode: null,
          now: nowIso(options.clock),
        });
      }
      insertInitialAppMeta(
        db,
        {
          contractVersion: options.contractVersion,
          dataEpoch: options.initialMeta!.dataEpoch,
          generationId: options.initialMeta!.generationId,
        },
        nowIso(options.clock),
        latest,
      );
    });
    return { fromVersion: 0, toVersion: latest, applied: migrations.map((m) => m.version), state: 'clean', failure: null };
  }

  const meta = readAppMeta(db);
  if (!meta) throw new AppError('INTEGRITY_ERROR', { details: { reason: 'APP_META_INVALID' } });
  if (meta.contractVersion !== options.contractVersion) {
    throw new AppError('SCHEMA_UNSUPPORTED', {
      details: { reason: 'DB_CONTRACT_MISMATCH' },
    });
  }
  if (meta.dbSchemaVersion > latest) {
    throw new AppError('SCHEMA_TOO_NEW', {
      details: { reason: `DB_SCHEMA_${meta.dbSchemaVersion}`, step: 'startup' },
    });
  }
  if (readUserVersion(db) > latest) {
    throw new AppError('SCHEMA_TOO_NEW', { details: { reason: 'USER_VERSION_TOO_NEW' } });
  }

  if (meta.migrationState === 'migrating') {
    // 上一个进程在迁移事务中崩溃：SQLite DDL 事务已回滚，旧 schema 完整，恢复为 clean 后重试。
    runInTransaction(db, () => {
      updateAppMeta(db, { migrationState: 'clean' }, nowIso(options.clock));
    });
  }

  verifyAppliedChecksums(db, meta.dbSchemaVersion, migrations);

  if (meta.migrationState === 'recovery_required') {
    return {
      fromVersion: meta.dbSchemaVersion,
      toVersion: meta.dbSchemaVersion,
      applied: [],
      state: 'recovery_required',
      failure: null,
    };
  }

  if (meta.dbSchemaVersion === latest) {
    return { fromVersion: meta.dbSchemaVersion, toVersion: meta.dbSchemaVersion, applied: [], state: 'clean', failure: null };
  }

  const pending = migrations.filter((migration) => migration.version > meta.dbSchemaVersion);
  const requireBackup = options.requirePreMigrationBackup !== false;
  let backupId: string | null = null;
  if (requireBackup && options.preMigrationBackup) {
    backupId = options.preMigrationBackup({
      fromVersion: meta.dbSchemaVersion,
      toVersion: pending[0]?.version ?? latest,
    });
  }
  if (requireBackup && backupId === null) {
    const failure: MigrationFailure = {
      toVersion: pending[0]?.version ?? latest,
      backupId: null,
      errorCode: 'BACKUP_FAILED',
    };
    runInTransaction(db, () => {
      updateAppMeta(db, { migrationState: 'recovery_required' }, nowIso(options.clock));
      insertMigrationRecord(db, {
        fromVersion: meta.dbSchemaVersion,
        toVersion: failure.toVersion,
        appVersion: options.appVersion,
        checksum: migrationChecksum(pending[0]!),
        status: 'failed',
        backupId: null,
        errorCode: failure.errorCode,
        now: nowIso(options.clock),
      });
    });
    return {
      fromVersion: meta.dbSchemaVersion,
      toVersion: meta.dbSchemaVersion,
      applied: [],
      state: 'recovery_required',
      failure,
    };
  }

  let currentVersion = meta.dbSchemaVersion;
  const applied: number[] = [];
  for (const migration of pending) {
    runInTransaction(db, () => {
      updateAppMeta(db, { migrationState: 'migrating' }, nowIso(options.clock));
    });
    try {
      runInTransaction(db, () => {
        try {
          db.exec(migration.sql);
        } catch (error) {
          throw translateSqliteError(error);
        }
        writeUserVersion(db, migration.version);
        insertMigrationRecord(db, {
          fromVersion: currentVersion,
          toVersion: migration.version,
          appVersion: options.appVersion,
          checksum: migrationChecksum(migration),
          status: 'completed',
          backupId,
          errorCode: null,
          now: nowIso(options.clock),
        });
        updateAppMeta(
          db,
          { dbSchemaVersion: migration.version, migrationState: 'clean', lastMigrationId: migration.name },
          nowIso(options.clock),
        );
      });
      currentVersion = migration.version;
      applied.push(migration.version);
    } catch (error) {
      const failure: MigrationFailure = { toVersion: migration.version, backupId, errorCode: 'MIGRATION_FAILED' };
      try {
        runInTransaction(db, () => {
          updateAppMeta(db, { migrationState: 'recovery_required' }, nowIso(options.clock));
          insertMigrationRecord(db, {
            fromVersion: currentVersion,
            toVersion: migration.version,
            appVersion: options.appVersion,
            checksum: migrationChecksum(migration),
            status: 'failed',
            backupId,
            errorCode: failure.errorCode,
            now: nowIso(options.clock),
          });
        });
      } catch {
        // 失败记录写入失败时不掩盖迁移失败本身；启动仍按 recovery_required 处理。
      }
      return {
        fromVersion: meta.dbSchemaVersion,
        toVersion: currentVersion,
        applied,
        state: 'recovery_required',
        failure,
      };
    }
  }

  return { fromVersion: meta.dbSchemaVersion, toVersion: currentVersion, applied, state: 'clean', failure: null };
}
