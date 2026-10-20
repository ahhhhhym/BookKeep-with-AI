/**
 * 备份档案 = 单文件 SQLite 一致快照（docs/ARCHITECTURE.md §7）。
 *
 * S05 基础版只包含账本数据库本身（尚无附件/候选表）；档案内 backup_manifest 记录
 * 备份时的 schema、ledgerId、snapshotRevision 与逻辑文件清单。archiveHash 是整份档案
 * （含 manifest）的 SHA-256，恢复前必须复核；manifest 内 ledger.db 的 hash/size 记录写入
 * manifest 之前的内容，仅作说明，不替代 archiveHash。
 *
 * 档案绝不包含密钥、DSH 配置、日志或临时文件；恢复必须先完整校验，再切换 active 指针。
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import { readAppMeta } from '../db/migrations';
import { getDefaultLedger } from '../db/ledger-repo';
import { collectIntegrityViolations, openSqlite, type SqliteDb } from '../db/sqlite';
import type { StoragePaths } from './layout';

export const BACKUP_MANIFEST_VERSION = 'bk-backup.v1';
export const BACKUP_MANIFEST_TABLE = 'backup_manifest';
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024 * 1024;

export interface BackupManifestFile {
  readonly path: string;
  readonly role: 'database';
  readonly size: number;
  readonly sha256: string;
}

export interface BackupManifest {
  readonly manifestVersion: typeof BACKUP_MANIFEST_VERSION;
  readonly backupId: string;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly dbSchemaVersion: number;
  readonly contractVersion: string;
  readonly ledgerId: string;
  readonly snapshotRevision: number;
  readonly files: readonly BackupManifestFile[];
  readonly warnings: readonly string[];
}

export interface CreateArchiveOptions {
  readonly db: SqliteDb;
  readonly paths: StoragePaths;
  readonly backupId: string;
  readonly appVersion: string;
  readonly contractVersion: string;
  readonly now: string;
}

export interface CreatedArchive {
  readonly archivePath: string;
  readonly archiveRef: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly manifest: BackupManifest;
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function temporaryArchivePath(paths: StoragePaths, backupId: string): string {
  return path.join(paths.temp, `backup-${backupId}-${process.pid}-${Date.now()}.db`);
}

/** 使用 VACUUM INTO 生成一致快照（不在业务事务内，单线程同步执行避免并发交错）。 */
export function createBackupArchive(options: CreateArchiveOptions): CreatedArchive {
  const { db, paths, backupId, appVersion, contractVersion, now } = options;
  const meta = readAppMeta(db);
  const ledger = getDefaultLedger(db);
  if (!meta || !ledger) {
    throw new AppError('BACKUP_FAILED', { details: { step: 'read-meta' } });
  }

  mkdirSync(paths.temp, { recursive: true });
  mkdirSync(paths.backups, { recursive: true });
  const temporary = temporaryArchivePath(paths, backupId);
  if (existsSync(temporary)) unlinkSync(temporary);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec(`VACUUM INTO '${temporary.replace(/'/g, "''")}'`);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // 清理失败不掩盖原始错误。
    }
    throw error instanceof AppError ? error : new AppError('BACKUP_FAILED', { details: { step: 'snapshot' } });
  }

  const snapshotSize = statSync(temporary).size;
  const snapshotHash = sha256File(temporary);
  const manifest: BackupManifest = {
    manifestVersion: BACKUP_MANIFEST_VERSION,
    backupId,
    createdAt: now,
    appVersion,
    dbSchemaVersion: meta.dbSchemaVersion,
    contractVersion,
    ledgerId: ledger.id,
    snapshotRevision: ledger.data_revision,
    files: [{ path: 'ledger.db', role: 'database', size: snapshotSize, sha256: snapshotHash }],
    warnings: [],
  };

  let archive: SqliteDb | null = null;
  try {
    // 不修改档案的 journal/WAL 设置：VACUUM INTO 产物保持默认 rollback journal，避免 -wal 未随档改名。
    archive = openSqlite(temporary, { configure: false });
    archive.exec(
      `CREATE TABLE IF NOT EXISTS ${BACKUP_MANIFEST_TABLE} (
         id TEXT PRIMARY KEY CHECK (id = 'manifest'),
         payload_json TEXT NOT NULL
       ) STRICT;`,
    );
    archive.exec(`DELETE FROM ${BACKUP_MANIFEST_TABLE}`);
    archive
      .prepare(`INSERT INTO ${BACKUP_MANIFEST_TABLE} (id, payload_json) VALUES ('manifest', ?)`)
      .run(JSON.stringify(manifest));
    const check = archive.prepare<{ quick_check: string }>('PRAGMA quick_check').all();
    if (check.some((row) => row.quick_check !== 'ok')) {
      throw new AppError('BACKUP_FAILED', { details: { step: 'verify-snapshot' } });
    }
  } catch (error) {
    try {
      archive?.close();
    } catch {
      // ignore
    }
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // ignore
    }
    throw error instanceof AppError ? error : new AppError('BACKUP_FAILED', { details: { step: 'manifest' } });
  }
  archive.close();

  const finalPath = path.join(paths.backups, `${backupId}.bkdb`);
  try {
    renameSync(temporary, finalPath);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // ignore
    }
    throw error instanceof AppError ? error : new AppError('BACKUP_FAILED', { details: { step: 'commit-file' } });
  }

  return {
    archivePath: finalPath,
    archiveRef: `backups/${backupId}.bkdb`,
    sha256: sha256File(finalPath),
    byteSize: statSync(finalPath).size,
    manifest,
  };
}

