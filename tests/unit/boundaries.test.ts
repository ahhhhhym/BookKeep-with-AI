import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../src/main/ipc/rate-limit';
import { NAV_IDS, NAV_ITEMS_META } from '../../src/shared/nav';
import { isKnownIconKey } from '../../src/shared/icons';

describe('密钥提交限流', () => {
  it('每窗口最多 5 次，超限给出 retryAfterMs', () => {
    const limiter = createRateLimiter(5, 60_000);
    for (let index = 0; index < 5; index += 1) {
      expect(limiter.tryConsume(1_000).ok).toBe(true);
    }
    const denied = limiter.tryConsume(1_000);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('窗口滚动后恢复额度', () => {
    const limiter = createRateLimiter(2, 1_000);
    expect(limiter.tryConsume(0).ok).toBe(true);
    expect(limiter.tryConsume(0).ok).toBe(true);
    expect(limiter.tryConsume(0).ok).toBe(false);
    expect(limiter.tryConsume(1_001).ok).toBe(true);
  });

  it('构造参数非法时直接抛错，不静默放行', () => {
    expect(() => createRateLimiter(0, 1_000)).toThrow();
    expect(() => createRateLimiter(1, 0)).toThrow();
    expect(() => createRateLimiter(1.5, 1_000)).toThrow();
  });
});

describe('主导航元数据', () => {
  it('8 个入口且顺序与 UX §1 一致（设置独立、不是分类）', () => {
    expect(NAV_IDS).toHaveLength(8);
    expect(NAV_ITEMS_META.map((item) => item.label)).toEqual([
      '记账', '统计', '图片导入', '任务队列', '候选审核', '分类', '数据管理', '设置',
    ]);
    expect(NAV_ITEMS_META.at(-1)?.id).toBe('settings');
  });

  it('每个导航图标都在本地白名单内且标签唯一', () => {
    const labels = new Set<string>();
    for (const item of NAV_ITEMS_META) {
      expect(isKnownIconKey(item.iconKey)).toBe(true);
      expect(labels.has(item.label)).toBe(false);
      labels.add(item.label);
    }
  });
});
