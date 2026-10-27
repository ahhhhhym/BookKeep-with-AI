/**
 * 图标白名单（docs/ICON-MAP.md §1/§3）。
 * 持久 iconKey 形如 lucide:<slug>，与 Category.id 分开；图标改名不得改分类 ID。
 * 34 个分类图标由 ICON-MAP 固定；导航图标是同一本地依赖集的附加条目（已逐项核验 slug 存在）。
 * 运行时渲染映射在渲染层（src/renderer/lib/icon-registry.tsx）。
 */

export const ICON_KEY_PREFIX = 'lucide:';

/** 34 个分类图标 slug（顺序与 ICON-MAP §2 一致）。 */
export const CATEGORY_ICON_SLUGS: readonly string[] = [
  'utensils',
  'shopping-bag',
  'toilet',
  'bus-front',
  'carrot',
  'cherry',
  'cupcake',
  'bike',
  'mic',
  'phone-call',
  'shirt',
  'brush',
  'house',
  'armchair',
  'baby',
  'person-standing',
  'messages-square',
  'plane',
  'wine',
  'cable',
  'car',
  'briefcase-medical',
  'book-bookmark',
  'graduation-cap',
  'dog',
  'banknote',
  'gift',
  'briefcase-business',
  'hammer',
  'heart-handshake',
  'ticket',
  'users-round',
  'package',
  'ellipsis',
];

/** 导航“设置”入口图标，不是分类（ICON-MAP §3）。 */
export const NAV_SETTINGS_ICON_SLUG = 'settings';

/** 主导航图标（本地 Lucide 资源；与分类图标同源、同许可）。 */
export const NAV_ICON_SLUGS: readonly string[] = [
  'notebook-pen',
  'chart-line',
  'image-plus',
  'list-checks',
  'clipboard-check',
  'layout-grid',
  'database',
  'party-popper',
  NAV_SETTINGS_ICON_SLUG,
];

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** 全部本地图标 slug（分类 + 导航），唯一化后用于资源核验。 */
export const ICON_SLUGS: readonly string[] = unique([...CATEGORY_ICON_SLUGS, ...NAV_ICON_SLUGS]);

export const ICON_KEYS: readonly string[] = ICON_SLUGS.map((slug) => `${ICON_KEY_PREFIX}${slug}`);

const ICON_KEY_SET: ReadonlySet<string> = new Set(ICON_KEYS);

export function isKnownIconKey(value: unknown): value is string {
  return typeof value === 'string' && ICON_KEY_SET.has(value);
}

/** 分类只能使用 34 个分类图标；“设置”等导航图标不是分类图标。 */
export function isCategoryIconKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(ICON_KEY_PREFIX) &&
    CATEGORY_ICON_SLUGS.includes(value.slice(ICON_KEY_PREFIX.length))
  );
}

export function iconSlug(iconKey: string): string | null {
  if (!iconKey.startsWith(ICON_KEY_PREFIX)) return null;
  const slug = iconKey.slice(ICON_KEY_PREFIX.length);
  return ICON_SLUGS.includes(slug) ? slug : null;
}
