/** 追加型审计事件（docs/ARCHITECTURE.md §3.2）：只插入，不更新/删除（DDL 触发器保障）。 */

import type { SqliteDb } from './sqlite';
import { randomUUID } from 'node:crypto';

export type AuditEntityType =
  | 'ledger'
  | 'category'
  | 'transaction'
  | 'image'
  | 'job'
  | 'settings'
  | 'backup'
  | 'dataset'
  | 'evaluation';

export interface AuditDiffEntry {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface AuditInput {
  readonly ledgerId: string;
  readonly entityType: AuditEntityType;
  readonly entityId: string | null;
  readonly action: string;
  readonly actor: 'local_user' | 'system';
  readonly diff: readonly AuditDiffEntry[];
  readonly mutationId: string | null;
  readonly reason: string | null;
  readonly now: string;
}

export function insertAuditEvent(db: SqliteDb, input: AuditInput): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO audit_event
       (id, ledger_id, entity_type, entity_id, action, actor, diff_json, mutation_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ledgerId,
    input.entityType,
    input.entityId,
    input.action,
    input.actor,
    JSON.stringify(input.diff),
    input.mutationId,
    input.reason,
    input.now,
  );
  return id;
}

export interface AuditRow {
  id: string;
  entity_type: AuditEntityType;
  entity_id: string | null;
  action: string;
  actor: string;
  diff_json: string;
  mutation_id: string | null;
  reason: string | null;
  created_at: string;
}

export function listAuditEvents(db: SqliteDb, entityType: AuditEntityType, entityId: string): AuditRow[] {
  return db
    .prepare<AuditRow>(
      `SELECT id, entity_type, entity_id, action, actor, diff_json, mutation_id, reason, created_at
         FROM audit_event WHERE entity_type = ? AND entity_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(entityType, entityId);
}
