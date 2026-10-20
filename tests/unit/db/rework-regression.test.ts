/**
 * S05-R1 回归：BK-S05-001（revision 分离/恢复令牌）与 BK-S05-002（备份目录保留）。
 *
 * 本文件先于修复编写，用于记录修复前失败；修复后必须全部通过。
 * 使用真实 SQLite 文件与临时数据目录，不写真实账本。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { AppError } from '../../../src/shared/errors';
import {
  cleanupLayout,
  closeQuietly,
  createTestLayout,
  fixedClock,
  openReadOnly,
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
  return `90000000-0000-4000-8000-${String(mutationCounter).padStart(12, '0')}`;
}

function activeFilter() {
  return {
    filter: {
      dateStart: null,
      dateEnd: null,
      categoryIds: [] as string[],
      nameQuery: null,
      deleted: 'active' as const,
    },
    page: { limit: 100, cursor: null },
  };
}

afterEach(() => {
  for (const layout of layouts.splice(0)) cleanupLayout(layout);
});

describe('BK-S05-001 回放旧收据不得回退当前 revision', () => {
  it('回放后当前 revision 保持持久水位；回放结果保留原 committedRevision', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const key = mutationId();
      const payload = transactionInput({ amountFen: 1800, name: 'A' });
      const first = store.createTransaction(payload, key);
      expect((first as { committedRevision?: number }).committedRevision).toBe(1);

      store.createTransaction(transactionInput({ amountFen: 2000, name: 'C' }), mutationId());
      expect(store.snapshot().dataRevision).toBe(2);

      const replay = store.createTransaction(payload, key);
      expect((replay as { committedRevision?: number }).committedRevision).toBe(1);
      expect(replay.transaction.id).toBe(first.transaction.id);
      // 关键：历史提交值不能写回当前水位。
      expect(store.snapshot().dataRevision).toBe(2);
      expect(store.currentRevision).toBe(2);
      expect(store.listTransactions(activeFilter()).snapshotRevision).toBe(2);

      const counts = openReadOnly(store.diagnostics().databasePath, (db) => ({
        receipts: db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM mutation_receipt').get()?.n ?? 0,
        createAudits:
          db
            .prepare<{ n: number }>(
              "SELECT COUNT(*) AS n FROM audit_event WHERE action = 'transaction.create'",
            )
            .get()?.n ?? 0,
      }));
      expect(counts.receipts).toBe(2);
      expect(counts.createAudits).toBe(2);
    } finally {
      closeQuietly(store);
    }
  });

  it('预览后新增数据并回放旧请求，旧恢复令牌仍必须失效且不覆盖新数据', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const key = mutationId();
      const payload = transactionInput({ amountFen: 1800, name: 'A' });
      store.createTransaction(payload, key);
      const backup = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        mutationId(),
      );
      const preview = store.previewRestore(backup.record.id);
      store.createTransaction(transactionInput({ amountFen: 2000, name: 'C' }), mutationId());
      store.createTransaction(payload, key);

      let rejected: AppError | null = null;
      try {
        store.restoreBackup(
          { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
          mutationId(),
        );
      } catch (error) {
        rejected = error as AppError;
      }
      expect(rejected?.code).toBe('TOKEN_EXPIRED');
      expect(rejected?.details.reason).toBe('RESTORE_CONTEXT_STALE');
      expect(store.snapshot().transactionCount).toBe(2);
      expect(store.snapshot().dataRevision).toBe(2);
    } finally {
      closeQuietly(store);
    }
  });

  it('连续回放、分类变更回放与重启回放都不改变当前水位、不重复写入', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const firstStore = LedgerStore.open(storeOptions(layout, clock.clock));
    let transactionKey = '';
    let transactionPayload = transactionInput();
    let categoryKey = '';
    try {
      transactionKey = mutationId();
      transactionPayload = transactionInput({ amountFen: 480, name: '双荟' });
      const created = firstStore.createTransaction(transactionPayload, transactionKey);
      expect((created as { committedRevision?: number }).committedRevision).toBe(1);

      categoryKey = mutationId();
      const renamed = firstStore.updateCategory(
        { id: 'cat_food', expectedVersion: 1, patch: { name: '用餐' } },
        categoryKey,
      );
      expect((renamed as { committedRevision?: number }).committedRevision).toBe(2);
      firstStore.createTransaction(transactionInput({ name: 'C' }), mutationId());
      expect(firstStore.snapshot().dataRevision).toBe(3);

      for (let index = 0; index < 3; index += 1) {
        const replay = firstStore.createTransaction(transactionPayload, transactionKey);
        expect((replay as { committedRevision?: number }).committedRevision).toBe(1);
        expect(firstStore.snapshot().dataRevision).toBe(3);
      }
      const categoryReplay = firstStore.updateCategory(
        { id: 'cat_food', expectedVersion: 1, patch: { name: '用餐' } },
        categoryKey,
      );
      expect((categoryReplay as { committedRevision?: number }).committedRevision).toBe(2);
      expect(categoryReplay.category.name).toBe('用餐');
      expect(firstStore.snapshot().dataRevision).toBe(3);
      expect(firstStore.snapshot().transactionCount).toBe(2);
      const counts = openReadOnly(firstStore.diagnostics().databasePath, (db) => ({
        receipts: db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM mutation_receipt').get()?.n ?? 0,
        audits: db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM audit_event').get()?.n ?? 0,
      }));
      expect(counts.receipts).toBe(3);
      // 1 次 ledger.initialize + 2 次 transaction.create + 1 次 category.update；回放不新增。
      expect(counts.audits).toBe(4);
    } finally {
      closeQuietly(firstStore);
    }

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const replayAfterRestart = reopened.createTransaction(transactionPayload, transactionKey);
      expect((replayAfterRestart as { committedRevision?: number }).committedRevision).toBe(1);
      expect(reopened.snapshot().dataRevision).toBe(3);
      expect(reopened.snapshot().transactionCount).toBe(2);
      const categoryReplay = reopened.updateCategory(
        { id: 'cat_food', expectedVersion: 1, patch: { name: '用餐' } },
        categoryKey,
      );
      expect((categoryReplay as { committedRevision?: number }).committedRevision).toBe(2);
    } finally {
      closeQuietly(reopened);
    }
  });
});

describe('BK-S05-002 恢复后备份目录仍可发现/校验/恢复', () => {
  it('恢复 B1 后 B1、B2 与 pre_restore 仍在列表中，且可再次预览/恢复 B2', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let b1: string;
    let b2: string;
    try {
      store.createTransaction(transactionInput({ amountFen: 100, name: 'B1前' }), mutationId());
      b1 = store.createBackup({ kind: 'manual', containsPrivateDataAcknowledged: true }, mutationId()).record.id;
      store.createTransaction(transactionInput({ amountFen: 200, name: 'B1后B2前' }), mutationId());
      b2 = store.createBackup({ kind: 'manual', containsPrivateDataAcknowledged: true }, mutationId()).record.id;

      const preview = store.previewRestore(b1);
      const restored = store.restoreBackup(
        { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');

      const ids = store.listBackups().records.map((record) => record.id);
      expect(ids).toContain(b1);
      expect(ids).toContain(b2);
      expect(ids).toContain(restored.preRestoreBackupId);
      expect(store.snapshot().transactionCount).toBe(1);

      const b2Preview = store.previewRestore(b2);
      expect(b2Preview.backupId).toBe(b2);
      const second = store.restoreBackup(
        { mode: 'commit', restoreToken: b2Preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in second)) throw new Error('expected restore result');
      expect(store.snapshot().transactionCount).toBe(2);
    } finally {
      closeQuietly(store);
    }
  });

  it('重启后备份目录保持，损坏档案在预览时拒绝且不覆盖当前数据', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let b1: string;
    let b2: string;
    let preRestore: string;
    try {
      store.createTransaction(transactionInput({ amountFen: 100, name: '一' }), mutationId());
      b1 = store.createBackup({ kind: 'manual', containsPrivateDataAcknowledged: true }, mutationId()).record.id;
      store.createTransaction(transactionInput({ amountFen: 200, name: '二' }), mutationId());
      b2 = store.createBackup({ kind: 'manual', containsPrivateDataAcknowledged: true }, mutationId()).record.id;
      const preview = store.previewRestore(b1);
      const restored = store.restoreBackup(
        { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');
      preRestore = restored.preRestoreBackupId;
    } finally {
      closeQuietly(store);
    }

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const ids = reopened.listBackups().records.map((record) => record.id);
      expect(ids).toContain(b1);
      expect(ids).toContain(b2);
      expect(ids).toContain(preRestore);
      const before = reopened.snapshot().transactionCount;

      const b2Path = reopened.diagnostics().backupPathOf(b2);
      const bytes = readFileSync(b2Path);
      bytes[bytes.length - 1] = bytes[bytes.length - 1] ^ 0xff;
      writeFileSync(b2Path, bytes);

      expectAppError(() => reopened.previewRestore(b2), 'HASH_MISMATCH');
      expect(reopened.snapshot().transactionCount).toBe(before);
      // 其他档案仍可正常预览。
      expect(reopened.previewRestore(b1).backupId).toBe(b1);
      expect(reopened.previewRestore(preRestore).backupId).toBe(preRestore);
    } finally {
      closeQuietly(reopened);
    }
  });

  it('外部 ledgerId 的档案可被发现/恢复，且只替换不合并交易', () => {
    const layoutA = newLayout();
    const layoutB = newLayout();
    const clock = fixedClock();
    const storeA = LedgerStore.open(storeOptions(layoutA, clock.clock));
    const storeB = LedgerStore.open(storeOptions(layoutB, clock.clock));
    let externalBackupId: string;
    let externalLedgerId: string;
    try {
      storeA.createTransaction(transactionInput({ amountFen: 1111, name: 'A账本交易' }), mutationId());
      storeB.createTransaction(transactionInput({ amountFen: 2222, name: 'B账本交易' }), mutationId());
      externalLedgerId = storeB.snapshot().ledgerId;
      externalBackupId = storeB.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        mutationId(),
      ).record.id;
      copyFileSync(
        storeB.diagnostics().backupPathOf(externalBackupId),
        storeA.diagnostics().backupPathOf(externalBackupId),
      );
    } finally {
      closeQuietly(storeB);
      closeQuietly(storeA);
    }

    const reopened = LedgerStore.open(storeOptions(layoutA, clock.clock));
    try {
      const ids = reopened.listBackups().records.map((record) => record.id);
      expect(ids).toContain(externalBackupId);
      const preview = reopened.previewRestore(externalBackupId);
      const restored = reopened.restoreBackup(
        { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');
      expect(reopened.snapshot().ledgerId).toBe(externalLedgerId);
      expect(reopened.snapshot().transactionCount).toBe(1);
      const items = reopened.listTransactions(activeFilter()).items;
      expect(items.map((item) => item.name)).toEqual(['B账本交易']);
      expect(items.some((item) => item.name === 'A账本交易')).toBe(false);
    } finally {
      closeQuietly(reopened);
    }
  });

  it('缺失档案仍保留目录条目但显示不可恢复，预览明确拒绝', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let backupId: string;
    try {
      store.createTransaction(transactionInput({ amountFen: 123, name: '缺失测试' }), mutationId());
      backupId = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        mutationId(),
      ).record.id;
    } finally {
      closeQuietly(store);
    }
    rmSync(store.diagnostics().backupPathOf(backupId));

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const record = reopened.listBackups().records.find((item) => item.id === backupId);
      expect(record).toBeDefined();
      expect(record?.artifact).toBeNull();
      expectAppError(() => reopened.previewRestore(backupId), 'BACKUP_INVALID');
      expect(reopened.snapshot().transactionCount).toBe(1);
    } finally {
      closeQuietly(reopened);
    }
  });

  it('独立目录可重建：catalog.json 丢失后重启仍能从档案恢复目录', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let b1: string;
    let b2: string;
    try {
      store.createTransaction(transactionInput({ amountFen: 100, name: '一' }), mutationId());
      b1 = store.createBackup({ kind: 'manual', containsPrivateDataAcknowledged: true }, mutationId()).record.id;
      b2 = store.createBackup({ kind: 'manual', containsPrivateDataAcknowledged: true }, mutationId()).record.id;
      const preview = store.previewRestore(b1);
      const restored = store.restoreBackup(
        { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');
    } finally {
      closeQuietly(store);
    }

    const catalogPath = path.join(layout.backups, 'catalog.json');
    rmSync(catalogPath, { force: true });
    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const ids = reopened.listBackups().records.map((record) => record.id);
      expect(ids).toContain(b1);
      expect(ids).toContain(b2);
      const rebuilt = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
        manifestVersion: string;
        entries: Array<{ id: string }>;
      };
      expect(rebuilt.manifestVersion).toBe('bk-backup-catalog.v1');
      expect(rebuilt.entries.map((entry) => entry.id)).toEqual(expect.arrayContaining([b1, b2]));
    } finally {
      closeQuietly(reopened);
    }
  });
});
