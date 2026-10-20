/**
 * 账本业务事务边界（docs/ARCHITECTURE.md §3/§5、docs/CONTRACTS.md §3）。
 *
 * 每个公开变更都在一个 BEGIN IMMEDIATE 事务内完成：幂等收据、业务校验、带 version 的写入、
 * 审计事件与 dataRevision 递增同事务提交；任一步失败全部回滚。读取不写库。
 *
 * 渲染层不能指定 source/sourceCandidateId/评分/状态：手工交易固定 source=manual；
 * AI 交易只能由内部批准路径（S11）以唯一 sourceCandidateId 插入。
 */

import { randomUUID } from 'node:crypto';
import { MAX_CATEGORIES } from '../../shared/constants';
import { SYSTEM_CATEGORIES } from '../../shared/categories';
import { isValidAmountFen } from '../../shared/amount';
import {
  isPrecisionConsistent,
  isRangeBoundary,
  isTransactionDate,
  isValidDateRange,
  isValidTimeString,
} from '../../shared/date';
import type {
  CategoryCreateInput,
  CategoryListResult,
  CategoryMutationResult,
  CategoryUpdateInput,
  DateGroupView,
  LedgerView,
  PageInput,
  TransactionFilter,
  TransactionInput,
  TransactionListInput,
  TransactionListResult,
  TransactionMutationResult,
  TransactionView,
} from '../../shared/entities';
import { AppError } from '../../shared/errors';
import { isCategoryIconKey } from '../../shared/icons';
import { checkOptionalText, checkRequiredText, normalizeNameKey, normalizeText } from '../../shared/text';
import { isSafeIntegerInRange } from '../../shared/validation';
import { insertAuditEvent, type AuditDiffEntry } from '../db/audit-repo';
import {
  countCategories,
  findCategoryByNormalizedName,
  getCategoryById,
  insertCategory,
  listCategories as listCategoryRows,
  maxSortOrder,
  updateCategoryWithVersion,
} from '../db/category-repo';
import { getDefaultLedger, insertDefaultLedger, readDataRevision } from '../db/ledger-repo';
import { findReceipt, insertReceipt } from '../db/receipt-repo';
import {
  mapCategory,
  mapLedger,
  mapTransaction,
  type CategoryRow as CategoryRowType,
} from '../db/rows';
import { runInTransaction, type SqliteDb } from '../db/sqlite';
import { queryTransactions } from '../db/transaction-query';
import {
  countTransactions,
  findTransactionByCandidateId,
  getTransactionById,
  insertTransaction,
  setTransactionDeletedAt,
  updateTransactionWithVersion,
  type TransactionFieldUpdate,
} from '../db/transaction-repo';
import { canonicalJson, hashPayload, shortHash } from './canonical';
import type { TokenCodec } from './signed-token';

export interface LedgerServiceContext {
  readonly db: SqliteDb;
  readonly ledgerId: string;
  readonly epoch: string;
  readonly clock: () => number;
  readonly cursorCodec: TokenCodec;
}

export interface ServiceResult<T> {
  readonly data: T;
  readonly revision: number;
  readonly replayed: boolean;
}

const MAX_VERSION = 2_147_483_647;
const CURSOR_TTL_MS = 5 * 60_000;

function nowIso(ctx: { readonly clock: () => number }): string {
  return new Date(ctx.clock()).toISOString();
}

function bumpRevision(db: SqliteDb, ledgerId: string, now: string): number {
  const current = readDataRevision(db, ledgerId);
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new AppError('INTEGRITY_ERROR', { details: { reason: 'REVISION_INVALID' } });
  }
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new AppError('COUNTER_EXHAUSTED', { details: { counter: 'dataRevision' } });
  }
  const result = db
    .prepare('UPDATE ledger SET data_revision = ?, updated_at = ? WHERE id = ?')
    .run(current + 1, now, ledgerId);
  if (result.changes !== 1) {
    throw new AppError('INTEGRITY_ERROR', { details: { reason: 'LEDGER_MISSING' } });
  }
  return current + 1;
}

function assertVersion(current: number, expected: number): void {
  if (current !== expected) {
    throw new AppError('VERSION_CONFLICT', { details: { currentVersion: current } });
  }
  if (current >= MAX_VERSION) {
    throw new AppError('VERSION_EXHAUSTED', { details: { currentVersion: current } });
  }
}

function fieldInvalid(path: string, code: string): AppError {
  return new AppError('FIELD_INVALID', { fieldErrors: [{ path, code }] });
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): AuditDiffEntry[] {
  const diff: AuditDiffEntry[] = [];
  for (const field of fields) {
    const beforeValue = before[field] ?? null;
    const afterValue = after[field] ?? null;
    if (!sameValue(beforeValue, afterValue)) {
      diff.push({ field, before: beforeValue, after: afterValue });
    }
  }
  return diff;
}

interface MutationOutcome<T> {
  readonly data: T;
  readonly resultIds: readonly string[];
  readonly resultType: string;
  /** false 表示没有实际变化（不递增 dataRevision）。 */
  readonly changed: boolean;
}

