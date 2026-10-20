import type { JSX } from 'react';
import { Notice, PageHeader, Panel, SkeletonNotice } from '../components/ui';

const CARDS = [
  {
    title: '正式交易 CSV',
    body: '导出全部正式未删除记录或当前筛选结果，UTF-8 带 BOM、CRLF、公式前缀转义。',
    action: '选择保存位置并导出',
  },
  {
    title: '本地完整备份',
    body: '包含账本、候选、审计及被引用图片，不含密钥；可能包含私人内容，请妥善保管。',
    action: '创建备份',
  },
  {
    title: '从备份恢复',
    body: '先校验档案与版本，再备份当前数据；失败保留原账本，恢复后需要重新同意上传与数据集用途。',
    action: '选择备份并预览',
  },
];

/** P08 数据导出、备份与恢复：入口按规格预留，实际文件操作在 S05/S15 实现。 */
export function DataPage(): JSX.Element {
  return (
    <div className="page">
      <PageHeader title="数据管理" subtitle="CSV 导出、完整备份与恢复；数据保存在当前 Windows 用户目录，移动程序不会移动账本。" />

      <Notice title="文件操作尚未接入">
        导出、备份与恢复都需要主进程受控的原生文件对话框与一致性快照，将在 S05/S15 实现。
      </Notice>

      <div className="grid-2">
        {CARDS.map((card) => (
          <Panel key={card.title} title={card.title}>
            <p className="muted">{card.body}</p>
            <div className="form-actions">
              <button type="button" className="button" disabled title="此功能尚未实现">
                {card.action}
              </button>
            </div>
          </Panel>
        ))}
      </div>

      <SkeletonNotice
        step="S05 / S15（导出与恢复）"
        items={[
          'CSV 全量快照导出与中文/公式安全检查',
          '备份清单 bk-backup.v1 与一致快照',
          '恢复前备份、切换日志与新 dataEpoch',
        ]}
      />
    </div>
  );
}
