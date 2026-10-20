import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { AppError } from '../../../src/shared/errors';
import {
  cleanupLayout,
  closeQuietly,
  createTestLayout,
  fixedClock,
  openWritable,
  storeOptions,
} from './helpers';

const layouts: ReturnType<typeof createTestLayout>[] = [];

function newLayout() {
  const layout = createTestLayout();
  layouts.push(layout);
  return layout;
}

function expectAppError(fn: () => unknown, code: string): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`expected AppError ${code}`);
}

let mutationCounter = 0;
function mutationId(): string {
  mutationCounter += 1;
  return `00000000-0000-4000-8000-${String(mutationCounter).padStart(12, '0')}`;
}

afterEach(() => {
  for (const layout of layouts.splice(0)) cleanupLayout(layout);
});

describe('分类维护与引用安全', () => {
  it('新建自定义分类使用 UUID、systemKey=null、初始 sortOrder=350 并按 10 递增', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const first = store.createCategory({ name: '早餐', iconKey: 'lucide:utensils' }, mutationId());
      expect(first.category.systemKey).toBeNull();
      expect(first.category.protected).toBe(false);
      expect(first.category.enabled).toBe(true);
      expect(first.category.sortOrder).toBe(350);
      expect(first.category.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(first.replayed).toBe(false);

      const second = store.createCategory({ name: '咖啡', iconKey: 'lucide:cupcake' }, mutationId());
      expect(second.category.sortOrder).toBe(360);
      expect(second.category.id).not.toBe(first.category.id);
    } finally {
      closeQuietly(store);
    }
  });

  it('名称唯一包含停用项与 ASCII 大小写；非法图标拒绝且不写入', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const created = store.createCategory({ name: 'Coffee', iconKey: 'lucide:cupcake' }, mutationId());
      expectAppError(
        () => store.createCategory({ name: ' coffee ', iconKey: 'lucide:cupcake' }, mutationId()),
        'CATEGORY_NAME_EXISTS',
      );
      store.disableCategory({ id: created.category.id, expectedVersion: 1 }, mutationId());
      expectAppError(
        () => store.createCategory({ name: 'COFFEE', iconKey: 'lucide:cupcake' }, mutationId()),
        'CATEGORY_NAME_EXISTS',
      );
      expectAppError(
        () => store.createCategory({ name: '夜宵', iconKey: 'lucide:settings' }, mutationId()),
        'ICON_INVALID',
      );
      expect(store.listCategories(true).categories.filter((category) => category.name === '夜宵')).toHaveLength(0);
    } finally {
      closeQuietly(store);
    }
  });

  it('改名/换图标/排序不改分类 ID；旧交易仍引用原 ID；版本冲突返回安全 currentVersion', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const created = store.createTransaction(
        {
          amountFen: 480,
          occurredDate: '2026-09-27',
          occurredTime: '18:00',
          timePrecision: 'minute',
          name: '双荟',
          categoryId: 'cat_food',
          merchant: null,
          note: null,
        },
        mutationId(),
      );
      const originalCategoryId = created.transaction.categoryId;

      const renamed = store.updateCategory(
        { id: 'cat_food', expectedVersion: 1, patch: { name: '用餐', iconKey: 'lucide:cupcake' } },
        mutationId(),
      );
      expect(renamed.category.id).toBe('cat_food');
      expect(renamed.category.name).toBe('用餐');

      const transactions = store.listTransactions({
        filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' },
        page: { limit: 10, cursor: null },
      });
      expect(transactions.items[0]?.categoryId).toBe(originalCategoryId);
      expect(transactions.items[0]?.categoryId).toBe('cat_food');

      const conflict = expectAppError(
        () =>
          store.updateCategory(
            { id: 'cat_food', expectedVersion: 1, patch: { name: '再改名' } },
            mutationId(),
          ),
        'VERSION_CONFLICT',
      );
      expect(conflict.details.currentVersion).toBe(2);
    } finally {
      closeQuietly(store);
    }
  });

  it('“其他”按身份保护不可停用（改名后仍保护），可改名与换图标', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      expectAppError(
        () => store.disableCategory({ id: 'cat_other', expectedVersion: 1 }, mutationId()),
        'CATEGORY_PROTECTED',
      );
      const renamed = store.updateCategory(
        { id: 'cat_other', expectedVersion: 1, patch: { name: '杂项' } },
        mutationId(),
      );
      expect(renamed.category.protected).toBe(true);
      expectAppError(
        () => store.disableCategory({ id: 'cat_other', expectedVersion: 2 }, mutationId()),
        'CATEGORY_PROTECTED',
      );
    } finally {
      closeQuietly(store);
    }
  });

  it('停用后可通过 update enabled=true 重新启用', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const disabled = store.disableCategory({ id: 'cat_travel', expectedVersion: 1 }, mutationId());
      expect(disabled.category.enabled).toBe(false);
      const enabled = store.updateCategory(
        { id: 'cat_travel', expectedVersion: 2, patch: { enabled: true } },
        mutationId(),
      );
      expect(enabled.category.enabled).toBe(true);
      // 已停用时用不同键重复停用不递增版本（幂等语义，不是新变更）。
      const disabledAgain = store.disableCategory(
        { id: 'cat_travel', expectedVersion: 3 },
        mutationId(),
      );
      expect(disabledAgain.category.enabled).toBe(false);
      const stillDisabled = store.disableCategory(
        { id: 'cat_travel', expectedVersion: 4 },
        mutationId(),
      );
      expect(stillDisabled.category.version).toBe(4);
    } finally {
      closeQuietly(store);
    }
  });

  it('分类总数上限 500（含停用）时拒绝新建', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const snapshot = store.snapshot();
      openWritable(store.diagnostics().databasePath, (db) => {
        const insert = db.prepare(
          `INSERT INTO category
             (id, ledger_id, name, normalized_name, icon_key, sort_order, enabled, system_key,
              version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'lucide:ellipsis', ?, 1, NULL, 1, ?, ?)`,
        );
        db.exec('BEGIN');
        try {
          for (let index = 0; index < 466; index += 1) {
            const name = `容量${index}`;
            insert.run(randomUUID(), snapshot.ledgerId, name, name.toLowerCase(), 400 + index, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      expect(store.snapshot().categoryCount).toBe(500);
      expectAppError(
        () => store.createCategory({ name: '第五百零一', iconKey: 'lucide:ellipsis' }, mutationId()),
        'CATEGORY_LIMIT',
      );
    } finally {
      closeQuietly(store);
    }
  });
});