function runMutation<T extends { replayed: boolean; committedRevision: number }>(
  ctx: LedgerServiceContext,
  operation: string,
  mutationId: string | null,
  payload: unknown,
  compute: (now: string) => MutationOutcome<T>,
): ServiceResult<T> {
  if (mutationId === null || mutationId.length === 0) {
    throw new AppError('INTERNAL_ERROR', { details: { reason: 'MUTATION_ID_REQUIRED' } });
  }
  const payloadHash = hashPayload({ operation, payload });
  return runInTransaction(ctx.db, () => {
    const existing = findReceipt(ctx.db, ctx.ledgerId, operation, mutationId);
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        throw new AppError('IDEMPOTENCY_CONFLICT', { details: { operation } });
      }
      const stored = JSON.parse(existing.result_snapshot_json) as T & {
        committedRevision?: number;
      };
      const committedRevision =
        typeof stored.committedRevision === 'number'
          ? stored.committedRevision
          : existing.revision_at_commit;
      // 回放返回原提交的 committedRevision；当前账本水位由 store 独立读取，绝不写回。
      return {
        data: { ...stored, committedRevision, replayed: true },
        revision: committedRevision,
        replayed: true,
      };
    }
    const now = nowIso(ctx);
    const outcome = compute(now);
    const revision = outcome.changed
      ? bumpRevision(ctx.db, ctx.ledgerId, now)
      : readDataRevision(ctx.db, ctx.ledgerId);
    const data = { ...outcome.data, replayed: false, committedRevision: revision } as T;
    insertReceipt(ctx.db, {
      ledgerId: ctx.ledgerId,
      operation,
      mutationId,
      payloadHash,
      resultType: outcome.resultType,
      resultIds: outcome.resultIds,
      snapshot: data,
      revision,
      now,
    });
    return { data, revision, replayed: false };
  });
}

export function mapLedgerRow(row: NonNullable<ReturnType<typeof getDefaultLedger>>): LedgerView {
  return mapLedger(row);
}

/* ------------------------------------------------------------------ */
/* 默认账本与分类种子                                                   */
/* ------------------------------------------------------------------ */

export interface EnsuredLedger {
  readonly ledger: ReturnType<typeof getDefaultLedger>;
  readonly categories: CategoryRowType[];
}

/**
 * 幂等初始化：不同调用次数/重启/不同 mutationId 都只产生一个默认账本与一组 34 个系统分类。
 * 账本已存在时不做任何写入（不覆盖用户改名/停用状态），由完整性检查发现缺失种子。
 */
export function ensureDefaultLedger(db: SqliteDb, clock: () => number): EnsuredLedger {
  return runInTransaction(db, () => {
    const now = nowIso({ clock });
    let ledger = getDefaultLedger(db);
    if (!ledger) {
      const ledgerCount = db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM ledger').get();
      if ((ledgerCount?.count ?? 0) > 0) {
        throw new AppError('INTEGRITY_ERROR', { details: { reason: 'LEDGER_WITHOUT_DEFAULT_KEY' } });
      }
      insertDefaultLedger(db, { id: randomUUID(), name: '默认账本', now });
      ledger = getDefaultLedger(db);
      if (!ledger) throw new AppError('INTEGRITY_ERROR', { details: { reason: 'LEDGER_INSERT_FAILED' } });
      for (const seed of SYSTEM_CATEGORIES) {
        insertCategory(db, {
          id: seed.id,
          ledgerId: ledger.id,
          name: seed.name,
          normalizedName: normalizeNameKey(seed.name),
          iconKey: seed.iconKey,
          sortOrder: seed.sortOrder,
          enabled: seed.enabled,
          systemKey: seed.systemKey,
          now,
        });
      }
    }
    const categories = listCategoryRows(db, ledger.id, true);
    return { ledger, categories };
  });
}

export function readLedgerView(db: SqliteDb): LedgerView | null {
  const row = getDefaultLedger(db);
  return row ? mapLedger(row) : null;
}

export function readRevision(db: SqliteDb, ledgerId: string): number {
  return readDataRevision(db, ledgerId);
}

export function listCategories(ctx: LedgerServiceContext, includeDisabled: boolean): CategoryListResult {
  const rows = listCategoryRows(ctx.db, ctx.ledgerId, includeDisabled);
  return { categories: rows.map(mapCategory), revision: readDataRevision(ctx.db, ctx.ledgerId) };
}

function resolveCategoryName(raw: unknown): { name: string; normalizedName: string } {
  const check = checkRequiredText(raw, 20);
  if (!check.ok) {
    const code =
      check.code === 'TEXT_EMPTY'
        ? 'CATEGORY_NAME_REQUIRED'
        : check.code === 'TEXT_TOO_LONG'
          ? 'CATEGORY_NAME_TOO_LONG'
          : check.code;
    throw fieldInvalid('payload.name', code);
  }
  return { name: check.value, normalizedName: normalizeNameKey(check.value) };
}

function resolveIconKey(raw: unknown): string {
  if (!isCategoryIconKey(raw)) {
    throw new AppError('ICON_INVALID', { fieldErrors: [{ path: 'payload.iconKey', code: 'ICON_UNKNOWN' }] });
  }
  return raw;
}

