/** 数据库/仓储集成测试共用：隔离临时数据目录、固定时钟、直连诊断连接。 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { StorageLayout } from '../../../src/main/paths';
import type { LedgerStore, LedgerStoreOptions } from '../../../src/main/services/ledger-store';
import { openSqlite, type SqliteDb } from '../../../src/main/db/sqlite';
import type { TransactionInput } from '../../../src/shared/entities';

export const TEST_START = Date.parse('2026-10-20T04:00:00.000Z');

export function createTestLayout(): StorageLayout {
  const root = mkdtempSync(path.join(tmpdir(), 'bookkeep-s05-'));
  return {
    root,
    data: path.join(root, 'data'),
    secrets: path.join(root, 'secrets'),
    backups: path.join(root, 'backups'),
    logs: path.join(root, 'logs'),
    temp: path.join(root, 'temp'),
    shell: path.join(root, 'shell'),
  };
}

export function cleanupLayout(layout: StorageLayout): void {
  try {
    rmSync(layout.root, { recursive: true, force: true });
  } catch {
    // Windows 上仍被占用的句柄不影响测试结论。
  }
}

/** 每次读取递增 1 秒，保证 createdAt 排序可预测。 */
export function fixedClock(start: number = TEST_START): { clock: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    clock: () => {
      current += 1_000;
      return current;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

export function storeOptions(
  layout: StorageLayout,
  clock: () => number,
  overrides: Partial<LedgerStoreOptions> = {},
): LedgerStoreOptions {
  return {
    layout,
    appVersion: '0.1.0-test',
    clock,
    tokenSecret: Buffer.from('0123456789abcdef0123456789abcdef', 'utf8'),
    ...overrides,
  };
}

export function openReadOnly<T>(databasePath: string, fn: (db: SqliteDb) => T): T {
  const db = openSqlite(databasePath, { readonly: true, fileMustExist: true, configure: false });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function openWritable<T>(databasePath: string, fn: (db: SqliteDb) => T): T {
  const db = openSqlite(databasePath, { fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function transactionInput(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    amountFen: 1800,
    occurredDate: '2026-09-08',
    occurredTime: null,
    timePrecision: 'date',
    name: '午餐',
    categoryId: 'cat_food',
    merchant: null,
    note: null,
    ...overrides,
  };
}

export function closeQuietly(store: LedgerStore): void {
  try {
    store.close();
  } catch {
    // ignore
  }
}

export function readBackupIdOfKind(store: LedgerStore, kind: string): string | null {
  const { databasePath } = store.diagnostics();
  return openReadOnly(databasePath, (db) => {
    const row = db
      .prepare<{ id: string }>('SELECT id FROM backup_record WHERE kind = ? ORDER BY created_at DESC LIMIT 1')
      .get(kind);
    return row?.id ?? null;
  });
}
