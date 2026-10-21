CREATE INDEX ix_candidate_review ON candidate(ledger_id,review_state,created_at,job_id,ordinal,id);

CREATE INDEX ix_image_hash ON image_asset(ledger_id,original_hash,prepared_hash);

CREATE INDEX ix_job_hash ON import_job(ledger_id,prepared_hash,created_at,id);

CREATE INDEX ix_job_queue ON import_job(ledger_id,status,created_at,id);

CREATE TABLE candidate (
 id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledger(id), job_id TEXT NOT NULL, image_asset_id TEXT NOT NULL,
 prepared_hash TEXT NOT NULL CHECK(length(prepared_hash)=64), ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 99),
 proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)), current_json TEXT NOT NULL CHECK(json_valid(current_json)),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), missing_json TEXT NOT NULL CHECK(json_valid(missing_json)),
 warnings_json TEXT NOT NULL CHECK(json_valid(warnings_json)), duplicates_json TEXT NOT NULL CHECK(json_valid(duplicates_json)),
 blocking INTEGER NOT NULL CHECK(blocking IN(0,1)), excluded_by_default INTEGER NOT NULL CHECK(excluded_by_default IN(0,1)),
 review_state TEXT NOT NULL DEFAULT 'pending_review' CHECK(review_state IN('pending_review','rejected','approved')),
 posted_transaction_id TEXT REFERENCES "transaction"(id), version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483647),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(ledger_id,job_id) REFERENCES import_job(ledger_id,id),
 FOREIGN KEY(ledger_id,image_asset_id) REFERENCES image_asset(ledger_id,id),
 UNIQUE(job_id,ordinal), UNIQUE(ledger_id,id),
 CHECK((review_state='approved')=(posted_transaction_id IS NOT NULL))
) STRICT;

CREATE TABLE image_asset (
 id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledger(id),
 parent_asset_id TEXT REFERENCES image_asset(id), source TEXT NOT NULL CHECK(source IN ('selection','drop','prepared')),
 original_hash TEXT NOT NULL CHECK(length(original_hash)=64), prepared_hash TEXT CHECK(prepared_hash IS NULL OR length(prepared_hash)=64),
 original_ref TEXT, prepared_ref TEXT, width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 8192), height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 8192),
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
 original_retained INTEGER NOT NULL CHECK(original_retained IN(0,1)), retention TEXT NOT NULL CHECK(retention IN('keep_original','prepared_only')),
 transform_json TEXT NOT NULL CHECK(json_valid(transform_json)), version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483647),
 deleted_at TEXT, created_at TEXT NOT NULL,
 CHECK((prepared_hash IS NULL)=(prepared_ref IS NULL)),
 UNIQUE(ledger_id,id)
) STRICT;

CREATE TABLE import_job (
 id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledger(id), image_asset_id TEXT NOT NULL,
 prepared_hash TEXT NOT NULL CHECK(length(prepared_hash)=64),
 status TEXT NOT NULL CHECK(status IN('queued','processing','completed','failed','cancelled')),
 generation INTEGER NOT NULL DEFAULT 1 CHECK(generation BETWEEN 1 AND 9007199254740991),
 attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 3), total_attempts INTEGER NOT NULL DEFAULT 0 CHECK(total_attempts BETWEEN 0 AND 9007199254740991),
 request_id TEXT, provider TEXT NOT NULL CHECK(provider IN('mock','deepseek')), model TEXT NOT NULL, actual_model TEXT,
 prompt_version TEXT NOT NULL, schema_version TEXT NOT NULL, categories_json TEXT NOT NULL CHECK(json_valid(categories_json)),
 consent_json TEXT NOT NULL CHECK(json_valid(consent_json)), needs_consent INTEGER NOT NULL DEFAULT 0 CHECK(needs_consent IN(0,1)),
 force_new INTEGER NOT NULL CHECK(force_new IN(0,1)), reason TEXT, error_code TEXT, started_at TEXT, finished_at TEXT, next_attempt_at TEXT,
 candidate_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_count BETWEEN 0 AND 100),
 warnings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings_json)), usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483647), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(ledger_id,image_asset_id) REFERENCES image_asset(ledger_id,id), UNIQUE(ledger_id,id),
 CHECK((status='processing' AND request_id IS NOT NULL AND started_at IS NOT NULL AND error_code IS NULL AND next_attempt_at IS NULL AND finished_at IS NULL) OR
 (status='queued' AND request_id IS NULL AND finished_at IS NULL) OR
 (status='completed' AND request_id IS NULL AND error_code IS NULL AND finished_at IS NOT NULL) OR
 (status='failed' AND request_id IS NULL AND error_code IS NOT NULL AND finished_at IS NOT NULL) OR
 (status='cancelled' AND request_id IS NULL AND error_code='CANCELLED' AND finished_at IS NOT NULL))
) STRICT;

CREATE TRIGGER trg_candidate_proposal BEFORE UPDATE OF proposal_json,evidence_json,job_id,image_asset_id,prepared_hash,ordinal ON candidate
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROPOSAL'); END;