function assertNameAvailable(
  db: SqliteDb,
  ledgerId: string,
  normalizedName: string,
  excludeId: string | null,
): void {
  if (findCategoryByNormalizedName(db, ledgerId, normalizedName, excludeId)) {
    throw new AppError('CATEGORY_NAME_EXISTS', {
      fieldErrors: [{ path: 'payload.name', code: 'NAME_TAKEN' }],
    });
  }
}

function nextCategorySortOrder(db: SqliteDb, ledgerId: string): number {
  const next = Math.max(350, maxSortOrder(db, ledgerId) + 10);
  if (next > 999_999) {
    throw new AppError('FIELD_INVALID', {
      fieldErrors: [{ path: 'payload.sortOrder', code: 'SORT_ORDER_EXHAUSTED' }],
    });
  }
  return next;
}

export function createCategory(
  ctx: LedgerServiceContext,
  input: CategoryCreateInput,
  mutationId: string | null,
): ServiceResult<CategoryMutationResult> {
  const { name, normalizedName } = resolveCategoryName(input.name);
  const iconKey = resolveIconKey(input.iconKey);
  if (input.sortOrder !== undefined && !isSafeIntegerInRange(input.sortOrder, 0, 999_999)) {
    throw fieldInvalid('payload.sortOrder', 'SORT_ORDER_INVALID');
  }
  return runMutation(ctx, 'category.create', mutationId, input, (now) => {
    if (countCategories(ctx.db, ctx.ledgerId) >= MAX_CATEGORIES) {
      throw new AppError('CATEGORY_LIMIT', { details: { maxCount: MAX_CATEGORIES } });
    }
    assertNameAvailable(ctx.db, ctx.ledgerId, normalizedName, null);
    const sortOrder = input.sortOrder ?? nextCategorySortOrder(ctx.db, ctx.ledgerId);
    const id = randomUUID();
    try {
      insertCategory(ctx.db, {
        id,
        ledgerId: ctx.ledgerId,
        name,
        normalizedName,
        iconKey,
        sortOrder,
        enabled: true,
        systemKey: null,
        now,
      });
    } catch (error) {
      const target = uniqueTarget(error);
      if (target.includes('normalized_name')) {
        throw new AppError('CATEGORY_NAME_EXISTS', {
          fieldErrors: [{ path: 'payload.name', code: 'NAME_TAKEN' }],
        });
      }
      throw error;
    }
    const row = getCategoryById(ctx.db, id);
    if (!row) throw new AppError('INTEGRITY_ERROR', { details: { reason: 'CATEGORY_MISSING_AFTER_INSERT' } });
    insertAuditEvent(ctx.db, {
      ledgerId: ctx.ledgerId,
      entityType: 'category',
      entityId: id,
      action: 'category.create',
      actor: 'local_user',
      diff: [
        { field: 'name', before: null, after: row.name },
        { field: 'iconKey', before: null, after: row.icon_key },
        { field: 'sortOrder', before: null, after: row.sort_order },
        { field: 'systemKey', before: null, after: null },
      ],
      mutationId,
      reason: null,
      now,
    });
    return {
      data: { category: mapCategory(row), replayed: false, committedRevision: 0 },
      resultIds: [id],
      resultType: 'category',
      changed: true,
    };
  });
}

export function updateCategory(
  ctx: LedgerServiceContext,
  input: CategoryUpdateInput,
  mutationId: string | null,
): ServiceResult<CategoryMutationResult> {
  const patch = input.patch;
  const nameCheck = 'name' in patch && patch.name !== undefined ? resolveCategoryName(patch.name) : null;
  const iconKey = 'iconKey' in patch && patch.iconKey !== undefined ? resolveIconKey(patch.iconKey) : null;
  if ('sortOrder' in patch && patch.sortOrder !== undefined && !isSafeIntegerInRange(patch.sortOrder, 0, 999_999)) {
    throw fieldInvalid('payload.patch.sortOrder', 'SORT_ORDER_INVALID');
  }
  if ('enabled' in patch && patch.enabled !== true) {
    throw fieldInvalid('payload.patch.enabled', 'USE_DISABLE_OPERATION');
  }
  return runMutation(ctx, 'category.update', mutationId, input, (now) => {
    const current = requireCategory(ctx.db, ctx.ledgerId, input.id);
    assertVersion(current.version, input.expectedVersion);
    const updates: Parameters<typeof updateCategoryWithVersion>[3] = {};
    let nextName = current.name;
    let nextNormalized = current.normalized_name;
    if (nameCheck) {
      if (nameCheck.normalizedName !== current.normalized_name || nameCheck.name !== current.name) {
        assertNameAvailable(ctx.db, ctx.ledgerId, nameCheck.normalizedName, current.id);
        updates.name = nameCheck.name;
        updates.normalizedName = nameCheck.normalizedName;
        nextName = nameCheck.name;
        nextNormalized = nameCheck.normalizedName;
      }
    }
    let nextIcon = current.icon_key;
    if (iconKey !== null && iconKey !== current.icon_key) {
      updates.iconKey = iconKey;
      nextIcon = iconKey;
    }
    let nextSort = current.sort_order;
    if (patch.sortOrder !== undefined && patch.sortOrder !== current.sort_order) {
      updates.sortOrder = patch.sortOrder;
      nextSort = patch.sortOrder;
    }
    let nextEnabled = current.enabled === 1;
    if (patch.enabled === true && current.enabled !== 1) {
      updates.enabled = true;
      nextEnabled = true;
    }
    if (Object.keys(updates).length === 0) {
      return {
        data: { category: mapCategory(current), replayed: false, committedRevision: 0 },
        resultIds: [current.id],
        resultType: 'category',
        changed: false,
      };
    }
    let updated: CategoryRowType | null;
    try {
      updated = updateCategoryWithVersion(ctx.db, current.id, input.expectedVersion, updates, now);
    } catch (error) {
      const target = uniqueTarget(error);
      if (target.includes('normalized_name')) {
        throw new AppError('CATEGORY_NAME_EXISTS', {
          fieldErrors: [{ path: 'payload.patch.name', code: 'NAME_TAKEN' }],
        });
      }
      throw error;
    }
    if (!updated) {
      const latest = getCategoryById(ctx.db, current.id);
      throw new AppError('VERSION_CONFLICT', { details: { currentVersion: latest?.version ?? current.version } });
    }
    insertAuditEvent(ctx.db, {
      ledgerId: ctx.ledgerId,
      entityType: 'category',
      entityId: current.id,
      action: 'category.update',
      actor: 'local_user',
      diff: diffFields(
        {
          name: current.name,
          normalizedName: current.normalized_name,
          iconKey: current.icon_key,
          sortOrder: current.sort_order,
          enabled: current.enabled === 1,
        },
        { name: nextName, normalizedName: nextNormalized, iconKey: nextIcon, sortOrder: nextSort, enabled: nextEnabled },
        ['name', 'iconKey', 'sortOrder', 'enabled'],
      ),
      mutationId,
      reason: null,
      now,
    });
    return {
      data: { category: mapCategory(updated), replayed: false, committedRevision: 0 },
      resultIds: [updated.id],
      resultType: 'category',
      changed: true,
    };
  });
}

