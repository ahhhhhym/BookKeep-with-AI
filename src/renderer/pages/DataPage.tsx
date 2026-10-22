import { useCallback, useEffect, useState, type JSX } from 'react';
import { EmptyState, ErrorLine, Notice, PageHeader, Panel, SkeletonNotice } from '../components/ui';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { DatasetPanel } from '../components/DatasetPanel';
import type {
  BackupRecordView,
  BackupRestorePreviewResult,
  BackupRestoreResult,
} from '../../shared/entities';

const KIND_TEXT: Record<BackupRecordView['kind'], string> = {
  manual: '手动备份',
  pre_migration: '迁移前备份',
  pre_restore: '恢复前备份',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN');
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * P08 数据管理：正式交易 CSV（S15）与本地完整备份/恢复（S05 基础）。
 * 备份/恢复的真实文件操作全部在主进程；渲染层只拿到受限 Artifact/token。
 */
export function DataPage(): JSX.Element {
  const [records, setRecords] = useState<BackupRecordView[] | null>(null);
  const [preview, setPreview] = useState<BackupRestorePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await call((api) => api.backup.list());
      setRecords(result.records);
    } catch (loadError) {
      setError(describeError(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createBackup = async (): Promise<void> => {
    if (
      !window.confirm(
        '本地备份会包含账本数据库（可能含私人消费内容），请妥善保管；备份不含密钥与日志。是否继续？',
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await call((api) =>
        api.backup.create({ kind: 'manual', containsPrivateDataAcknowledged: true }),
      );
      setNotice(`已创建备份（${formatSize(result.artifact.byteSize)}）。`);
      await load();
    } catch (createError) {
      setError(describeError(createError));
    } finally {
      setPending(false);
    }
  };

  const previewRestore = async (record: BackupRecordView): Promise<void> => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await call((api) => api.backup.restore({ mode: 'preview', backupId: record.id }));
      const previewResult = result as BackupRestorePreviewResult;
      setPreview(previewResult);
    } catch (previewError) {
      setNotice(null);
      setError(describeError(previewError));
    } finally {
      setPending(false);
    }
  };

  const commitRestore = async (): Promise<void> => {
    if (!preview) return;
    if (
      !window.confirm(
        '恢复会用所选备份替换当前账本数据（当前数据会先自动备份为“恢复前备份”）。是否继续？',
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = (await call((api) =>
        api.backup.restore({
          mode: 'commit',
          restoreToken: preview.restoreToken,
          currentDataWillBeReplaced: true,
        }),
      )) as BackupRestoreResult;
      setPreview(null);
      setNotice(
        `恢复完成：已切换数据世代，当前修订号 ${result.revision}；恢复前备份 ${result.preRestoreBackupId.slice(0, 8)}…`,
      );
      await load();
    } catch (commitError) {
      setPreview(null);
      setError(describeError(commitError));
      await load();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="数据管理"
        subtitle="CSV 导出、完整备份与恢复；数据库与备份保存在当前 Windows 用户目录，移动程序不会移动账本。"
      />

      {error ? <ErrorLine message={error} /> : null}
      {notice ? <Notice title="操作完成">{notice}</Notice> : null}
      <DatasetPanel />

      <div className="grid-2">
        <Panel title="正式交易 CSV">
          <p className="muted">导出全部正式未删除记录或当前筛选结果，UTF-8 带 BOM、CRLF、公式前缀转义。</p>
          <div className="form-actions">
            <button type="button" className="button" disabled title="S15 实现">
              选择保存位置并导出
            </button>
          </div>
          <p className="tiny">导出接口按契约预留；S05 不伪造成功结果。</p>
        </Panel>

        <Panel title="本地数据库备份" actions={<span className="tiny">不含密钥/日志</span>}>
          <p className="muted">
            一致数据库快照，保存到 <code>%LOCALAPPDATA%\BookKeepAI\backups</code>；档案记录 schema、账本与修订号，
            恢复前会再次校验 hash 与完整性。
            当前仅支持无图片附件的账本；已有图片时会拒绝数据库单独备份或恢复。包含附件的完整备份将在S15接入。
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={pending}
              onClick={() => void createBackup()}
            >
              创建备份
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="备份档案" actions={<span className="tiny">{records?.length ?? 0} 个</span>}>
        {records === null ? (
          <EmptyState title="正在读取备份…" />
        ) : records.length === 0 ? (
          <EmptyState title="暂无备份">创建备份后可在此预览校验并恢复。</EmptyState>
        ) : (
          <table className="result-table">
            <thead>
              <tr>
                <th>创建时间</th>
                <th>类型</th>
                <th>schema</th>
                <th>大小</th>
                <th>状态</th>
                <th>SHA256</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{formatTime(record.createdAt)}</td>
                  <td>{KIND_TEXT[record.kind]}</td>
                  <td>{record.dbSchemaVersion}</td>
                  <td>{record.artifact ? formatSize(record.artifact.byteSize) : '—'}</td>
                  <td>
                    {record.status === 'completed'
                      ? record.artifact
                        ? '可用'
                        : '校验失败/不可恢复'
                      : record.status === 'failed'
                        ? '校验冲突/失败'
                        : record.status}
                  </td>
                  <td title={record.archiveHash ?? ''}>{record.archiveHash?.slice(0, 12) ?? '—'}…</td>
                  <td>
                    <button
                      type="button"
                      className="button button-small"
                      disabled={pending || record.status !== 'completed' || record.artifact === null}
                      title={record.artifact === null ? '备份文件缺失或校验冲突，无法恢复' : undefined}
                      onClick={() => void previewRestore(record)}
                    >
                      校验并恢复
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {preview ? (
        <Panel
          title="恢复预览"
          actions={
            <div className="form-actions">
              <button type="button" className="button" disabled={pending} onClick={() => setPreview(null)}>
                取消
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={pending}
                onClick={() => void commitRestore()}
              >
                确认覆盖当前数据并恢复
              </button>
            </div>
          }
        >
          <dl className="kv">
            <dt>备份</dt>
            <dd title={preview.backupId}>{preview.backupId}</dd>
            <dt>创建时间</dt>
            <dd>{formatTime(preview.createdAt)}</dd>
            <dt>schema</dt>
            <dd>
              {preview.dbSchemaVersion}
              {preview.schemaCompatibility === 'needs_migration' ? '（恢复时在 staging 迁移）' : ''}
            </dd>
            <dt>备份时修订号</dt>
            <dd>{preview.snapshotRevision}</dd>
            <dt>校验</dt>
            <dd>hash 与完整性已通过；版本 {preview.manifestVersion}</dd>
            {preview.lastAppliedRestoreId ? (
              <>
                <dt>此前恢复</dt>
                <dd>{preview.lastAppliedRestoreId}</dd>
              </>
            ) : null}
          </dl>
          <p className="tiny">恢复成功后 dataEpoch 会更换，旧页面缓存与令牌随之失效；当前数据会先自动备份。</p>
        </Panel>
      ) : null}

      <SkeletonNotice
        step="S15（CSV 与恢复加固）"
        items={[
          'CSV 全量快照导出与中文/公式安全检查',
          '恢复中断/断电故障注入与旧 generation 清理',
        ]}
      >
        CSV 导出与恢复的故障加固将在后续步骤实现；S05 已提供备份创建、校验预览与恢复切换基础。
      </SkeletonNotice>
    </div>
  );
}
