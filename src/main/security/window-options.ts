/**
 * 窗口安全选项（不导入 electron，便于单测）。
 * 渲染进程：无 Node 集成、开启 contextIsolation 与 sandbox、禁用 webview。
 */

import { APP_ORIGIN, APP_SCHEME } from '../../shared/constants';

export interface SecureWebPreferences {
  preload: string;
  contextIsolation: true;
  sandbox: true;
  nodeIntegration: false;
  nodeIntegrationInWorker: false;
  nodeIntegrationInSubFrames: false;
  webviewTag: false;
  webSecurity: true;
  allowRunningInsecureContent: false;
  experimentalFeatures: false;
  spellcheck: false;
  navigateOnDragDrop: false;
  devTools: boolean;
}

export interface WindowSecurityOptions {
  readonly preloadPath: string;
  readonly devTools: boolean;
}

export function buildSecureWebPreferences(options: WindowSecurityOptions): SecureWebPreferences {
  return {
    preload: options.preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    spellcheck: false,
    navigateOnDragDrop: false,
    devTools: options.devTools,
  };
}

/** 渲染层可被导航到的来源白名单：开发服务器或打包后的本地自定义协议。 */
export function allowedRendererOrigins(devServerOrigin: string | null): string[] {
  return devServerOrigin ? [devServerOrigin] : [APP_ORIGIN];
}

/** 用 `${protocol}//${host}` 归一化，兼容非特殊协议（URL.origin 对自定义协议为 null）。 */
export function frameOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password || (url.protocol === `${APP_SCHEME}:` && url.pathname !== '/index.html' && url.pathname !== '/')) return null;
    if (!url.protocol || url.protocol === 'about:' || url.protocol === 'data:' || url.protocol === 'blob:') {
      return null;
    }
    if (url.protocol !== `${APP_SCHEME}:` && url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function isAllowedNavigation(url: string, allowedOrigins: readonly string[]): boolean {
  const origin = frameOrigin(url);
  return origin !== null && allowedOrigins.includes(origin);
}
