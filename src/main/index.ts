/** 主进程入口：单实例、硬化、受限 IPC、账本存储启动、窗口与自检。 */

import { app, BrowserWindow, dialog, safeStorage, session } from 'electron';
import { APP_DISPLAY_NAME, APP_ORIGIN } from '../shared/constants';
import { AppError } from '../shared/errors';
import { capturePages } from './capture';
import { createIpcRouter } from './ipc/registry';
import { registerIpcHandlers } from './ipc/handlers';
import { resolveStorageLayout } from './paths';
import { registerAppScheme, serveRendererAssets } from './protocol';
import { runSelfTest, writeSelfTestReport } from './selftest';
import { ImageService } from './services/image-service';
import { RecognitionService } from './services/recognition-service';
import { LedgerStore } from './services/ledger-store';
import { SecretStore } from './services/settings/ai-settings';
import { ProbeService } from './services/providers/probe';
import path from 'node:path';
import { isAllowedNavigation } from './security/window-options';
import {
  createMainWindow,
  hardenSession,
  resolvePreloadPath,
  resolveRendererDir,
} from './window';

const SELF_TEST_FLAG = '--self-test';
const SELF_TEST_REPORT_PREFIX = '--self-test-report=';
const CAPTURE_UI_PREFIX = '--capture-ui=';

const selfTestMode = process.argv.includes(SELF_TEST_FLAG);
const reportArgument = process.argv.find((argument) => argument.startsWith(SELF_TEST_REPORT_PREFIX));
const reportPath = reportArgument ? reportArgument.slice(SELF_TEST_REPORT_PREFIX.length) : null;
const captureArgument = process.argv.find((argument) => argument.startsWith(CAPTURE_UI_PREFIX));
const captureDir = captureArgument ? captureArgument.slice(CAPTURE_UI_PREFIX.length) : null;

if (captureDir) {
  // 截图模式禁用硬件加速，避免无显示环境下 GPU 进程异常影响退出码。
  app.disableHardwareAcceleration();
}
const devServerUrl = process.env.BOOKKEEP_DEV_SERVER_URL?.trim() || null;
const allowedOrigins = devServerUrl ? [new URL(devServerUrl).origin] : [APP_ORIGIN];
const storage = resolveStorageLayout(process.env);

let mainWindow: BrowserWindow | null = null;
let store: LedgerStore | null = null;
let secrets: SecretStore | null = null;

app.setAppUserModelId('ai.bookkeep.desktop');
if (storage.ok) {
  app.setPath('userData', storage.layout.shell);
}

registerAppScheme();

function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, allowedOrigins)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function waitForRenderer(window: BrowserWindow, timeoutMs = 30_000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (loaded: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(loaded);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    window.webContents.once('did-finish-load', () => finish(true));
    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`[bookkeep] renderer load failed: ${code} ${description}`);
      finish(false);
    });
  });
}

function startupErrorText(error: unknown): string {
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  switch (code) {
    case 'SCHEMA_TOO_NEW':
      return '账本数据库版本比当前应用新。请使用更新版本的应用，或先备份后从备份恢复；不会创建空账本覆盖现有数据。';
    case 'SCHEMA_UNSUPPORTED':
      return '账本数据库版本不受当前应用支持。请确认应用版本；现有数据未被修改。';
    case 'RECOVERY_REQUIRED':
      return '检测到需要恢复的账本状态（数据库指针/迁移/完整性）。业务写入已停止，请使用备份恢复；不会覆盖或重建账本。';
    case 'INTEGRITY_ERROR':
      return '账本数据库完整性检查失败。请先保留数据目录并从备份恢复，不要删除或重建账本。';
    case 'MIGRATION_FAILED':
      return '数据库迁移失败，旧数据未被覆盖。请从迁移前备份恢复后重试。';
    case 'BACKUP_FAILED':
      return '迁移前备份失败，因此没有执行数据库迁移。请检查磁盘空间/权限后重试。';
    case 'STORAGE_UNAVAILABLE':
      return '无法访问本地数据目录（%LOCALAPPDATA%\\BookKeepAI）。请检查系统环境后重试。';
    default:
      return '账本初始化失败，现有数据未被删除。请查看本地日志或从备份恢复。';
  }
}

function reportStartupFailure(error: unknown): void {
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  console.error(`[bookkeep] startup database failure: ${code}`);
  if (selfTestMode) {
    const report = {
      ok: false,
      generatedAt: new Date().toISOString(),
      environment: {},
      checks: [{ id: 'startup.database', ok: false, detail: { code } }],
    };
    if (reportPath) writeSelfTestReport(report, reportPath);
    app.exit(1);
    return;
  }
  dialog.showErrorBox(`${APP_DISPLAY_NAME} 账本无法打开`, startupErrorText(error));
  app.exit(1);
}

