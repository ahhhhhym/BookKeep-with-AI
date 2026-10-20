/**
 * S05-R2 回归：BK-S05-003（目录重建不得用档案当前 hash 覆盖已知原始基准）。
 *
 * 先于修复编写，用于记录修复前失败；修复后必须全部通过。
 * 组合序列使用真实 SQLite 档案与临时数据目录，不接触真实账本。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { AppError } from '../../../src/shared/errors';
import {
  cleanupLayout,
  closeQuietly,
  createTestLayout,
  fixedClock,
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
  return `91000000-0000-4000-8000-${String(mutationCounter).padStart(12, '0')}`;
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function catalogPath(layout: ReturnType<typeof createTestLayout>): string {
  return path.join(layout.backups, 'catalog.json');
}

interface CatalogDoc {
  manifestVersion: string;
  updatedAt: string;
  entries: Array<Record<string, unknown>>;
}

function readCatalog(layout: ReturnType<typeof createTestLayout>): CatalogDoc {
  return JSON.parse(readFileSync(catalogPath(layout), 'utf8')) as CatalogDoc;
}

function writeCatalog(layout: ReturnType<typeof createTestLayout>, doc: CatalogDoc): void {
  writeFileSync(catalogPath(layout), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

/** 用合法 SQLite 写操作改动档案中的一笔金额，保持 schema/引用/quick_check 合法。 */
function tamperArchiveAmount(filePath: string, amountFen: number): string {
  openWritable(filePath, (db) => {
    const row = db
      .prepare<{ id: string }>('SELECT id FROM "transaction" ORDER BY id LIMIT 1')
      .get();
    if (!row) throw new Error('archive has no transaction to tamper');
    db.prepare('UPDATE "transaction" SET amount_fen = ? WHERE id = ?').run(amountFen, row.id);
    const quick = db.prepare<{ quick_check: string }>('PRAGMA quick_check').all();
    if (!quick.every((entry) => entry.quick_check === 'ok')) {
      throw new Error('tampered archive failed quick_check');
    }
  });
  return hashFile(filePath);
}

interface SeededBackups {
  b1: string;
  b2: string;
  b1Name: string;
  b2Name: string;
  originalB2Hash: string;
}

function seedTwoBackups(store: LedgerStore): SeededBackups {
  store.createTransaction(transactionInput({ amountFen: 111, name: 'B1前' }), mutationId());
  const b1 = store.createBackup(
    { kind: 'manual', containsPrivateDataAcknowledged: true },
    mutationId(),
  ).record.id;
  store.createTransaction(transactionInput({ amountFen: 222, name: 'B2前' }), mutationId());
  const b2 = store.createBackup(
    { kind: 'manual', containsPrivateDataAcknowledged: true },
    mutationId(),
  ).record.id;
  const record = store.listBackups().records.find((item) => item.id === b2);
  if (!record?.archiveHash) throw new Error('missing B2 record');
  return { b1, b2, b1Name: 'B1前', b2Name: 'B2前', originalB2Hash: record.archiveHash };
}

function activeList(store: LedgerStore) {
  return store.listTransactions({
    filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' },
    page: { limit: 100, cursor: null },
  });
}

afterEach(() => {
  for (const layout of layouts.splice(0)) cleanupLayout(layout);
});

