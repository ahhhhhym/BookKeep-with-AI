import { afterEach, describe, expect, it } from 'vitest';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { MIGRATIONS, migrateDatabase, readAppMeta, type Migration } from '../../../src/main/db/migrations';
import { AppError } from '../../../src/shared/errors';
import { CONTRACT_VERSION } from '../../../src/shared/constants';
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
  return `20000000-0000-4000-8000-${String(mutationCounter).padStart(12, '0')}`;
}

const V1 = MIGRATIONS[0];
const V2_GOOD: Migration = {
  version: 2,
  name: 'test-upgrade-flag',
  sql: 'ALTER TABLE ledger ADD COLUMN test_flag INTEGER NOT NULL DEFAULT 0;',
};
const V2_BAD: Migration = {
  version: 2,
  name: 'test-broken-upgrade',
  sql: 'ALTER TABLE ledger ADD COLUMN broken (;',
};

afterEach(() => {
  for (const layout of layouts.splice(0)) cleanupLayout(layout);
});

function migrationRows(store: LedgerStore | null, databasePath?: string) {
  const path = store ? store.diagnostics().databasePath : databasePath;
  if (!path) throw new Error('database path required');
  return openReadOnly(path, (db) =>
    db
      .prepare<{ to_version: number; status: string; error_code: string | null; backup_id: string | null }>(
        'SELECT to_version, status, error_code, backup_id FROM migration_record ORDER BY to_version, status',
      )
      .all(),
  );
}

