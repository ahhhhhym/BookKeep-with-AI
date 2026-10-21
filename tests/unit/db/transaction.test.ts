import { afterEach, describe, expect, it } from 'vitest';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { AppError } from '../../../src/shared/errors';
import type { TransactionInput } from '../../../src/shared/entities';
import {
  cleanupLayout,
  closeQuietly,
  createTestLayout,
  fixedClock,
  openReadOnly,
  openWritable,
  storeOptions,
  transactionInput,
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
  return `10000000-0000-4000-8000-${String(mutationCounter).padStart(12, '0')}`;
}

function activeFilter(overrides: Record<string, unknown> = {}) {
  return {
    filter: {
      dateStart: null,
      dateEnd: null,
      categoryIds: [] as string[],
      nameQuery: null,
      deleted: 'active' as const,
      ...overrides,
    },
    page: { limit: 100, cursor: null },
  };
}

afterEach(() => {
  for (const layout of layouts.splice(0)) cleanupLayout(layout);
});

describe('正式交易：金额、日期精度、来源与审计', () => {
  it('接受 0.01 元与上限金额，拒绝 0/负数/小数/超上限且不产生半条记录', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const minimal = store.createTransaction(transactionInput({ amountFen: 1 }), mutationId());
      expect(minimal.transaction.amountFen).toBe(1);
      const maximum = store.createTransaction(
        transactionInput({ amountFen: 999_999_999, name: '上限' }),
        mutationId(),
      );
      expect(maximum.transaction.amountFen).toBe(999_999_999);

      for (const amountFen of [0, -1, 1.5, 1_000_000_000, Number.NaN, Number.POSITIVE_INFINITY]) {
        expectAppError(
          () => store.createTransaction(transactionInput({ amountFen }), mutationId()),
          'AMOUNT_INVALID',
        );
      }
      expect(store.snapshot().transactionCount).toBe(2);
      expect(store.listTransactions(activeFilter()).totalCount).toBe(2);
    } finally {
      closeQuietly(store);
    }
  });

  it('日期必须真实且落在 1900-01-01～9998-12-31；精度与时刻一致', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      for (const occurredDate of ['2026-02-30', '2026-13-01', '1899-12-31', '9999-01-01', '2026-9-8']) {
        expectAppError(
          () => store.createTransaction(transactionInput({ occurredDate }), mutationId()),
          'DATE_INVALID',
        );
      }
      expectAppError(
        () =>
          store.createTransaction(
            transactionInput({ occurredTime: null, timePrecision: 'minute' }),
            mutationId(),
          ),
        'DATE_INVALID',
      );
      expectAppError(
        () =>
          store.createTransaction(
            transactionInput({ occurredTime: '12:00', timePrecision: 'date' }),
            mutationId(),
          ),
        'FIELD_INVALID',
      );
      expectAppError(
        () =>
          store.createTransaction(
            transactionInput({ occurredTime: '24:00', timePrecision: 'minute' }),
            mutationId(),
          ),
        'DATE_INVALID',
      );
      const dated = store.createTransaction(
        transactionInput({ occurredDate: '9998-12-31', occurredTime: null, timePrecision: 'date' }),
        mutationId(),
      );
      expect(dated.transaction.occurredDate).toBe('9998-12-31');
      expect(store.snapshot().transactionCount).toBe(1);
    } finally {
      closeQuietly(store);
    }
  });

  it('名称 NFC/去空白；空名称与超长/控制字符拒绝；手工来源固定 manual 且无候选关联', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const created = store.createTransaction(
        transactionInput({ name: '  Coffee  ', merchant: '  测试店  ', note: '  第一行\n第二行\tTab  ' }),
        mutationId(),
      );
      expect(created.transaction.name).toBe('Coffee');
      expect(created.transaction.merchant).toBe('测试店');
      expect(created.transaction.note).toBe('第一行\n第二行\tTab');
      expect(created.transaction.source).toBe('manual');
      expect(created.transaction.sourceCandidateId).toBeNull();
      expect(created.transaction.currency).toBe('CNY');
      expect(created.transaction.version).toBe(1);
      expect(created.transaction.deletedAt).toBeNull();

      expectAppError(
        () => store.createTransaction(transactionInput({ name: '   ' }), mutationId()),
        'FIELD_INVALID',
      );
      expectAppError(
        () => store.createTransaction(transactionInput({ name: 'a'.repeat(101) }), mutationId()),
        'FIELD_INVALID',
      );
      expectAppError(
        () => store.createTransaction(transactionInput({ name: '换\n行' }), mutationId()),
        'FIELD_INVALID',
      );
      expectAppError(
        () => store.createTransaction(transactionInput({ categoryId: 'cat_missing' }), mutationId()),
        'NOT_FOUND',
      );
    } finally {
      closeQuietly(store);
    }
  });

  it('每个变更写审计事件并递增 dataRevision；失败不递增', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      expect(store.snapshot().dataRevision).toBe(0);
      const created = store.createTransaction(transactionInput(), mutationId());
      expect(store.snapshot().dataRevision).toBe(1);
      store.updateTransaction(
        { id: created.transaction.id, expectedVersion: 1, patch: { amountFen: 2000 } },
        mutationId(),
      );
      expect(store.snapshot().dataRevision).toBe(2);
      store.softDeleteTransaction({ id: created.transaction.id, expectedVersion: 2 }, mutationId());
      expect(store.snapshot().dataRevision).toBe(3);
      expectAppError(
        () =>
          store.updateTransaction(
            { id: created.transaction.id, expectedVersion: 3, patch: { name: 'x' } },
            mutationId(),
          ),
        'TRANSACTION_DELETED',
      );
      expect(store.snapshot().dataRevision).toBe(3);

      const events = openReadOnly(store.diagnostics().databasePath, (db) =>
        db
          .prepare<{ action: string }>(
            "SELECT action FROM audit_event WHERE entity_type = 'transaction' ORDER BY created_at, id",
          )
          .all()
          .map((row) => row.action),
      );
      expect(events).toEqual(['transaction.create', 'transaction.update', 'transaction.softDelete']);
    } finally {
      closeQuietly(store);
    }
  });
});

