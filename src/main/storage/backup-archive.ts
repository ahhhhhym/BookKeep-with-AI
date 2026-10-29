/**
 * 备份档案 = 单文件 SQLite 一致快照（docs/ARCHITECTURE.md §7）。
 *
 * S15的bk-content.v2内嵌全部有效图片引用的字节与逐文件清单；数据库条目明确使用
 * logical-sqlite.v1摘要（表结构及全部业务行）。整体archiveHash保护完整容器。
 * 历史S05无附件档案显式兼容，其旧数据库条目hash仅为当时的说明性记录。
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
  truncateSync,
} from 'node:fs';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import { readAppMeta } from '../db/migrations';
import { getDefaultLedger } from '../db/ledger-repo';
import { collectIntegrityViolations, openSqlite, type SqliteDb } from '../db/sqlite';
import { generationDatabasePath, type StoragePaths } from './layout';
import { CONTENT_VERSION, CONTENT_LIMIT, databaseDigest, embedAttachments, verifyAttachments, extractAttachments } from './backup-content';
import { regularPath } from './safe-file';
import {verifyBackupSuccess,backupPayloadSize,type BackupSuccess,PREPARED_VERSION,readVerifiedCompletion} from './backup-success';

export const BACKUP_MANIFEST_VERSION = 'bk-backup.v1';
export const BACKUP_MANIFEST_TABLE = 'backup_manifest';
export const MAX_BACKUP_BYTES = CONTENT_LIMIT + 256 * 1024 * 1024;

export interface BackupManifestFile {
  readonly path: string;
  readonly role: 'database' | 'attachment';
  readonly size: number;
  readonly sha256: string;
  readonly hashMode?: 'logical-sqlite.v1';
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
  readonly contentVersion?: typeof CONTENT_VERSION;
  readonly databaseDigest?: string;
  readonly excludes?: readonly string[];
  readonly successVersion?: string;
  readonly backupKind?: 'manual'|'pre_restore'|'pre_migration';
  readonly verificationKey?: string;
}

export interface CreateArchiveOptions {
  readonly db: SqliteDb;
  readonly paths: StoragePaths;
  readonly backupId: string;
  readonly appVersion: string;
  readonly contractVersion: string;
  readonly now: string;
  readonly success?: {readonly version:string;readonly publicKey:string};
  readonly kind?: 'manual'|'pre_restore'|'pre_migration';
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

  regularPath(paths.temp, paths.root, false); regularPath(paths.backups, paths.root, false);
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
  let manifest: BackupManifest = {
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
    ...(options.kind?{backupKind:options.kind}:{}),
    ...(options.success?{successVersion:options.success.version,verificationKey:options.success.publicKey}:{}),
  };

  let archive: SqliteDb | null = null;
  try {
    // 不修改档案的 journal/WAL 设置：VACUUM INTO 产物保持默认 rollback journal，避免 -wal 未随档改名。
    archive = openSqlite(temporary, { configure: false });
    const attachmentDirectory = path.join(path.dirname(generationDatabasePath(paths, meta.activeGeneration)), 'attachments');
    const attachments = embedAttachments(archive, attachmentDirectory, paths.root);
    const logicalDigest=databaseDigest(archive);
    manifest = { ...manifest, contentVersion: CONTENT_VERSION, databaseDigest: logicalDigest,
      files: [{...manifest.files[0]!,sha256:logicalDigest,hashMode:'logical-sqlite.v1'}, ...attachments], excludes: ['secrets','logs','datasets/state','datasets/images','datasets/artifacts','datasets/withdrawals.json','datasets/test-contacts.json'] };
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

  // A prepared self-success archive is private and never restorable until registration commits.
  const finalPath = options.success ? temporary : path.join(paths.backups, `${backupId}.bkdb`);
  try {
    if(finalPath!==temporary)renameSync(temporary, finalPath);
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
  readonly success: BackupSuccess|null;
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
    if (typeof parsed.ledgerId !== 'string' || !/^[a-f0-9-]{36}$/.test(parsed.ledgerId)) return null;
    if (typeof parsed.backupId !== 'string' || !/^[a-f0-9-]{36}$/.test(parsed.backupId) || typeof parsed.createdAt!=='string' || !Number.isFinite(Date.parse(parsed.createdAt))) return null;
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
  /** Internal pre-registration validation only; never used by import/preview/restore. */
  readonly allowPrepared?: boolean;
}

/** 只读校验：格式/完整性/清单/schema 兼容性/业务不变量。任何失败都不触碰 active。 */
export function inspectBackupArchive(
  archivePath: string,
  options: InspectArchiveOptions,
): ArchiveInspection {
  if (!existsSync(archivePath)) return { ok: false, code: 'BACKUP_INVALID', reason: 'ARCHIVE_MISSING' };
  try { regularPath(archivePath, path.dirname(archivePath)); } catch { return {ok:false,code:'BACKUP_INVALID',reason:'ARCHIVE_PATH'}; }
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
    const images=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_asset'").get();

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
    if (!Array.isArray(manifest.files) || manifest.files.length<1 || manifest.files.length>10001 || manifest.files.filter(f=>f.role==='database' && f.path==='ledger.db').length!==1 || manifest.files.filter(f=>f.role==='database').length!==1 || manifest.files.some(f=>!['database','attachment'].includes(f.role)||!Number.isSafeInteger(f.size)||f.size<1||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))) return {ok:false,code:'BACKUP_INVALID',reason:'MANIFEST_FILES'};
    if (manifest.contentVersion !== undefined) {
      if (manifest.contentVersion !== CONTENT_VERSION || manifest.files[0]?.hashMode!=='logical-sqlite.v1' || manifest.files[0]?.sha256!==manifest.databaseDigest || databaseDigest(db)!==manifest.databaseDigest) return {ok:false,code:'BACKUP_INVALID',reason:'DATABASE_DIGEST'};
      verifyAttachments(db,manifest.files);
    } else if (images && db.prepare('SELECT id FROM image_asset WHERE deleted_at IS NULL LIMIT 1').get()) return {ok:false,code:'BACKUP_INVALID',reason:'DB_ONLY_ARCHIVE_HAS_ATTACHMENTS'};
    const ledger = getDefaultLedger(db);
    if (!ledger || ledger.id !== manifest.ledgerId || ledger.data_revision!==manifest.snapshotRevision || manifest.contractVersion!==meta.contractVersion) {
      return { ok: false, code: 'BACKUP_INVALID', reason: 'LEDGER_MISMATCH' };
    }
    const bytes=readFileSync(archivePath);
    let success=verifyBackupSuccess(bytes,manifest,options.allowPrepared);
    if(manifest.successVersion===PREPARED_VERSION)success=readVerifiedCompletion(archivePath,bytes,manifest);
    return {
      ok: true,
      archive: {
        manifest,
        dbSchemaVersion: meta.dbSchemaVersion,
        ledgerId: ledger.id,
        snapshotRevision: manifest.snapshotRevision,
        byteSize: size,
        success,
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
  regularPath(destination,path.dirname(path.dirname(destination)),false);
  copyFileSync(archivePath, destination);
  const bytes=readFileSync(destination),payloadSize=backupPayloadSize(bytes);
  if(payloadSize!==bytes.length)truncateSync(destination,payloadSize);
  const staged=openSqlite(destination,{configure:false});
  try { const manifest=readManifest(staged); if(manifest?.contentVersion===CONTENT_VERSION) extractAttachments(staged,destination); else staged.exec('DROP TABLE IF EXISTS backup_manifest'); }
  finally { staged.close(); }
}
