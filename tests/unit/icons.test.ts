import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ICON_SLUGS,
  ICON_KEYS,
  ICON_SLUGS,
  iconSlug,
  isKnownIconKey,
  isCategoryIconKey,
} from '../../src/shared/icons';
import { ICON_COMPONENTS } from '../../src/renderer/lib/icon-registry';

describe('图标白名单与本地映射', () => {
  it('34 个分类图标 slug 唯一', () => {
    expect(CATEGORY_ICON_SLUGS).toHaveLength(34);
    expect(new Set(CATEGORY_ICON_SLUGS).size).toBe(34);
  });

  it('全部 slug（含导航）唯一且包含设置入口', () => {
    expect(ICON_SLUGS.length).toBeGreaterThanOrEqual(35);
    expect(new Set(ICON_SLUGS).size).toBe(ICON_SLUGS.length);
    expect(ICON_SLUGS).toContain('settings');
    expect(ICON_SLUGS.length).toBe(CATEGORY_ICON_SLUGS.length + 10);
    expect(ICON_SLUGS).toContain('party-popper');
    expect(isKnownIconKey('lucide:party-popper')).toBe(true);
    expect(isCategoryIconKey('lucide:party-popper')).toBe(false);
  });

  it('渲染映射覆盖且仅覆盖白名单 slug', () => {
    expect(Object.keys(ICON_COMPONENTS).sort()).toEqual([...ICON_SLUGS].sort());
    for (const slug of ICON_SLUGS) {
      const component = ICON_COMPONENTS[slug];
      expect(component).toBeTruthy();
      expect(['function', 'object']).toContain(typeof component);
    }
  });

  it('iconKey 前缀与反解一致', () => {
    for (const key of ICON_KEYS) {
      expect(key.startsWith('lucide:')).toBe(true);
      expect(isKnownIconKey(key)).toBe(true);
      expect(iconSlug(key)).toBe(key.slice('lucide:'.length));
    }
    expect(isKnownIconKey('lucide:unknown-icon')).toBe(false);
    expect(isKnownIconKey('lucide:')).toBe(false);
    expect(iconSlug('lucide:unknown-icon')).toBeNull();
    expect(iconSlug('not-lucide:utensils')).toBeNull();
  });
});
