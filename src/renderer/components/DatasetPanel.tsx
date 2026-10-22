import { useCallback, useEffect, useState } from 'react';
import { DATASET_NOTICE, DATASET_SCHEMA, FIELDS, type DatasetCommand, type DatasetSummary, type Label, type Metric, type Rights, type Sample, type Split } from '../../shared/dataset';
import type { Asset, Job, JobList } from '../../shared/imports';
import type { CategoryView } from '../../shared/entities';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { ErrorLine, Notice, Panel } from './ui';
import { ImagePreview } from './ImagePreview';
/** Explicit dataset workflow. This component never reads the transaction list. */
export function DatasetPanel() {
    const [summary, setSummary] = useState<DatasetSummary | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<Record<string, unknown> | null>(null), [asset, setAsset] = useState<Asset | null>(null);
    const [source, setSource] = useState(''), [person, setPerson] = useState(''), [license, setLicense] = useState(''), [recipient, setRecipient] = useState(''), [until, setUntil] = useState('');
    const [rightsChecked, setRightsChecked] = useState(false), [redactionChecked, setRedactionChecked] = useState(false), [datasetChecked, setDatasetChecked] = useState(false), [future, setFuture] = useState(false), [images, setImages] = useState(false);
    const [consentId, setConsentId] = useState<string | null>(null), [kind, setKind] = useState<'real' | 'synthetic'>('real'), [scene, setScene] = useState('单笔支付详情');
    const [jobs, setJobs] = useState<Job[]>([]), [predictionJobId, setPredictionJobId] = useState<string | null>(null);
    const [sample, setSample] = useState<Sample | null>(null), [history, setHistory] = useState<Sample[]>([]), [labels, setLabels] = useState<Label[]>([]), [categories, setCategories] = useState<CategoryView[]>([]);
    const [labelText, setLabelText] = useState('[]');
    const [amount, setAmount] = useState(''), [date, setDate] = useState(''), [time, setTime] = useState(''), [item, setItem] = useState(''), [category, setCategory] = useState(''), [transactionKind, setTransactionKind] = useState<Label['value']['transactionKind']>('expense');
    const [transactionId, setTransactionId] = useState(''), [reason, setReason] = useState(''), [relation, setRelation] = useState(''), [selected, setSelected] = useState<string[]>([]), [tag, setTag] = useState(''), [seed, setSeed] = useState('13');
    const [versionId, setVersionId] = useState(''), [split, setSplit] = useState<Split>('dev'), [upload, setUpload] = useState(false), [charge, setCharge] = useState(false), [runId, setRunId] = useState(''), [alignment, setAlignment] = useState('[]');
    const refresh = useCallback(async () => { setSummary(await call(api => api.dataset.read({ kind: 'summary', id: null })) as DatasetSummary); }, []);
    useEffect(() => { void refresh().catch(e => setError(describeError(e))); void call(api => api.category.list()).then(r => setCategories(r.categories)).catch(e => setError(describeError(e))); }, [refresh]);
    // Poll only while a real runner is active; the timer does not manufacture progress.
    useEffect(() => { if (!summary?.runs.some(r => r.status === 'queued' || r.status === 'processing'))
        return; const timer = window.setInterval(() => { void refresh().catch(e => setError(describeError(e))); }, 750); return () => clearInterval(timer); }, [summary, refresh]);
    const task = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try {
        await fn();
        await refresh();
    }
    catch (e) {
        setError(e instanceof Error && e.message === 'LOCAL_FORM' ? '请填写来源、许可、复核人、接收方、期限，并确认各项独立授权。' : describeError(e));
    }
    finally {
        setBusy(false);
    } };
    const command = async (c: DatasetCommand) => { const r = await call(api => api.dataset.command(c)) as Record<string, unknown>; setResult(r); return r; };
    const loadSample = async (id: string) => { const r = await call(api => api.dataset.read({ kind: 'sample', id })) as {
        sample: Sample;
        history: Sample[];
    }; setSample(r.sample); setLabels(r.sample.labels ?? []); setLabelText(JSON.stringify(r.sample.labels ?? [], null, 2)); setHistory(r.history); };
    const grant = async () => {
        if (!asset?.preparedHash || !source || !license || !person || !recipient || !until || !rightsChecked || !redactionChecked || !datasetChecked)
            throw new Error('LOCAL_FORM');
        const rights: Rights = { sourceType: 'other', sourceAlias: source, collectedOn: new Date().toISOString().slice(0, 10), registrar: person, licenseStatus: 'allowed', licenseAlias: license, licenseVersion: 'human-declaration.v1', purposes: future ? ['evaluation', 'future_training'] : ['evaluation'], recipients: [recipient], allowImages: images, retainUntil: new Date(until).toISOString(), reviewAt: new Date(until).toISOString(), redactionStatus: 'approved', redactionMethod: 'human-prepared-image.v1', redactionReviewer: person };
        const current = summary?.consents.filter(c => c.imageAssetId === asset.id && c.purpose === 'dataset').at(-1);
        const r = await command({ op: 'consent', imageAssetId: asset.id, preparedHash: asset.preparedHash, purpose: 'dataset', decision: 'grant', supersedesId: current?.id ?? null, noticeVersion: DATASET_NOTICE, rights, runManifestHash: null });
        setConsentId(r.consentId as string);
    };
    const addLabel = () => {
        const fen = amount === '' ? null : /^\d+(\.\d{1,2})?$/.test(amount) ? Number(amount.split('.')[0]) * 100 + Number((amount.split('.')[1] ?? '').padEnd(2, '0')) : NaN;
        if (!Number.isSafeInteger(fen ?? 1) || (time && !date)) {
            setError('金额最多两位小数；填写时间时必须同时有完整日期。');
            return;
        }
        const fields = { amountFen: fen, occurredDate: date || null, name: item || null, categoryId: category || null };
        const value: Label['value'] = { ...fields, occurredTime: time || null, timePrecision: date ? (time ? 'minute' : 'date') : 'unknown', merchant: null, transactionKind, amountBasis: 'line_payment', groupKey: null, lineItems: [], evidence: FIELDS.filter(f => fields[f] !== null).map(field => ({ field, text: String(fields[field]), region: null, source: 'human' })), missingFields: FIELDS.filter(f => fields[f] === null), warnings: transactionKind && transactionKind !== 'expense' ? [{ code: 'NON_EXPENSE', message: '人工确认非支出', field: 'transactionKind' }] : [], confidence: null };
        const label: Label = { labelId: crypto.randomUUID(), ordinal: labels.length, transactionId: transactionId || crypto.randomUUID(), value, facts: Object.fromEntries(FIELDS.map(f => [f, { status: fields[f] === null ? 'unknown' : 'known', reason: fields[f] === null ? 'not_visible' : 'prepared图可见，经人工标注', basisRef: null }])) as Label['facts'] };
        setLabels([...labels, label]);
        setLabelText(JSON.stringify([...labels, label], null, 2));
        setAmount('');
        setItem('');
        setTransactionId('');
    };
    const start = async (provider: 'mock' | 'deepseek') => {
        if (provider === 'deepseek') {
            if (!upload || !charge)
                throw new Error('LOCAL_FORM');
            const v = await call(api => api.dataset.read({ kind: 'version', id: versionId })) as {
                manifestHash: string;
                splits: Record<string, Split>;
                samples: {
                    id: string;
                    imageAssetId: string;
                    preparedHash: string;
                }[];
            };
            for (const s of v.samples.filter(s => v.splits[s.id] === split)) {
                const old = summary?.consents.filter(c => c.imageAssetId === s.imageAssetId && c.purpose === 'recognition').at(-1);
                await command({ op: 'consent', imageAssetId: s.imageAssetId, preparedHash: s.preparedHash, purpose: 'recognition', decision: 'grant', supersedesId: old?.id ?? null, noticeVersion: DATASET_NOTICE, rights: null, runManifestHash: v.manifestHash });
            }
        }
        const r = await command({ op: 'evaluate', versionId, scope: provider === 'mock' ? 'framework' : 'quality', provider, split, intent: split === 'test' ? 'final' : 'development', seed: Number(seed), promptVersion: 'bk-eval.s13.v1', possibleChargeAccepted: charge, fixture: null });
        setRunId(r.runId as string);
    };
    return <div data-dataset-panel>
    <Panel title="样本、评测与未来训练接口">
      <Notice title="框架运行与模型训练分别报告">本步提供登记、人工标注、导出及推理评测框架。模型未训练；训练提交与状态查询不支持。真实识别质量待S14人类样本验证。账本与候选不会自动加入数据集。</Notice>
      <p className="tiny">数据集独立保存在本地用户数据目录，不进入应用ZIP或现有账本备份。撤回后保留匿名传播记录；外部副本由人类处理。test只供固定方案最终评测，不提供调优内容导出。</p>
      {error ? <ErrorLine message={error}/> : null}
      <button className="button" disabled={busy} onClick={() => void task(refresh)}>刷新真实状态</button>
      <details><summary>1. 选择已脱敏图片，分别确认许可、脱敏及纳入数据集</summary>
        <button className="button" disabled={busy} onClick={() => void task(async () => { const r = await call(api => api.recognition.status({ jobId: null, statusFilter: ['completed'], page: { limit: 100, cursor: null } })) as JobList; setJobs(r.items); })}>读取已完成识图来源（不登记）</button>
        {jobs.length ? <label>选择同图AI预测来源<select aria-label="选择同图AI预测来源" value={predictionJobId ?? ''} onChange={e => void task(async () => { const job = jobs.find(j => j.id === e.target.value); if (!job)
        return; const r = await call(api => api.image.resource({ imageAssetId: job.imageAssetId, variant: 'prepared' })); setAsset(r.asset); setPredictionJobId(job.id); setConsentId(null); setDatasetChecked(false); setRedactionChecked(false); setRightsChecked(false); })}><option value="">请选择（最多最近100项）</option>{jobs.map(j => <option value={j.id} key={j.id}>{j.id.slice(0, 8)} / {j.provider} / {j.finishedAt}</option>)}</select></label> : null}
        <button className="button" disabled={busy} onClick={() => void task(async () => { const selection = await call(api => api.image.select()); if (!selection.tokens.length)
        return; const imported = await call(api => api.image.import({ selectionTokens: selection.tokens, retention: 'prepared_only' })); const a = imported.results[0]?.asset; if (!a)
        throw new Error('IMAGE_IMPORT'); const prepared = await call(api => api.image.prepare({ imageAssetId: a.id, expectedVersion: a.version, crop: null, masks: [], retainOriginal: false })); setAsset(prepared); setPredictionJobId(null); setConsentId(null); setDatasetChecked(false); setRedactionChecked(false); setRightsChecked(false); })}>选择已脱敏图片（只导入，不联网、不入集）</button>
        {asset ? <><ImagePreview asset={asset}/><p className="tiny">请检查像素与可读字段；需遮盖时先用“图片导入”页处理。图片摘要：{asset.preparedHash?.slice(0, 16)}</p></> : null}
        <div className="grid-2">
          <label>来源匿名别名<input value={source} onChange={e => setSource(e.target.value)}/></label>
          <label>许可依据匿名别名<input value={license} onChange={e => setLicense(e.target.value)}/></label>
          <label>登记/脱敏复核人别名<input value={person} onChange={e => setPerson(e.target.value)}/></label>
          <label>允许接收方范围<input value={recipient} onChange={e => setRecipient(e.target.value)}/></label>
          <label>保留及到期复核期限<input type="datetime-local" value={until} onChange={e => setUntil(e.target.value)}/></label>
          <label>素材类型<select aria-label="素材类型" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="real">人类真实样本</option><option value="synthetic">合成样本</option></select></label>
          <label>主场景<input value={scene} onChange={e => setScene(e.target.value)}/></label>
        </div>
        <p><label><input type="checkbox" checked={rightsChecked} onChange={e => setRightsChecked(e.target.checked)}/>我有权提供该图及许可范围</label></p>
        <p><label><input type="checkbox" checked={redactionChecked} onChange={e => setRedactionChecked(e.target.checked)}/>我已逐张检查脱敏像素及可见证据</label></p>
        <p><label><input type="checkbox" checked={datasetChecked} onChange={e => setDatasetChecked(e.target.checked)}/>独立同意本地登记、人工标注和评测；不等于上传识图同意</label></p>
        <p><label><input type="checkbox" checked={future} onChange={e => setFuture(e.target.checked)}/>另行允许未来训练准备用途（本步不训练）</label></p>
        <p><label><input type="checkbox" checked={images} onChange={e => setImages(e.target.checked)}/>允许向上述接收方导出prepared图片</label></p>
        <button className="button" disabled={busy || !asset} onClick={() => void task(grant)}>记录独立数据集同意</button>{' '}
        <button className="button button-primary" disabled={busy || !asset || !consentId} onClick={() => void task(async () => { const r = await command({ op: 'register', imageAssetId: asset!.id, preparedHash: asset!.preparedHash!, kind, consentId: consentId!, predictionJobId, primaryScene: scene, secondaryScenes: [], relations: [] }); await loadSample(r.sampleId as string); })}>显式登记当前样本</button>
      </details>
      <details open><summary>2. 人工标签、纠错与版本</summary>
        <div className="form-actions"><label>复核人/标注人别名<input value={person} onChange={e => setPerson(e.target.value)}/></label><label>修订或关联原因<input value={reason} onChange={e => setReason(e.target.value)}/></label></div>
        <table className="result-table"><thead><tr><th>选择整组</th><th>样本/版本</th><th>类型/场景</th><th>标注状态</th><th>操作</th></tr></thead><tbody>{summary?.samples.map(s => <tr key={s.id}><td><input aria-label={'选择样本 ' + s.id} type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))}/></td><td>{s.id.slice(0, 8)} / v{s.version}</td><td>{s.kind} / {s.primaryScene}</td><td>{s.reviewStatus}</td><td><button className="button" disabled={busy} onClick={() => void task(() => loadSample(s.id))}>标注/历史</button> <button className="button" disabled={busy} onClick={() => { if (window.confirm('撤回后立即阻断用途，并删除本地数据集副本。正式图片审计引用单独保留，外部副本不能保证收回。'))
        void task(async () => { await command({ op: 'withdraw', sampleId: s.id, reason: reason || 'human_withdrawal' }); setSample(null); }); }}>撤回并传播删除</button></td></tr>)}</tbody></table>
        {sample ? <div><h3>人工标注 {sample.id.slice(0, 8)} v{sample.version}</h3><ImagePreview asset={{ id: sample.imageAssetId }}/>
          <p className="tiny">每个独立支付添加一笔。不可见字段留空=unknown；人类外部补充值请在高级标签中标为assisted。商户不能代替购买物。未标注与确认无交易分开。</p>
          <div className="grid-2"><label>实付人民币元（未知留空）<input value={amount} onChange={e => setAmount(e.target.value)}/></label><label>完整日期（缺年留空）<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label><label>精确时间（未知留空）<input type="time" value={time} onChange={e => setTime(e.target.value)}/></label><label>购买物/服务<input value={item} onChange={e => setItem(e.target.value)}/></label><label>分类<select aria-label="分类" value={category} onChange={e => setCategory(e.target.value)}><option value="">未知</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>交易状态<select aria-label="交易状态" value={transactionKind ?? ''} onChange={e => setTransactionKind(e.target.value as typeof transactionKind || null)}>{['expense', 'refund', 'transfer', 'income', 'failed', 'closed', ''].map(s => <option key={s} value={s}>{s || '未知'}</option>)}</select></label><label>匿名交易关联ID（新交易可留空）<input value={transactionId} onChange={e => setTransactionId(e.target.value)}/></label></div>
          <button className="button" disabled={busy} onClick={addLabel}>加入一笔人工真值</button>{' '}<button className="button" disabled={busy} onClick={() => { setLabels([]); setLabelText('[]'); }}>明确标为无交易（空数组）</button>
          <details><summary>标签与证据JSON（多笔、unknown/assisted、合计关系）</summary><textarea aria-label="人工标签JSON" rows={12} value={labelText} onChange={e => { setLabelText(e.target.value); try {
            setLabels(JSON.parse(e.target.value));
            setError(null);
        }
        catch {
            setError('标签JSON暂未完整，请完成后保存。');
        } }}/></details>
          <p>当前标签：{labels.length}笔；原AI预测{sample.predictionAvailable ? '已冻结' : '无来源，不能当零检出'}。</p>
          <button className="button" disabled={busy || !person || !reason} onClick={() => void task(async () => { await command({ op: 'label', id: sample.id, expectedVersion: sample.version, labels: JSON.parse(labelText), annotator: person, reviewer: null, reviewMode: null, reason, correctionOfLockedTest: false }); await loadSample(sample.id); })}>保存人工标签/纠错版本</button>{' '}
          <button className="button" disabled={busy || sample.reviewStatus !== 'labelled' || !person || !reason} onClick={() => void task(async () => { await command({ op: 'label', id: sample.id, expectedVersion: sample.version, labels: JSON.parse(labelText), annotator: sample.annotator!, reviewer: person, reviewMode: person === sample.annotator ? 'same_person' : 'different_person', reason, correctionOfLockedTest: false }); await loadSample(sample.id); })}>完成第二次人工复核（同人会明示记录）</button>
          <p className="tiny">保留历史：{history.map(s => `v${s.version} ${s.reason}`).join('；')}</p>
        </div> : null}
        <label>近似图/订单匿名关联（疑似也按同组隔离）<input value={relation} onChange={e => setRelation(e.target.value)}/></label><button className="button" disabled={busy || !selected.length || !relation || !reason} onClick={() => void task(async () => { await command({ op: 'link', ids: selected, relation, reason }); })}>关联所选样本</button>
        <div className="form-actions"><label>不可复用版本名<input value={tag} onChange={e => setTag(e.target.value)}/></label><label>固定seed<input type="number" min="0" max="2147483647" value={seed} onChange={e => setSeed(e.target.value)}/></label><button className="button" disabled={busy || !selected.length || !tag} onClick={() => void task(async () => { const r = await command({ op: 'version', tag, sampleIds: selected, seed: Number(seed), synonyms: {}, synonymVersion: 'none.v1' }); setVersionId(r.versionId as string); })}>整组划分并冻结版本/test</button></div>
      </details>
      <details><summary>3. 校验、授权导出及推理评测</summary>
        <label>选择固定数据集版本<select aria-label="选择固定数据集版本" value={versionId} onChange={e => setVersionId(e.target.value)}><option value="">请选择</option>{summary?.versions.map(v => <option value={v.id} key={v.id}>{v.tag} / {v.status} {v.exploratory ? '探索' : ''} {v.contaminated ? '已污染' : ''}</option>)}</select></label>
        <button className="button" disabled={busy || !versionId} onClick={() => void task(async () => { await command({ op: 'validate', versionId }); })}>校验schema、许可、图片和清单</button>
        <p>向指定接收方导出会再次核对独立许可；完整版本含test时请改选允许的完整开发组。导出不会联网。</p>
        <label>导出接收方<input value={recipient} onChange={e => setRecipient(e.target.value)}/></label><label><input type="checkbox" checked={images} onChange={e => setImages(e.target.checked)}/>本次包含prepared图片</label><label><input type="checkbox" checked={future} onChange={e => setFuture(e.target.checked)}/>本次用途为未来训练准备</label>
        <button className="button" disabled={busy || !versionId || !recipient} onClick={() => { if (window.confirm(`确认向“${recipient}”导出${selected.length ? '所选完整组' : '全版本'}的标签${images ? '和prepared图片' : ''}？用途：${future ? '未来训练准备' : '评测'}。`))
        void task(async () => { const r = await command({ op: 'export', versionId, sampleIds: selected.length ? selected : null, includeImages: images, purpose: future ? 'future_training' : 'evaluation', recipient, confirmed: true }); await call(api => api.dataset.save({ artifactId: r.artifactId as string })); }); }}>确认范围并选择目录导出</button>
        <p><label>评测split<select aria-label="评测split" value={split} onChange={e => setSplit(e.target.value as Split)}><option>train</option><option>dev</option><option>test</option></select></label> test只允许固定方案最终评测；内容/误差用于调优即须退役。</p>
        <button className="button" disabled={busy || !versionId} onClick={() => void task(() => start('mock'))}>运行合成框架mock（空预测基线）</button>
        <p><label><input type="checkbox" checked={upload} onChange={e => setUpload(e.target.checked)}/>本次独立同意将该版本所选split的prepared图发送DeepSeek，仅作推理评测</label></p><p><label><input type="checkbox" checked={charge} onChange={e => setCharge(e.target.checked)}/>确认本次可能产生API费用（未知账单费用报告为N/A）</label></p>
        <button className="button" disabled={busy || !versionId || !upload || !charge} onClick={() => void task(() => start('deepseek'))}>运行真实provider质量评测</button>
        <button className="button" disabled={busy || !versionId || !reason} onClick={() => void task(async () => { await command({ op: 'contaminate', versionId, reason }); })}>登记test接触/污染并退役</button>
        <p className="tiny">推理结束后先看隐藏字段值的证据定位，人工盲对齐，再计分；禁止按金额/日期正确程度选匹配。合成最小样本与预定对齐由 npm run dataset:demo 提供。</p>
        <label>运行<select aria-label="运行" value={runId} onChange={e => setRunId(e.target.value)}><option value="">请选择</option>{summary?.runs.map(r => <option key={r.id} value={r.id}>{r.id.slice(0, 8)} / {r.provider} / {r.status}</option>)}</select></label>
        <button className="button" disabled={busy || !runId} onClick={() => void task(async () => { setResult(await call(api => api.dataset.read({ kind: 'blinded', id: runId })) as Record<string, unknown>); })}>读取盲对齐定位清单</button>{' '}<button className="button" disabled={busy || !runId} onClick={() => void task(async () => { await command({ op: 'cancel', runId }); })}>取消实际运行</button>
        <label>人工盲对齐清单JSON<textarea rows={4} value={alignment} onChange={e => setAlignment(e.target.value)}/></label>
        <button className="button" disabled={busy || !runId || !person} onClick={() => { if (window.confirm('确认只按图区域、来源行和序号作一对一盲对齐，未按被评字段值选配？'))
        void task(async () => { await command({ op: 'align', runId, alignment: JSON.parse(alignment), reviewer: person, blindConfirmed: true, duplicatePredictions: [] }); }); }}>确认盲对齐并生成分母报告</button>
        <button className="button" disabled={busy || !versionId} onClick={() => void task(async () => { await command({ op: 'submit', versionId }); })}>检测训练提交能力（预期不支持）</button>
        {summary?.runs.filter(r => r.report).map(r => <details key={r.id}><summary>{r.scope === 'framework' ? '框架已运行（mock）' : '推理评测结果'} / 模型未训练 / {r.id.slice(0, 8)}</summary>
          <p>真实模型质量：{r.scope === 'framework' ? '未评测' : '实验性推理结果，仍需S14复核'}；外部权重训练：未执行。</p>
          <table className="result-table"><thead><tr><th>指标</th><th>来源/场景/划分</th><th>分子/分母</th><th>值</th></tr></thead><tbody>{((r.report?.metrics ?? []) as Metric[]).map(m => <tr key={[m.key, m.kind, m.scene, m.split].join('/')}><td>{m.key}</td><td>{m.kind}/{m.scene}/{m.split}</td><td>{m.numerator}/{m.denominator}</td><td>{m.value === null ? 'N/A' : `${(m.value * 100).toFixed(2)}%`}</td></tr>)}</tbody></table>
          <details><summary>可复算的完整报告</summary><pre>{JSON.stringify(r.report, null, 2)}</pre></details></details>)}
        <h3>未来训练格式准备（本地转换，不训练权重）</h3>
        {summary?.exports.filter(e => e.status === 'completed').map(e => <p key={e.id}>{e.id.slice(0, 8)} / {e.recipient}{' '}<button className="button" disabled={busy} onClick={() => void task(async () => { const prepared = await command({ op: 'prepare', versionId: e.versionId, exportId: e.id, adapterVersion: 'future-training.v1' }); await command({ op: 'validatePrepared', versionId: e.versionId, artifactId: prepared.artifactId as string, manifestHash: e.manifestHash, schemaVersion: DATASET_SCHEMA }); })}>准备并校验授权训练格式（不出网）</button></p>)}
      </details>
      {busy ? <p role="status">正在执行实际操作…</p> : null}
      {result ? <details open><summary>本次实际结果（不代表阶段验收通过或模型训练完成）</summary><pre className="dataset-result">{JSON.stringify(result, null, 2)}</pre></details> : null}
      <details><summary>撤回/删除传播与外部副本待办（{summary?.withdrawals.length ?? 0}）</summary><pre>{JSON.stringify(summary?.withdrawals ?? [], null, 2)}</pre></details>
    </Panel>
  </div>;
}