let recognition: RecognitionService | null = null;
async function bootstrap(): Promise<void> {
  hardenSession(session.defaultSession);

  if (!storage.ok) {
    if (selfTestMode) {
      const report = {
        ok: false,
        generatedAt: new Date().toISOString(),
        environment: {},
        checks: [{ id: 'storage.localAppDataRoot', ok: false, detail: { reason: storage.reason } }],
      };
      if (reportPath) writeSelfTestReport(report, reportPath);
    } else {
      dialog.showErrorBox(
        `${APP_DISPLAY_NAME} 无法启动`,
        '无法确定本地数据目录（%LOCALAPPDATA%\\BookKeepAI）。请检查系统环境后重试。',
      );
    }
    app.exit(1);
    return;
  }

  try {
    store = LedgerStore.open({ layout: storage.layout, appVersion: app.getVersion() });
    // 启动幂等兜底：不同启动次数/不同 mutationId 都不会产生第二个默认账本或重复分类。
    store.ensureDefault();
  } catch (error) {
    reportStartupFailure(error);
    return;
  }

  const images=new ImageService(store,()=>mainWindow?.webContents.id??null);
  if (!devServerUrl) {
    serveRendererAssets(resolveRendererDir(__dirname),token=>images.readResource(token));
  }

  const router = createIpcRouter({
    expectedOrigins: allowedOrigins,
    getSenderWebContentsId: () => mainWindow?.webContents.id ?? null,
    getDataEpoch: () => store?.currentEpoch ?? null,
    getDataRevision: () => store?.currentRevision ?? 0,
    onRejectedSender: (reason) => {
      console.warn(`[bookkeep] rejected IPC sender: ${reason}`);
    },
    onInternalError: (error) => {
      console.error('[bookkeep] unexpected IPC failure', error instanceof Error ? error.message : 'unknown');
    },
  });
  secrets = new SecretStore(storage.layout.secrets, safeStorage);
  const probe = new ProbeService(secrets, path.join(__dirname, 'probe/s09-receipt-v1.png'), storage.layout.logs);
  recognition=new RecognitionService(store,images,secrets);
  registerIpcHandlers(router, {
    store,
    secrets, probe, images, get recognition(){return recognition!;},
    onRestored:()=>{recognition?.shutdown();recognition=new RecognitionService(store!,images,secrets!);},
    selectImages: async()=>{ const result=await dialog.showOpenDialog(mainWindow!,{title:"选择消费图片",properties:["openFile","multiSelections"],filters:[{name:"JPEG / PNG / WebP",extensions:["jpg","jpeg","png","webp"]}]}); return result.canceled?[]:result.filePaths; },
  });

  const created = createMainWindow({
    preloadPath: resolvePreloadPath(__dirname),
    devServerUrl,
    allowedOrigins,
    show: !selfTestMode,
  });
  mainWindow = created.window;

  const window = created.window;
  const loaded = await waitForRenderer(window);

  if (captureDir) {
    if (!loaded) {
      console.error('[bookkeep] capture aborted: renderer did not load');
      app.exit(1);
      return;
    }
    const files = await capturePages(window, captureDir);
    console.log(`[bookkeep] captured ${files.length} pages -> ${captureDir}`);
    router.dispose();
    app.exit(0);
    return;
  }

  if (!selfTestMode) {
    if (loaded) window.show();
    if (store.snapshot().recoveryRequired) {
      void dialog.showMessageBox(window, {
        type: 'warning',
        title: `${APP_DISPLAY_NAME} 恢复模式`,
        message: '账本当前处于恢复模式',
        detail: '检测到迁移或完整性状态需要处理，业务写入已停止。可在“数据管理”中从备份恢复；现有数据不会被自动覆盖。',
        buttons: ['知道了'],
      });
    }
    return;
  }

  const report = await runSelfTest({
    window,
    webPreferences: created.preferences,
    appVersion: app.getVersion(),
    storageOk: storage.ok,
    storageRoot: storage.layout.root,
    storageReason: null,
    singleInstanceLocked: true,
    allowedOrigins,
    registeredChannels: router.registeredChannels(),
    devServerUrl,
    database: store.snapshot(),
    programPath: app.getAppPath(),
  });
  if (reportPath) writeSelfTestReport(report, reportPath);
  console.log(
    `[bookkeep] self-test ${report.ok ? 'PASSED' : 'FAILED'} (${report.checks.filter((c) => c.ok).length}/${report.checks.length})`,
  );
  for (const entry of report.checks) {
    if (!entry.ok) console.error(`[bookkeep] self-test check failed: ${entry.id} ${JSON.stringify(entry.detail ?? {})}`);
  }
  router.dispose();
  store.close();
  app.exit(report.ok ? 0 : 1);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('will-quit', () => {
  recognition?.shutdown();
  secrets?.clearSession();
  store?.close();
  store = null;
});

const singleInstanceLocked = app.requestSingleInstanceLock();
if (!singleInstanceLocked) {
  // 同一账本只允许一个可写实例（ARCHITECTURE §7）：第二个进程直接退出，由已有窗口继续。
  app.quit();
} else {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
  app.on('window-all-closed', () => {
    if (!selfTestMode) app.quit();
  });
  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error('[bookkeep] bootstrap failed', error instanceof Error ? error.message : 'unknown');
      app.exit(1);
    });
}
