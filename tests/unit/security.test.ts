import { describe, expect, it } from 'vitest';
import { APP_ORIGIN } from '../../src/shared/constants';
import { REQUIRED_PRODUCTION_DIRECTIVES, buildContentSecurityPolicy } from '../../src/shared/csp';
import {
  allowedRendererOrigins,
  buildSecureWebPreferences,
  frameOrigin,
  isAllowedNavigation,
} from '../../src/main/security/window-options';

describe('窗口安全选项', () => {
  it('渲染进程禁用 Node 集成并开启隔离与沙箱', () => {
    const preferences = buildSecureWebPreferences({ preloadPath: 'C:\\app\\preload\\index.cjs', devTools: false });
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.sandbox).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.nodeIntegrationInWorker).toBe(false);
    expect(preferences.nodeIntegrationInSubFrames).toBe(false);
    expect(preferences.webviewTag).toBe(false);
    expect(preferences.webSecurity).toBe(true);
    expect(preferences.devTools).toBe(false);
    expect(preferences.preload).toBe('C:\\app\\preload\\index.cjs');
  });

  it('生产环境默认不开放开发者工具', () => {
    expect(buildSecureWebPreferences({ preloadPath: 'x', devTools: false }).devTools).toBe(false);
    expect(buildSecureWebPreferences({ preloadPath: 'x', devTools: true }).devTools).toBe(true);
  });
});

describe('内容安全策略', () => {
  it('生产策略覆盖必需指令且禁止外部连接', () => {
    const policy = buildContentSecurityPolicy('production');
    for (const directive of REQUIRED_PRODUCTION_DIRECTIVES) {
      expect(policy).toContain(directive);
    }
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain('http:');
    expect(policy).not.toContain('https:');
  });

  it('开发策略只对本地 dev server 放宽', () => {
    const policy = buildContentSecurityPolicy('development');
    expect(policy).toContain('http://127.0.0.1:5273');
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain('https://');
  });
});

describe('来源与导航白名单', () => {
  it('自定义协议来源按 scheme+host 归一化', () => {
    expect(frameOrigin(`${APP_ORIGIN}/index.html`)).toBe(APP_ORIGIN);
    expect(frameOrigin('http://127.0.0.1:5273/')).toBe('http://127.0.0.1:5273');
    expect(frameOrigin('file:///C:/app/index.html')).toBeNull();
    expect(frameOrigin('about:blank')).toBeNull();
    expect(frameOrigin('data:text/html,x')).toBeNull();
    expect(frameOrigin('https://evil.example/')).toBe('https://evil.example');
  });

  it('只允许打包协议或 dev server 的导航', () => {
    const origins = allowedRendererOrigins(null);
    expect(origins).toEqual([APP_ORIGIN]);
    expect(isAllowedNavigation(`${APP_ORIGIN}/index.html`, origins)).toBe(true);
    expect(isAllowedNavigation('https://example.com/', origins)).toBe(false);
    expect(isAllowedNavigation('file:///C:/Windows/System32/calc.exe', origins)).toBe(false);

    const devOrigins = allowedRendererOrigins('http://127.0.0.1:5273');
    expect(devOrigins).toEqual(['http://127.0.0.1:5273']);
    expect(isAllowedNavigation('http://127.0.0.1:5273/index.html', devOrigins)).toBe(true);
    expect(isAllowedNavigation(`${APP_ORIGIN}/index.html`, devOrigins)).toBe(false);
  });
});
