/**
 * 账本存储生命周期（docs/ARCHITECTURE.md §7）。
 *
 * 启动顺序：解析/校验 active generation → 打开 SQLite（WAL/外键/忙等待）→ 迁移（升级前备份）
 * → 幂等默认账本与分类 → 业务完整性检查 → 提供仓储事务边界。恢复时关闭旧库、原子切换
 * active 指针、打开新库并更换 dataEpoch；旧 generation 与 pre_restore 快照保留。
 *
 * 迁移失败或完整性检查失败时仍可打开（只读恢复模式）：业务写入返回 RECOVERY_REQUIRED，
 * 查看与备份恢复仍可用，绝不静默创建空库覆盖旧数据。
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { CONTRACT_VERSION } from '../../shared/constants';
import type {
  BackupCreateInput,
  BackupCreateResult,
  BackupListResult,
  BackupRestoreInput,
  BackupRestorePreviewResult,
  BackupRestoreResult,
  CategoryCreateInput,
  CategoryListResult,
  CategoryMutationResult,
  CategoryUpdateInput,
  LedgerEnsureDefaultView,
  TransactionInput,
  TransactionListInput,
  TransactionListResult,
  TransactionMutationResult,
} from '../../shared/entities';
import { AppError } from '../../shared/errors';
import type { StorageLayout } from '../paths';
import { insertAuditEvent } from '../db/audit-repo';
import { countCategories } from '../db/category-repo';
import { collectBusinessViolations, summariseViolations } from '../db/integrity';
import { countLedgers, getDefaultLedger, readDataRevision } from '../db/ledger-repo';
import {
  MIGRATIONS,
  migrateDatabase,
  readAppMeta,
  updateAppMeta,
  type Migration,
  type MigrationState,
} from '../db/migrations';
import { insertReceipt } from '../db/receipt-repo';
import { mapCategory, mapLedger } from '../db/rows';
import { openSqlite, runInTransaction, type SqliteDb } from '../db/sqlite';
import { countTransactions } from '../db/transaction-repo';
import {
  ACTIVE_POINTER_VERSION,
  readActivePointer,
  writeActivePointer,
} from '../storage/active-pointer';
import {
  catalogEntryFromRow,
  mergeCatalogIntoDatabase,
  readBackupCatalog,
  reconcileBackupCatalog,
  upsertBackupCatalogEntries,
  type BackupCatalogEntry,
} from '../storage/backup-catalog';
import {
  backupArchivePath,
  ensureStorageDirectories,
  generationDatabasePath,
  storagePaths,
  type StoragePaths,
} from '../storage/layout';
import { readRestoreLog, appendRestoreLog } from '../storage/restore-log';
import {
  BackupService,
  copyBackupRecordToNewDatabase,
  createPreMigrationBackup,
  listBackupRows,
  getBackupRow, backupRecordView,
  type BackupEnvironment,
  type StagedRestorePlan,
} from './backup-service';
import { hashPayload } from './canonical';
import {
  createAiTransaction,
  createCategory,
  createManualTransaction,
  disableCategory,
  ensureDefaultLedger,
  listCategories,
  listTransactions,
  restoreTransaction,
  softDeleteTransaction,
  updateCategory,
  updateTransaction,
  type AiTransactionInput,
  type LedgerServiceContext,
  type ServiceResult,
} from './ledger-service';
import { createTokenCodec, type TokenCodec } from './signed-token';
import type { StatisticsInput, TopCategoriesInput, TopTransactionsInput } from '../../shared/statistics';
import { statisticsSeries, statisticsSummary, statisticsTopCategories, statisticsTopTransactions } from './statistics-service';

export interface LedgerStoreOptions {
  readonly layout: StorageLayout;
  readonly appVersion: string;
  readonly clock?: () => number;
  readonly migrations?: readonly Migration[];
  /** 仅测试注入；生产使用进程随机 secret，token 5 分钟有效。 */
  readonly tokenSecret?: Buffer;
  readonly fault?: (step: string) => void;
}

