import { describe, expect, it } from 'vitest';
import {
  OTHER_CATEGORY_ID,
  SYSTEM_CATEGORIES,
  SYSTEM_CATEGORY_COUNT,
} from '../../src/shared/categories';

describe('系统分类种子（ICON-MAP）', () => {
  it('固定 34 个分类：33 个消费分类 + 其他', () => {
    expect(SYSTEM_CATEGORY_COUNT).toBe(34);
    expect(SYSTEM_CATEGORIES).toHaveLength(34);
    const nonOther = SYSTEM_CATEGORIES.filter((category) => category.id !== OTHER_CATEGORY_ID);
    expect(nonOther).toHaveLength(33);
  });

  it('分类 ID 与 systemKey 唯一且稳定映射', () => {
    const ids = new Set(SYSTEM_CATEGORIES.map((category) => category.id));
    const keys = new Set(SYSTEM_CATEGORIES.map((category) => category.systemKey));
    expect(ids.size).toBe(34);
    expect(keys.size).toBe(34);
    for (const category of SYSTEM_CATEGORIES) {
      expect(category.id.startsWith('cat_')).toBe(true);
      expect(category.systemKey).toBe(category.id.replace(/^cat_/, ''));
    }
  });

  it('sortOrder 为序号 × 10 且从 10 开始', () => {
    SYSTEM_CATEGORIES.forEach((category, index) => {
      expect(category.sortOrder).toBe((index + 1) * 10);
      expect(category.enabled).toBe(true);
    });
  });

  it('中文名称顺序与 PRD 4.2 一致，且设置为独立入口而非分类', () => {
    expect(SYSTEM_CATEGORIES.map((category) => category.name)).toEqual([
      '餐饮', '购物', '日用', '交通', '蔬菜', '水果', '零食', '运动', '娱乐', '通讯', '服饰',
      '美容', '住房', '居家', '孩子', '长辈', '社交', '旅行', '烟酒', '数码', '汽车', '医疗',
      '书籍', '学习', '宠物', '礼金', '礼物', '办公', '维修', '捐赠', '彩票', '亲友', '快递',
      '其他',
    ]);
    expect(SYSTEM_CATEGORIES.some((category) => category.name === '设置')).toBe(false);
  });

  it('只有“其他”受保护，不能停用', () => {
    const protectedCategories = SYSTEM_CATEGORIES.filter((category) => category.protected);
    expect(protectedCategories.map((category) => category.id)).toEqual([OTHER_CATEGORY_ID]);
  });

  it('每个分类的 iconKey 都在本地白名单中', () => {
    for (const category of SYSTEM_CATEGORIES) {
      expect(category.iconKey.startsWith('lucide:')).toBe(true);
    }
  });
});
