/**
 * 系统分类种子（docs/ICON-MAP.md §2）。
 * Category.id 与 systemKey 稳定不变；sortOrder = 序号 × 10；“其他”按身份保护，不可停用。
 * 本文件只定义种子数据；落库/初始化事务由 S05 实现。
 */

export interface SystemCategorySeed {
  readonly id: string;
  readonly systemKey: string;
  readonly name: string;
  readonly iconKey: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
  /** 系统保护分类：只允许改名/换图标，不允许停用。 */
  readonly protected: boolean;
}

interface CategoryDefinition {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  { id: 'cat_food', name: '餐饮', slug: 'utensils' },
  { id: 'cat_shopping', name: '购物', slug: 'shopping-bag' },
  { id: 'cat_daily', name: '日用', slug: 'toilet' },
  { id: 'cat_transport', name: '交通', slug: 'bus-front' },
  { id: 'cat_vegetables', name: '蔬菜', slug: 'carrot' },
  { id: 'cat_fruit', name: '水果', slug: 'cherry' },
  { id: 'cat_snacks', name: '零食', slug: 'cupcake' },
  { id: 'cat_sport', name: '运动', slug: 'bike' },
  { id: 'cat_entertainment', name: '娱乐', slug: 'mic' },
  { id: 'cat_communication', name: '通讯', slug: 'phone-call' },
  { id: 'cat_clothing', name: '服饰', slug: 'shirt' },
  { id: 'cat_beauty', name: '美容', slug: 'brush' },
  { id: 'cat_housing', name: '住房', slug: 'house' },
  { id: 'cat_home', name: '居家', slug: 'armchair' },
  { id: 'cat_children', name: '孩子', slug: 'baby' },
  { id: 'cat_elders', name: '长辈', slug: 'person-standing' },
  { id: 'cat_social', name: '社交', slug: 'messages-square' },
  { id: 'cat_travel', name: '旅行', slug: 'plane' },
  { id: 'cat_tobacco_alcohol', name: '烟酒', slug: 'wine' },
  { id: 'cat_digital', name: '数码', slug: 'cable' },
  { id: 'cat_car', name: '汽车', slug: 'car' },
  { id: 'cat_medical', name: '医疗', slug: 'briefcase-medical' },
  { id: 'cat_books', name: '书籍', slug: 'book-bookmark' },
  { id: 'cat_study', name: '学习', slug: 'graduation-cap' },
  { id: 'cat_pet', name: '宠物', slug: 'dog' },
  { id: 'cat_cash_gift', name: '礼金', slug: 'banknote' },
  { id: 'cat_gift', name: '礼物', slug: 'gift' },
  { id: 'cat_office', name: '办公', slug: 'briefcase-business' },
  { id: 'cat_repair', name: '维修', slug: 'hammer' },
  { id: 'cat_donation', name: '捐赠', slug: 'heart-handshake' },
  { id: 'cat_lottery', name: '彩票', slug: 'ticket' },
  { id: 'cat_relatives', name: '亲友', slug: 'users-round' },
  { id: 'cat_delivery', name: '快递', slug: 'package' },
  { id: 'cat_other', name: '其他', slug: 'ellipsis' },
];

/** “设置”是导航入口，不是分类；不进 Category 表，不能作为交易分类。 */
export const NAV_SETTINGS_NAV_ID = 'nav_settings';

/** 受保护分类的稳定 systemKey（按身份判断，名称可改）。 */
export const PROTECTED_SYSTEM_KEYS: readonly string[] = ['other'];

export const SYSTEM_CATEGORIES: readonly SystemCategorySeed[] = CATEGORY_DEFINITIONS.map(
  (definition, index) => ({
    id: definition.id,
    systemKey: definition.id.replace(/^cat_/, ''),
    name: definition.name,
    iconKey: `lucide:${definition.slug}`,
    sortOrder: (index + 1) * 10,
    enabled: true,
    protected: definition.id === 'cat_other',
  }),
);

export const SYSTEM_CATEGORY_COUNT = SYSTEM_CATEGORIES.length;
export const OTHER_CATEGORY_ID = 'cat_other';