export function disableCategory(
  ctx: LedgerServiceContext,
  input: { id: string; expectedVersion: number },
  mutationId: string | null,
): ServiceResult<CategoryMutationResult> {
  return runMutation(ctx, 'category.disable', mutationId, input, (now) => {
    const current = requireCategory(ctx.db, ctx.ledgerId, input.id);
    if (current.system_key === 'other') {
      throw new AppError('CATEGORY_PROTECTED', {
        fieldErrors: [{ path: 'payload.id', code: 'OTHER_CATEGORY_PROTECTED' }],
      });
    }
    assertVersion(current.version, input.expectedVersion);
    if (current.enabled !== 1) {
      return {
        data: { category: mapCategory(current), replayed: false, committedRevision: 0 },
        resultIds: [current.id],
        resultType: 'category',
        changed: false,
      };
    }
    const updated = updateCategoryWithVersion(
      ctx.db,
      current.id,
      input.expectedVersion,
      { enabled: false },
      now,
    );
    if (!updated) {
      const latest = getCategoryById(ctx.db, current.id);
      throw new AppError('VERSION_CONFLICT', { details: { currentVersion: latest?.version ?? current.version } });
    }
    insertAuditEvent(ctx.db, {
      ledgerId: ctx.ledgerId,
      entityType: 'category',
      entityId: current.id,
      action: 'category.disable',
      actor: 'local_user',
      diff: [{ field: 'enabled', before: true, after: false }],
      mutationId,
      reason: null,
      now,
    });
    return {
      data: { category: mapCategory(updated), replayed: false, committedRevision: 0 },
      resultIds: [updated.id],
      resultType: 'category',
      changed: true,
    };
  });
}

function requireCategory(db: SqliteDb, ledgerId: string, id: string): CategoryRowType {
  const row = getCategoryById(db, id);
  if (!row || row.ledger_id !== ledgerId) {
    throw new AppError('NOT_FOUND', { fieldErrors: [{ path: 'payload.id', code: 'CATEGORY_NOT_FOUND' }] });
  }
  return row;
}

function uniqueTarget(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  return String((error as { message?: unknown }).message ?? '');
}

/* ------------------------------------------------------------------ */
/* 正式交易                                                             */
/* ------------------------------------------------------------------ */

interface ResolvedTransactionFields {
  amountFen: number;
  occurredDate: string;
  occurredTime: string | null;
  timePrecision: 'date' | 'minute';
  name: string;
  categoryId: string;
  merchant: string | null;
  note: string | null;
}

function resolveTextFields(input: TransactionInput): Pick<ResolvedTransactionFields, 'name' | 'merchant' | 'note'> {
  const name = checkRequiredText(input.name, 100);
  if (!name.ok) {
    throw fieldInvalid(
      'payload.name',
      name.code === 'TEXT_EMPTY' ? 'NAME_REQUIRED' : name.code === 'TEXT_TOO_LONG' ? 'NAME_TOO_LONG' : name.code,
    );
  }
  const merchant = checkOptionalText(input.merchant, 100);
  if (!merchant.ok) throw fieldInvalid('payload.merchant', merchant.code);
  const note = checkOptionalText(input.note, 500, { allowLineBreaks: true });
  if (!note.ok) throw fieldInvalid('payload.note', note.code);
  return { name: name.value, merchant: merchant.value, note: note.value };
}

