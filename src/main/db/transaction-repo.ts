/** 正式交易仓储：整数分、日期精度、来源与唯一候选关联、version 条件写入、软删除。 */

import type { SqliteDb } from './sqlite';
import type { TransactionRow } from './rows';

const TRANSACTION_COLUMNS = `id, ledger_id, amount_fen, currency, occurred_date, occurred_time,
       time_precision, name, category_id, merchant, note, source, source_candidate_id,
       deleted_at, version, created_at, updated_at`;

export function getTransactionById(db: SqliteDb, id: string): TransactionRow | null {
  const row = db
    .prepare<TransactionRow>(`SELECT ${TRANSACTION_COLUMNS} FROM "transaction" WHERE id = ?`)
    .get(id);
  return row ?? null;
}

export interface NewTransaction {
  id: string;
  ledgerId: string;
  amountFen: number;
  occurredDate: string;
  occurredTime: string | null;
  timePrecision: 'date' | 'minute';
  name: string;
  categoryId: string;
  merchant: string | null;
  note: string | null;
  source: 'manual' | 'ai';
  sourceCandidateId: string | null;
  now: string;
}

export function insertTransaction(db: SqliteDb, transaction: NewTransaction): void {
  db.prepare(
    `INSERT INTO "transaction"
       (id, ledger_id, amount_fen, currency, occurred_date, occurred_time, time_precision,
        name, category_id, merchant, note, source, source_candidate_id, deleted_at,
        version, created_at, updated_at)
     VALUES (?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
  ).run(
    transaction.id,
    transaction.ledgerId,
    transaction.amountFen,
    transaction.occurredDate,
    transaction.occurredTime,
    transaction.timePrecision,
    transaction.name,
    transaction.categoryId,
    transaction.merchant,
    transaction.note,
    transaction.source,
    transaction.sourceCandidateId,
    transaction.now,
    transaction.now,
  );
}

export interface TransactionFieldUpdate {
  amountFen?: number;
  occurredDate?: string;
  occurredTime?: string | null;
  timePrecision?: 'date' | 'minute';
  name?: string;
  categoryId?: string;
  merchant?: string | null;
  note?: string | null;
}

/** version 条件更新；返回 null 表示版本不匹配或对象不存在（由服务层区分）。 */
export function updateTransactionWithVersion(
  db: SqliteDb,
  id: string,
  expectedVersion: number,
  update: TransactionFieldUpdate,
  now: string,
): TransactionRow | null {
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (update.amountFen !== undefined) {
    assignments.push('amount_fen = ?');
    values.push(update.amountFen);
  }
  if (update.occurredDate !== undefined) {
    assignments.push('occurred_date = ?');
    values.push(update.occurredDate);
  }
  if (update.occurredTime !== undefined) {
    assignments.push('occurred_time = ?');
    values.push(update.occurredTime);
  }
  if (update.timePrecision !== undefined) {
    assignments.push('time_precision = ?');
    values.push(update.timePrecision);
  }
  if (update.name !== undefined) {
    assignments.push('name = ?');
    values.push(update.name);
  }
  if (update.categoryId !== undefined) {
    assignments.push('category_id = ?');
    values.push(update.categoryId);
  }
  if (update.merchant !== undefined) {
    assignments.push('merchant = ?');
    values.push(update.merchant);
  }
  if (update.note !== undefined) {
    assignments.push('note = ?');
    values.push(update.note);
  }
  if (assignments.length === 0) return getTransactionById(db, id);
  assignments.push('version = version + 1');
  assignments.push('updated_at = ?');
  values.push(now);
  const result = db
    .prepare(
      `UPDATE "transaction" SET ${assignments.join(', ')}
        WHERE id = ? AND version = ? AND version < 2147483647`,
    )
    .run(...values, id, expectedVersion);
  if (result.changes !== 1) return null;
  return getTransactionById(db, id);
}

/** 软删除/恢复同样走 version 条件写入。 */
export function setTransactionDeletedAt(
  db: SqliteDb,
  id: string,
  expectedVersion: number,
  deletedAt: string | null,
  now: string,
): TransactionRow | null {
  const result = db
    .prepare(
      `UPDATE "transaction"
          SET deleted_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND version < 2147483647`,
    )
    .run(deletedAt, now, id, expectedVersion);
  if (result.changes !== 1) return null;
  return getTransactionById(db, id);
}

export function countTransactions(db: SqliteDb, ledgerId: string): number {
  const row = db
    .prepare<{ count: number }>('SELECT COUNT(*) AS count FROM "transaction" WHERE ledger_id = ?')
    .get(ledgerId);
  return row?.count ?? 0;
}

export function findTransactionByCandidateId(
  db: SqliteDb,
  sourceCandidateId: string,
): TransactionRow | null {
  const row = db
    .prepare<TransactionRow>(
      `SELECT ${TRANSACTION_COLUMNS} FROM "transaction" WHERE source_candidate_id = ?`,
    )
    .get(sourceCandidateId);
  return row ?? null;
}

export { TRANSACTION_COLUMNS };
