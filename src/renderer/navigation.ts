/** 主导航：顶部四项，底部成就和设置。 */

import type { NavId, NavMeta } from '../shared/nav';
import { NAV_ITEMS_META, primaryNavId } from '../shared/nav';

export type NavItem = NavMeta;

export const NAV_ITEMS: readonly NavItem[] = NAV_ITEMS_META;

export const DEFAULT_NAV_ID: NavId = 'ledger';

export function navItem(id: NavId): NavItem {
  const found = NAV_ITEMS.find((item) => item.id === primaryNavId(id));
  if (!found) throw new Error(`unknown nav id: ${id}`);
  return found;
}
