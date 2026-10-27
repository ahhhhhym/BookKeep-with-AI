/** v4 additive migration only. No runtime CREATE TABLE. Business/audit rows remain untouched. */
export const ACHIEVEMENT_SQL = `
CREATE TABLE achievement_initialization (
 ledger_id TEXT PRIMARY KEY REFERENCES ledger(id), rule_version INTEGER NOT NULL CHECK(rule_version=1),
 completed_at TEXT NOT NULL
) STRICT;
CREATE TABLE achievement_fact (
 ledger_id TEXT NOT NULL REFERENCES ledger(id), kind TEXT NOT NULL CHECK(kind IN('manual_entry','ai_entry','manual_backup')),
 source_id TEXT NOT NULL, succeeded_at TEXT NOT NULL, day TEXT NOT NULL CHECK(length(day)=10),
 evidence TEXT NOT NULL, recorded_at TEXT NOT NULL,
 PRIMARY KEY(ledger_id,kind,source_id)
) STRICT;
CREATE TABLE achievement_activity_day (
 ledger_id TEXT NOT NULL REFERENCES ledger(id), day TEXT NOT NULL CHECK(length(day)=10),
 first_recorded_at TEXT NOT NULL, PRIMARY KEY(ledger_id,day)
) STRICT;
CREATE TABLE achievement_unlock (
 ledger_id TEXT NOT NULL REFERENCES ledger(id), achievement_id TEXT NOT NULL CHECK(achievement_id IN(
 'entry_first','entry_10','entry_100','streak_3','streak_7','streak_30','ai_first','ai_10','backup_first','backup_days_3')),
 condition_version INTEGER NOT NULL CHECK(condition_version=1), unlocked_at TEXT,
 origin TEXT NOT NULL CHECK(origin IN('history','live')), evaluated_at TEXT NOT NULL, evidence TEXT NOT NULL,
 CHECK((origin='history' AND unlocked_at IS NULL) OR (origin='live' AND unlocked_at IS NOT NULL)),
 PRIMARY KEY(ledger_id,achievement_id)
) STRICT;
CREATE TABLE achievement_notice (
 id TEXT NOT NULL, ledger_id TEXT NOT NULL REFERENCES ledger(id), kind TEXT NOT NULL CHECK(kind IN('unlock','history_summary')),
 status TEXT NOT NULL CHECK(status IN('pending','shown','closed','suppressed')),
 created_at TEXT NOT NULL, state_at TEXT NOT NULL, PRIMARY KEY(ledger_id,id)
) STRICT;
CREATE UNIQUE INDEX ux_achievement_history_notice ON achievement_notice(ledger_id) WHERE kind='history_summary';
CREATE TABLE achievement_notice_item (
 ledger_id TEXT NOT NULL, achievement_id TEXT NOT NULL, notice_id TEXT NOT NULL,
 PRIMARY KEY(ledger_id,achievement_id),
 FOREIGN KEY(ledger_id,achievement_id) REFERENCES achievement_unlock(ledger_id,achievement_id),
 FOREIGN KEY(ledger_id,notice_id) REFERENCES achievement_notice(ledger_id,id)
) STRICT;
CREATE TABLE achievement_diagnostic (
 ledger_id TEXT PRIMARY KEY REFERENCES ledger(id), error_code TEXT NOT NULL, failed_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER trg_achievement_unlock_no_update BEFORE UPDATE ON achievement_unlock BEGIN SELECT RAISE(ABORT,'PERMANENT_UNLOCK'); END;
CREATE TRIGGER trg_achievement_unlock_no_delete BEFORE DELETE ON achievement_unlock BEGIN SELECT RAISE(ABORT,'PERMANENT_UNLOCK'); END;
CREATE TRIGGER trg_achievement_fact_no_update BEFORE UPDATE ON achievement_fact BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FACT'); END;
CREATE TRIGGER trg_achievement_fact_no_delete BEFORE DELETE ON achievement_fact BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FACT'); END;
CREATE TRIGGER trg_achievement_day_no_delete BEFORE DELETE ON achievement_activity_day BEGIN SELECT RAISE(ABORT,'PERMANENT_ACTIVITY_DAY'); END;
CREATE TRIGGER trg_achievement_day_no_update BEFORE UPDATE ON achievement_activity_day BEGIN SELECT RAISE(ABORT,'PERMANENT_ACTIVITY_DAY'); END;
`;