describe('版本冲突、软删除与恢复', () => {
  it('过期版本更新冲突并返回安全 currentVersion；删除/恢复各只生效一次', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const created = store.createTransaction(transactionInput(), mutationId());
      const updated = store.updateTransaction(
        { id: created.transaction.id, expectedVersion: 1, patch: { amountFen: 500 } },
        mutationId(),
      );
      expect(updated.transaction.version).toBe(2);
      const conflict = expectAppError(
        () =>
          store.updateTransaction(
            { id: created.transaction.id, expectedVersion: 1, patch: { amountFen: 600 } },
            mutationId(),
          ),
        'VERSION_CONFLICT',
      );
      expect(conflict.details).toEqual({ currentVersion: 2 });

      const deleted = store.softDeleteTransaction(
        { id: created.transaction.id, expectedVersion: 2 },
        mutationId(),
      );
      expect(deleted.transaction.deletedAt).not.toBeNull();
      expectAppError(
        () =>
          store.softDeleteTransaction(
            { id: created.transaction.id, expectedVersion: 3 },
            mutationId(),
          ),
        'STATE_CONFLICT',
      );
      expect(store.listTransactions(activeFilter()).totalCount).toBe(0);
      expect(store.listTransactions(activeFilter({ deleted: 'deleted' })).totalCount).toBe(1);
      expect(store.listTransactions(activeFilter({ deleted: 'all' })).totalCount).toBe(1);

      const restored = store.restoreTransaction(
        { id: created.transaction.id, expectedVersion: 3 },
        mutationId(),
      );
      expect(restored.transaction.deletedAt).toBeNull();
      expect(restored.transaction.version).toBe(4);
      expectAppError(
        () =>
          store.restoreTransaction(
            { id: created.transaction.id, expectedVersion: 4 },
            mutationId(),
          ),
        'STATE_CONFLICT',
      );
      expect(store.listTransactions(activeFilter()).totalCount).toBe(1);
    } finally {
      closeQuietly(store);
    }
  });

  it('停用分类后：不能新增或改选，但原交易编辑（不改类）与恢复软删仍可用', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const created = store.createTransaction(transactionInput(), mutationId());
      store.disableCategory({ id: 'cat_food', expectedVersion: 1 }, mutationId());
      expectAppError(
        () => store.createTransaction(transactionInput(), mutationId()),
        'CATEGORY_DISABLED',
      );
      // 原样保留停用分类（未改选）允许保存。
      const kept = store.updateTransaction(
        { id: created.transaction.id, expectedVersion: 1, patch: { categoryId: 'cat_food' } },
        mutationId(),
      );
      expect(kept.transaction.categoryId).toBe('cat_food');
      expect(kept.transaction.version).toBe(1);
      const edited = store.updateTransaction(
        { id: created.transaction.id, expectedVersion: 1, patch: { amountFen: 1900 } },
        mutationId(),
      );
      expect(edited.transaction.categoryId).toBe('cat_food');
      expect(edited.transaction.amountFen).toBe(1900);
      store.softDeleteTransaction({ id: created.transaction.id, expectedVersion: 2 }, mutationId());
      const restored = store.restoreTransaction(
        { id: created.transaction.id, expectedVersion: 3 },
        mutationId(),
      );
      expect(restored.transaction.categoryId).toBe('cat_food');
      // 改选到另一个停用分类会被拒绝。
      store.disableCategory({ id: 'cat_shopping', expectedVersion: 1 }, mutationId());
      expectAppError(
        () =>
          store.updateTransaction(
            { id: created.transaction.id, expectedVersion: 4, patch: { categoryId: 'cat_shopping' } },
            mutationId(),
          ),
        'CATEGORY_DISABLED',
      );
    } finally {
      closeQuietly(store);
    }
  });
});

