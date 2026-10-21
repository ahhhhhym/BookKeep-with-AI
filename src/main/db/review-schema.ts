/** Additive v3. A real FK closes S05 N03 without rebuilding referenced tables. */
export const REVIEW_SQL = `
ALTER TABLE candidate ADD COLUMN resolution_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(resolution_json));
CREATE UNIQUE INDEX ux_candidate_posted_pair ON candidate(id,posted_transaction_id);
CREATE TABLE review_posting (
 candidate_id TEXT PRIMARY KEY REFERENCES candidate(id), transaction_id TEXT NOT NULL UNIQUE REFERENCES "transaction"(id),
 FOREIGN KEY(candidate_id,transaction_id) REFERENCES candidate(id,posted_transaction_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TRIGGER trg_posting_no_update BEFORE UPDATE ON review_posting BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LINK'); END;
CREATE TRIGGER trg_posting_no_delete BEFORE DELETE ON review_posting BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LINK'); END;
ALTER TABLE "transaction" ADD COLUMN review_candidate_id TEXT REFERENCES review_posting(candidate_id) DEFERRABLE INITIALLY DEFERRED
 CHECK(review_candidate_id IS source_candidate_id);
CREATE TABLE review_event (
 id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledger(id), candidate_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('edit','reopen','resolve_duplicate','resolve_warning','reject','approve')),
 before_json TEXT NOT NULL CHECK(json_valid(before_json)), after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500), mutation_id TEXT NOT NULL,
 transaction_id TEXT REFERENCES "transaction"(id), created_at TEXT NOT NULL,
 FOREIGN KEY(ledger_id,candidate_id) REFERENCES candidate(ledger_id,id),
 CHECK((action='approve')=(transaction_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX ux_review_approve ON review_event(candidate_id) WHERE action='approve';
CREATE TRIGGER trg_review_no_update BEFORE UPDATE ON review_event BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER trg_review_no_delete BEFORE DELETE ON review_event BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER trg_ai_candidate_insert BEFORE INSERT ON "transaction" WHEN NEW.source='ai'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM candidate c JOIN import_job j ON j.id=c.job_id
 WHERE c.id=NEW.source_candidate_id AND c.ledger_id=NEW.ledger_id AND c.review_state='pending_review' AND j.status='completed')
 THEN RAISE(ABORT,'AI_REVIEW_SOURCE_REQUIRED') END;
END;
CREATE TRIGGER trg_tx_source_immutable BEFORE UPDATE OF source,source_candidate_id,review_candidate_id,ledger_id ON "transaction"
WHEN NEW.source IS NOT OLD.source OR NEW.source_candidate_id IS NOT OLD.source_candidate_id OR NEW.review_candidate_id IS NOT OLD.review_candidate_id OR NEW.ledger_id IS NOT OLD.ledger_id
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOURCE'); END;
CREATE TRIGGER trg_candidate_approved_immutable BEFORE UPDATE OF current_json,review_state,posted_transaction_id ON candidate
WHEN OLD.review_state='approved'
BEGIN SELECT RAISE(ABORT,'ALREADY_APPROVED'); END;
CREATE TRIGGER trg_candidate_approve_link BEFORE UPDATE OF review_state,posted_transaction_id ON candidate WHEN NEW.review_state='approved'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM "transaction" t WHERE t.id=NEW.posted_transaction_id
 AND t.ledger_id=NEW.ledger_id AND t.source_candidate_id=NEW.id AND t.review_candidate_id=NEW.id)
 THEN RAISE(ABORT,'APPROVE_LINK_REQUIRED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM review_event e WHERE e.candidate_id=NEW.id AND e.action='approve' AND e.transaction_id=NEW.posted_transaction_id)
 THEN RAISE(ABORT,'APPROVE_EVENT_REQUIRED') END;
END;
CREATE TRIGGER trg_review_approve_link BEFORE INSERT ON review_event WHEN NEW.action='approve'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM "transaction" t WHERE t.id=NEW.transaction_id AND t.ledger_id=NEW.ledger_id AND t.source_candidate_id=NEW.candidate_id)
 THEN RAISE(ABORT,'REVIEW_LINK_REQUIRED') END;
END;
`;
