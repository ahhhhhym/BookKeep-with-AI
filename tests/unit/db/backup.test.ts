import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { AppError } from '../../../src/shared/errors';
import {
  cleanupLayout,
  closeQuietly,
  createTestLayout,
  fixedClock,
  openWritable,
  readBackupIdOfKind,
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
  return `30000000-0000-4000-8000-${String(mutationCounter).padStart(12, '0')}`;
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function countTransactions(store: LedgerStore): number {
  return store.snapshot().transactionCount;
}

afterEach(() => {
  for (const layout of layouts.splice(0)) cleanupLayout(layout);
});

describe('备份创建与清单', () => {
  it('创建一致快照：记录 completed、档案存在、hash 可复算，重复 mutationId 回放原结果', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      store.createTransaction(transactionInput({ amountFen: 480 }), mutationId());
      const key = mutationId();
      const result = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        key,
      );
      expect(result.record.status).toBe('completed');
      expect(result.record.kind).toBe('manual');
      expect(result.record.artifact?.sha256).toMatch(/^[0-9a-f]{64}$/);
      const archivePath = store.diagnostics().backupPathOf(result.record.id);
      expect(existsSync(archivePath)).toBe(true);
      expect(sha256File(archivePath)).toBe(result.record.artifact?.sha256);
      expect(statSync(archivePath).size).toBe(result.record.artifact?.byteSize);
      expect(archivePath.startsWith(path.join(layout.backups))).toBe(true);

      const replay = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        key,
      );
      expect(replay.replayed).toBe(true);
      expect(replay.record.id).toBe(result.record.id);
      expect(store.listBackups().records).toHaveLength(1);
    } finally {
      closeQuietly(store);
    }
  });
});

