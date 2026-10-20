/** 主导航定义（docs/UX.md §1：记账、统计、图片导入、任务队列、候选审核、分类、数据管理、设置）。 */

import type { NavId } from '../shared/nav';
import { NAV_ITEMS_META } from '../shared/nav';

export interface NavItem {
  readonly id: NavId;
  readonly label: string;
  readonly iconKey: string;
  readonly description: string;
}

export const NAV_ITEMS: readonly NavItem[] = NAV_ITEMS_META;

export const DEFAULT_NAV_ID: NavId = 'ledger';

export function navItem(id: NavId): NavItem {
  const found = NAV_ITEMS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown nav id: ${id}`);
  return found;
}