describe('幂等收据与唯一候选关联', () => {
  it('同一 mutationId 重发返回原结果且不增加记录；改载荷报 IDEMPOTENCY_CONFLICT', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const key = mutationId();
      const payload = transactionInput();
      const first = store.createTransaction(payload, key);
      const revisionAfterFirst = store.snapshot().dataRevision;
      const replay = store.createTransaction(payload, key);
      expect(replay.replayed).toBe(true);
      expect(replay.transaction.id).toBe(first.transaction.id);
      expect(store.snapshot().transactionCount).toBe(1);
      expect(store.snapshot().dataRevision).toBe(revisionAfterFirst);

      expectAppError(
        () => store.createTransaction(transactionInput({ amountFen: 999 }), key),
        'IDEMPOTENCY_CONFLICT',
      );
      expect(store.snapshot().transactionCount).toBe(1);
      // 不复用 mutationId 的重复内容仍会创建新记录（由 UI 的按钮锁/提交键控制）。
      const second = store.createTransaction(payload, mutationId());
      expect(second.transaction.id).not.toBe(first.transaction.id);
      expect(store.snapshot().transactionCount).toBe(2);
    } finally {
      closeQuietly(store);
    }
  });

  it('S11 closes the legacy AI creation bypass; real review idempotence is covered by s11-review', () => {
    const layout = newLayout();
    const store = LedgerStore.open(storeOptions(layout, fixedClock().clock));
    try {
      expect(() => store.createAiTransaction({ ...transactionInput(), sourceCandidateId: 'c4010000-0000-4000-8000-000000000001' })).toThrowError('UNSUPPORTED');
      expect(store.snapshot().transactionCount).toBe(0);
    } finally { closeQuietly(store); }
  });
});

