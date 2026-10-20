import { useState, type JSX } from 'react';
import { EmptyState, Notice, PageHeader, Panel, SkeletonNotice } from '../components/ui';
import { LEDGER_TIMEZONE, todayInLedgerTimezone } from '../lib/format';

type Period = 'week' | 'month' | 'year';

const PERIOD_LABEL: Record<Period, string> = { week: '周', month: '月', year: '年' };

/** P03 统计：周期切换交互占位；数值来自 S07 的同一统计服务，当前不显示任何伪造数字。 */
export function StatisticsPage(): JSX.Element {
  const [period, setPeriod] = useState<Period>('month');

  return (
    <div className="page">
      <PageHeader
        title="统计"
        subtitle={`仅统计正式、未删除的支出 · 账本时区 ${LEDGER_TIMEZONE} · 今天 ${todayInLedgerTimezone()}`}
        actions={
          <div className="segmented" role="group" aria-label="统计周期">
            {(['week', 'month', 'year'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
              >
                {PERIOD_LABEL[value]}
              </button>
            ))}
          </div>
        }
      />

      <Notice tone="warn" title="统计服务尚未接入">
        {PERIOD_LABEL[period]}视图的点位、环比与 Top3 将由 S07 基于账本整数分计算；本页当前不显示占位金额冒充真实结果。
      </Notice>

      <div className="metric-row">
        <div className="metric">
          <div className="metric-label">总支出</div>
          <div className="metric-value">—</div>
          <div className="metric-note">等待账本数据（S05）</div>
        </div>
        <div className="metric">
          <div className="metric-label">日均支出</div>
          <div className="metric-value">—</div>
          <div className="metric-note">分母为周期自然日数（含无消费日）</div>
        </div>
        <div className="metric">
          <div className="metric-label">分类排行</div>
          <div className="metric-value">—</div>
          <div className="metric-note">按聚合金额降序，金额并列按分类 ID</div>
        </div>
      </div>

      <Panel title={`本${PERIOD_LABEL[period]}趋势`}>
        <EmptyState title="图表将在 S07 实现">
          周视图 7 个日点、月视图 28～31 个日点、年视图 12 个月点；空点补 0，未来点标记“尚未到来”。
        </EmptyState>
      </Panel>

      <SkeletonNotice
        step="S07（统计图表）"
        items={[
          '周/月/年序列与补零，未来点空心标记',
          '日点前三笔交易、月点前三分类（总额在上）',
          '悬停 / 键盘聚焦 / 点击固定提示，与数据表同值',
        ]}
      />
    </div>
  );
}
