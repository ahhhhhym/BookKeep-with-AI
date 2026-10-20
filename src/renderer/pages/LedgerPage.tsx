import type { JSX } from 'react';
import { EmptyState, Notice, PageHeader, Panel, SkeletonNotice } from '../components/ui';

/** P01 记账列表：S04 只提供导航空壳与真实空态，不伪造账本数据。 */
export function LedgerPage(): JSX.Element {
  return (
    <div className="page">
      <PageHeader
        title="记账"
        subtitle="按日期分组的支出列表，只统计正式且未删除的交易。"
        actions={
          <button type="button" className="button button-primary" disabled aria-describedby="ledger-pending">
            记一笔
          </button>
        }
      />

      <Notice tone="warn" title="账本数据尚未接入">
        默认账本、分类种子与交易存储将在 S05/S06 实现。当前页面不读取、不写入任何账本数据，也不显示示例金额。
      </Notice>

      <Panel title="支出列表">
        <EmptyState title="还没有支出，记下第一笔吧。">
          账本建立后，这里按“今天 / 昨天 / 具体日期 · 星期”分组显示条目、分类图标与金额。
        </EmptyState>
      </Panel>

      <div id="ledger-pending">
        <SkeletonNotice
          step="S05（数据与账本）/ S06（手工记账）"
          items={[
            '首次启动幂等建立“默认账本”与 33+其他 分类',
            '手工新增 / 编辑 / 软删除 / 恢复，整数分金额校验',
            '日期分组、折叠、名称搜索与分类筛选',
          ]}
        />
      </div>
    </div>
  );
}
