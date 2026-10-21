/**
 * 业务不变量检查（启动、恢复 staging、迁移后使用）。
 * 返回稳定违规码，不返回 SQL、路径或用户数据；调用方按 INTEGRITY_ERROR 处理。
 */

import { SYSTEM_CATEGORIES } from '../../shared/categories';
import { isTransactionDate, isPrecisionConsistent } from '../../shared/date';
import { MAX_CATEGORIES } from '../../shared/constants';
import { listSystemKeys } from './category-repo';
import { countLedgers, getDefaultLedger, readDataRevision } from './ledger-repo';
import { collectIntegrityViolations, tableExists, type SqliteDb } from './sqlite';

const REQUIRED_SYSTEM_KEYS = SYSTEM_CATEGORIES.map((category) => category.systemKey).sort();

export function collectBusinessViolations(db: SqliteDb): string[] {
  const violations: string[] = [];
  if (!tableExists(db, 'app_meta') || !tableExists(db, 'ledger') || !tableExists(db, 'category')) {
    return ['SCHEMA_TABLES_MISSING'];
  }

  const ledgerCount = countLedgers(db);
  if (ledgerCount !== 1) violations.push(`LEDGER_COUNT:${ledgerCount}`);
  const ledger = getDefaultLedger(db);
  if (!ledger) return [...violations, 'LEDGER_MISSING'];

  if (readDataRevision(db, ledger.id) < 0) violations.push('REVISION_NEGATIVE');

  const categoryCountRow = db
    .prepare<{ count: number }>('SELECT COUNT(*) AS count FROM category WHERE ledger_id = ?')
    .get(ledger.id);
  const categoryCount = categoryCountRow?.count ?? 0;
  if (categoryCount > MAX_CATEGORIES) violations.push(`CATEGORY_LIMIT:${categoryCount}`);
  if (categoryCount < REQUIRED_SYSTEM_KEYS.length) violations.push(`CATEGORY_COUNT:${categoryCount}`);

  const systemKeys = listSystemKeys(db, ledger.id);
  const expected = REQUIRED_SYSTEM_KEYS.join(',');
  if (systemKeys.join(',') !== expected) violations.push('SYSTEM_CATEGORY_SET');

  const other = db
    .prepare<{ enabled: number }>(
      "SELECT enabled FROM category WHERE ledger_id = ? AND system_key = 'other'",
    )
    .get(ledger.id);
  if (!other) violations.push('CATEGORY_OTHER_MISSING');
  else if (other.enabled !== 1) violations.push('CATEGORY_OTHER_DISABLED');

  const badCategoryLink = db
    .prepare<{ count: number }>(
      `SELECT COUNT(*) AS count FROM "transaction" t
        WHERE t.ledger_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM category c WHERE c.id = t.category_id AND c.ledger_id = t.ledger_id
          )`,
    )
    .get(ledger.id);
  if ((badCategoryLink?.count ?? 0) > 0) violations.push(`TRANSACTION_CATEGORY_LINK:${badCategoryLink?.count}`);

  const badAmount = db
    .prepare<{ count: number }>(
      `SELECT COUNT(*) AS count FROM "transaction"
        WHERE amount_fen < 1 OR amount_fen > 999999999`,
    )
    .get();
  if ((badAmount?.count ?? 0) > 0) violations.push(`TRANSACTION_AMOUNT:${badAmount?.count}`);

  const badSource = db
    .prepare<{ count: number }>(
      `SELECT COUNT(*) AS count FROM "transaction"
        WHERE (source = 'manual' AND source_candidate_id IS NOT NULL)
           OR (source = 'ai' AND (source_candidate_id IS NULL OR length(source_candidate_id) < 1))`,
    )
    .get();
  if ((badSource?.count ?? 0) > 0) violations.push(`TRANSACTION_SOURCE:${badSource?.count}`);

  const duplicateCandidate = db
    .prepare<{ count: number }>(
      `SELECT COUNT(*) AS count FROM (
         SELECT source_candidate_id FROM "transaction"
          WHERE source_candidate_id IS NOT NULL
          GROUP BY source_candidate_id HAVING COUNT(*) > 1
       )`,
    )
    .get();
  if ((duplicateCandidate?.count ?? 0) > 0) violations.push('DUPLICATE_CANDIDATE_LINK');

  const transactions = db
    .prepare<{
      id: string;
      occurred_date: string;
      occurred_time: string | null;
      time_precision: string;
    }>(
      `SELECT id, occurred_date, occurred_time, time_precision FROM "transaction"
        WHERE ledger_id = ?`,
    )
    .all(ledger.id);
  let badDate = 0;
  let badPrecision = 0;
  for (const row of transactions) {
    if (!isTransactionDate(row.occurred_date)) badDate += 1;
    if (!isPrecisionConsistent(row.time_precision, row.occurred_time)) badPrecision += 1;
  }
  if (badDate > 0) violations.push(`TRANSACTION_DATE:${badDate}`);
  if (badPrecision > 0) violations.push(`TRANSACTION_PRECISION:${badPrecision}`);

  if (tableExists(db,'import_job') && tableExists(db,'candidate') && tableExists(db,'image_asset')) {
    const mismatched = db.prepare<{n:number}>(`SELECT count(*) n FROM candidate c
      JOIN import_job j ON j.id=c.job_id JOIN image_asset a ON a.id=c.image_asset_id
      WHERE c.ledger_id<>j.ledger_id OR c.ledger_id<>a.ledger_id OR c.image_asset_id<>j.image_asset_id
      OR c.prepared_hash<>j.prepared_hash OR c.prepared_hash<>a.prepared_hash OR j.status<>'completed'`).get()!.n;
    if(mismatched)violations.push(`CANDIDATE_SOURCE:${mismatched}`);
    const counts = db.prepare<{n:number}>(`SELECT count(*) n FROM import_job j WHERE
      (j.status='completed' AND j.candidate_count<>(SELECT count(*) FROM candidate c WHERE c.job_id=j.id))
      OR (j.status<>'completed' AND EXISTS(SELECT 1 FROM candidate c WHERE c.job_id=j.id))`).get()!.n;
    if(counts)violations.push(`JOB_CANDIDATE_COUNT:${counts}`);
  }

  violations.push(...collectIntegrityViolations(db));
  return violations;
}

export function summariseViolations(violations: readonly string[]): string {
  const unique = [...new Set(violations)];
  return unique.slice(0, 8).join('|');
}
