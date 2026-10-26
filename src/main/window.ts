/** 主窗口与进程级硬化：拒绝新窗口、远端导航、webview 与全部权限请求。 */

import { BrowserWindow, nativeTheme, session, type Session } from 'electron';
import path from 'node:path';
import { initializeAppearance, titlebarPalette, followWindowAppearance } from './appearance';
import { APP_DISPLAY_NAME, APP_ORIGIN } from '../shared/constants';
import {
  buildSecureWebPreferences,
  isAllowedNavigation,
  type SecureWebPreferences,
} from './security/window-options';

export interface MainWindowOptions {
  readonly preloadPath: string;
  readonly devServerUrl: string | null;
  readonly allowedOrigins: readonly string[];
  readonly show: boolean;
}

export interface CreatedMainWindow {
  readonly window: BrowserWindow;
  /** 创建时确实生效的 webPreferences（用于自检记录；运行时隔离另有行为证据）。 */
  readonly preferences: SecureWebPreferences;
}

export function resolvePreloadPath(mainDir: string): string {
  return path.join(mainDir, '..', 'preload', 'index.cjs');
}

export function resolveRendererDir(mainDir: string): string {
  return path.join(mainDir, '..', 'renderer');
}

export function createMainWindow(options: MainWindowOptions): CreatedMainWindow {
  initializeAppearance();
  const preferences = buildSecureWebPreferences({
    preloadPath: options.preloadPath,
    devTools: options.devServerUrl !== null,
  });

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: options.show,
    title: APP_DISPLAY_NAME,
    titleBarStyle: 'hidden',
    titleBarOverlay: titlebarPalette(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f5f7fb',
    autoHideMenuBar: true,
    webPreferences: preferences,
  });

  followWindowAppearance(window);

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, options.allowedOrigins)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  const target = options.devServerUrl ?? `${APP_ORIGIN}/index.html`;
  void window.loadURL(target);

  return { window, preferences };
}

/** 进程级硬化：任何 webContents 都继承同一策略。 */
export function hardenSession(targetSession: Session): void {
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.on('will-download', (event) => {
    // 导出/备份走主进程受控文件对话框，浏览器下载一律拒绝。
    event.preventDefault();
  });
}

export function applyDefaultSessionHardening(): void {
  hardenSession(session.defaultSession);
}
