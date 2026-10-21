import { useCallback, useEffect, useState, type JSX } from 'react';
import type { Candidate, ListResult } from '../../shared/imports';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { formatAmountFen } from '../lib/format';
import { Notice, PageHeader, Panel } from '../components/ui';
import { ImagePreview } from '../components/ImagePreview';
export function ReviewPage(): JSX.Element {
    const [data, setData] = useState<ListResult<Candidate> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const load = useCallback(async (more = false) => { try {
        const next = await call(api => api.candidate.list({ jobId: null, page: { limit: 100, cursor: more ? data?.nextCursor ?? null : null } }));
        setData(old => more && old ? { ...next, items: [...old.items, ...next.items] } : next);
        setError(null);
    }
    catch (e) {
        setError(describeError(e));
    } }, [data?.nextCursor]);
    useEffect(() => { void load(); }, [load]);
    return <div className="page"><PageHeader title="候选审核" subtitle="持久化草稿 · 尚未入账" actions={<button className="button" onClick={() => void load()}>刷新草稿</button>}/><Notice title="本步仅查看与核对">所有待审草稿对正式统计影响为0。补全、拒绝及人工批准入账在S11接入；此处无法直接入账。</Notice>{error ? <p role="alert">{error}</p> : null}<Panel title={`待审草稿（${data?.totalCount ?? 0}）`}>{!data ? <p role="status">正在读取草稿…</p> : !data.items.length ? <p>暂无待审核记录。</p> : data.items.map(c => <article key={c.id} className="candidate-card" data-candidate-id={c.id}><div className="image-compare"><div><h3>本次上传图</h3><ImagePreview asset={{ id: c.imageAssetId }}/></div><div><h3>{c.current.name ?? '购买内容未知，请补填'}</h3><p>金额：{c.current.amountFen === null ? '未识别，请对照图片补填实付金额' : formatAmountFen(c.current.amountFen)}</p><p>日期：{c.current.occurredDate ?? '日期未知，请补填含年份的实际日期'} · 时间：{c.current.occurredTime ?? '未知'}</p><p>分类：{c.current.categoryId ?? '未知，请选择'} · 类型：{c.current.transactionKind ?? '未知'}</p><p>{c.blocking ? '存在阻断疑点，需补全或核实' : '待人工逐项核对'} · {c.reviewState}</p>{c.excludedByDefault ? <p className="notice" data-tone="warn">疑似退款、转账或失败记录，默认排除，不能直接作为支出。</p> : null}{c.missingFields.length ? <p>缺失：{c.missingFields.join('、')}</p> : null}{c.duplicateMatches.length ? <p className="notice" data-tone="warn">疑似重复，等待审核：{c.duplicateMatches.map(m => `${m.targetType}:${m.targetId.slice(0, 8)} (${m.basis})`).join('；')}</p> : null}{c.warnings.map((w, i) => <p key={i}>{w.code}：{w.message}</p>)}</div></div><details><summary>字段证据与来源</summary><ul>{c.proposal.evidence.map((e, i) => <li key={i}>{e.field}：{e.text ?? '无文字证据'}{e.region ? '（区域相对本次上传图）' : ''}</li>)}</ul><p className="tiny hash-text">任务{c.jobId} · 来源图{c.imageAssetId} · SHA256 {c.preparedHash}</p><p>截图中的指令仅作为数据保存，不会执行。</p></details></article>)}{data?.nextCursor ? <button className="button" onClick={() => void load(true)}>加载更多草稿</button> : null}</Panel></div>;
}
