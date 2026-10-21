import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { isInsideDirectory, resolveStorageLayout } from '../../src/main/paths';

describe('本地存储布局', () => {
  it('LOCALAPPDATA 缺失时返回 STORAGE_UNAVAILABLE（不回退程序目录）', () => {
    const result = resolveStorageLayout({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('拒绝相对路径', () => {
    const result = resolveStorageLayout({ LOCALAPPDATA: 'relative\\AppData' });
    expect(result.ok).toBe(false);
  });

  it('根目录固定为 %LOCALAPPDATA%\\BookKeepAI', () => {
    const base = 'C:\\Users\\tester\\AppData\\Local';
    const result = resolveStorageLayout({ LOCALAPPDATA: base });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.root).toBe(path.join(base, 'BookKeepAI'));
    expect(result.layout.data).toBe(path.join(base, 'BookKeepAI', 'data'));
    expect(result.layout.secrets).toBe(path.join(base, 'BookKeepAI', 'secrets'));
    expect(result.layout.shell).toBe(path.join(base, 'BookKeepAI', 'shell'));
    // 程序目录/工作目录不得出现在任何运行期路径中。
    for (const value of Object.values(result.layout)) {
      expect(value.startsWith(path.join(base, 'BookKeepAI'))).toBe(true);
    }
  });

  it('目录包含判断拒绝前缀伪装', () => {
    expect(isInsideDirectory('C:\\data\\BookKeepAI\\a.db', 'C:\\data\\BookKeepAI')).toBe(true);
    expect(isInsideDirectory('C:\\data\\BookKeepAI', 'C:\\data\\BookKeepAI')).toBe(true);
    expect(isInsideDirectory('C:\\data\\BookKeepAI-evil\\a.db', 'C:\\data\\BookKeepAI')).toBe(false);
    expect(isInsideDirectory('C:\\other\\a.db', 'C:\\data\\BookKeepAI')).toBe(false);
  });
});
