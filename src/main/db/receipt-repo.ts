/** 幂等收据（docs/CONTRACTS.md §1）：唯一 (ledgerId, operation, mutationId)，随业务事务提交。 */

import { randomUUID } from 'node:crypto';
import type { SqliteDb } from './sqlite';

export interface MutationReceiptRow {
  payload_hash: string;
  result_type: string;
  result_snapshot_json: string;
  revision_at_commit: number;
}

export function findReceipt(
  db: SqliteDb,
  ledgerId: string,
  operation: string,
  mutationId: string,
): MutationReceiptRow | null {
  const row = db
    .prepare<MutationReceiptRow>(
      `SELECT payload_hash, result_type, result_snapshot_json, revision_at_commit
         FROM mutation_receipt
        WHERE ledger_id = ? AND operation = ? AND mutation_id = ?`,
    )
    .get(ledgerId, operation, mutationId);
  return row ?? null;
}

export interface NewReceipt {
  readonly ledgerId: string;
  readonly operation: string;
  readonly mutationId: string;
  readonly payloadHash: string;
  readonly resultType: string;
  readonly resultIds: readonly string[];
  readonly snapshot: unknown;
  readonly revision: number;
  readonly now: string;
}

export function insertReceipt(db: SqliteDb, receipt: NewReceipt): void {
  db.prepare(
    `INSERT INTO mutation_receipt
       (id, ledger_id, operation, mutation_id, payload_hash, result_type,
        result_ids_json, result_snapshot_json, revision_at_commit, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    receipt.ledgerId,
    receipt.operation,
    receipt.mutationId,
    receipt.payloadHash,
    receipt.resultType,
    JSON.stringify(receipt.resultIds),
    JSON.stringify(receipt.snapshot),
    receipt.revision,
    receipt.now,
  );
}
