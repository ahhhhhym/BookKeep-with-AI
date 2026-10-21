/**
 * SQLite 连接、事务与错误翻译（docs/ARCHITECTURE.md §7）。
 *
 * 只有主进程的数据层使用本模块；渲染层永远拿不到连接、SQL 或路径。
 * 原生模块加载失败、数据库损坏、磁盘满、忙锁都转成安全错误码，不把 SQLite 原文抛给 UI。
 */

import type Database from 'better-sqlite3';
import { AppError } from '../../shared/errors';
import { loadBetterSqlite3 } from '../native';

export type SqliteDb = InstanceType<typeof Database>;

export interface OpenSqliteOptions {
  readonly readonly?: boolean;
  readonly fileMustExist?: boolean;
  readonly timeoutMs?: number;
  /** 只读连接不修改 journal/持久性设置。 */
  readonly configure?: boolean;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export function openSqlite(file: string, options: OpenSqliteOptions = {}): SqliteDb {
  const loaded = loadBetterSqlite3();
  if (!loaded.ok || loaded.ctor === null) {
    throw new AppError('INTEGRITY_ERROR', { details: { reason: 'SQLITE_MODULE_UNAVAILABLE' } });
  }
  let db: SqliteDb;
  try {
    db = new loaded.ctor(file, {
      readonly: options.readonly === true,
      fileMustExist: options.fileMustExist === true,
      timeout: options.timeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    });
  } catch (error) {
    throw translateSqliteError(error);
  }
  if (options.configure !== false) {
    configureConnection(db, options.readonly === true);
  }
  return db;
}

/** WAL + 外键 + 充分持久写入；数据库忙时最多等待 5 秒后报 DB_BUSY。 */
export function configureConnection(db: SqliteDb, readonly: boolean): void {
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
  }
  try {
    db.pragma('trusted_schema = OFF');
  } catch {
    // 旧 SQLite 版本不支持该 pragma 时忽略，不改变业务语义。
  }
}

export function runInTransaction<T>(db: SqliteDb, fn: () => T): T {
  if (db.inTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  let result: T;
  try {
    result = fn();
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚失败交由调用方按原始错误处理；不掩盖首个异常。
    }
    throw error;
  }
  try {
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 同上。
    }
    throw translateSqliteError(error);
  }
  return result;
}

export function tableExists(db: SqliteDb, name: string): boolean {
  const row = db
    .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

export function listUserTables(db: SqliteDb): string[] {
  const rows = db
    .prepare<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return rows.map((row) => row.name);
}

export function readUserVersion(db: SqliteDb): number {
  const row = db.prepare<{ user_version: number }>('PRAGMA user_version').get();
  return row?.user_version ?? 0;
}

export function writeUserVersion(db: SqliteDb, version: number): void {
  db.pragma(`user_version = ${Math.max(0, Math.trunc(version))}`);
}

/** 启动时的完整性与外键检查；返回违规描述（不返回 SQL 或路径）。 */
export function collectIntegrityViolations(db: SqliteDb): string[] {
  const violations: string[] = [];
  const quick = db.prepare<{ quick_check: string }>('PRAGMA quick_check').all();
  for (const row of quick) {
    if (row.quick_check !== 'ok') violations.push(`QUICK_CHECK:${row.quick_check.slice(0, 80)}`);
  }
  try {
    const fkRows = db.prepare<Record<string, unknown>>('PRAGMA foreign_key_check').all();
    if (fkRows.length > 0) violations.push(`FOREIGN_KEY:${fkRows.length}`);
  } catch {
    violations.push('FOREIGN_KEY_CHECK_FAILED');
  }
  return violations;
}

/** 把 better-sqlite3 异常映射为稳定的安全错误码（不泄漏 SQL/路径）。 */
export function translateSqliteError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = typeof error === 'object' && error !== null ? String((error as { code?: unknown }).code ?? '') : '';
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return new AppError('DB_BUSY', { details: { reason: 'SQLITE_BUSY' } });
  }
  if (code === 'SQLITE_FULL') {
    return new AppError('STORAGE_FULL', { details: { reason: 'SQLITE_FULL' } });
  }
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') {
    return new AppError('INTEGRITY_ERROR', { details: { reason: 'SQLITE_CORRUPT' } });
  }
  if (code === 'SQLITE_READONLY') {
    return new AppError('STORAGE_UNAVAILABLE', { details: { reason: 'SQLITE_READONLY' } });
  }
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    return new AppError('INTEGRITY_ERROR', { details: { reason: 'SQLITE_CONSTRAINT' } });
  }
  return new AppError('INTERNAL_ERROR', { details: { reason: 'SQLITE_ERROR' } });
}

/** 判断是否为唯一约束冲突，并给出冲突的列信息（仅用于调用点内部分派）。 */
export function uniqueConstraintTarget(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = String((error as { code?: unknown }).code ?? '');
  if (code !== 'SQLITE_CONSTRAINT_UNIQUE' && code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') return null;
  const message = String((error as { message?: unknown }).message ?? '');
  return message;
}
