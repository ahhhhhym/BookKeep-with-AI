/** 分类仓储（docs/ARCHITECTURE.md §3.1）。 */

import type { SqliteDb } from './sqlite';
import type { CategoryRow } from './rows';

const CATEGORY_COLUMNS = `id, ledger_id, name, normalized_name, icon_key, sort_order, enabled,
       system_key, version, created_at, updated_at`;

export function listCategories(
  db: SqliteDb,
  ledgerId: string,
  includeDisabled: boolean,
): CategoryRow[] {
  const where = includeDisabled ? '' : ' AND enabled = 1';
  return db
    .prepare<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS} FROM category
        WHERE ledger_id = ?${where}
        ORDER BY sort_order ASC, id ASC`,
    )
    .all(ledgerId);
}

export function getCategoryById(db: SqliteDb, id: string): CategoryRow | null {
  const row = db
    .prepare<CategoryRow>(`SELECT ${CATEGORY_COLUMNS} FROM category WHERE id = ?`)
    .get(id);
  return row ?? null;
}

export function findCategoryByNormalizedName(
  db: SqliteDb,
  ledgerId: string,
  normalizedName: string,
  excludeId: string | null,
): CategoryRow | null {
  const row =
    excludeId === null
      ? db
          .prepare<CategoryRow>(
            `SELECT ${CATEGORY_COLUMNS} FROM category WHERE ledger_id = ? AND normalized_name = ?`,
          )
          .get(ledgerId, normalizedName)
      : db
          .prepare<CategoryRow>(
            `SELECT ${CATEGORY_COLUMNS} FROM category
              WHERE ledger_id = ? AND normalized_name = ? AND id <> ?`,
          )
          .get(ledgerId, normalizedName, excludeId);
  return row ?? null;
}

export function countCategories(db: SqliteDb, ledgerId: string): number {
  const row = db
    .prepare<{ count: number }>('SELECT COUNT(*) AS count FROM category WHERE ledger_id = ?')
    .get(ledgerId);
  return row?.count ?? 0;
}

export function maxSortOrder(db: SqliteDb, ledgerId: string): number {
  const row = db
    .prepare<{ max_order: number | null }>(
      'SELECT MAX(sort_order) AS max_order FROM category WHERE ledger_id = ?',
    )
    .get(ledgerId);
  return row?.max_order ?? 0;
}

export interface NewCategory {
  id: string;
  ledgerId: string;
  name: string;
  normalizedName: string;
  iconKey: string;
  sortOrder: number;
  enabled: boolean;
  systemKey: string | null;
  now: string;
}

export function insertCategory(db: SqliteDb, category: NewCategory): void {
  db.prepare(
    `INSERT INTO category
       (id, ledger_id, name, normalized_name, icon_key, sort_order, enabled, system_key,
        version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    category.id,
    category.ledgerId,
    category.name,
    category.normalizedName,
    category.iconKey,
    category.sortOrder,
    category.enabled ? 1 : 0,
    category.systemKey,
    category.now,
    category.now,
  );
}

export interface CategoryFieldUpdate {
  name?: string;
  normalizedName?: string;
  iconKey?: string;
  sortOrder?: number;
  enabled?: boolean;
}

/** 版本条件更新：返回最新行；0 行更新表示 VERSION_CONFLICT（由服务层判定）。 */
export function updateCategoryWithVersion(
  db: SqliteDb,
  id: string,
  expectedVersion: number,
  update: CategoryFieldUpdate,
  now: string,
): CategoryRow | null {
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (update.name !== undefined) {
    assignments.push('name = ?');
    values.push(update.name);
  }
  if (update.normalizedName !== undefined) {
    assignments.push('normalized_name = ?');
    values.push(update.normalizedName);
  }
  if (update.iconKey !== undefined) {
    assignments.push('icon_key = ?');
    values.push(update.iconKey);
  }
  if (update.sortOrder !== undefined) {
    assignments.push('sort_order = ?');
    values.push(update.sortOrder);
  }
  if (update.enabled !== undefined) {
    assignments.push('enabled = ?');
    values.push(update.enabled ? 1 : 0);
  }
  if (assignments.length === 0) return getCategoryById(db, id);
  assignments.push('version = version + 1');
  assignments.push('updated_at = ?');
  values.push(now);
  const result = db
    .prepare(
      `UPDATE category SET ${assignments.join(', ')}
        WHERE id = ? AND version = ? AND version < 2147483647`,
    )
    .run(...values, id, expectedVersion);
  if (result.changes !== 1) return null;
  return getCategoryById(db, id);
}

/** 系统分类种子是否齐全（恢复/启动完整性检查用）。 */
export function listSystemKeys(db: SqliteDb, ledgerId: string): string[] {
  return db
    .prepare<{ system_key: string }>(
      'SELECT system_key FROM category WHERE ledger_id = ? AND system_key IS NOT NULL ORDER BY system_key',
    )
    .all(ledgerId)
    .map((row) => row.system_key);
}
