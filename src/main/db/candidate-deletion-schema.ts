/** Additive migration: existing review states, events and posting graph stay intact. */
export const CANDIDATE_DELETION_SQL = `
ALTER TABLE candidate ADD COLUMN deleted_at TEXT CHECK(deleted_at IS NULL OR (length(deleted_at)=24 AND review_state='pending_review' AND posted_transaction_id IS NULL));
CREATE INDEX ix_candidate_deleted ON candidate(ledger_id,deleted_at,review_state);
CREATE TABLE candidate_lifecycle_event (
 id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('delete','restore')), mutation_id TEXT NOT NULL,
 before_version INTEGER NOT NULL CHECK(before_version>0), after_version INTEGER NOT NULL CHECK(after_version=before_version+1),
 created_at TEXT NOT NULL,
 FOREIGN KEY(ledger_id,candidate_id) REFERENCES candidate(ledger_id,id),
 UNIQUE(ledger_id,action,mutation_id)
) STRICT;
CREATE TRIGGER trg_lifecycle_no_update BEFORE UPDATE ON candidate_lifecycle_event BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER trg_lifecycle_no_delete BEFORE DELETE ON candidate_lifecycle_event BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER trg_deleted_no_ai_insert BEFORE INSERT ON "transaction" WHEN NEW.source='ai' AND EXISTS(SELECT 1 FROM candidate WHERE id=NEW.source_candidate_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'CANDIDATE_DELETED'); END;
CREATE TRIGGER trg_deleted_no_posting BEFORE INSERT ON review_posting WHEN EXISTS(SELECT 1 FROM candidate WHERE id=NEW.candidate_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'CANDIDATE_DELETED'); END;
`;
