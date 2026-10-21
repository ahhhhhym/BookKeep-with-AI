-- table: app_meta
CREATE TABLE app_meta (
  id TEXT PRIMARY KEY CHECK (id = 'app'),
  db_schema_version INTEGER NOT NULL CHECK (db_schema_version >= 1),
  contract_version TEXT NOT NULL,
  data_epoch TEXT NOT NULL,
  active_generation TEXT NOT NULL,
  migration_state TEXT NOT NULL CHECK (migration_state IN ('clean','migrating','recovery_required')),
  last_migration_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- table: audit_event
CREATE TABLE audit_event (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ledger','category','transaction','image','job','settings','backup','dataset','evaluation')),
  entity_id TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  actor TEXT NOT NULL CHECK (actor IN ('local_user','system')),
  diff_json TEXT NOT NULL,
  mutation_id TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  created_at TEXT NOT NULL
) STRICT;

-- table: backup_manifest
CREATE TABLE backup_manifest (
         id TEXT PRIMARY KEY CHECK (id = 'manifest'),
         payload_json TEXT NOT NULL
       ) STRICT;

-- table: backup_record
CREATE TABLE backup_record (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('manual','pre_migration','pre_restore')),
  status TEXT NOT NULL CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  manifest_version TEXT NOT NULL CHECK (manifest_version = 'bk-backup.v1'),
  db_schema_version INTEGER NOT NULL CHECK (db_schema_version >= 1),
  app_version TEXT NOT NULL,
  archive_hash TEXT CHECK (archive_hash IS NULL OR length(archive_hash) = 64),
  archive_ref TEXT,
  error_code TEXT,
  finished_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    status <> 'completed'
    OR (archive_hash IS NOT NULL AND archive_ref IS NOT NULL AND finished_at IS NOT NULL)
  )
) STRICT;

-- table: category
CREATE TABLE category (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 20),
  icon_key TEXT NOT NULL CHECK (length(icon_key) BETWEEN 1 AND 64),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 999999),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  system_key TEXT CHECK (system_key IS NULL OR length(system_key) BETWEEN 1 AND 64),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- table: ledger
CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  timezone TEXT NOT NULL CHECK (timezone = 'Asia/Shanghai'),
  default_key TEXT NOT NULL UNIQUE CHECK (default_key = 'default'),
  data_revision INTEGER NOT NULL DEFAULT 0 CHECK (data_revision >= 0),
  dataset_revision INTEGER NOT NULL DEFAULT 0 CHECK (dataset_revision >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- table: migration_record
CREATE TABLE migration_record (
  id TEXT PRIMARY KEY,
  from_version INTEGER NOT NULL CHECK (from_version >= 0),
  to_version INTEGER NOT NULL CHECK (to_version >= 1),
  app_version TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  backup_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
) STRICT;

-- table: mutation_receipt
CREATE TABLE mutation_receipt (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  result_type TEXT NOT NULL,
  result_ids_json TEXT NOT NULL,
  result_snapshot_json TEXT NOT NULL,
  revision_at_commit INTEGER NOT NULL CHECK (revision_at_commit >= 0),
  created_at TEXT NOT NULL
) STRICT;

-- table: transaction
CREATE TABLE "transaction" (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  amount_fen INTEGER NOT NULL CHECK (amount_fen BETWEEN 1 AND 999999999),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  occurred_date TEXT NOT NULL CHECK (
    occurred_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND substr(occurred_date, 6, 2) BETWEEN '01' AND '12'
    AND substr(occurred_date, 9, 2) BETWEEN '01' AND '31'
  ),
  occurred_time TEXT CHECK (
    occurred_time IS NULL OR (
      occurred_time GLOB '[0-9][0-9]:[0-9][0-9]'
      AND CAST(substr(occurred_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
      AND CAST(substr(occurred_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
    )
  ),
  time_precision TEXT NOT NULL CHECK (time_precision IN ('date','minute')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  category_id TEXT NOT NULL,
  merchant TEXT CHECK (merchant IS NULL OR length(merchant) BETWEEN 1 AND 100),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  source TEXT NOT NULL CHECK (source IN ('manual','ai')),
  source_candidate_id TEXT,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (source = 'manual' AND source_candidate_id IS NULL)
    OR (source = 'ai' AND source_candidate_id IS NOT NULL AND length(source_candidate_id) BETWEEN 1 AND 64)
  ),
  CHECK (
    (time_precision = 'date' AND occurred_time IS NULL)
    OR (time_precision = 'minute' AND occurred_time IS NOT NULL)
  ),
  FOREIGN KEY (ledger_id) REFERENCES ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (ledger_id, category_id) REFERENCES category(ledger_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

-- index: ix_audit_entity
CREATE INDEX ix_audit_entity ON audit_event(entity_type, entity_id, created_at);

-- index: ix_backup_created
CREATE INDEX ix_backup_created ON backup_record(created_at, id);

-- index: ix_category_order
CREATE INDEX ix_category_order ON category(ledger_id, enabled, sort_order, id);

-- index: ix_transaction_category
CREATE INDEX ix_transaction_category ON "transaction"(ledger_id, category_id, deleted_at, occurred_date);

-- index: ix_transaction_list
CREATE INDEX ix_transaction_list ON "transaction"(ledger_id, deleted_at, occurred_date, id);

-- index: ux_category_ledger_id
CREATE UNIQUE INDEX ux_category_ledger_id ON category(ledger_id, id);

-- index: ux_category_name
CREATE UNIQUE INDEX ux_category_name ON category(ledger_id, normalized_name);

-- index: ux_category_system_key
CREATE UNIQUE INDEX ux_category_system_key ON category(ledger_id, system_key) WHERE system_key IS NOT NULL;

-- index: ux_migration_completed
CREATE UNIQUE INDEX ux_migration_completed ON migration_record(to_version) WHERE status = 'completed';

-- index: ux_receipt_key
CREATE UNIQUE INDEX ux_receipt_key ON mutation_receipt(ledger_id, operation, mutation_id);

-- index: ux_transaction_candidate
CREATE UNIQUE INDEX ux_transaction_candidate ON "transaction"(source_candidate_id) WHERE source_candidate_id IS NOT NULL;

-- trigger: trg_audit_no_delete
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- trigger: trg_audit_no_update
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_event
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- trigger: trg_migration_no_delete
CREATE TRIGGER trg_migration_no_delete BEFORE DELETE ON migration_record
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- trigger: trg_migration_no_update
CREATE TRIGGER trg_migration_no_update BEFORE UPDATE ON migration_record
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- trigger: trg_receipt_no_delete
CREATE TRIGGER trg_receipt_no_delete BEFORE DELETE ON mutation_receipt
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- trigger: trg_receipt_no_update
CREATE TRIGGER trg_receipt_no_update BEFORE UPDATE ON mutation_receipt
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
