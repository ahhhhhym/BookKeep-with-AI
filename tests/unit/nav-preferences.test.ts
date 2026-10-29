import { describe, expect, it } from 'vitest';
import { readNavMode, writeNavMode } from '../../src/renderer/lib/nav-preferences';
import { NAV_ITEMS_META } from '../../src/shared/nav';
import { isKnownIconKey, isCategoryIconKey } from '../../src/shared/icons';

describe('local navigation preferences', () => {
  it('defaults to detailed for first use, invalid data and unavailable storage', () => {
    for (const value of [null, '', 'rail', 'COMPACT', ' detailed ', 'null']) {
      expect(readNavMode({ getItem: () => value })).toBe('detailed');
    }
    expect(readNavMode(null)).toBe('detailed');
    expect(readNavMode({ getItem() { throw Error('denied'); } })).toBe('detailed');
  });
  it('writes and restores only the mode key, preserving the old width', () => {
    const data = new Map([['bookkeep.sidebarWidth', '280']]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    for (const mode of ['compact', 'detailed'] as const) {
      writeNavMode(storage, mode);
      expect(readNavMode(storage)).toBe(mode);
    }
    expect([...data.entries()]).toEqual([['bookkeep.sidebarWidth', '280'], ['bookkeep.navMode', 'detailed']]);
  });
  it('does not throw when a session mode cannot be persisted', () => {
    expect(() => writeNavMode(null, 'compact')).not.toThrow();
    expect(() => writeNavMode({ setItem() { throw Error('quota'); } }, 'compact')).not.toThrow();
  });
  it('changes only the ledger navigation name and registers a three-bar SVG', () => {
    expect(NAV_ITEMS_META.map(item => item.label)).toEqual(['账本', '统计', 'AI记账', '数据管理', '成就', '设置']);
    expect(isKnownIconKey('lucide:menu')).toBe(true);
    expect(isCategoryIconKey('lucide:menu')).toBe(false);
  });
});
