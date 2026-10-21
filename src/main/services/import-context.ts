import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors';
import { runInTransaction, type SqliteDb } from '../db/sqlite';
import { findReceipt, insertReceipt } from '../db/receipt-repo';
import { hashPayload } from './canonical';
import type { LedgerStore } from './ledger-store';
export type ImportContext = {
    db: SqliteDb;
    ledgerId: string;
    epoch: string;
    revision: number;
    directory: string;
};
export function change<T>(store: LedgerStore, operation: string, mutationId: string | null, payload: unknown, fn: (ctx: ImportContext) => T): T {
    return store.withImports(true, ctx => runInTransaction(ctx.db, () => {
        const digest = hashPayload({ operation, payload });
        if (mutationId) {
            const old = findReceipt(ctx.db, ctx.ledgerId, operation, mutationId);
            if (old) {
                if (old.payload_hash !== digest)
                    throw new AppError('IDEMPOTENCY_CONFLICT');
                return JSON.parse(old.result_snapshot_json) as T;
            }
        }
        const result = fn(ctx);
        const now = new Date().toISOString();
        const rev = ctx.db.prepare<{
            data_revision: number;
        }>('SELECT data_revision FROM ledger WHERE id=?').get(ctx.ledgerId)!.data_revision;
        if (rev >= Number.MAX_SAFE_INTEGER)
            throw new AppError('COUNTER_EXHAUSTED');
        ctx.db.prepare('UPDATE ledger SET data_revision=data_revision+1,updated_at=? WHERE id=?').run(now, ctx.ledgerId);
        if (mutationId)
            insertReceipt(ctx.db, { ledgerId: ctx.ledgerId, operation, mutationId, payloadHash: digest, resultType: operation, resultIds: [], snapshot: result, revision: rev + 1, now });
        // No provider text, file paths or bytes in audit.
        ctx.db.prepare('INSERT INTO audit_event(id,ledger_id,entity_type,entity_id,action,actor,diff_json,mutation_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run(randomUUID(), ctx.ledgerId, operation.startsWith('image') ? 'image' : 'job', null, operation, 'system', '[]', mutationId, null, now);
        return result;
    }));
}