export interface LedgerStoreSnapshot {
  readonly generationId: string;
  readonly dbSchemaVersion: number;
  readonly ledgerId: string;
  readonly dataEpoch: string;
  readonly dataRevision: number;
  readonly categoryCount: number;
  readonly ledgerCount: number;
  readonly transactionCount: number;
  readonly migrationState: MigrationState;
  readonly recoveryRequired: boolean;
  readonly recoveryReason: string | null;
  readonly databaseRelativePath: string;
  readonly databaseExists: boolean;
}

function nowIso(clock: () => number): string {
  return new Date(clock()).toISOString();
}

function deriveSecret(secret: Buffer, purpose: string): Buffer {
  return createHash('sha256').update(secret).update(purpose).digest();
}

function generationDirectories(paths: StoragePaths): string[] {
  try {
    return readdirSync(paths.generations, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export class LedgerStore {
  private db: SqliteDb;
  private readonly paths: StoragePaths;
  private readonly appVersion: string;
  private readonly clock: () => number;
  private readonly migrations: readonly Migration[];
  private readonly latestSchemaVersion: number;
  private readonly cursorCodec: TokenCodec;
  private readonly tokenCodec: TokenCodec;
  private readonly backupService: BackupService;
  private generationId: string;
  private databasePath: string;
  private ledgerId: string;
  private epoch: string;
  private revision: number;
  private schemaVersion: number;
  private migrationState: MigrationState;
  private recoveryReason: string | null;
  private closed = false;
  private fault: ((step: string) => void) | undefined;

  private constructor(init: {
    db: SqliteDb;
    paths: StoragePaths;
    appVersion: string;
    clock: () => number;
    migrations: readonly Migration[];
    latestSchemaVersion: number;
    generationId: string;
    databasePath: string;
    ledgerId: string;
    epoch: string;
    revision: number;
    schemaVersion: number;
    migrationState: MigrationState;
    recoveryReason: string | null;
    tokenSecret: Buffer;
  }) {
    this.db = init.db;
    this.paths = init.paths;
    this.appVersion = init.appVersion;
    this.clock = init.clock;
    this.migrations = init.migrations;
    this.latestSchemaVersion = init.latestSchemaVersion;
    this.generationId = init.generationId;
    this.databasePath = init.databasePath;
    this.ledgerId = init.ledgerId;
    this.epoch = init.epoch;
    this.revision = init.revision;
    this.schemaVersion = init.schemaVersion;
    this.migrationState = init.migrationState;
    this.recoveryReason = init.recoveryReason;
    this.cursorCodec = createTokenCodec(deriveSecret(init.tokenSecret, 'cursor'), init.clock);
    this.tokenCodec = createTokenCodec(deriveSecret(init.tokenSecret, 'restore'), init.clock);
    this.backupService = new BackupService({
      env: () => this.backupEnvironment(),
      latestSchemaVersion: this.latestSchemaVersion,
      migrations: this.migrations,
      tokenCodec: this.tokenCodec,
      ledgerId: () => this.ledgerId,
      switchToStagedGeneration: (plan) => this.switchToStagedGeneration(plan),
    });
  }

  static open(options: LedgerStoreOptions): LedgerStore {
    const paths = storagePaths(options.layout);
    ensureStorageDirectories(paths);
    const clock = options.clock ?? Date.now;
    const migrations = options.migrations ?? MIGRATIONS;
    const latestSchemaVersion = migrations[migrations.length - 1]?.version ?? 0;
    if (latestSchemaVersion < 1) {
      throw new AppError('INTERNAL_ERROR', { details: { reason: 'NO_MIGRATIONS' } });
    }
    const tokenSecret = options.tokenSecret ?? randomBytes(32);
    const active = readActivePointer(paths);

    if (!active.ok && active.reason === 'INVALID') {
      throw new AppError('RECOVERY_REQUIRED', { details: { reason: 'ACTIVE_POINTER_INVALID' } });
    }

    let db: SqliteDb | null = null;
    let generationId: string;
    let databasePath: string;
    let migrationState: MigrationState = 'clean';
    let recoveryReason: string | null = null;
    let createdFresh = false;

    if (!active.ok) {
      if (generationDirectories(paths).length > 0) {
        throw new AppError('RECOVERY_REQUIRED', { details: { reason: 'ACTIVE_POINTER_MISSING' } });
      }
      generationId = randomUUID();
      databasePath = generationDatabasePath(paths, generationId);
      mkdirSync(path.dirname(databasePath), { recursive: true });
      createdFresh = true;
      try {
        db = openSqlite(databasePath);
        migrateDatabase(db, {
          contractVersion: CONTRACT_VERSION,
          appVersion: options.appVersion,
          clock,
          migrations,
          initialMeta: { generationId, dataEpoch: randomUUID() },
        });
        ensureDefaultLedger(db, clock);
        const violations = collectBusinessViolations(db);
        if (violations.length > 0) {
          throw new AppError('INTEGRITY_ERROR', { details: { reason: summariseViolations(violations) } });
        }
        const meta = readAppMeta(db);
        const ledger = getDefaultLedger(db);
        if (!meta || !ledger) {
          throw new AppError('INTEGRITY_ERROR', { details: { reason: 'INITIAL_META_OR_LEDGER_MISSING' } });
        }
        writeActivePointer(paths, {
          manifestVersion: ACTIVE_POINTER_VERSION,
          generationId,
          dbSchemaVersion: meta.dbSchemaVersion,
          ledgerId: ledger.id,
          dataEpoch: meta.dataEpoch,
          activatedAt: nowIso(clock),
          previousGenerationId: null,
          restoreId: null,
        });
      } catch (error) {
        try {
          db?.close();
        } catch {
          // ignore
        }
        // 全新初始化失败：删除仅本次创建的 generation，避免下次启动误判为“缺 active 指针”。
        try {
          rmSync(path.dirname(databasePath), { recursive: true, force: true });
        } catch {
          // ignore
        }
        throw error;
      }
    } else {
      generationId = active.pointer.generationId;
      databasePath = generationDatabasePath(paths, generationId);
      try {
        db = openSqlite(databasePath);
        const migration = migrateDatabase(db, {
          contractVersion: CONTRACT_VERSION,
          appVersion: options.appVersion,
          clock,
          migrations,
          preMigrationBackup: () =>
            createPreMigrationBackup({ db: db as SqliteDb, paths, appVersion: options.appVersion, clock }),
        });
        migrationState = migration.state;
        if (migration.state === 'recovery_required') {
          recoveryReason = migration.failure?.errorCode ?? 'MIGRATION_FAILED';
        } else {
          const violations = collectBusinessViolations(db);
          if (violations.length > 0) {
            migrationState = 'recovery_required';
            recoveryReason = summariseViolations(violations);
          }
        }
      } catch (error) {
        try {
          db?.close();
        } catch {
          // ignore
        }
        throw error;
      }
    }

    if (!db) throw new AppError('INTEGRITY_ERROR', { details: { reason: 'DATABASE_NOT_OPEN' } });
    const meta = readAppMeta(db);
    const ledger = getDefaultLedger(db);
    if (!meta || !ledger) {
      try {
        db.close();
      } catch {
        // ignore
      }
      throw new AppError('INTEGRITY_ERROR', { details: { reason: 'APP_META_OR_LEDGER_MISSING' } });
    }
    if (meta.activeGeneration !== generationId) {
      recoveryReason = recoveryReason ?? 'ACTIVE_GENERATION_MISMATCH';
      migrationState = 'recovery_required';
    }
    // active.json 中的 ledgerId/dataEpoch 只作启动提示；以数据库内 AppMeta/Ledger 为事实源。
    if (
      active.ok &&
      (active.pointer.dataEpoch !== meta.dataEpoch || active.pointer.ledgerId !== ledger.id)
    ) {
      try {
        writeActivePointer(paths, {
          manifestVersion: ACTIVE_POINTER_VERSION,
          generationId,
          dbSchemaVersion: meta.dbSchemaVersion,
          ledgerId: ledger.id,
          dataEpoch: meta.dataEpoch,
          activatedAt: nowIso(clock),
          previousGenerationId: active.pointer.previousGenerationId,
          restoreId: active.pointer.restoreId,
        });
      } catch {
        // 指针修复失败不影响本次只读事实；下次启动仍会复核。
      }
    }

    const store = new LedgerStore({
      db,
      paths,
      appVersion: options.appVersion,
      clock,
      migrations,
      latestSchemaVersion,
      generationId,
      databasePath,
      ledgerId: ledger.id,
      epoch: meta.dataEpoch,
      revision: ledger.data_revision,
      schemaVersion: meta.dbSchemaVersion,
      migrationState,
      recoveryReason,
      tokenSecret,
    });
    // 独立备份目录：先把当前 generation 的可信创建记录导入目录，再扫描未知档案。
    // 顺序不可颠倒：扫描得到的当前文件 hash 不能抢在 DB 原 hash 之前成为基准。
    try {
      const databaseEntries = listBackupRows(db)
        .map(catalogEntryFromRow)
        .filter((entry): entry is BackupCatalogEntry => entry !== null);
      upsertBackupCatalogEntries(paths, databaseEntries, nowIso(clock));
      reconcileBackupCatalog(paths, nowIso(clock));
      mergeCatalogIntoDatabase(db, ledger.id, readBackupCatalog(paths), nowIso(clock));
    } catch (error) {
      console.warn(
        '[bookkeep] backup catalog reconciliation skipped',
      );
    }
    store.fault = options.fault;
    if (createdFresh) {
      store.appendStartupAudit();
    }
    return store;
  }

  private appendStartupAudit(): void {
    try {
      insertAuditEvent(this.db, {
        ledgerId: this.ledgerId,
        entityType: 'ledger',
        entityId: this.ledgerId,
        action: 'ledger.initialize',
        actor: 'system',
        diff: [{ field: 'categoryCount', before: null, after: 34 }],
        mutationId: null,
        reason: null,
        now: nowIso(this.clock),
      });
    } catch {
      // 审计失败不阻止首次启动（迁移与默认账本已提交）。
    }
  }

  private backupEnvironment(): BackupEnvironment {
    return { db: this.db, paths: this.paths, appVersion: this.appVersion, clock: this.clock };
  }

  private context(): LedgerServiceContext {
    return {
      db: this.db,
      ledgerId: this.ledgerId,
      epoch: this.epoch,
      clock: this.clock,
      cursorCodec: this.cursorCodec,
    };
  }

  private assertOpen(): void {
    if (this.closed) throw new AppError('INTERNAL_ERROR', { details: { reason: 'STORE_CLOSED' } });
  }

  assertWritable(): void {
    this.assertOpen();
    if (this.recoveryReason !== null) {
      throw new AppError('RECOVERY_REQUIRED', { details: { reason: this.recoveryReason } });
    }
  }

  /** 当前水位只以持久 Ledger.dataRevision 为事实源；缓存仅作关闭/异常时兜底。 */
  private currentRevisionFromDb(): number {
    try {
      return readDataRevision(this.db, this.ledgerId);
    } catch {
      return this.revision;
    }
  }

  private trackMutation<T extends { replayed: boolean; committedRevision: number }>(
    result: ServiceResult<T>,
  ): T {
    // 回放返回历史 committedRevision，但当前水位必须重新读取持久值，绝不回退。
    this.revision = this.currentRevisionFromDb();
    return { ...result.data, replayed: result.replayed };
  }

  /** IPC 信封使用的轻量值，避免每次请求重算统计。 */
  get currentEpoch(): string {
    return this.epoch;
  }

  get currentRevision(): number {
    return this.currentRevisionFromDb();
  }

  get currentLedgerId(): string {
    return this.ledgerId;
  }

  snapshot(): LedgerStoreSnapshot {
    const databaseRelativePath = path
      .relative(this.paths.root, this.databasePath)
      .split(path.sep)
      .join('/');
    return {
      generationId: this.generationId,
      dbSchemaVersion: this.schemaVersion,
      ledgerId: this.ledgerId,
      dataEpoch: this.epoch,
      dataRevision: this.currentRevisionFromDb(),
      categoryCount: countCategories(this.db, this.ledgerId),
      ledgerCount: countLedgers(this.db),
      transactionCount: countTransactions(this.db, this.ledgerId),
      migrationState: this.migrationState,
      recoveryRequired: this.recoveryReason !== null,
      recoveryReason: this.recoveryReason,
      databaseRelativePath,
      databaseExists: existsSync(this.databasePath),
    };
  }

  /* ----------------------------- 账本与分类 ----------------------------- */

  ensureDefault(): LedgerEnsureDefaultView {
    this.assertOpen();
    if (this.recoveryReason !== null) {
      const ledger = getDefaultLedger(this.db);
      if (!ledger) throw new AppError('RECOVERY_REQUIRED', { details: { reason: this.recoveryReason } });
      return {
        ledger: mapLedger(ledger),
        categories: listCategories(this.context(), true).categories,
        readiness: 'recovery_required',
        dataEpoch: this.epoch,
      };
    }
    const ensured = ensureDefaultLedger(this.db, this.clock);
    if (!ensured.ledger) throw new AppError('INTEGRITY_ERROR', { details: { reason: 'LEDGER_MISSING' } });
    this.ledgerId = ensured.ledger.id;
    this.revision = readDataRevision(this.db, this.ledgerId);
    return {
      ledger: mapLedger(ensured.ledger),
      categories: ensured.categories.map(mapCategory),
      readiness: 'ready',
      dataEpoch: this.epoch,
    };
  }

  listCategories(includeDisabled: boolean): CategoryListResult {
    this.assertOpen();
    const result = listCategories(this.context(), includeDisabled);
    this.revision = result.revision;
    return result;
  }

  createCategory(input: CategoryCreateInput, mutationId: string | null): CategoryMutationResult {
    this.assertWritable();
    return this.trackMutation(createCategory(this.context(), input, mutationId));
  }

  updateCategory(input: CategoryUpdateInput, mutationId: string | null): CategoryMutationResult {
    this.assertWritable();
    return this.trackMutation(updateCategory(this.context(), input, mutationId));
  }

  disableCategory(
    input: { id: string; expectedVersion: number },
    mutationId: string | null,
  ): CategoryMutationResult {
    this.assertWritable();
    return this.trackMutation(disableCategory(this.context(), input, mutationId));
  }

  /* ------------------------------- 交易 -------------------------------- */

  createTransaction(input: TransactionInput, mutationId: string | null): TransactionMutationResult {
    this.assertWritable();
    return this.trackMutation(createManualTransaction(this.context(), input, mutationId));
  }

  updateTransaction(
    input: { id: string; expectedVersion: number; patch: Partial<TransactionInput> },
    mutationId: string | null,
  ): TransactionMutationResult {
    this.assertWritable();
    return this.trackMutation(updateTransaction(this.context(), input, mutationId));
  }

  softDeleteTransaction(
    input: { id: string; expectedVersion: number },
    mutationId: string | null,
  ): TransactionMutationResult {
    this.assertWritable();
    return this.trackMutation(softDeleteTransaction(this.context(), input, mutationId));
  }

  restoreTransaction(
    input: { id: string; expectedVersion: number },
    mutationId: string | null,
  ): TransactionMutationResult {
    this.assertWritable();
    return this.trackMutation(restoreTransaction(this.context(), input, mutationId));
  }

  listTransactions(input: TransactionListInput): TransactionListResult {
    this.assertOpen();
    const result = listTransactions(this.context(), input);
    this.revision = result.snapshotRevision;
    return result;
  }

  /** S07既定统计只读操作。 */
  statisticsSeries(input: StatisticsInput) { this.assertOpen(); return statisticsSeries(this.context(), input); }
  statisticsSummary(input: StatisticsInput) { this.assertOpen(); return statisticsSummary(this.context(), input); }
  statisticsTopTransactions(input: TopTransactionsInput) { this.assertOpen(); return statisticsTopTransactions(this.context(), input); }
  statisticsTopCategories(input: TopCategoriesInput) { this.assertOpen(); return statisticsTopCategories(this.context(), input); }

  /** S11 批准路径的内部入口；不暴露 IPC。 */
  createAiTransaction(input: AiTransactionInput): TransactionMutationResult {
    this.assertWritable();
    const result = createAiTransaction(this.context(), input);
    this.revision = this.currentRevisionFromDb();
    return {
      transaction: result.transaction,
      replayed: result.alreadyExisted,
      committedRevision: result.alreadyExisted ? this.revision : result.revision,
    };
  }

  /* ------------------------------- 备份 -------------------------------- */

  createBackup(input: BackupCreateInput, mutationId: string | null): BackupCreateResult {
    this.assertOpen();
    return this.backupService.create(input, mutationId);
  }

  listBackups(page?: {limit:number;cursor:string|null}): BackupListResult {
    this.assertOpen();
    return this.backupService.list(page);
  }

  backupRecord(id:string) {const row=getBackupRow(this.db,id);return row?backupRecordView(this.paths,row):null;}
  refreshBackupCatalog():void {
    reconcileBackupCatalog(this.paths,nowIso(this.clock));
    mergeCatalogIntoDatabase(this.db,this.ledgerId,readBackupCatalog(this.paths),nowIso(this.clock));
  }
  backupStatus(restoreId:string):{status:string;result:unknown} {
    const receipt=this.db.prepare<{result_snapshot_json:string}>("SELECT result_snapshot_json FROM mutation_receipt WHERE operation='backup.restore' AND mutation_id=?").get(restoreId);
    const pointer=readActivePointer(this.paths);
    if(receipt && pointer.ok && pointer.pointer.restoreId===restoreId)return {status:'committed',result:JSON.parse(receipt.result_snapshot_json)};
    const entry=readRestoreLog(this.paths).filter(e=>e.restoreId===restoreId).at(-1);
    return {status:entry?.status==='committed'?'previously_committed':entry?.status==='failed'?'failed':entry?'interrupted':'unknown',result:null};
  }
  previewRestore(backupId: string): BackupRestorePreviewResult {
    this.assertOpen();
    return this.backupService.preview(backupId);
  }

  restoreBackup(input: BackupRestoreInput, mutationId: string | null): BackupRestorePreviewResult | BackupRestoreResult {
    this.assertOpen();

    if (input.mode === 'preview') return this.backupService.preview(input.backupId);
    return this.backupService.restoreCommit({ restoreToken: input.restoreToken }, mutationId);
  }

  private switchToStagedGeneration(plan: StagedRestorePlan): BackupRestoreResult {
    const oldPointer = readActivePointer(this.paths);
    if (!oldPointer.ok) {
      throw new AppError('RESTORE_FAILED', { details: { step: 'old-pointer' } });
    }
    const old = {
      generationId: this.generationId,
      databasePath: this.databasePath,
      ledgerId: this.ledgerId,
      epoch: this.epoch,
      revision: this.revision,
      schemaVersion: this.schemaVersion,
      migrationState: this.migrationState,
      recoveryReason: this.recoveryReason,
    };
    const now = nowIso(this.clock);
    // 切换前先读取“当前账本”的备份创建记录：即使运行中 catalog 被删，
    // 这些已知基准也必须进入重建目录，不能被随后的档案扫描覆盖（BK-S05-003）。
    const previousDatabaseEntries = listBackupRows(this.db)
      .map(catalogEntryFromRow)
      .filter((entry): entry is BackupCatalogEntry => entry !== null);
    let newDb: SqliteDb | null = null;
    let oldClosed = false;
    try {
      const probe = openSqlite(plan.stagingDatabasePath, { readonly: true, fileMustExist: true });
      let stagingMeta;
      let stagingLedger;
      try {
        stagingMeta = readAppMeta(probe);
        stagingLedger = getDefaultLedger(probe);
      } finally {
        probe.close();
      }
      if (
        !stagingMeta ||
        !stagingLedger ||
        stagingMeta.dataEpoch !== plan.newDataEpoch ||
        stagingMeta.activeGeneration !== plan.generationId
      ) {
        throw new AppError('RESTORE_FAILED', { details: { step: 'staging-meta' } });
      }
      appendRestoreLog(this.paths, {
        at: now,
        restoreId: plan.restoreId,
        backupId: plan.backupId,
        backupHash: plan.backupHash,
        fromGeneration: old.generationId,
        toGeneration: plan.generationId,
        status: 'switching',
      });
      this.fault?.('before-stage-open');
      const committedPointer = {
        manifestVersion: ACTIVE_POINTER_VERSION as typeof ACTIVE_POINTER_VERSION,
        generationId: plan.generationId,
        dbSchemaVersion: stagingMeta.dbSchemaVersion,
        ledgerId: stagingLedger.id,
        dataEpoch: plan.newDataEpoch,
        activatedAt: now,
        previousGenerationId: old.generationId,
        restoreId: plan.restoreId,
      };
      this.db.close();
      oldClosed = true;
      const openedDb = openSqlite(plan.stagingDatabasePath);
      newDb = openedDb;
      const newMeta = readAppMeta(openedDb);
      const ledger = getDefaultLedger(openedDb);
      if (!newMeta || !ledger) {
        throw new AppError('RESTORE_FAILED', { details: { step: 'reopen' } });
      }
      const violations = collectBusinessViolations(openedDb);
      if (violations.length > 0) {
        throw new AppError('RESTORE_FAILED', { details: { step: 'post-switch-integrity' } });
      }
      const result: BackupRestoreResult = {
        ledgerId: ledger.id,
        newDataEpoch: plan.newDataEpoch,
        revision: ledger.data_revision,
        preRestoreBackupId: plan.preRestore.row.id,
        appliedBackupHash: plan.backupHash,
        replayed: false,
      };
      // 独立备份目录先于切换即可读；先导入旧快照与切换前账本的可信记录，再扫描未知档案。
      // 这样扫描不会用档案当前 hash 覆盖目录/DB 中既有的创建基准（BK-S05-003）。
      upsertBackupCatalogEntries(this.paths, previousDatabaseEntries, now);
      const restoredDatabaseEntries = listBackupRows(openedDb)
        .map(catalogEntryFromRow)
        .filter((entry): entry is BackupCatalogEntry => entry !== null);
      upsertBackupCatalogEntries(this.paths, restoredDatabaseEntries, now);
      reconcileBackupCatalog(this.paths, now);
      const catalogEntries = readBackupCatalog(this.paths);
      runInTransaction(openedDb, () => {
        mergeCatalogIntoDatabase(openedDb, ledger.id, catalogEntries, now);
        copyBackupRecordToNewDatabase(openedDb, plan.preRestore.row, now, ledger.id);
        insertAuditEvent(openedDb, {
          ledgerId: ledger.id,
          entityType: 'backup',
          entityId: plan.backupId,
          action: 'backup.restore',
          actor: 'local_user',
          diff: [
            { field: 'archiveHash', before: null, after: plan.backupHash },
            { field: 'generationId', before: old.generationId, after: plan.generationId },
            { field: 'dataEpoch', before: old.epoch, after: plan.newDataEpoch },
          ],
          mutationId: plan.restoreId,
          reason: null,
          now,
        });
        insertReceipt(openedDb, {
          ledgerId: ledger.id,
          operation: 'backup.restore',
          mutationId: plan.restoreId,
          payloadHash: hashPayload({
            operation: 'backup.restore',
            payload: { backupId: plan.backupId, archiveHash: plan.backupHash },
          }),
          resultType: 'backup',
          resultIds: [plan.backupId],
          snapshot: result,
          revision: ledger.data_revision,
          now,
        });
        updateAppMeta(openedDb, { activeGeneration: plan.generationId }, now);
      });
      this.fault?.('before-publish');
      // The new generation is fully prepared before the single atomic commit point.
      writeActivePointer(this.paths, committedPointer);
      this.db = openedDb;
      this.generationId = plan.generationId;
      this.databasePath = plan.stagingDatabasePath;
      this.ledgerId = ledger.id;
      this.epoch = plan.newDataEpoch;
      this.revision = ledger.data_revision;
      this.schemaVersion = newMeta.dbSchemaVersion;
      this.migrationState = 'clean';
      this.recoveryReason = null;
      try { this.fault?.('after-publish'); appendRestoreLog(this.paths, {
        at: nowIso(this.clock),
        restoreId: plan.restoreId,
        backupId: plan.backupId,
        backupHash: plan.backupHash,
        fromGeneration: old.generationId,
        toGeneration: plan.generationId,
        status: 'committed',
      }); } catch { /* active pointer + durable receipt are authoritative after commit */ }
      return result;
    } catch (error) {
      try {
        newDb?.close();
      } catch {
        // ignore
      }
      // Failures before publication never changed active.json.
      if (oldClosed) {
        try {
          this.db = openSqlite(old.databasePath);
          this.generationId = old.generationId;
          this.databasePath = old.databasePath;
          this.ledgerId = old.ledgerId;
          this.epoch = old.epoch;
          this.revision = old.revision;
          this.schemaVersion = old.schemaVersion;
          this.migrationState = old.migrationState;
          this.recoveryReason = old.recoveryReason;
        } catch {
          this.recoveryReason = 'RESTORE_ROLLBACK_FAILED';
          this.migrationState = 'recovery_required';
        }
      }
      try { appendRestoreLog(this.paths, {
        at: nowIso(this.clock),
        restoreId: plan.restoreId,
        backupId: plan.backupId,
        backupHash: plan.backupHash,
        fromGeneration: old.generationId,
        toGeneration: plan.generationId,
        status: 'failed',
        errorCode: error instanceof AppError ? error.code : 'RESTORE_FAILED',
      }); } catch { /* old generation retained; no raw exception logging */ }
      throw error instanceof AppError
        ? error
        : new AppError('RESTORE_FAILED', { details: { step: 'switch' } });
    }
  }

  /** Main-process-only synchronous callback; never exposed through preload. */
  withImports<T>(write: boolean, fn: (ctx: import('./import-context').ImportContext) => T): T {
    if (write) this.assertWritable(); else this.assertOpen();
    return fn({ db: this.db, ledgerId: this.ledgerId, epoch: this.epoch, revision: this.currentRevision,
      directory: path.join(path.dirname(this.databasePath), 'attachments') });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch {
      // 关闭失败不影响进程退出。
    }
  }

  /** 仅用于测试/诊断的受限路径信息（不跨 IPC）。 */
  diagnostics(): { root: string; databasePath: string; generationId: string; backupPathOf: (id: string) => string } {
    return {
      root: this.paths.root,
      databasePath: this.databasePath,
      generationId: this.generationId,
      backupPathOf: (id: string) => backupArchivePath(this.paths, id),
    };
  }
}