describe('备份恢复：校验、切换、epoch 与失败保护', () => {
  it('恢复回滚数据并更换 dataEpoch，保留 pre_restore 与旧 generation；重启保持新状态', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let oldEpoch: string;
    let oldGeneration: string;
    let backupId: string;
    let restoreToken: string;
    let archiveHash: string;
    try {
      const backupSource = store.createTransaction(transactionInput({ amountFen: 96530 }), mutationId());
      const backup = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        mutationId(),
      );
      backupId = backup.record.id;
      archiveHash = backup.record.artifact?.sha256 ?? '';
      store.createTransaction(transactionInput({ amountFen: 100, name: '备份后新增' }), mutationId());
      expect(countTransactions(store)).toBe(2);

      const preview = store.previewRestore(backupId);
      expect(preview.archiveHash).toBe(archiveHash);
      expect(preview.dbSchemaVersion).toBe(2);
      expect(preview.schemaCompatibility).toBe('current');
      expect(preview.snapshotRevision).toBe(1);
      expect(preview.lastAppliedRestoreId).toBeNull();
      restoreToken = preview.restoreToken;

      oldEpoch = store.snapshot().dataEpoch;
      oldGeneration = store.snapshot().generationId;
      const restored = store.restoreBackup(
        { mode: 'commit', restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');
      expect(restored.newDataEpoch).not.toBe(oldEpoch);
      expect(restored.appliedBackupHash).toBe(archiveHash);
      expect(restored.ledgerId).toBe(store.snapshot().ledgerId);
      expect(restored.preRestoreBackupId).toMatch(/^[0-9a-f-]{36}$/);
      expect(store.snapshot().dataEpoch).toBe(restored.newDataEpoch);
      expect(store.snapshot().generationId).not.toBe(oldGeneration);
      expect(store.snapshot().transactionCount).toBe(1);
      expect(store.snapshot().recoveryRequired).toBe(false);
      const list = store.listBackups().records;
      expect(list.some((record) => record.kind === 'pre_restore')).toBe(true);
      expect(list.some((record) => record.id === backupSource.transaction.id)).toBe(false);
      // 旧 generation 目录与被替换前的 data 均保留。
      expect(
        existsSync(path.join(layout.data, 'generations', oldGeneration, 'ledger.db')),
      ).toBe(true);
    } finally {
      closeQuietly(store);
    }

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      expect(reopened.snapshot().dataEpoch).not.toBe(oldEpoch);
      expect(reopened.snapshot().transactionCount).toBe(1);
      expect(reopened.snapshot().recoveryRequired).toBe(false);
      expect(reopened.snapshot().generationId).not.toBe(oldGeneration);
      expect(readBackupIdOfKind(reopened, 'pre_restore')).not.toBeNull();
    } finally {
      closeQuietly(reopened);
    }
  });

  it('档案被篡改时 hash 不符拒绝恢复，当前数据不变', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      store.createTransaction(transactionInput(), mutationId());
      const backup = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        mutationId(),
      );
      const preview = store.previewRestore(backup.record.id);
      const archivePath = store.diagnostics().backupPathOf(backup.record.id);
      const bytes = readFileSync(archivePath);
      bytes[bytes.length - 1] = bytes[bytes.length - 1] ^ 0xff;
      writeFileSync(archivePath, bytes);

      expectAppError(() => store.previewRestore(backup.record.id), 'HASH_MISMATCH');
      expectAppError(
        () =>
          store.restoreBackup(
            { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
            mutationId(),
          ),
        'HASH_MISMATCH',
      );
      expect(countTransactions(store)).toBe(1);
      expect(store.snapshot().recoveryRequired).toBe(false);
    } finally {
      closeQuietly(store);
    }
  });

  it('记录 hash 与损坏档案一致时仍拒绝（非 SQLite/完整性失败），不覆盖当前数据', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      store.createTransaction(transactionInput(), mutationId());
      const backup = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        mutationId(),
      );
      const archivePath = store.diagnostics().backupPathOf(backup.record.id);
      writeFileSync(archivePath, 'this is not a sqlite archive');
      const forgedHash = sha256File(archivePath);
      openWritable(store.diagnostics().databasePath, (db) => {
        db.prepare('UPDATE backup_record SET archive_hash = ? WHERE id = ?').run(
          forgedHash,
          backup.record.id,
        );
      });
      expectAppError(() => store.previewRestore(backup.record.id), 'BACKUP_INVALID');
      expect(countTransactions(store)).toBe(1);
    } finally {
      closeQuietly(store);
    }
  });

  it('归档 schema 比应用新时拒绝恢复（SCHEMA_TOO_NEW），当前数据不变', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    let backupId: string;
    let databasePath: string;
    let archivePath: string;
    try {
      store.createTransaction(transactionInput(), mutationId());
      const backup = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        mutationId(),
      );
      backupId = backup.record.id;
      databasePath = store.diagnostics().databasePath;
      archivePath = store.diagnostics().backupPathOf(backupId);
    } finally {
      closeQuietly(store);
    }

    openWritable(archivePath, (db) => {
      db.prepare("UPDATE app_meta SET db_schema_version = 99 WHERE id = 'app'").run();
    });
    const forgedHash = sha256File(archivePath);
    openWritable(databasePath, (db) => {
      db.prepare('UPDATE backup_record SET archive_hash = ? WHERE id = ?').run(forgedHash, backupId);
    });
    // 同步伪造独立目录，使“档案/DB/目录一致性”成立，从而测到 schema 检查而不是 hash 冲突分支。
    const catalogPath = path.join(layout.backups, 'catalog.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = catalog.entries.find((item) => item.id === backupId);
    if (!entry) throw new Error('catalog entry missing');
    entry.archiveHash = forgedHash;
    entry.integrity = 'ok';
    entry.conflictCode = null;
    entry.conflictingHash = null;
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

    const reopened = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      expectAppError(() => reopened.previewRestore(backupId), 'SCHEMA_TOO_NEW');
      expect(reopened.snapshot().transactionCount).toBe(1);
    } finally {
      closeQuietly(reopened);
    }
  });

  it('预览后数据变化使 restoreToken 失效；当前数据不被覆盖', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      store.createTransaction(transactionInput(), mutationId());
      const backup = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        mutationId(),
      );
      const preview = store.previewRestore(backup.record.id);
      store.createTransaction(transactionInput({ name: '预览后新增' }), mutationId());
      const error = expectAppError(
        () =>
          store.restoreBackup(
            { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
            mutationId(),
          ),
        'TOKEN_EXPIRED',
      );
      expect(error.details.reason).toBe('RESTORE_CONTEXT_STALE');
      expect(countTransactions(store)).toBe(2);
    } finally {
      closeQuietly(store);
    }
  });

  it('不存在的 backupId 预览返回 NOT_FOUND', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      expectAppError(
        () => store.previewRestore('00000000-0000-4000-8000-000000000099'),
        'NOT_FOUND',
      );
    } finally {
      closeQuietly(store);
    }
  });

  it('截断档案在预览阶段拒绝，且不生成半恢复 generation', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const store = LedgerStore.open(storeOptions(layout, clock.clock));
    try {
      store.createTransaction(transactionInput(), mutationId());
      const backup = store.createBackup(
        { kind: 'manual', containsPrivateDataAcknowledged: true },
        mutationId(),
      );
      const archivePath = store.diagnostics().backupPathOf(backup.record.id);
      truncateSync(archivePath, 128);
      expectAppError(() => store.previewRestore(backup.record.id), 'HASH_MISMATCH');
      expect(store.snapshot().transactionCount).toBe(1);
    } finally {
      closeQuietly(store);
    }
  });
});