function resolveDateFields(input: TransactionInput): Pick<
  ResolvedTransactionFields,
  'occurredDate' | 'occurredTime' | 'timePrecision'
> {
  if (!isTransactionDate(input.occurredDate)) {
    throw new AppError('DATE_INVALID', {
      fieldErrors: [{ path: 'payload.occurredDate', code: 'TRANSACTION_DATE_INVALID' }],
    });
  }
  if (input.timePrecision === 'minute' && !isValidTimeString(input.occurredTime)) {
    throw new AppError('DATE_INVALID', {
      fieldErrors: [{ path: 'payload.occurredTime', code: 'OCCURRED_TIME_INVALID' }],
    });
  }
  if (!isPrecisionConsistent(input.timePrecision, input.occurredTime)) {
    throw fieldInvalid('payload.timePrecision', 'PRECISION_TIME_MISMATCH');
  }
  return {
    occurredDate: input.occurredDate,
    occurredTime: input.occurredTime,
    timePrecision: input.timePrecision,
  };
}

function resolveAmount(input: TransactionInput): number {
  if (!isValidAmountFen(input.amountFen)) {
    throw new AppError('AMOUNT_INVALID', {
      fieldErrors: [{ path: 'payload.amountFen', code: 'AMOUNT_RANGE' }],
    });
  }
  return input.amountFen;
}

function resolveCategoryForWrite(
  db: SqliteDb,
  ledgerId: string,
  categoryId: string,
  allowDisabled: boolean,
): string {
  const category = getCategoryById(db, categoryId);
  if (!category || category.ledger_id !== ledgerId) {
    throw new AppError('NOT_FOUND', {
      fieldErrors: [{ path: 'payload.categoryId', code: 'CATEGORY_NOT_FOUND' }],
    });
  }
  if (!allowDisabled && category.enabled !== 1) {
    throw new AppError('CATEGORY_DISABLED', {
      fieldErrors: [{ path: 'payload.categoryId', code: 'CATEGORY_DISABLED' }],
    });
  }
  return category.id;
}

export function validateTransactionInput(
  db: SqliteDb,
  ledgerId: string,
  input: TransactionInput,
  options: { readonly allowDisabledCategory?: boolean; readonly categoryUnchanged?: boolean } = {},
): ResolvedTransactionFields {
  return {
    amountFen: resolveAmount(input),
    ...resolveDateFields(input),
    ...resolveTextFields(input),
    categoryId:
      options.categoryUnchanged === true
        ? input.categoryId
        : resolveCategoryForWrite(db, ledgerId, input.categoryId, options.allowDisabledCategory === true),
  };
}

export function createManualTransaction(
  ctx: LedgerServiceContext,
  input: TransactionInput,
  mutationId: string | null,
): ServiceResult<TransactionMutationResult> {
  return runMutation(ctx, 'transaction.create', mutationId, input, (now) => {
    const fields = validateTransactionInput(ctx.db, ctx.ledgerId, input);
    const id = randomUUID();
    insertTransaction(ctx.db, {
      id,
      ledgerId: ctx.ledgerId,
      ...fields,
      source: 'manual',
      sourceCandidateId: null,
      now,
    });
    const row = getTransactionById(ctx.db, id);
    if (!row) throw new AppError('INTEGRITY_ERROR', { details: { reason: 'TRANSACTION_MISSING_AFTER_INSERT' } });
    insertAuditEvent(ctx.db, {
      ledgerId: ctx.ledgerId,
      entityType: 'transaction',
      entityId: id,
      action: 'transaction.create',
      actor: 'local_user',
      diff: diffFields(
        {},
        {
          amountFen: row.amount_fen,
          occurredDate: row.occurred_date,
          occurredTime: row.occurred_time,
          timePrecision: row.time_precision,
          name: row.name,
          categoryId: row.category_id,
          merchant: row.merchant,
          note: row.note,
          source: row.source,
        },
        [
          'amountFen',
          'occurredDate',
          'occurredTime',
          'timePrecision',
          'name',
          'categoryId',
          'merchant',
          'note',
          'source',
        ],
      ),
      mutationId,
      reason: null,
      now,
    });
    return {
      data: { transaction: mapTransaction(row), replayed: false, committedRevision: 0 },
      resultIds: [id],
      resultType: 'transaction',
      changed: true,
    };
  });
}

const TRANSACTION_MUTABLE_FIELDS = [
  'amountFen',
  'occurredDate',
  'occurredTime',
  'timePrecision',
  'name',
  'categoryId',
  'merchant',
  'note',
] as const;

