/** 主导航元数据（不依赖 React，便于单测；docs/UX.md §1 顺序固定）。 */

export const NAV_IDS = [
  'ledger',
  'statistics',
  'import',
  'queue',
  'review',
  'categories',
  'data',
  'settings',
] as const;

export type NavId = (typeof NAV_IDS)[number];

export interface NavMeta {
  readonly id: NavId;
  readonly label: string;
  readonly iconKey: string;
  readonly description: string;
}

export const NAV_ITEMS_META: readonly NavMeta[] = [
  { id: 'ledger', label: '记账', iconKey: 'lucide:notebook-pen', description: '日期分组的支出列表' },
  { id: 'statistics', label: '统计', iconKey: 'lucide:chart-line', description: '周/月/年趋势与排行' },
  { id: 'import', label: '图片导入', iconKey: 'lucide:image-plus', description: '截图预览、裁剪与遮盖' },
  { id: 'queue', label: '任务队列', iconKey: 'lucide:list-checks', description: '识别任务与真实进度' },
  { id: 'review', label: '候选审核', iconKey: 'lucide:clipboard-check', description: '逐笔核对后入账' },
  { id: 'categories', label: '分类', iconKey: 'lucide:layout-grid', description: '33 个分类与“其他”' },
  { id: 'data', label: '数据管理', iconKey: 'lucide:database', description: 'CSV 导出、备份与恢复' },
  { id: 'settings', label: '设置', iconKey: 'lucide:settings', description: 'AI 服务、本地数据与关于' },
];

export const NAV_ITEM_COUNT = NAV_ITEMS_META.length;

export function isNavId(value: unknown): value is NavId {
  return typeof value === 'string' && (NAV_IDS as readonly string[]).includes(value);
}