describe('列表查询边界：排序、筛选、分页与日期组', () => {
  function seed(store: LedgerStore): Record<string, string> {
    const ids: Record<string, string> = {};
    const rows: Array<[string, TransactionInput]> = [
      ['A', transactionInput({ occurredDate: '2026-09-08', occurredTime: '18:00', timePrecision: 'minute', amountFen: 1000, name: 'A' })],
      ['B', transactionInput({ occurredDate: '2026-09-08', occurredTime: null, timePrecision: 'date', amountFen: 1000, name: 'B' })],
      ['C', transactionInput({ occurredDate: '2026-09-08', occurredTime: '12:00', timePrecision: 'minute', amountFen: 2000, name: 'C' })],
      ['D', transactionInput({ occurredDate: '2026-09-09', occurredTime: null, timePrecision: 'date', amountFen: 3000, name: 'D' })],
      ['P', transactionInput({ occurredDate: '2026-09-10', name: '100%', amountFen: 100 })],
      ['Q', transactionInput({ occurredDate: '2026-09-10', name: 'a_b', amountFen: 200, categoryId: 'cat_fruit' })],
    ];
    for (const [label, input] of rows) {
      ids[label] = store.createTransaction(input, mutationId()).transaction.id;
    }
    return ids;
  }

  it('日期倒序、同日已知时刻在前且时刻降序、未知在后', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const ids = seed(store);
      const page = store.listTransactions(activeFilter({ dateStart: '2026-09-01', dateEnd: '2026-09-10' }));
      expect(page.items.map((item) => item.name)).toEqual(['D', 'A', 'C', 'B']);
      expect(page.items.map((item) => item.id)).toEqual([ids.D, ids.A, ids.C, ids.B]);
      expect(page.filteredTotalFen).toBe('7000');
      expect(page.totalCount).toBe(4);
    } finally {
      closeQuietly(store);
    }
  });

  it('分页无漏重、日期组小计覆盖整组筛选集合而非当前页', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      seed(store);
      const first = store.listTransactions({
        filter: { dateStart: '2026-09-01', dateEnd: '2026-09-10', categoryIds: [], nameQuery: null, deleted: 'active' },
        page: { limit: 2, cursor: null },
      });
      expect(first.items.map((item) => item.name)).toEqual(['D', 'A']);
      expect(first.nextCursor).not.toBeNull();
      expect(first.dateGroups).toEqual([
        { date: '2026-09-09', count: 1, totalFen: '3000' },
        { date: '2026-09-08', count: 3, totalFen: '4000' },
      ]);
      expect(first.filteredTotalFen).toBe('7000');

      const second = store.listTransactions({
        filter: { dateStart: '2026-09-01', dateEnd: '2026-09-10', categoryIds: [], nameQuery: null, deleted: 'active' },
        page: { limit: 2, cursor: first.nextCursor },
      });
      expect(second.items.map((item) => item.name)).toEqual(['C', 'B']);
      expect(second.nextCursor).toBeNull();
      const allIds = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(allIds).size).toBe(4);
    } finally {
      closeQuietly(store);
    }
  });

  it('名称搜索是字面子串（% 与 _ 不是通配符）且 ASCII 大小写不敏感', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      seed(store);
      const percent = store.listTransactions(activeFilter({ nameQuery: '%' }));
      expect(percent.items.map((item) => item.name)).toEqual(['100%']);
      const underscore = store.listTransactions(activeFilter({ nameQuery: '_' }));
      expect(underscore.items.map((item) => item.name)).toEqual(['a_b']);
      store.createTransaction(transactionInput({ name: 'Coffee', occurredDate: '2026-09-11' }), mutationId());
      const caseInsensitive = store.listTransactions(activeFilter({ nameQuery: 'COFFEE' }));
      expect(caseInsensitive.items.map((item) => item.name)).toEqual(['Coffee']);
    } finally {
      closeQuietly(store);
    }
  });

  it('日期范围为 start 包含/end 不包含；分类筛选与删除视图独立', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const ids = seed(store);
      const range = store.listTransactions(activeFilter({ dateStart: '2026-09-08', dateEnd: '2026-09-09' }));
      expect(range.items.map((item) => item.name)).toEqual(['A', 'C', 'B']);
      const category = store.listTransactions(activeFilter({ categoryIds: ['cat_fruit'] }));
      expect(category.items.map((item) => item.name)).toEqual(['a_b']);
      store.softDeleteTransaction({ id: ids.P, expectedVersion: 1 }, mutationId());
      expect(store.listTransactions(activeFilter()).items.some((item) => item.name === '100%')).toBe(false);
      expect(
        store
          .listTransactions(activeFilter({ deleted: 'deleted' }))
          .items.map((item) => item.name),
      ).toEqual(['100%']);
      expect(store.listTransactions(activeFilter({ deleted: 'all' })).totalCount).toBe(6);
    } finally {
      closeQuietly(store);
    }
  });

  it('非法筛选范围与过期游标被拒绝，不返回静默错页', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      seed(store);
      const filter = {
        dateStart: '2026-09-01',
        dateEnd: '2026-09-30',
        categoryIds: [],
        nameQuery: null,
        deleted: 'active' as const,
      };
      expectAppError(
        () => store.listTransactions({ filter: { ...filter, dateStart: '2026-09-30', dateEnd: '2026-09-01' }, page: { limit: 2, cursor: null } }),
        'RANGE_INVALID',
      );
      expectAppError(
        () => store.listTransactions({ filter: { ...filter, dateStart: '2026-02-30' }, page: { limit: 2, cursor: null } }),
        'DATE_INVALID',
      );
      expectAppError(
        () => store.listTransactions({ filter, page: { limit: 0, cursor: null } }),
        'FIELD_INVALID',
      );
      const first = store.listTransactions({ filter, page: { limit: 2, cursor: null } });
      expect(first.nextCursor).not.toBeNull();
      store.createTransaction(transactionInput({ occurredDate: '2026-09-11' }), mutationId());
      expectAppError(
        () => store.listTransactions({ filter, page: { limit: 2, cursor: first.nextCursor } }),
        'SNAPSHOT_STALE',
      );
    } finally {
      closeQuietly(store);
    }
  });
});