export function updateTransaction(
  ctx: LedgerServiceContext,
  input: { id: string; expectedVersion: number; patch: Partial<TransactionInput> },
  mutationId: string | null,
): ServiceResult<TransactionMutationResult> {
  const patch = input.patch;
  if (Object.keys(patch).length === 0) throw fieldInvalid('payload.patch', 'PATCH_EMPTY');
  for (const key of Object.keys(patch)) {
    if (!(TRANSACTION_MUTABLE_FIELDS as readonly string[]).includes(key)) {
      throw fieldInvalid('payload.patch', 'IMMUTABLE_FIELD');
    }
  }
  return runMutation(ctx, 'transaction.update', mutationId, input, (now) => {
    const current = requireTransaction(ctx.db, ctx.ledgerId, input.id);
    assertVersion(current.version, input.expectedVersion);
    if (current.deleted_at !== null) {
      throw new AppError('TRANSACTION_DELETED', { details: { reason: 'DELETED' } });
    }
    const categoryChanged =
      patch.categoryId !== undefined && patch.categoryId !== current.category_id;
    const mergedInput: TransactionInput = {
      amountFen: patch.amountFen ?? current.amount_fen,
      occurredDate: patch.occurredDate ?? current.occurred_date,
      occurredTime: patch.occurredTime !== undefined ? patch.occurredTime : current.occurred_time,
      timePrecision: patch.timePrecision ?? current.time_precision,
      name: patch.name ?? current.name,
      categoryId: patch.categoryId ?? current.category_id,
      merchant: patch.merchant !== undefined ? patch.merchant : current.merchant,
      note: patch.note !== undefined ? patch.note : current.note,
    };
    const fields = validateTransactionInput(ctx.db, ctx.ledgerId, mergedInput, {
      allowDisabledCategory: !categoryChanged,
      categoryUnchanged: !categoryChanged,
    });
    const update: TransactionFieldUpdate = {};
    if (fields.amountFen !== current.amount_fen) update.amountFen = fields.amountFen;
    if (fields.occurredDate !== current.occurred_date) update.occurredDate = fields.occurredDate;
    if (fields.occurredTime !== current.occurred_time) update.occurredTime = fields.occurredTime;
    if (fields.timePrecision !== current.time_precision) update.timePrecision = fields.timePrecision;
    if (fields.name !== current.name) update.name = fields.name;
    if (fields.categoryId !== current.category_id) update.categoryId = fields.categoryId;
    if (fields.merchant !== current.merchant) update.merchant = fields.merchant;
    if (fields.note !== current.note) update.note = fields.note;

    if (Object.keys(update).length === 0) {
      return {
        data: { transaction: mapTransaction(current), replayed: false, committedRevision: 0 },
        resultIds: [current.id],
        resultType: 'transaction',
        changed: false,
      };
    }

    const updated = updateTransactionWithVersion(ctx.db, current.id, input.expectedVersion, update, now);
    if (!updated) {
      const latest = getTransactionById(ctx.db, current.id);
      throw new AppError('VERSION_CONFLICT', { details: { currentVersion: latest?.version ?? current.version } });
    }
    insertAuditEvent(ctx.db, {
      ledgerId: ctx.ledgerId,
      entityType: 'transaction',
      entityId: current.id,
      action: 'transaction.update',
      actor: 'local_user',
      diff: diffFields(
        {
          amountFen: current.amount_fen,
          occurredDate: current.occurred_date,
          occurredTime: current.occurred_time,
          timePrecision: current.time_precision,
          name: current.name,
          categoryId: current.category_id,
          merchant: current.merchant,
          note: current.note,
        },
        {
          amountFen: updated.amount_fen,
          occurredDate: updated.occurred_date,
          occurredTime: updated.occurred_time,
          timePrecision: updated.time_precision,
          name: updated.name,
          categoryId: updated.category_id,
          merchant: updated.merchant,
          note: updated.note,
        },
        [...TRANSACTION_MUTABLE_FIELDS],
      ),
      mutationId,
      reason: null,
      now,
    });
    return {
      data: { transaction: mapTransaction(updated), replayed: false, committedRevision: 0 },
      resultIds: [updated.id],
      resultType: 'transaction',
      changed: true,
    };
  });
}

export function softDeleteTransaction(
  ctx: LedgerServiceContext,
  input: { id: string; expectedVersion: number },
  mutationId: string | null,
): ServiceResult<TransactionMutationResult> {
  return runMutation(ctx, 'transaction.softDelete', mutationId, input, (now) => {
    const current = requireTransaction(ctx.db, ctx.ledgerId, input.id);
    assertVersion(current.version, input.expectedVersion);
    if (current.deleted_at !== null) {
      throw new AppError('STATE_CONFLICT', { details: { reason: 'ALREADY_DELETED' } });
    }
    const updated = setTransactionDeletedAt(ctx.db, current.id, input.expectedVersion, now, now);
    if (!updated) {
      const latest = getTransactionById(ctx.db, current.id);
      throw new AppError('VERSION_CONFLICT', { details: { currentVersion: latest?.version ?? current.version } });
    }
    insertAuditEvent(ctx.db, {
      ledgerId: ctx.ledgerId,
      entityType: 'transaction',
      entityId: current.id,
      action: 'transaction.softDelete',
      actor: 'local_user',
      diff: [{ field: 'deletedAt', before: null, after: now }],
      mutationId,
      reason: null,
      now,
    });
    return {
      data: { transaction: mapTransaction(updated), replayed: false, committedRevision: 0 },
      resultIds: [updated.id],
      resultType: 'transaction',
      changed: true,
    };
  });
}