describe('BK-S05-003 目录重建的 hash 基准', () => {
  it('目录丢失后重建必须保留数据库原始 hash，不采纳档案当前 hash', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let ids: SeededBackups;
    try {
      ids = seedTwoBackups(store);
    } finally {
      closeQuietly(store);
    }
    const archivePath = store.diagnostics().backupPathOf(ids.b2);
    const tamperedHash = tamperArchiveAmount(archivePath, 7777);
    expect(tamperedHash).not.toBe(ids.originalB2Hash);
    rmSync(catalogPath(layout), { force: true });

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const catalog = readCatalog(layout);
      const entry = catalog.entries.find((item) => item.id === ids.b2);
      expect(entry?.archiveHash).toBe(ids.originalB2Hash);
      expectAppError(() => reopened.previewRestore(ids.b2), 'HASH_MISMATCH');
      expect(reopened.snapshot().transactionCount).toBe(2);
    } finally {
      closeQuietly(reopened);
    }
  });

  it('B1→B2→合法改 B2 金额→目录丢失→重启→恢复 B1→再预览 B2 仍拒绝', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let ids: SeededBackups;
    try {
      ids = seedTwoBackups(store);
    } finally {
      closeQuietly(store);
    }
    const tamperedHash = tamperArchiveAmount(store.diagnostics().backupPathOf(ids.b2), 8888);
    expect(tamperedHash).not.toBe(ids.originalB2Hash);
    rmSync(catalogPath(layout), { force: true });

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      // 恢复前：DB 仍保留原 hash，预览必须拒绝。
      expectAppError(() => reopened.previewRestore(ids.b2), 'HASH_MISMATCH');
      expect(activeList(reopened).totalCount).toBe(2);

      // 恢复未损坏的 B1；新 generation 没有 B2 记录，只能由目录重建。
      const preview = reopened.previewRestore(ids.b1);
      const restored = reopened.restoreBackup(
        { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');
      expect(activeList(reopened).totalCount).toBe(1);
      expect(activeList(reopened).items.map((item) => item.name)).toEqual([ids.b1Name]);

      // 恢复后：目录重建仍必须以 B2 原 hash 为基准，拒绝内容已变档案。
      expectAppError(() => reopened.previewRestore(ids.b2), 'HASH_MISMATCH');
      expect(activeList(reopened).totalCount).toBe(1);
      expect(activeList(reopened).items.map((item) => item.name)).toEqual([ids.b1Name]);

      // 未损坏的 B1 与 pre_restore 仍可正常预览。
      expect(reopened.previewRestore(ids.b1).backupId).toBe(ids.b1);
      expect(reopened.previewRestore(restored.preRestoreBackupId).backupId).toBe(
        restored.preRestoreBackupId,
      );
    } finally {
      closeQuietly(reopened);
    }
  });

  it('目录记录与 DB 记录 hash 冲突时明确标错并拒绝，不按读取顺序选择', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let ids: SeededBackups;
    try {
      ids = seedTwoBackups(store);
    } finally {
      closeQuietly(store);
    }

    const catalog = readCatalog(layout);
    const forged = 'a'.repeat(64);
    const entry = catalog.entries.find((item) => item.id === ids.b2);
    if (!entry) throw new Error('catalog entry missing');
    entry.archiveHash = forged;
    entry.origin = 'created';
    entry.integrity = 'ok';
    writeCatalog(layout, catalog);

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const record = reopened.listBackups().records.find((item) => item.id === ids.b2);
      expect(record).toBeDefined();
      expect(record?.artifact).toBeNull();
      expectAppError(() => reopened.previewRestore(ids.b2), 'BACKUP_INVALID');

      const preview = reopened.previewRestore(ids.b1);
      const restored = reopened.restoreBackup(
        { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');
      expectAppError(() => reopened.previewRestore(ids.b2), 'BACKUP_INVALID');
      expect(activeList(reopened).totalCount).toBe(1);
    } finally {
      closeQuietly(reopened);
    }
  });

  it('目录 JSON 损坏 + 档案内容已变：重启/恢复 B1 后仍以原 hash 拒绝 B2', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let ids: SeededBackups;
    try {
      ids = seedTwoBackups(store);
    } finally {
      closeQuietly(store);
    }
    tamperArchiveAmount(store.diagnostics().backupPathOf(ids.b2), 9999);
    writeFileSync(catalogPath(layout), '{broken catalog json', 'utf8');

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const catalog = readCatalog(layout);
      const entry = catalog.entries.find((item) => item.id === ids.b2);
      expect(entry?.archiveHash).toBe(ids.originalB2Hash);
      expectAppError(() => reopened.previewRestore(ids.b2), 'HASH_MISMATCH');

      const preview = reopened.previewRestore(ids.b1);
      const restored = reopened.restoreBackup(
        { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');
      expectAppError(() => reopened.previewRestore(ids.b2), 'HASH_MISMATCH');
      expect(activeList(reopened).totalCount).toBe(1);
    } finally {
      closeQuietly(reopened);
    }
  });

  it('运行中删除目录再恢复 B1：仍保留切换前账本的 B2 原 hash，拒绝改动档案', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let ids: SeededBackups;
    try {
      ids = seedTwoBackups(store);
    } finally {
      closeQuietly(store);
    }
    tamperArchiveAmount(store.diagnostics().backupPathOf(ids.b2), 6666);

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      const preview = reopened.previewRestore(ids.b1);
      // 运行中目录丢失；恢复切换仍须保留当前账本 DB 中的 B2 创建基准。
      rmSync(catalogPath(layout), { force: true });
      const restored = reopened.restoreBackup(
        { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');
      expectAppError(() => reopened.previewRestore(ids.b2), 'HASH_MISMATCH');
      expect(activeList(reopened).totalCount).toBe(1);
      const catalog = readCatalog(layout);
      const entry = catalog.entries.find((item) => item.id === ids.b2);
      expect(entry?.archiveHash).toBe(ids.originalB2Hash);
    } finally {
      closeQuietly(reopened);
    }
  });
});