describe('数据库迁移：版本、备份与失败恢复', () => {
  it('迁移记录与默认数据在多次重启后不重复插入', () => {
    const layout = newLayout();
    const clock = fixedClock();
    for (let round = 0; round < 3; round += 1) {
      const store = LedgerStore.open(storeOptions(layout, clock.clock, { migrations: [V1] }));
      try {
        expect(store.snapshot().categoryCount).toBe(34);
        expect(store.snapshot().ledgerCount).toBe(1);
        expect(store.snapshot().dbSchemaVersion).toBe(1);
      } finally {
        closeQuietly(store);
      }
    }
    const store = LedgerStore.open(storeOptions(layout, clock.clock, { migrations: [V1] }));
    try {
      const rows = migrationRows(store);
      expect(rows.filter((row) => row.to_version === 1 && row.status === 'completed')).toHaveLength(1);
    } finally {
      closeQuietly(store);
    }
  });

  it('升级前自动备份、升级后数据保留，且已应用版本不重复记录', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const first = LedgerStore.open(storeOptions(layout, clock.clock, { migrations: [V1] }));
    const { databasePath } = first.diagnostics();
    const created = first.createTransaction(transactionInput({ amountFen: 4426 }), mutationId());
    closeQuietly(first);

    const upgraded = LedgerStore.open(
      storeOptions(layout, clock.clock, { migrations: [V1, V2_GOOD] }),
    );
    try {
      expect(upgraded.snapshot().dbSchemaVersion).toBe(2);
      expect(upgraded.snapshot().transactionCount).toBe(1);
      expect(upgraded.snapshot().recoveryRequired).toBe(false);
      const backups = upgraded.listBackups();
      expect(backups.records.filter((record) => record.kind === 'pre_migration')).toHaveLength(1);
      const rows = migrationRows(upgraded);
      expect(rows.filter((row) => row.to_version === 2 && row.status === 'completed')).toHaveLength(1);
      const transactions = upgraded.listTransactions({
        filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' },
        page: { limit: 10, cursor: null },
      });
      expect(transactions.items[0]?.id).toBe(created.transaction.id);
    } finally {
      closeQuietly(upgraded);
    }

    const again = LedgerStore.open(
      storeOptions(layout, clock.clock, { migrations: [V1, V2_GOOD] }),
    );
    try {
      expect(again.snapshot().dbSchemaVersion).toBe(2);
      const rows = migrationRows(again);
      expect(rows.filter((row) => row.to_version === 2 && row.status === 'completed')).toHaveLength(1);
      expect(again.listBackups().records.filter((record) => record.kind === 'pre_migration')).toHaveLength(1);
    } finally {
      closeQuietly(again);
    }
    expect(databasePath).toContain('ledger.db');
  });

  it('迁移失败回滚并进入 recovery_required：旧数据可读、写入被拒绝、可恢复到迁移前备份', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const first = LedgerStore.open(storeOptions(layout, clock.clock, { migrations: [V1] }));
    const oldEpoch = first.snapshot().dataEpoch;
    const created = first.createTransaction(transactionInput({ amountFen: 3330 }), mutationId());
    closeQuietly(first);

    const broken = LedgerStore.open(
      storeOptions(layout, clock.clock, { migrations: [V1, V2_BAD] }),
    );
    let preMigrationBackupId: string;
    let failedEpoch: string;
    try {
      expect(broken.snapshot().recoveryRequired).toBe(true);
      expect(broken.snapshot().recoveryReason).toBe('MIGRATION_FAILED');
      expect(broken.snapshot().dbSchemaVersion).toBe(1);
      expect(broken.snapshot().transactionCount).toBe(1);
      expectAppError(
        () => broken.createTransaction(transactionInput(), mutationId()),
        'RECOVERY_REQUIRED',
      );
      // 旧数据仍可读，仍可列出/预览备份。
      expect(
        broken.listTransactions({
          filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' },
          page: { limit: 10, cursor: null },
        }).items[0]?.id,
      ).toBe(created.transaction.id);
      const rows = migrationRows(broken);
      const failed = rows.find((row) => row.status === 'failed');
      expect(failed?.error_code).toBe('MIGRATION_FAILED');
      expect(failed?.to_version).toBe(2);
      const backups = broken.listBackups().records.filter((record) => record.kind === 'pre_migration');
      expect(backups).toHaveLength(1);
      preMigrationBackupId = backups[0].id;
      failedEpoch = broken.snapshot().dataEpoch;
      expect(failedEpoch).toBe(oldEpoch);
    } finally {
      closeQuietly(broken);
    }

    // 用修复后的迁移版本重启：仍保持恢复模式，等待用户恢复。
    const stillBroken = LedgerStore.open(
      storeOptions(layout, clock.clock, { migrations: [V1, V2_GOOD] }),
    );
    try {
      expect(stillBroken.snapshot().recoveryRequired).toBe(true);
      expect(stillBroken.snapshot().dbSchemaVersion).toBe(1);
    } finally {
      closeQuietly(stillBroken);
    }

    // 恢复迁移前备份：staging 迁移到 v2，切换新 generation 与新 dataEpoch。
    const restoreStore = LedgerStore.open(
      storeOptions(layout, clock.clock, { migrations: [V1, V2_GOOD] }),
    );
    try {
      const preview = restoreStore.previewRestore(preMigrationBackupId);
      expect(preview.schemaCompatibility).toBe('needs_migration');
      expect(preview.dbSchemaVersion).toBe(1);
      const restored = restoreStore.restoreBackup(
        { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true },
        mutationId(),
      );
      if (!('newDataEpoch' in restored)) throw new Error('expected restore result');
      expect(restored.newDataEpoch).not.toBe(failedEpoch);
      expect(restoreStore.snapshot().recoveryRequired).toBe(false);
      expect(restoreStore.snapshot().dbSchemaVersion).toBe(2);
      expect(restoreStore.snapshot().transactionCount).toBe(1);
      expect(restoreStore.listBackups().records.some((record) => record.kind === 'pre_restore')).toBe(true);
      const rows = migrationRows(restoreStore);
      expect(rows.filter((row) => row.to_version === 2 && row.status === 'completed')).toHaveLength(1);
    } finally {
      closeQuietly(restoreStore);
    }
  });

  it('迁移事务中崩溃（state=migrating）在下次启动恢复为 clean 并继续迁移', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const first = LedgerStore.open(storeOptions(layout, clock.clock, { migrations: [V1] }));
    const { databasePath } = first.diagnostics();
    first.createTransaction(transactionInput({ amountFen: 1200 }), mutationId());
    closeQuietly(first);

    openWritable(databasePath, (db) => {
      db.prepare("UPDATE app_meta SET migration_state = 'migrating' WHERE id = 'app'").run();
    });

    const reopened = LedgerStore.open(
      storeOptions(layout, clock.clock, { migrations: [V1, V2_GOOD] }),
    );
    try {
      expect(reopened.snapshot().dbSchemaVersion).toBe(2);
      expect(reopened.snapshot().migrationState).toBe('clean');
      expect(reopened.snapshot().recoveryRequired).toBe(false);
      expect(reopened.snapshot().transactionCount).toBe(1);
      expect(migrationRows(reopened).filter((row) => row.status === 'completed')).toHaveLength(2);
    } finally {
      closeQuietly(reopened);
    }
  });

  it('迁移前备份失败时不执行迁移、不覆盖旧库，并标记 recovery_required', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const first = LedgerStore.open(storeOptions(layout, clock.clock, { migrations: [V1] }));
    const { databasePath } = first.diagnostics();
    closeQuietly(first);

    const result = openWritable(databasePath, (db) =>
      migrateDatabase(db, {
        contractVersion: CONTRACT_VERSION,
        appVersion: '0.1.0-test',
        clock: clock.clock,
        migrations: [V1, V2_GOOD],
        preMigrationBackup: () => null,
      }),
    );
    expect(result.state).toBe('recovery_required');
    expect(result.failure?.errorCode).toBe('BACKUP_FAILED');
    expect(result.toVersion).toBe(1);

    openReadOnly(databasePath, (db) => {
      const meta = readAppMeta(db);
      expect(meta?.dbSchemaVersion).toBe(1);
      expect(meta?.migrationState).toBe('recovery_required');
      const failed = db
        .prepare<{ error_code: string }>("SELECT error_code FROM migration_record WHERE status = 'failed'")
        .get();
      expect(failed?.error_code).toBe('BACKUP_FAILED');
      const ledger = db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM ledger').get();
      expect(ledger?.count).toBe(1);
    });
  });

  it('已应用迁移的 checksum 被篡改时拒绝启动（INTEGRITY_ERROR），不静默继续', () => {
    const layout = newLayout();
    const clock = fixedClock();
    const first = LedgerStore.open(storeOptions(layout, clock.clock, { migrations: [V1] }));
    const { databasePath } = first.diagnostics();
    closeQuietly(first);

    openWritable(databasePath, (db) => {
      // 模拟存储层被外部改写：追加型触发器仍在正常路径阻止 UPDATE，这里先移除以构造损坏。
      db.exec('DROP TRIGGER trg_migration_no_update');
      db.prepare("UPDATE migration_record SET checksum = ? WHERE to_version = 1 AND status = 'completed'").run(
        '0'.repeat(64),
      );
    });

    expectAppError(() => LedgerStore.open(storeOptions(layout, clock.clock, { migrations: [V1] })), 'INTEGRITY_ERROR');
  });
});
