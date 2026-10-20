/**
 * 交易列表查询边界（docs/ARCHITECTURE.md §6）。
 *
 * 列表全序：occurredDate DESC → 已知时刻在前 → occurredTime DESC → createdAt DESC → id ASC。
 * 名称是字面子串（NFC，ASCII 大小写不敏感），不是 SQL 通配符；日期与分类条件是 AND。
 * 日期组小计覆盖整组筛选集合（不只当前页）。
 */

import type { DateGroupView, TransactionFilter } from '../../shared/entities';
import { normalizeText } from '../../shared/text';
import { deletedFilterSql, mapTransaction, type TransactionRow } from './rows';
import type { SqliteDb } from './sqlite';

const TX_COLUMNS = `t.id, t.ledger_id, t.amount_fen, t.currency, t.occurred_date, t.occurred_time,
  t.time_precision, t.name, t.category_id, t.merchant, t.note, t.source, t.source_candidate_id,
  t.deleted_at, t.version, t.created_at, t.updated_at`;

export interface TransactionQueryPage {
  readonly offset: number;
  readonly limit: number;
}

export interface TransactionPageData {
  readonly rows: TransactionRow[];
  readonly totalCount: number;
  readonly filteredTotalFen: string;
  readonly dateGroups: DateGroupView[];
}

interface WhereClause {
  readonly sql: string;
  readonly params: unknown[];
}

function buildWhere(ledgerId: string, filter: TransactionFilter): WhereClause {
  const conditions: string[] = ['t.ledger_id = ?', deletedFilterSql(filter.deleted)];
  const params: unknown[] = [ledgerId];
  if (filter.dateStart !== null) {
    conditions.push('t.occurred_date >= ?');
    params.push(filter.dateStart);
  }
  if (filter.dateEnd !== null) {
    conditions.push('t.occurred_date < ?');
    params.push(filter.dateEnd);
  }
  if (filter.categoryIds.length > 0) {
    conditions.push(`t.category_id IN (${filter.categoryIds.map(() => '?').join(', ')})`);
    params.push(...filter.categoryIds);
  }
  if (filter.nameQuery !== null) {
    conditions.push('instr(lower(t.name), ?) > 0');
    params.push(normalizeText(filter.nameQuery).replace(/[A-Z]/g, (character) => character.toLowerCase()));
  }
  return { sql: conditions.join(' AND '), params };
}

function normalizeFenString(value: string | null): string {
  if (value === null || value.length === 0) return '0';
  try {
    return BigInt(value).toString();
  } catch {
    return '0';
  }
}

const LIST_ORDER = `t.occurred_date DESC,
  CASE WHEN t.occurred_time IS NULL THEN 1 ELSE 0 END ASC,
  t.occurred_time DESC,
  t.created_at DESC,
  t.id ASC`;

export function queryTransactions(
  db: SqliteDb,
  ledgerId: string,
  filter: TransactionFilter,
  page: TransactionQueryPage,
): TransactionPageData {
  const where = buildWhere(ledgerId, filter);
  const countRow = db
    .prepare<{ count: number; total_text: string | null }>(
      `SELECT COUNT(*) AS count, CAST(COALESCE(SUM(t.amount_fen), 0) AS TEXT) AS total_text
         FROM "transaction" t WHERE ${where.sql}`,
    )
    .get(...where.params);
  const totalCount = countRow?.count ?? 0;
  const filteredTotalFen = normalizeFenString(countRow?.total_text ?? null);

  const rows =
    page.limit > 0
      ? db
          .prepare<TransactionRow>(
            `SELECT ${TX_COLUMNS}
               FROM "transaction" t
              WHERE ${where.sql}
              ORDER BY ${LIST_ORDER}
              LIMIT ? OFFSET ?`,
          )
          .all(...where.params, page.limit, page.offset)
      : [];

  const pageDates = [...new Set(rows.map((row) => row.occurred_date))];
  const dateGroups: DateGroupView[] = [];
  if (pageDates.length > 0) {
    const placeholders = pageDates.map(() => '?').join(', ');
    const groupRows = db
      .prepare<{ occurred_date: string; count: number; total_text: string }>(
        `SELECT t.occurred_date AS occurred_date,
                COUNT(*) AS count,
                CAST(SUM(t.amount_fen) AS TEXT) AS total_text
           FROM "transaction" t
          WHERE ${where.sql} AND t.occurred_date IN (${placeholders})
          GROUP BY t.occurred_date
          ORDER BY t.occurred_date DESC`,
      )
      .all(...where.params, ...pageDates);
    for (const row of groupRows) {
      dateGroups.push({
        date: row.occurred_date,
        count: row.count,
        totalFen: normalizeFenString(row.total_text),
      });
    }
  }

  return { rows, totalCount, filteredTotalFen, dateGroups };
}

export function mapTransactionRows(rows: readonly TransactionRow[]) {
  return rows.map(mapTransaction);
}
