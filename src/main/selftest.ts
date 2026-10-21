/**
 * 骨架自检：真实启动渲染进程并核验安全边界、IPC 校验、mock provider 与原生 SQLite 加载。
 * 不是业务验收，也不代表 G1～G6 任一通过。
 */

import type { BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { APP_ORIGIN, CONTRACT_VERSION } from '../shared/constants';
import { REQUIRED_PRODUCTION_DIRECTIVES } from '../shared/csp';
import { ALL_CHANNELS } from '../shared/ipc';
import { loadBetterSqlite3 } from './native';
import { isInsideDirectory } from './paths';
import type { SecureWebPreferences } from './security/window-options';
import type { LedgerStoreSnapshot } from './services/ledger-store';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface SelfTestCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail?: unknown;
}

export interface SelfTestReport {
  readonly ok: boolean;
  readonly generatedAt: string;
  readonly environment: Record<string, unknown>;
  readonly checks: SelfTestCheck[];
}

export interface SelfTestDependencies {
  readonly window: BrowserWindow;
  readonly webPreferences: SecureWebPreferences;
  readonly appVersion: string;
  readonly storageOk: boolean;
  readonly storageRoot: string | null;
  readonly storageReason: string | null;
  readonly singleInstanceLocked: boolean;
  readonly allowedOrigins: readonly string[];
  readonly registeredChannels: readonly string[];
  readonly devServerUrl: string | null;
  readonly database: LedgerStoreSnapshot;
  readonly programPath: string;
}

interface RendererIsolationFacts {
  requireType: string;
  processType: string;
  moduleType: string;
  globalType: string;
  bridgeType: string;
  bridgeKeys: string[];
  statisticsKeys: string[];
  ipcRendererType: string;
  electronType: string;
}

interface BridgeResultLike {
  ok: boolean;
  data?: unknown;
  error?: { code?: string };
}

function check(id: string, ok: boolean, detail?: unknown): SelfTestCheck {
  return detail === undefined ? { id, ok } : { id, ok, detail };
}

async function evaluate<T>(window: BrowserWindow, code: string): Promise<T> {
  return (await window.webContents.executeJavaScript(code, true)) as T;
}

function sqliteCheck(): SelfTestCheck {
  const loaded = loadBetterSqlite3();
  if (!loaded.ok || loaded.ctor === null) {
    return check('sqlite.better-sqlite3', false, { error: loaded.error });
  }
  const Database = loaded.ctor;
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(':memory:');
    db.exec('CREATE TABLE tx (id INTEGER PRIMARY KEY, amount_fen INTEGER NOT NULL)');
    db.prepare('INSERT INTO tx (amount_fen) VALUES (?)').run(4426);
    const row = db.prepare<{ amount_fen: number }>('SELECT amount_fen FROM tx WHERE id = 1').get();
    const version = db.prepare<{ v: string }>('SELECT sqlite_version() AS v').get();
    return check('sqlite.better-sqlite3', row?.amount_fen === 4426, {
      sqliteVersion: version?.v ?? 'unknown',
      modules: process.versions.modules ?? 'unknown',
      napi: process.versions.napi ?? 'unknown',
      amountFen: row?.amount_fen ?? null,
    });
  } catch (error) {
    return check('sqlite.better-sqlite3', false, {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      db?.close();
    } catch {
      // 关闭失败不影响结论。
    }
  }
}