export function restoreTransaction(
  ctx: LedgerServiceContext,
  input: { id: string; expectedVersion: number },
  mutationId: string | null,
): ServiceResult<TransactionMutationResult> {
  return runMutation(ctx, 'transaction.restore', mutationId, input, (now) => {
    const current = requireTransaction(ctx.db, ctx.ledgerId, input.id);
    assertVersion(current.version, input.expectedVersion);
    if (current.deleted_at === null) {
      throw new AppError('STATE_CONFLICT', { details: { reason: 'NOT_DELETED' } });
    }
    const updated = setTransactionDeletedAt(ctx.db, current.id, input.expectedVersion, null, now);
    if (!updated) {
      const latest = getTransactionById(ctx.db, current.id);
      throw new AppError('VERSION_CONFLICT', { details: { currentVersion: latest?.version ?? current.version } });
    }
    insertAuditEvent(ctx.db, {
      ledgerId: ctx.ledgerId,
      entityType: 'transaction',
      entityId: current.id,
      action: 'transaction.restore',
      actor: 'local_user',
      diff: [{ field: 'deletedAt', before: current.deleted_at, after: null }],
      mutationId,
      reason: null,
      now,
    });
    return {
      data: { transaction: mapTransaction(updated), replayed: false, committedRevision: 0 },
      resultIds: [updated.id],
      resultType: 'transaction',
      changed: true,
    };
  });
}

function requireTransaction(db: SqliteDb, ledgerId: string, id: string): NonNullable<ReturnType<typeof getTransactionById>> {
  const row = getTransactionById(db, id);
  if (!row || row.ledger_id !== ledgerId) {
    throw new AppError('NOT_FOUND', { fieldErrors: [{ path: 'payload.id', code: 'TRANSACTION_NOT_FOUND' }] });
  }
  return row;
}

export interface AiTransactionInput extends TransactionInput {
  readonly sourceCandidateId: string;
}

/**
 * S11 批准路径的内部入口：唯一 sourceCandidateId 是第二道幂等兜底。
 * 已存在关联（含软删）时返回原交易，绝不插入第二笔；尚未暴露给 IPC。
 */
export function createAiTransaction(
  ctx: LedgerServiceContext,
  input: AiTransactionInput,
): { readonly transaction: TransactionView; readonly revision: number; readonly alreadyExisted: boolean } {
  if (!isSafeIntegerInRange(input.amountFen, 1, 999_999_999)) {
    throw new AppError('AMOUNT_INVALID', { fieldErrors: [{ path: 'payload.amountFen', code: 'AMOUNT_RANGE' }] });
  }
  if (typeof input.sourceCandidateId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.sourceCandidateId)) {
    throw new AppError('FIELD_INVALID', {
      fieldErrors: [{ path: 'sourceCandidateId', code: 'EXPECTED_ID' }],
    });
  }
  return runInTransaction(ctx.db, () => {
    const existing = findTransactionByCandidateId(ctx.db, input.sourceCandidateId);
    if (existing) {
      return { transaction: mapTransaction(existing), revision: readDataRevision(ctx.db, ctx.ledgerId), alreadyExisted: true };
    }
    const fields = validateTransactionInput(ctx.db, ctx.ledgerId, input);
    const now = nowIso(ctx);
    const id = randomUUID();
    try {
      insertTransaction(ctx.db, {
        id,
        ledgerId: ctx.ledgerId,
        ...fields,
        source: 'ai',
        sourceCandidateId: input.sourceCandidateId,
        now,
      });
    } catch (error) {
      const target = uniqueTarget(error);
      if (target.includes('source_candidate_id') || target.includes('ux_transaction_candidate')) {
        const raced = findTransactionByCandidateId(ctx.db, input.sourceCandidateId);
        if (raced) {
          return {
            transaction: mapTransaction(raced),
            revision: readDataRevision(ctx.db, ctx.ledgerId),
            alreadyExisted: true,
          };
        }
      }
      throw error;
    }
    const row = getTransactionById(ctx.db, id);
    if (!row) throw new AppError('INTEGRITY_ERROR', { details: { reason: 'TRANSACTION_MISSING_AFTER_INSERT' } });
    insertAuditEvent(ctx.db, {
      ledgerId: ctx.ledgerId,
      entityType: 'transaction',
      entityId: id,
      action: 'transaction.aiApprove',
      actor: 'system',
      diff: [
        { field: 'amountFen', before: null, after: row.amount_fen },
        { field: 'occurredDate', before: null, after: row.occurred_date },
        { field: 'source', before: null, after: row.source },
        { field: 'sourceCandidateId', before: null, after: row.source_candidate_id },
      ],
      mutationId: null,
      reason: null,
      now,
    });
    return { transaction: mapTransaction(row), revision: bumpRevision(ctx.db, ctx.ledgerId, now), alreadyExisted: false };
  });
}

/* ------------------------------------------------------------------ */
/* 列表查询                                                             */
/* ------------------------------------------------------------------ */

