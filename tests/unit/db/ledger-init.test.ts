import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { SYSTEM_CATEGORIES, OTHER_CATEGORY_ID } from '../../../src/shared/categories';
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

afterEach(() => {
  for (const layout of layouts.splice(0)) cleanupLayout(layout);
});

describe('默认账本与 34 个分类的幂等初始化', () => {
  it('首次启动建立唯一默认账本、33+其他分类与 dataEpoch', () => {
    const layout = newLayout();
    const { clock } = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock));
    try {
      const view = store.ensureDefault();
      expect(view.readiness).toBe('ready');
      expect(view.ledger.name).toBe('默认账本');
      expect(view.ledger.currency).toBe('CNY');
      expect(view.ledger.timezone).toBe('Asia/Shanghai');
      expect(view.ledger.dataRevision).toBe(0);
      expect(view.categories).toHaveLength(34);
      expect(view.categories.map((category) => category.id).sort()).toEqual(
        SYSTEM_CATEGORIES.map((category) => category.id).sort(),
      );
      expect(view.categories.some((category) => category.id === 'nav_settings')).toBe(false);
      expect(view.categories.filter((category) => category.systemKey !== null)).toHaveLength(34);
      expect(view.categories.filter((category) => category.systemKey === null)).toHaveLength(0);
      const other = view.categories.find((category) => category.id === OTHER_CATEGORY_ID);
      expect(other?.protected).toBe(true);
      expect(other?.enabled).toBe(true);

      const snapshot = store.snapshot();
      expect(snapshot.ledgerCount).toBe(1);
      expect(snapshot.categoryCount).toBe(34);
      expect(snapshot.transactionCount).toBe(0);
      expect(snapshot.dbSchemaVersion).toBe(4);
      expect(snapshot.migrationState).toBe('clean');
      expect(snapshot.recoveryRequired).toBe(false);
      expect(snapshot.databaseRelativePath).toBe(
        `data/generations/${snapshot.generationId}/ledger.db`,
      );
      expect(snapshot.databaseExists).toBe(true);
      expect(existsSync(path.join(layout.root, 'data', 'active.json'))).toBe(true);
      expect(
        existsSync(path.join(layout.root, 'data', 'generations', snapshot.generationId, 'ledger.db')),
      ).toBe(true);
    } finally {
      closeQuietly(store);
    }
  });

  it('重复调用 ensureDefault 与重启不重复插入默认数据，也不覆盖改名/停用', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const first = LedgerStore.open(storeOptions(layout, clock.clock));
    let ledgerId: string;
    let epoch: string;
    try {
      for (let index = 0; index < 5; index += 1) {
        expect(first.ensureDefault().categories).toHaveLength(34);
      }
      ledgerId = first.snapshot().ledgerId;
      epoch = first.snapshot().dataEpoch;
    } finally {
      closeQuietly(first);
    }

    // 改名与停用后重启，初始化不得把种子重置回去。
    const second = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const rename = second.updateCategory(
        { id: 'cat_food', expectedVersion: 1, patch: { name: '用餐' } },
        '11111111-1111-4111-8111-111111111111',
      );
      expect(rename.category.name).toBe('用餐');
      second.disableCategory(
        { id: 'cat_shopping', expectedVersion: 1 },
        '22222222-2222-4222-8222-222222222222',
      );
    } finally {
      closeQuietly(second);
    }

    const third = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const view = third.ensureDefault();
      expect(third.snapshot().ledgerId).toBe(ledgerId);
      expect(third.snapshot().dataEpoch).toBe(epoch);
      expect(view.categories).toHaveLength(34);
      expect(view.categories.find((category) => category.id === 'cat_food')?.name).toBe('用餐');
      expect(view.categories.find((category) => category.id === 'cat_shopping')?.enabled).toBe(false);
      expect(view.categories.filter((category) => category.id === 'cat_food')).toHaveLength(1);
      expect(third.snapshot().ledgerCount).toBe(1);
    } finally {
      closeQuietly(third);
    }
  });

  it('数据库 schema 比应用新时拒绝启动，不初始化空库覆盖', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    const { databasePath } = store.diagnostics();
    closeQuietly(store);

    openWritable(databasePath, (db) => {
      db.prepare("UPDATE app_meta SET db_schema_version = 99 WHERE id = 'app'").run();
      db.pragma('user_version = 99');
    });

    expectAppError(() => LedgerStore.open(storeOptions(layout, clock.clock)), 'SCHEMA_TOO_NEW');
  });

  it('active.json 损坏时进入恢复而不是创建新空账本', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    const { databasePath } = store.diagnostics();
    closeQuietly(store);

    writeFileSync(path.join(layout.data, 'active.json'), '{not json', 'utf8');
    expectAppError(() => LedgerStore.open(storeOptions(layout, clock.clock)), 'RECOVERY_REQUIRED');
    expect(existsSync(databasePath)).toBe(true);
  });

  it('存在 generation 但缺少 active 指针时拒绝自动选库', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    closeQuietly(store);
    rmSync(path.join(layout.data, 'active.json'));
    expectAppError(() => LedgerStore.open(storeOptions(layout, clock.clock)), 'RECOVERY_REQUIRED');
  });
});
