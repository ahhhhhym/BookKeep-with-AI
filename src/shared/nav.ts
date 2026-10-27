/** 主导航与 AI 子页；分类业务数据不受可视导航影响。 */

export const NAV_IDS = [
  'ledger',
  'statistics',
  'ai',
  'data',
  'achievements',
  'settings',
] as const;

export const AI_PAGE_IDS = ['import', 'queue', 'review'] as const;
export type AiPageId = (typeof AI_PAGE_IDS)[number];
export type PrimaryNavId = (typeof NAV_IDS)[number];
export type NavId = PrimaryNavId | AiPageId;
export function primaryNavId(id: NavId): PrimaryNavId {
  return (AI_PAGE_IDS as readonly string[]).includes(id) ? 'ai' : id as PrimaryNavId;
}

export interface NavMeta {
  readonly id: NavId;
  readonly label: string;
  readonly iconKey: string;
  readonly description: string;
  readonly group: 'main' | 'bottom';
}

export const NAV_ITEMS_META: readonly NavMeta[] = [
  { id: 'ledger', label: '记账', iconKey: 'lucide:notebook-pen', description: '日期分组的支出列表', group: 'main' },
  { id: 'statistics', label: '统计', iconKey: 'lucide:chart-line', description: '周/月/年趋势与排行', group: 'main' },
  { id: 'ai', label: 'AI记账', iconKey: 'lucide:image-plus', description: '图片导入、任务队列与候选审核', group: 'main' },
  { id: 'data', label: '数据管理', iconKey: 'lucide:database', description: 'CSV 导出、备份与恢复', group: 'main' },
  { id: 'achievements', label: '成就', iconKey: 'lucide:party-popper', description: '成就页面骨架', group: 'bottom' },
  { id: 'settings', label: '设置', iconKey: 'lucide:settings', description: 'AI 服务、本地数据与关于', group: 'bottom' },
];

export const NAV_ITEM_COUNT = NAV_ITEMS_META.length;

export function isNavId(value: unknown): value is NavId {
  return typeof value === 'string' && ([...NAV_IDS, ...AI_PAGE_IDS] as readonly string[]).includes(value);
}
