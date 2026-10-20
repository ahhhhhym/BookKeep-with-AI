import type { JSX } from 'react';
import { EmptyState, Notice, PageHeader, Panel, SkeletonNotice } from '../components/ui';

/** P05 任务队列：只显示真实持久化任务；S04 没有任务表，因此是真空态。 */
export function QueuePage(): JSX.Element {
  return (
    <div className="page">
      <PageHeader title="任务队列" subtitle="识别任务按真实请求次数与持久化状态显示，不使用假进度。" />

      <Notice title="任务链路尚未接入">
        队列、并发（默认 2）、90 秒超时与两次退避重试在 S10 实现；当前不会发起任何网络请求。
      </Notice>

      <Panel title="任务">
        <EmptyState title="暂无识别任务。">
          导入图片并同意上传后，任务会显示排队中 / 正在识别 / 失败 / 已取消等真实状态。
        </EmptyState>
      </Panel>

      <SkeletonNotice
        step="S10（识别任务链路）"
        items={[
          '图片导入、预处理与 SHA-256 去重提示',
          '任务五态与 generation 栅栏，取消后迟到响应丢弃',
          '重启后 processing 转 INTERRUPTED，不自动续发',
        ]}
      />
    </div>
  );
}
