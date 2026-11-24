import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { Job, JobList, JobStatus } from '../../shared/imports';
import { NOTICE_VERSION } from '../../shared/imports';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { EmptyState, PageHeader, Panel, Spinner, StatusDot } from '../components/ui';
import { Modal } from '../components/Modal';
import { ImagePreview } from '../components/ImagePreview';
import type { NavId } from '../../shared/nav';
const labels: Record<JobStatus, string> = { queued: '排队中', processing: '正在识别', completed: '识别完成', failed: '识别失败', cancelled: '已取消' };
export function QueuePage({ onNavigate }: { readonly onNavigate?: (id: NavId) => void } = {}): JSX.Element {
    const [data, setData] = useState<JobList | null>(null);
    const [filter, setFilter] = useState<JobStatus | ''>('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState<Job | null>(null);
    const [consent, setConsent] = useState(false);
    const alive = useRef(true);
    const inFlight = useRef(false);
    const currentData = useRef<JobList | null>(null);
    const currentFilter = useRef(filter);
    currentFilter.current = filter;
    const options = useRef<{
        key: string;
        id: string;
    } | null>(null);
    const load = useCallback(async (cursor: string | null = null) => { if (inFlight.current)
        return; inFlight.current = true; try {
        const read = async (nextCursor: string | null): Promise<JobList> => {
            const result = await call(api => api.recognition.status({ jobId: null, statusFilter: filter ? [filter] : [], page: { limit: 100, cursor: nextCursor } }));
            if (!('items' in result))
                throw new Error('Unexpected job result');
            return result;
        };
        const previous = currentData.current;
        let result = await read(cursor);
        if (cursor && previous)
            result = { ...result, items: [...previous.items, ...result.items] };
        else {
            // Refresh every already displayed page with cursors from the same new snapshot.
            const visibleCount = previous?.items.length ?? 100;
            while (result.nextCursor && result.items.length < visibleCount) {
                const next = await read(result.nextCursor);
                result = { ...next, items: [...result.items, ...next.items] };
            }
        }
        if (alive.current && currentFilter.current === filter) {
            currentData.current = result;
            setData(result);
            setError(null);
        }
    }
    catch (e) {
        if (alive.current && currentFilter.current === filter)
            setError(describeError(e));
    }
    finally {
        inFlight.current = false;
    } }, [filter]);
    useEffect(() => { alive.current = true; currentData.current = null; setData(null); void load(); const timer = setInterval(() => void load(), 1500); return () => { alive.current = false; clearInterval(timer); }; }, [load]);
    const act = async (job: Job, retry = false) => { setBusy(true); try {
        const key = JSON.stringify({ id: job.id, version: job.version, retry });
        if (options.current?.key !== key)
            options.current = { key, id: crypto.randomUUID() };
        const opt = { mutationId: options.current!.id };
        if (retry) {
            const input = { jobId: job.id, expectedVersion: job.version, possibleChargeAccepted: true as const, uploadConsent: { preparedHash: job.preparedHash, confirmed: true as const, noticeVersion: NOTICE_VERSION as typeof NOTICE_VERSION } };
            await call(api => job.status === 'queued' ? api.recognition.resume(input, opt) : api.recognition.retry(input, opt));
        }
        else
            await call(api => api.recognition.cancel({ jobId: job.id, expectedVersion: job.version }, opt));
        options.current = null;
        setConfirm(null);
        setConsent(false);
        await load();
    }
    catch (e) {
        setError(describeError(e));
    }
    finally {
        setBusy(false);
    } };
    const counts = data?.counts;
    const ended = counts ? counts.completed + counts.failed + counts.cancelled : 0;
    const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
    return <div className="page"><PageHeader title="任务队列" subtitle="识别完成后会生成待审草稿，经你确认后才会入账。"/>
    {total > 0 ? <div className="form-actions"><label className="field">状态筛选<select value={filter} onChange={e => setFilter(e.target.value as JobStatus | '')}><option value="">全部</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="button" onClick={() => void load()}>刷新</button></div> : null}
    {error ? <p role="alert" className="error-line">{error}</p> : null}
    {!data ? <p role="status" className="muted status-inline"><Spinner />正在读取任务…</p> : total === 0 ? <EmptyState title="暂无识别任务" action={onNavigate ? <button type="button" className="button button-primary" onClick={() => onNavigate('import')}>去导入图片</button> : undefined}>导入消费截图后，识别进度与结果会显示在这里。</EmptyState> : <Panel title={`已完成 ${ended} / ${total}`} actions={<span className="tiny">成功 {counts?.completed ?? 0} · 失败 {counts?.failed ?? 0} · 取消 {counts?.cancelled ?? 0}</span>}>{!data.items.length ? <p className="muted">当前筛选下没有任务。</p> : data.items.map(job => <article className="task-row" key={job.id} data-job-id={job.id} data-status={job.status}><div className="task-thumb"><ImagePreview asset={{ id: job.imageAssetId }}/></div><div><strong className="status-inline">{job.status === 'processing' ? <StatusDot tone="primary" /> : null}{labels[job.status]}</strong><p className="tiny">{job.provider === 'mock' ? '本地模拟（未出网）' : job.actualModel ?? job.model} · 第 {job.attempt}/3 次尝试</p>{job.status === 'processing' ? <p role="status" className="status-inline"><Spinner />正在识别中…</p> : null}{job.needsConsent && job.status === 'queued' ? <p>任务已保留，请确认上传后继续。</p> : null}{job.nextAttemptAt && !job.needsConsent ? <p>将于 {new Date(job.nextAttemptAt).toLocaleTimeString('zh-CN')} 后自动重试。</p> : null}{job.errorCode ? <p>{job.errorCode === 'INTERRUPTED' ? '上次识别被中断，未生成正式支出，可手动重试。' : `${job.errorCode}，未生成正式支出。`}</p> : null}{job.status === 'completed' ? <p>{job.candidateCount ? `已生成 ${job.candidateCount} 笔待审候选，尚未入账。` : '未识别到可确认的支出，可检查图片或手工记账。'}</p> : null}</div><div className="form-actions">{job.status === 'completed' && job.candidateCount > 0 && onNavigate ? <button className="button button-primary" onClick={() => onNavigate('review')}>去审核候选</button> : null}{['processing', 'queued'].includes(job.status) ? <button className="button button-danger-ghost" disabled={busy} onClick={() => void act(job)}>取消任务</button> : null}{['failed', 'cancelled'].includes(job.status) || (job.status === 'queued' && job.needsConsent) ? <button className="button" disabled={busy} onClick={() => { setConfirm(job); setConsent(false); }}>{job.status === 'queued' ? '重新同意并继续' : '重试'}</button> : null}</div></article>)}{data?.nextCursor ? <button className="button" onClick={() => void load(data.nextCursor)}>加载更多</button> : null}</Panel>}
    {confirm ? <Modal title="确认再次请求" busy={busy} onClose={() => setConfirm(null)}><p>将再次上传本图，可能重复产生 API 费用。</p><ImagePreview asset={{ id: confirm.imageAssetId }}/><label className="check-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>我同意上传本图并接受可能产生的费用</label><div className="expense-actions"><button className="button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="button button-primary" disabled={busy || !consent} onClick={() => void act(confirm, true)}>{busy ? <><Spinner />正在提交…</> : '确认请求'}</button></div></Modal> : null}
  </div>;
}