export interface InspectedArchive {
  readonly manifest: BackupManifest;
  readonly dbSchemaVersion: number;
  readonly ledgerId: string;
  readonly snapshotRevision: number;
  readonly byteSize: number;
}

export type ArchiveInspection =
  | { readonly ok: true; readonly archive: InspectedArchive }
  | {
      readonly ok: false;
      readonly code: 'BACKUP_INVALID' | 'SCHEMA_TOO_NEW' | 'SCHEMA_UNSUPPORTED';
      readonly reason: string;
    };

function readManifest(db: SqliteDb): BackupManifest | null {
  try {
    const row = db
      .prepare<{ payload_json: string }>(`SELECT payload_json FROM ${BACKUP_MANIFEST_TABLE} WHERE id = 'manifest'`)
      .get();
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json) as BackupManifest;
    if (parsed.manifestVersion !== BACKUP_MANIFEST_VERSION) return null;
    if (typeof parsed.ledgerId !== 'string' || parsed.ledgerId.length === 0) return null;
    if (typeof parsed.dbSchemaVersion !== 'number' || !Number.isSafeInteger(parsed.dbSchemaVersion)) return null;
    if (typeof parsed.snapshotRevision !== 'number' || !Number.isSafeInteger(parsed.snapshotRevision)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface InspectArchiveOptions {
  readonly latestSchemaVersion: number;
  readonly contractVersion: string;
}

/** 只读校验：格式/完整性/清单/schema 兼容性/业务不变量。任何失败都不触碰 active。 */
export function inspectBackupArchive(
  archivePath: string,
  options: InspectArchiveOptions,
): ArchiveInspection {
  if (!existsSync(archivePath)) return { ok: false, code: 'BACKUP_INVALID', reason: 'ARCHIVE_MISSING' };
  const size = statSync(archivePath).size;
  if (size <= 0 || size > MAX_BACKUP_BYTES) {
    return { ok: false, code: 'BACKUP_INVALID', reason: 'ARCHIVE_SIZE' };
  }
  let db: SqliteDb;
  try {
    db = openSqlite(archivePath, { readonly: true, fileMustExist: true });
  } catch {
    return { ok: false, code: 'BACKUP_INVALID', reason: 'NOT_SQLITE' };
  }
  try {
    const integrity = collectIntegrityViolations(db);
    if (integrity.length > 0) return { ok: false, code: 'BACKUP_INVALID', reason: 'INTEGRITY' };
    const manifest = readManifest(db);
    if (!manifest) return { ok: false, code: 'BACKUP_INVALID', reason: 'MANIFEST_MISSING' };
    const meta = readAppMeta(db);
    if (!meta) return { ok: false, code: 'BACKUP_INVALID', reason: 'APP_META_MISSING' };
    if (meta.contractVersion !== options.contractVersion) {
      return { ok: false, code: 'SCHEMA_UNSUPPORTED', reason: 'CONTRACT_MISMATCH' };
    }
    if (meta.dbSchemaVersion > options.latestSchemaVersion) {
      return { ok: false, code: 'SCHEMA_TOO_NEW', reason: 'DB_SCHEMA_TOO_NEW' };
    }
    if (meta.dbSchemaVersion < 1 || manifest.dbSchemaVersion !== meta.dbSchemaVersion) {
      return { ok: false, code: 'BACKUP_INVALID', reason: 'MANIFEST_SCHEMA_MISMATCH' };
    }
    const ledger = getDefaultLedger(db);
    if (!ledger || ledger.id !== manifest.ledgerId) {
      return { ok: false, code: 'BACKUP_INVALID', reason: 'LEDGER_MISMATCH' };
    }
    return {
      ok: true,
      archive: {
        manifest,
        dbSchemaVersion: meta.dbSchemaVersion,
        ledgerId: ledger.id,
        snapshotRevision: manifest.snapshotRevision,
        byteSize: size,
      },
    };
  } catch {
    return { ok: false, code: 'BACKUP_INVALID', reason: 'UNREADABLE' };
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

/** 把已验证档案复制到 staging generation（不修改原档案）。 */
export function stageArchiveDatabase(archivePath: string, destination: string): void {
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(archivePath, destination);
}