function normalizeFilter(filter: TransactionFilter): TransactionFilter {
  const dateStart = filter.dateStart ?? null;
  const dateEnd = filter.dateEnd ?? null;
  const deleted = filter.deleted ?? 'active';
  const rawCategoryIds = filter.categoryIds ?? [];
  const rawNameQuery = filter.nameQuery ?? null;
  if (!isRangeBoundary(dateStart, 'start')) {
    throw new AppError('DATE_INVALID', {
      fieldErrors: [{ path: 'payload.filter.dateStart', code: 'DATE_INVALID' }],
    });
  }
  if (!isRangeBoundary(dateEnd, 'end')) {
    throw new AppError('DATE_INVALID', {
      fieldErrors: [{ path: 'payload.filter.dateEnd', code: 'DATE_INVALID' }],
    });
  }
  if (!isValidDateRange(dateStart, dateEnd)) {
    throw new AppError('RANGE_INVALID', {
      fieldErrors: [{ path: 'payload.filter.dateStart', code: 'RANGE_ORDER' }],
    });
  }
  if (deleted !== 'active' && deleted !== 'deleted' && deleted !== 'all') {
    throw fieldInvalid('payload.filter.deleted', 'EXPECTED_ACTIVE_DELETED_ALL');
  }
  if (!Array.isArray(rawCategoryIds) || rawCategoryIds.length > 500) {
    throw fieldInvalid('payload.filter.categoryIds', 'EXPECTED_ARRAY_MAX_500');
  }
  const ids: string[] = [];
  for (const id of rawCategoryIds) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw fieldInvalid('payload.filter.categoryIds', 'EXPECTED_ID');
    }
    ids.push(id);
  }
  let nameQuery: string | null = null;
  if (rawNameQuery !== null) {
    if (typeof rawNameQuery !== 'string') throw fieldInvalid('payload.filter.nameQuery', 'EXPECTED_STRING');
    const normalized = normalizeText(rawNameQuery);
    if ([...normalized].length > 100) {
      throw fieldInvalid('payload.filter.nameQuery', 'NAME_QUERY_TOO_LONG');
    }
    nameQuery = normalized.length === 0 ? null : normalized;
  }
  return {
    dateStart,
    dateEnd,
    categoryIds: [...new Set(ids)].sort(),
    nameQuery,
    deleted,
  };
}

function validatePage(page: PageInput): PageInput {
  const limit = page.limit ?? 50;
  const cursor = page.cursor ?? null;
  if (!isSafeIntegerInRange(limit, 1, 100)) {
    throw fieldInvalid('payload.page.limit', 'EXPECTED_LIMIT');
  }
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length > 2048)) {
    throw fieldInvalid('payload.page.cursor', 'CURSOR_INVALID');
  }
  return { limit, cursor };
}

function scopeHashOf(filter: TransactionFilter): string {
  return shortHash(
    {
      dateStart: filter.dateStart,
      dateEnd: filter.dateEnd,
      categoryIds: filter.categoryIds,
      nameQuery: filter.nameQuery,
      deleted: filter.deleted,
    },
    24,
  );
}

function decodeCursor(
  ctx: LedgerServiceContext,
  cursor: string,
  revision: number,
  scopeHash: string,
): number {
  const verified = ctx.cursorCodec.verify(cursor, 2048);
  if (!verified.ok) {
    throw new AppError('SNAPSHOT_STALE', {
      details: { reason: verified.reason === 'TOKEN_EXPIRED' ? 'CURSOR_EXPIRED' : 'CURSOR_INVALID' },
    });
  }
  const payload = verified.payload;
  if (
    payload.e !== ctx.epoch ||
    payload.r !== revision ||
    payload.s !== scopeHash ||
    typeof payload.o !== 'number' ||
    !Number.isSafeInteger(payload.o) ||
    payload.o < 0
  ) {
    throw new AppError('SNAPSHOT_STALE', { details: { reason: 'CURSOR_SCOPE_MISMATCH' } });
  }
  return payload.o;
}

export function listTransactions(
  ctx: LedgerServiceContext,
  input: TransactionListInput,
): TransactionListResult {
  const filter = normalizeFilter(input.filter);
  const page = validatePage(input.page);
  const revision = readDataRevision(ctx.db, ctx.ledgerId);
  const scopeHash = scopeHashOf(filter);
  const offset = page.cursor === null ? 0 : decodeCursor(ctx, page.cursor, revision, scopeHash);
  const pageData = queryTransactions(ctx.db, ctx.ledgerId, filter, { offset, limit: page.limit });
  const nextOffset = offset + pageData.rows.length;
  const nextCursor =
    nextOffset < pageData.totalCount
      ? ctx.cursorCodec.sign({
          v: 1,
          e: ctx.epoch,
          r: revision,
          s: scopeHash,
          o: nextOffset,
          x: ctx.clock() + CURSOR_TTL_MS,
        })
      : null;
  const dateGroups: DateGroupView[] = pageData.dateGroups;
  return {
    items: pageData.rows.map(mapTransaction),
    nextCursor,
    totalCount: pageData.totalCount,
    snapshotRevision: revision,
    filteredTotalFen: pageData.filteredTotalFen,
    dateGroups,
    filterEcho: filter,
  };
}

export const LEDGER_CONTRACT_VERSION = 'bookkeep.v1';

/** 供测试与恢复校验：统计当前账本正式交易数（含软删）。 */
export function countAllTransactions(db: SqliteDb, ledgerId: string): number {
  return countTransactions(db, ledgerId);
}
