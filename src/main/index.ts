/** 主进程入口：单实例、硬化、受限 IPC、窗口与骨架自检。 */

import { app, BrowserWindow, dialog, safeStorage, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { APP_DISPLAY_NAME, APP_ORIGIN } from '../shared/constants';
import { capturePages } from './capture';
import { createIpcRouter } from './ipc/registry';
import { registerIpcHandlers } from './ipc/handlers';
import { resolveStorageLayout } from './paths';
import { registerAppScheme, serveRendererAssets } from './protocol';
import { runSelfTest, writeSelfTestReport } from './selftest';
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
/**
 * S04 会话世代：没有数据库，因此每次启动生成一个 UUID 作为 dataEpoch，
 * 只用于验证「非启动操作必须携带当前世代」的 IPC 边界。
 * S05 起由 AppMeta.dataEpoch 持久化并提供恢复后的新世代。
 */
const sessionDataEpoch = randomUUID();

let mainWindow: BrowserWindow | null = null;

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

  if (!devServerUrl) {
    serveRendererAssets(resolveRendererDir(__dirname));
  }

  const router = createIpcRouter({
    expectedOrigins: allowedOrigins,
    getSenderWebContentsId: () => mainWindow?.webContents.id ?? null,
    dataEpoch: sessionDataEpoch,
    dataRevision: 0,
    onRejectedSender: (reason) => {
      console.warn(`[bookkeep] rejected IPC sender: ${reason}`);
    },
    onInternalError: (error) => {
      console.error('[bookkeep] unexpected IPC failure', error instanceof Error ? error.message : 'unknown');
    },
  });
  registerIpcHandlers(router, {
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
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
  });
  if (reportPath) writeSelfTestReport(report, reportPath);
  console.log(
    `[bookkeep] self-test ${report.ok ? 'PASSED' : 'FAILED'} (${report.checks.filter((c) => c.ok).length}/${report.checks.length})`,
  );
  for (const entry of report.checks) {
    if (!entry.ok) console.error(`[bookkeep] self-test check failed: ${entry.id} ${JSON.stringify(entry.detail ?? {})}`);
  }
  router.dispose();
  app.exit(report.ok ? 0 : 1);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
