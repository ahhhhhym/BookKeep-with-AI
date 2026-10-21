import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { Job, JobList, JobStatus } from '../../shared/imports';
import { NOTICE_VERSION } from '../../shared/imports';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { PageHeader, Panel, Notice } from '../components/ui';
import { Modal } from '../components/Modal';
import { ImagePreview } from '../components/ImagePreview';
const labels: Record<JobStatus, string> = { queued: '排队中', processing: '正在识别', completed: '识别完成', failed: '识别失败', cancelled: '已取消' };
export function QueuePage(): JSX.Element {
    const [data, setData] = useState<JobList | null>(null);
    const [filter, setFilter] = useState<JobStatus | ''>('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState<Job | null>(null);
    const [consent, setConsent] = useState(false);
    const alive = useRef(true);
    const inFlight = useRef(false);
    const options = useRef<{
        key: string;
        id: string;
    } | null>(null);
    const load = useCallback(async (more = false) => { if (inFlight.current)
        return; inFlight.current = true; try {
        const result = await call(api => api.recognition.status({ jobId: null, statusFilter: filter ? [filter] : [], page: { limit: 100, cursor: more ? data?.nextCursor ?? null : null } }));
        if (alive.current && 'items' in result) {
            setData(old => more && old ? { ...result, items: [...old.items, ...result.items] } : result);
            setError(null);
        }
    }
    catch (e) {
        if (alive.current)
            setError(describeError(e));
    }
    finally {
        inFlight.current = false;
    } }, [filter, data?.nextCursor]);
    useEffect(() => { alive.current = true; void load(); const timer = setInterval(() => void load(), 1500); return () => { alive.current = false; clearInterval(timer); }; }, [load]);
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
    return <div className="page"><PageHeader title="任务队列" subtitle="并发2 · 单次90秒 · 最多3次真实请求。识别完成只生成待审草稿。"/><Notice>重启后不会自动补发收费请求。取消后不再接收本次结果，已发送的请求仍可能计费。</Notice><div className="form-actions"><label>状态筛选<select value={filter} onChange={e => setFilter(e.target.value as JobStatus | '')}><option value="">全部</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="button" onClick={() => void load()}>刷新任务</button></div>{error ? <p role="alert">{error}</p> : null}
    <Panel title={`已结束 ${ended}/${total} 张（成功${counts?.completed ?? 0} / 失败${counts?.failed ?? 0} / 取消${counts?.cancelled ?? 0}）`}>{!data ? <p role="status">正在读取任务…</p> : !data.items.length ? <p>暂无识别任务。</p> : data.items.map(job => <article className="task-row" key={job.id} data-job-id={job.id} data-status={job.status}><div className="task-thumb"><ImagePreview asset={{ id: job.imageAssetId }}/></div><div><strong>{labels[job.status]} · {job.id.slice(0, 8)}</strong><p>{job.provider === 'mock' ? '本地模拟（未出网）' : job.actualModel ?? job.model} · 本轮请求{job.attempt}/3次 · 累计{job.totalAttempts}次</p>{job.status === 'processing' ? <p role="status">正在识别，第{job.attempt}次请求…（不定进度）</p> : null}{job.needsConsent && job.status === 'queued' ? <p>任务已保留，请确认本次上传后继续。</p> : null}{job.nextAttemptAt && !job.needsConsent ? <p>退避至{new Date(job.nextAttemptAt).toLocaleTimeString('zh-CN')}后再次请求。</p> : null}{job.errorCode ? <p>{job.errorCode === 'INTERRUPTED' ? '上次识别被中断，结果未确认。请检查后手动重试。' : job.errorCode}；没有新增正式支出。</p> : null}{job.status === 'completed' ? <p>{job.candidateCount ? `生成${job.candidateCount}笔候选，尚未入账，请到候选审核查看。` : '未找到可确认支出，可检查图片或手工记账。'}</p> : null}</div><div className="form-actions">{['processing', 'queued'].includes(job.status) ? <button className="button" disabled={busy} onClick={() => void act(job)}>请求取消</button> : null}{['failed', 'cancelled'].includes(job.status) || (job.status === 'queued' && job.needsConsent) ? <button className="button" disabled={busy} onClick={() => { setConfirm(job); setConsent(false); }}>{job.status === 'queued' ? '重新同意并继续' : '重试'}</button> : null}</div></article>)}{data?.nextCursor ? <button className="button" onClick={() => void load(true)}>加载更多</button> : null}</Panel>
    {confirm ? <Modal title="确认再次请求" busy={busy} onClose={() => setConfirm(null)}><p>将上传本图，可能重复计费。取消不能撤回已经发送的数据或费用。</p><ImagePreview asset={{ id: confirm.imageAssetId }}/><label className="check-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>我同意上传本图并接受可能产生的费用</label><div className="form-actions"><button className="button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="button button-primary" disabled={busy || !consent} onClick={() => void act(confirm, true)}>{busy ? '正在提交…' : '确认请求'}</button></div></Modal> : null}
  </div>;
}
