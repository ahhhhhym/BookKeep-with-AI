import type { JSX } from 'react';
import { EmptyState, Notice, PageHeader, Panel, SkeletonNotice } from '../components/ui';

/** P06 候选审核：待审候选、四字段确认与原子入账在 S11 实现。 */
export function ReviewPage(): JSX.Element {
  return (
    <div className="page">
      <PageHeader title="候选审核" subtitle="AI 结果只是候选；每笔都必须人工核对后才会写入正式账本。" />

      <Notice title="审核链路尚未接入">
        候选表、并排证据、逐笔确认与幂等批准事务在 S11 实现；当前没有候选数据，也不会自动入账。
      </Notice>

      <Panel title="待审核">
        <EmptyState title="暂无待审核记录。">
          识别完成后候选进入待审核，未被批准或已被拒绝的记录对正式统计影响为 0。
        </EmptyState>
      </Panel>

      <SkeletonNotice
        step="S11（审核入账）"
        items={[
          '金额 / 日期 / 名称 / 分类四项独立核对，缺字段阻断',
          '合计与明细不重复计入，退款/转账等默认排除',
          '唯一 sourceCandidateId，双击或重试不产生第二笔',
        ]}
      />
    </div>
  );
}
