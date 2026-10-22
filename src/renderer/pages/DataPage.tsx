import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { EmptyState, ErrorLine, Notice, PageHeader, Panel } from '../components/ui';
import { BridgeError, call, getBridge } from '../lib/bridge';
import { reconcileRestore, RESTORE_STATUS_TEXT } from '../lib/restore-status';
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
export function DataPage({ onDataRestored }: { onDataRestored?: () => void }): JSX.Element {
  const backupIntent=useRef<string|null>(null),restoreIntent=useRef<string|null>(null);
  const restoreBusy = useRef(false);
  const loadSequence = useRef(0);
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [datasetGeneration, setDatasetGeneration] = useState(0);
  const [records, setRecords] = useState<BackupRecordView[] | null>(null);
  const [preview, setPreview] = useState<BackupRestorePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (preserveError = false): Promise<void> => {
    const sequence = ++loadSequence.current;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const all:BackupRecordView[]=[];let cursor:string|null=null;
        do{const result=await call(api=>api.backup.list({page:{limit:50,cursor}}));all.push(...result.records);cursor=result.nextCursor;}while(cursor);
        if (sequence === loadSequence.current) setRecords(all);
        return;
      } catch (loadError) {
        if (sequence !== loadSequence.current) return;
        if (attempt === 0 && loadError instanceof BridgeError && ['STALE_EPOCH', 'SNAPSHOT_STALE'].includes(loadError.code)) continue;
        setRecords([]);
        if (!preserveError) setError(describeError(loadError));
        else setError(previous => [previous, `备份列表读取失败：${describeError(loadError)}`].filter(Boolean).join(' '));
        return;
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { ++loadSequence.current; };
  }, [load]);

  const refreshAfterRestore = async (): Promise<void> => {
    ++loadSequence.current;
    setRecords(null);
    setDatasetGeneration(value => value + 1);
    onDataRestored?.();
    await load(true);
  };

  const verifyRestore = async (restoreId: string): Promise<void> => {
    setVerifyId(restoreId);
    setVerifying(true);
    try {
      const api = getBridge();
      if (!api) throw new BridgeError('BRIDGE_UNAVAILABLE', null);
      const status = await reconcileRestore(api, restoreId);
      if (status.status === 'committed' || status.status === 'previously_committed') {
        setNotice(RESTORE_STATUS_TEXT[status.status]);
        setVerifyId(null);
        if (restoreIntent.current === restoreId) restoreIntent.current = null;
      } else {
        setError(RESTORE_STATUS_TEXT[status.status]);
      }
    } catch (statusError) {
      setError(`恢复结果尚未核实：${describeError(statusError)} 可按原恢复编号再次只读核实，请先勿重复覆盖。`);
    } finally {
      setVerifying(false);
      await refreshAfterRestore();
    }
  };

  const recheckRestore = async (): Promise<void> => {
    if (!verifyId || restoreBusy.current) return;
    restoreBusy.current = true;
    setPending(true); setError(null); setNotice(null);
    try { await verifyRestore(verifyId); }
    finally { restoreBusy.current = false; setPending(false); }
  };

  const createBackup = async (): Promise<void> => {
    if (
      !window.confirm(
        '备份包含账本、候选、审核记录及引用图片，可能含私人内容。不包含密钥、日志和独立数据集（含撤回/test记录）。请妥善保管，是否继续？',
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      backupIntent.current??=crypto.randomUUID();
      const result = await call((api) =>
        api.backup.create({ kind: 'manual', containsPrivateDataAcknowledged: true },{mutationId:backupIntent.current!}),
      );
      backupIntent.current=null;
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
      restoreIntent.current=crypto.randomUUID();
      setVerifyId(null);
      setPreview(previewResult);
    } catch (previewError) {
      setNotice(null);
      setError(describeError(previewError));
    } finally {
      setPending(false);
    }
  };

  const commitRestore = async (): Promise<void> => {
    if (!preview || restoreBusy.current) return;
    if (
      !window.confirm(
        '恢复会用所选备份替换当前账本数据（当前数据会先自动备份为“恢复前备份”）。是否继续？',
      )
    ) {
      return;
    }
    restoreBusy.current = true;
    const restoreId = restoreIntent.current ?? (restoreIntent.current = crypto.randomUUID());
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = (await call((api) =>
        api.backup.restore({
          mode: 'commit',
          restoreToken: preview.restoreToken,
          currentDataWillBeReplaced: true,
        },{mutationId:restoreId}),
      )) as BackupRestoreResult;
      setPreview(null);
      if (result.replayed) {
        await verifyRestore(restoreId);
        return;
      }
      restoreIntent.current=null;
      setVerifyId(null);
      setNotice(
        `恢复完成：已切换数据世代，当前修订号 ${result.revision}；恢复前备份 ${result.preRestoreBackupId.slice(0, 8)}…`,
      );
      await refreshAfterRestore();
    } catch (commitError) {
      setPreview(null);
      await verifyRestore(restoreId);
    } finally {
      restoreBusy.current = false;
      setPending(false);
    }
  };

  const exportCsv=async()=>{setPending(true);setError(null);try{const a=await call(api=>api.maintenance.exportCsv({filter:{dateStart:null,dateEnd:null,nameQuery:null,categoryIds:[],deleted:'active'},snapshotRevision:null}));const saved=await call(api=>api.maintenance.save({artifactId:a.artifactId}));setNotice(saved.saved?`已导出${a.recordCount}笔正式交易。`:'已取消保存。');}catch(e){setError(describeError(e));}finally{setPending(false);}};
  const saveBackup=async(id:string)=>{setPending(true);try{const a=await call(api=>api.maintenance.backupArtifact({backupId:id}));const saved=await call(api=>api.maintenance.save({artifactId:a.artifactId}));setNotice(saved.saved?'备份已保存到所选位置。':'已取消保存。');}catch(e){setError(describeError(e));}finally{setPending(false);}};
  const importBackup=async()=>{setPending(true);setError(null);try{const r=await call(api=>api.maintenance.selectBackup());if(!r.selectionToken)return;if(!window.confirm('将校验并登记所选备份，不立即替换账本。备份可能含私人内容，是否继续？'))return;await call(api=>api.maintenance.importBackup({selectionToken:r.selectionToken!,containsPrivateDataAcknowledged:true}));await load();setNotice('备份已校验并登记；请预览后单独确认恢复。');}catch(e){setError(describeError(e));}finally{setPending(false);}};
  return (
    <div className="page">
      <PageHeader
        title="数据管理"
        subtitle="CSV 导出、完整备份与恢复；数据库与备份保存在当前 Windows 用户目录，移动程序不会移动账本。"
      />

      {error ? <ErrorLine message={error} /> : null}
      {notice ? <Notice title="操作完成">{notice}</Notice> : null}
      {verifying ? <p role="status">正在只读核实恢复结果…</p> : null}
      {verifyId ? <div className="form-actions"><span className="tiny">恢复编号：{verifyId}</span><button className="button" disabled={pending} onClick={() => void recheckRestore()}>重新核实本次恢复状态</button></div> : null}
      <DatasetPanel key={datasetGeneration} />

      <div className="grid-2">
        <Panel title="正式交易 CSV">
          <p className="muted">导出全部正式未删除记录或当前筛选结果，UTF-8 带 BOM、CRLF、公式前缀转义。</p>
          <div className="form-actions">
            <button type="button" className="button" disabled={pending} onClick={()=>void exportCsv()}>
              选择保存位置并导出
            </button>
          </div>
          <p className="tiny">仅导出正式未删除交易；候选、失败任务和已删除记录不在范围内。</p>
        </Panel>

        <Panel title="账本与附件备份" actions={<span className="tiny">不含密钥/日志/独立数据集</span>}>
          <p className="muted">
            一致数据库快照，保存到 <code>%LOCALAPPDATA%\BookKeepAI\backups</code>；档案记录 schema、账本与修订号，
            恢复前会再次校验 hash 与完整性。
            包含候选与引用的原图/预处理图。独立数据集state/images/artifacts、撤回墓碑与test接触记录不在备份中，恢复时保持本地独立记录并使旧授权失效。
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
            <button className="button" disabled={pending} onClick={()=>void importBackup()}>选择外部备份</button>
          </div>
        </Panel>
      </div>

      <Panel title="备份档案" actions={<span className="tiny">{records?.length ?? 0} 个</span>}>
        {records === null ? (
          <EmptyState title="正在读取备份…" />
        ) : records.length === 0 ? (
          <EmptyState title={error ? '备份列表暂不可用' : '暂无备份'}>{error ? '请重新打开数据管理读取备份列表。' : '创建备份后可在此预览校验并恢复。'}</EmptyState>
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
                    <button className="button button-small" disabled={pending||!record.artifact} onClick={()=>void saveBackup(record.id)}>另存备份</button>
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

    </div>
  );
}