export async function runSelfTest(deps: SelfTestDependencies): Promise<SelfTestReport> {
  const checks: SelfTestCheck[] = [];
  const { window } = deps;

  const versions = process.versions;
  checks.push(
    check('environment.versions', Boolean(versions.electron && versions.chrome && versions.node), {
      electron: versions.electron,
      chrome: versions.chrome,
      node: versions.node,
      modules: versions.modules,
      napi: versions.napi,
      platform: process.platform,
      arch: process.arch,
      appVersion: deps.appVersion,
      contractVersion: CONTRACT_VERSION,
    }),
  );

  checks.push(
    check('storage.localAppDataRoot', deps.storageOk && deps.storageRoot !== null, {
      rootSuffix: deps.storageRoot ?? null,
      reason: deps.storageReason,
    }),
  );

  const preferences = deps.webPreferences;
  checks.push(
    check(
      'window.webPreferences',
      preferences.sandbox === true &&
        preferences.contextIsolation === true &&
        preferences.nodeIntegration === false &&
        preferences.webviewTag === false,
      {
        source: 'creation-time webPreferences + 运行时 renderer 隔离证据',
        sandbox: preferences.sandbox,
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
        webviewTag: preferences.webviewTag,
      },
    ),
  );

  checks.push(check('app.singleInstanceLock', deps.singleInstanceLocked, {}));

  const isolation = await evaluate<RendererIsolationFacts>(window, `(() => ({
    requireType: typeof require,
    processType: typeof process,
    moduleType: typeof module,
    globalType: typeof global,
    bridgeType: typeof window.bookkeep,
    bridgeKeys: window.bookkeep ? Object.keys(window.bookkeep).sort() : [],
    statisticsKeys: window.bookkeep?.statistics ? Object.keys(window.bookkeep.statistics).sort() : [],
    ipcRendererType: typeof window.ipcRenderer,
    electronType: typeof window.electron,
  }))()`);

  checks.push(
    check(
      'renderer.nodeIsolation',
      isolation.requireType === 'undefined' &&
        isolation.processType === 'undefined' &&
        isolation.moduleType === 'undefined' &&
        isolation.globalType === 'undefined' &&
        isolation.ipcRendererType === 'undefined' &&
        isolation.electronType === 'undefined',
      isolation,
    ),
  );

  checks.push(
    check(
      'preload.bridgeSurface',
      isolation.bridgeType === 'object' &&
        isolation.bridgeKeys.join(',') ===
          'backup,category,contractVersion,ledger,provider,settings,skeleton,skeletonStage,statistics,transaction' &&
        isolation.statisticsKeys.join(',') === 'series,summary,topCategories,topTransactions',
      { bridgeType: isolation.bridgeType, bridgeKeys: isolation.bridgeKeys, statisticsKeys: isolation.statisticsKeys },
    ),
  );

  const database = deps.database;
  checks.push(
    check(
      'db.schemaAndLocation',
      database.databaseExists &&
        database.dbSchemaVersion >= 1 &&
        database.databaseRelativePath.startsWith('data/generations/') &&
        deps.storageRoot !== null &&
        !isInsideDirectory(deps.storageRoot, deps.programPath),
      {
        schemaVersion: database.dbSchemaVersion,
        databaseRelativePath: database.databaseRelativePath,
        databaseExists: database.databaseExists,
        outsideProgramDirectory:
          deps.storageRoot !== null && !isInsideDirectory(deps.storageRoot, deps.programPath),
      },
    ),
  );
  checks.push(
    check(
      'db.defaultLedgerSeed',
      database.ledgerCount === 1 &&
        database.categoryCount >= 34 &&
        database.categoryCount <= 500 &&
        !database.recoveryRequired &&
        UUID_V4.test(database.dataEpoch),
      {
        ledgerId: database.ledgerId,
        dataEpoch: database.dataEpoch,
        categoryCount: database.categoryCount,
        ledgerCount: database.ledgerCount,
        transactionCount: database.transactionCount,
        dataRevision: database.dataRevision,
        generationId: database.generationId,
        migrationState: database.migrationState,
      },
    ),
  );

  const dom = await evaluate<{
    shell: string | null;
    navItems: number;
    background: string;
    csp: string | null;
    remoteResources: number;
    origin: string;
  }>(window, `(() => {
    const shell = document.querySelector('[data-app-shell]');
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const remote = Array.from(document.querySelectorAll('script[src], img[src], link[href]')).filter((el) => {
      const value = el.src || el.href || '';
      return /^https?:/i.test(value);
    });
    return {
      shell: shell ? shell.getAttribute('data-app-shell') : null,
      navItems: document.querySelectorAll('[data-nav-item]').length,
      background: getComputedStyle(document.body).backgroundColor,
      csp: meta ? meta.getAttribute('content') : null,
      remoteResources: remote.length,
      origin: location.origin,
    };
  })()`);

  const cspMissing = REQUIRED_PRODUCTION_DIRECTIVES.filter(
    (directive) => dom.csp === null || !dom.csp.includes(directive),
  );
  checks.push(
    check('renderer.mounted', dom.shell === 'ready' && dom.navItems === 8, {
      shell: dom.shell,
      navItems: dom.navItems,
    }),
  );
  checks.push(
    check('renderer.stylesApplied', dom.background === 'rgb(245, 247, 251)', { background: dom.background }),
  );
  checks.push(
    check('renderer.contentSecurityPolicy', cspMissing.length === 0, {
      missing: cspMissing,
      origin: dom.origin,
    }),
  );
  checks.push(
    check('renderer.noRemoteResources', dom.remoteResources === 0, { remoteResources: dom.remoteResources }),
  );

  const readAi = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.settings.readAi())()`,
  );
  const readAiData = (readAi.data ?? {}) as Record<string, unknown>;
  checks.push(
    check(
      'ipc.settingsAi',
      readAi.ok === true &&
        readAiData.readiness === 'stub' &&
        readAiData.ledgerId === deps.database.ledgerId,
      {
        ok: readAi.ok,
        readiness: readAiData.readiness ?? null,
        model: readAiData.model ?? null,
        ledgerIdMatches: readAiData.ledgerId === deps.database.ledgerId,
      },
    ),
  );

  const readStatus = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.settings.readStatus())()`,
  );
  const statusData = (readStatus.data ?? {}) as Record<string, unknown>;
  checks.push(
    check(
      'ipc.settingsReadStatus',
      readStatus.ok === true && statusData.configured === false && typeof statusData.encryptionAvailable === 'boolean',
      { ok: readStatus.ok, configured: statusData.configured ?? null, mode: statusData.mode ?? null },
    ),
  );

  const invalidPayload = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.skeleton.mockRecognition({ scenario: 'two-expenses', extra: 1 }))()`,
  );
  checks.push(
    check('ipc.rejectsUnknownPayloadKey', invalidPayload.ok === false && invalidPayload.error?.code === 'PAYLOAD_INVALID', {
      code: invalidPayload.error?.code ?? null,
    }),
  );

  const saveSecret = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.settings.saveSecret({ action: 'remove' }))()`,
  );
  checks.push(
    check('ipc.saveSecretStub', saveSecret.ok === false && saveSecret.error?.code === 'NOT_IMPLEMENTED', {
      code: saveSecret.error?.code ?? null,
    }),
  );

  const mockTwo = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.skeleton.mockRecognition({ scenario: 'two-expenses' }))()`,
  );
  const mockTwoData = (mockTwo.data ?? {}) as Record<string, unknown>;
  const mockCandidates = (mockTwoData.candidates ?? []) as Array<Record<string, unknown>>;
  checks.push(
    check(
      'provider.mockTwoExpenses',
      mockTwo.ok === true &&
        mockTwoData.providerId === 'mock' &&
        mockTwoData.localSimulation === true &&
        mockTwoData.actualModel === null &&
        mockCandidates.length === 2 &&
        mockCandidates.every((candidate) => candidate.blocking === false),
      {
        ok: mockTwo.ok,
        candidates: mockCandidates.length,
        blocking: mockCandidates.map((candidate) => candidate.blocking),
      },
    ),
  );

  const mockPhoto = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.skeleton.mockRecognition({ scenario: 'product-photo' }))()`,
  );
  const mockPhotoData = (mockPhoto.data ?? {}) as Record<string, unknown>;
  const photoCandidates = (mockPhotoData.candidates ?? []) as Array<Record<string, unknown>>;
  const photoMissing = (photoCandidates[0]?.missingFields ?? []) as unknown[];
  checks.push(
    check(
      'provider.mockMissingFieldsBlock',
      mockPhoto.ok === true && photoCandidates.length === 1 && photoCandidates[0]?.blocking === true && photoMissing.length >= 2,
      { ok: mockPhoto.ok, blocking: photoCandidates[0]?.blocking ?? null, missing: photoMissing },
    ),
  );

  const deepseekCapabilities = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.provider.capabilities({ providerId: 'deepseek' }))()`,
  );
  const capData = (deepseekCapabilities.data ?? {}) as Record<string, unknown>;
  checks.push(
    check(
      'provider.deepseekStub',
      deepseekCapabilities.ok === true &&
        capData.structuredOutputStatus === 'unverified' &&
        capData.trainingSubmitSupported === false,
      { status: capData.structuredOutputStatus ?? null },
    ),
  );

  const ensureDefault = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.ledger.ensureDefault())()`,
  );
  const ensureData = (ensureDefault.data ?? {}) as Record<string, unknown>;
  const ensureCategories = (ensureData.categories ?? []) as Array<Record<string, unknown>>;
  const categoryIds = ensureCategories.map((category) => String(category.id));
  const systemKeys = ensureCategories
    .map((category) => category.systemKey)
    .filter((key): key is string => typeof key === 'string');
  checks.push(
    check(
      'ipc.ledgerEnsureDefault',
      ensureDefault.ok === true &&
        ensureCategories.length === deps.database.categoryCount &&
        ensureCategories.length >= 34 &&
        new Set(categoryIds).size === ensureCategories.length &&
        systemKeys.length === 34 &&
        new Set(systemKeys).size === 34 &&
        categoryIds.every((id) => id !== 'nav_settings') &&
        (ensureData.ledger as Record<string, unknown> | undefined)?.id === deps.database.ledgerId,
      {
        ok: ensureDefault.ok,
        categories: ensureCategories.length,
        uniqueCategoryIds: new Set(categoryIds).size,
        uniqueSystemKeys: new Set(systemKeys).size,
        hasSettingsEntry: categoryIds.includes('nav_settings'),
      },
    ),
  );

  const categoryList = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.category.list({ includeDisabled: true }))()`,
  );
  const categoryListData = (categoryList.data ?? {}) as Record<string, unknown>;
  const listedCategories = (categoryListData.categories ?? []) as Array<Record<string, unknown>>;
  checks.push(
    check(
      'ipc.categoryList',
      categoryList.ok === true &&
        listedCategories.length === deps.database.categoryCount &&
        listedCategories.every((category) => typeof category.iconKey === 'string' && category.iconKey.startsWith('lucide:')),
      { ok: categoryList.ok, categories: listedCategories.length },
    ),
  );

  const transactionList = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.transaction.list({
      filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' },
      page: { limit: 5, cursor: null }
    }))()`,
  );
  const transactionListData = (transactionList.data ?? {}) as Record<string, unknown>;
  checks.push(
    check(
      'ipc.transactionList',
      transactionList.ok === true &&
        Array.isArray(transactionListData.items) &&
        typeof transactionListData.totalCount === 'number' &&
        transactionListData.totalCount === deps.database.transactionCount,
      {
        ok: transactionList.ok,
        totalCount: transactionListData.totalCount ?? null,
        filteredTotalFen: transactionListData.filteredTotalFen ?? null,
      },
    ),
  );

  const backups = await evaluate<BridgeResultLike>(
    window,
    `(async () => window.bookkeep.backup.list())()`,
  );
  checks.push(
    check('ipc.backupList', backups.ok === true, { ok: backups.ok }),
  );

  checks.push(
    check(
      'ipc.channelWhitelist',
      deps.registeredChannels.length === ALL_CHANNELS.length &&
        !deps.registeredChannels.some((channel) => channel.startsWith('ipcRenderer')),
      { channels: [...deps.registeredChannels] },
    ),
  );

  checks.push(sqliteCheck());

  const opened = await evaluate<boolean>(window, `(() => window.open('https://example.com/') === null)()`);
  checks.push(check('window.openDenied', opened === true, { returnedNull: opened }));

  const blockedNavigation = await evaluate<{ before: string; after: string }>(
    window,
    `(async () => {
      const before = location.href;
      try { location.href = 'https://example.com/'; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { before, after: location.href };
    })()`,
  );
  checks.push(
    check('navigation.remoteBlocked', blockedNavigation.before === blockedNavigation.after, blockedNavigation),
  );

  const expectedOrigin = deps.devServerUrl ?? `${APP_ORIGIN}`;
  checks.push(
    check('renderer.origin', dom.origin.startsWith(expectedOrigin.split('/').slice(0, 3).join('/')), {
      origin: dom.origin,
      expected: expectedOrigin,
    }),
  );

  const report: SelfTestReport = {
    ok: checks.every((entry) => entry.ok),
    generatedAt: new Date().toISOString(),
    environment: {
      appVersion: deps.appVersion,
      platform: process.platform,
      arch: process.arch,
      electron: versions.electron,
      chrome: versions.chrome,
      node: versions.node,
      modules: versions.modules,
      allowedOrigins: deps.allowedOrigins,
      devServer: deps.devServerUrl !== null,
    },
    checks,
  };
  return report;
}

export function writeSelfTestReport(report: SelfTestReport, targetPath: string): void {
  writeFileSync(targetPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
