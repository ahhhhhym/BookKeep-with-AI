/** 账本仓储：首版只有一个默认账本（defaultKey=default）。 */

import type { SqliteDb } from './sqlite';
import type { LedgerRow } from './rows';

export function getDefaultLedger(db: SqliteDb): LedgerRow | null {
  const row = db
    .prepare<LedgerRow>(
      `SELECT id, name, currency, timezone, default_key, data_revision, dataset_revision,
              version, created_at, updated_at
         FROM ledger ORDER BY created_at ASC, id ASC LIMIT 1`,
    )
    .get();
  return row ?? null;
}

export function countLedgers(db: SqliteDb): number {
  const row = db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM ledger').get();
  return row?.count ?? 0;
}

export interface NewLedger {
  id: string;
  name: string;
  now: string;
}

export function insertDefaultLedger(db: SqliteDb, ledger: NewLedger): void {
  db.prepare(
    `INSERT INTO ledger
       (id, name, currency, timezone, default_key, data_revision, dataset_revision,
        version, created_at, updated_at)
     VALUES (?, ?, 'CNY', 'Asia/Shanghai', 'default', 0, 0, 1, ?, ?)`,
  ).run(ledger.id, ledger.name, ledger.now, ledger.now);
}

/** 事务内递增数据修订号并返回新值；超安全整数范围拒绝 COUNTER_EXHAUSTED。 */
export function bumpDataRevision(db: SqliteDb, ledgerId: string, now: string): number {
  const row = db
    .prepare<{ data_revision: number }>('SELECT data_revision FROM ledger WHERE id = ?')
    .get(ledgerId);
  if (!row) throw new Error('LEDGER_MISSING');
  if (!Number.isSafeInteger(row.data_revision) || row.data_revision < 0) {
    throw new Error('REVISION_INVALID');
  }
  if (row.data_revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('COUNTER_EXHAUSTED');
  }
  const next = row.data_revision + 1;
  const result = db
    .prepare('UPDATE ledger SET data_revision = ?, updated_at = ? WHERE id = ?')
    .run(next, now, ledgerId);
  if (result.changes !== 1) throw new Error('REVISION_UPDATE_FAILED');
  return next;
}

export function readDataRevision(db: SqliteDb, ledgerId: string): number {
  const row = db
    .prepare<{ data_revision: number }>('SELECT data_revision FROM ledger WHERE id = ?')
    .get(ledgerId);
  return row?.data_revision ?? 0;
}