describe('重启持久化与审计不可变', () => {
  it('交易/版本/修订号/审计在重启后保持，不重复插入', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const first = LedgerStore.open(storeOptions(layout, clock.clock));
    let transactionId = '';
    try {
      transactionId = first.createTransaction(
        transactionInput({ amountFen: 480, name: '双荟', occurredTime: '18:00', timePrecision: 'minute' }),
        mutationId(),
      ).transaction.id;
      first.createTransaction(transactionInput({ amountFen: 1500, name: '晚餐' }), mutationId());
    } finally {
      closeQuietly(first);
    }

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      expect(reopened.snapshot().transactionCount).toBe(2);
      expect(reopened.snapshot().dataRevision).toBe(2);
      const list = reopened.listTransactions(activeFilter({}));
      expect(list.totalCount).toBe(2);
      expect(list.filteredTotalFen).toBe('1980');
      expect(list.items.map((item) => item.id)).toContain(transactionId);
      expect(list.items.find((item) => item.id === transactionId)?.amountFen).toBe(480);
    } finally {
      closeQuietly(reopened);
    }
  });

  it('审计事件与幂等收据为追加型：直接 UPDATE/DELETE 被数据库触发器拒绝', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      store.createTransaction(transactionInput(), mutationId());
      const { databasePath } = store.diagnostics();
      expect(() =>
        openWritable(databasePath, (db) => {
          db.prepare("UPDATE audit_event SET action = 'tampered'").run();
        }),
      ).toThrow();
      expect(() =>
        openWritable(databasePath, (db) => {
          db.prepare('DELETE FROM mutation_receipt').run();
        }),
      ).toThrow();
      expect(store.listTransactions(activeFilter({})).totalCount).toBe(1);
    } finally {
      closeQuietly(store);
    }
  });
});
