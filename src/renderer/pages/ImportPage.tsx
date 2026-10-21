import { useRef, useState, type JSX } from 'react';
import { Notice, PageHeader, Panel } from '../components/ui';
import { Modal } from '../components/Modal';
import { ImagePreview } from '../components/ImagePreview';
import { ImageEditor } from '../components/ImageEditor';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { IMPORT_PROMPT, NOTICE_VERSION, type Asset, type Rect, type Selection } from '../../shared/imports';
export function ImportPage({ onError }: {
    readonly onError: (message: string | null) => void;
}): JSX.Element {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [errors, setErrors] = useState<string[]>([]);
    const [upload, setUpload] = useState(false);
    const [consent, setConsent] = useState(false);
    const [provider, setProvider] = useState<'deepseek' | 'mock'>('deepseek');
    const [forceNew, setForceNew] = useState(false);
    const [reason, setReason] = useState('');
    const mutation = useRef<{
        key: string;
        id: string;
    } | null>(null);
    const intent = (key: string) => { if (mutation.current?.key !== key)
        mutation.current = { key, id: crypto.randomUUID() }; return { mutationId: mutation.current!.id }; };
    const fail = (error: unknown) => { const text = describeError(error); setErrors([text]); onError(text); };
    const doImport = async (selection: Selection) => {
        if (!selection.tokens.length)
            return;
        const input = { selectionTokens: selection.tokens, retention: 'keep_original' as const };
        const result = await call(api => api.image.import(input, intent(JSON.stringify(input))));
        mutation.current = null;
        const imported = result.results.flatMap(r => r.asset ? [r.asset] : []);
        setAssets(previous => [...previous, ...imported.filter(a => !previous.some(p => p.id === a.id))]);
        setSelected(imported[0]?.id ?? null);
        setErrors(result.results.flatMap((r, i) => r.errorCode ? [`第${i + 1}张：${r.errorCode}（未上传）`] : []));
        setMessage(`本地校验完成 ${result.results.length}/${selection.tokens.length}。${result.results.filter(r => r.reused).length} 张同图已复用；保存预处理后再识别。`);
    };
    const choose = async (files?: File[]) => { if (busy)
        return; setBusy(true); setErrors([]); onError(null); try {
        await doImport(await call(api => files ? api.image.drop(files) : api.image.select()));
    }
    catch (e) {
        fail(e);
    }
    finally {
        setBusy(false);
    } };
    const asset = assets.find(a => a.id === selected);
    const prepared = assets.filter(a => a.preparedHash);
    const save = async (crop: Rect | null, masks: Rect[], retainOriginal: boolean) => { if (!asset)
        return; setBusy(true); setErrors([]); try {
        const input = { imageAssetId: asset.id, expectedVersion: asset.version, crop, masks, retainOriginal };
        const next = await call(api => api.image.prepare(input, intent(JSON.stringify(input))));
        mutation.current = null;
        setAssets(list => list.map(a => a.id === asset.id ? next : a));
        setSelected(next.id);
        setConsent(false);
        setMessage('处理图已保存。请检查本次上传图并重新同意上传。');
    }
    catch (e) {
        fail(e);
    }
    finally {
        setBusy(false);
    } };
    const start = async () => { setBusy(true); setErrors([]); try {
        const input = { images: prepared.map(a => ({ imageAssetId: a.id, preparedHash: a.preparedHash! })), provider, promptVersion: IMPORT_PROMPT as typeof IMPORT_PROMPT, uploadConsent: prepared.map(a => ({ preparedHash: a.preparedHash!, confirmed: true as const, noticeVersion: NOTICE_VERSION as typeof NOTICE_VERSION })), forceNew, reason: forceNew ? reason : null };
        const result = await call(api => api.recognition.start(input, intent(JSON.stringify(input))));
        mutation.current = null;
        setUpload(false);
        setConsent(false);
        setMessage(`已建立${result.createdIds.length}个任务，复用${result.reusedIds.length}个已有任务。请到任务队列查看真实状态；候选尚未入账。`);
    }
    catch (e) {
        fail(e);
    }
    finally {
        setBusy(false);
    } };
    return <div className="page" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void choose([...e.dataTransfer.files]); }}>
    <PageHeader title="图片导入" subtitle="JPEG / PNG / WebP · 单张10MiB · 最长边8192像素 · 每批20张" actions={<button className="button button-primary" disabled={busy} onClick={() => void choose()}>选择图片</button>}/>
    <Notice title="先在本地整理，再决定上传">可将消费图片拖到这里。识图可能产生费用，失败或重试也可能计费；上传不会自动加入训练或评测数据集。手工记账始终可用。</Notice>
    {busy ? <p role="status">正在处理本次操作…</p> : null}{message ? <p role="status">{message}</p> : null}{errors.map((text, i) => <p key={i} className="notice" data-tone="danger" role="alert">{text}</p>)}
    {!assets.length ? <Panel title="本地图片"><p>选择或拖入消费截图，导入后先在本地预览。</p></Panel> : <>
      <Panel title={`本批图片（${assets.length}）`}><div className="import-assets">{assets.map((a, i) => <div key={a.id}><button className="button" disabled={busy} aria-pressed={a.id === selected} onClick={() => setSelected(a.id)}>图片{i + 1} · {a.preparedHash ? '已处理' : '待处理'}</button><button className="button" disabled={busy} onClick={() => { setAssets(list => list.filter(x => x.id !== a.id)); setConsent(false); }}>本次排除</button></div>)}</div></Panel>
      {asset ? <Panel title="预览与隐私处理"><ImageEditor key={asset.id} asset={asset} busy={busy} onSave={(c, m, r) => void save(c, m, r)}/>{asset.preparedHash ? <details open><summary>核对原图（仅本地）与本次上传图</summary><div className="image-compare">{asset.originalRetained ? <ImagePreview asset={asset} variant="original"/> : <p>原图未保留，只能核对处理图。</p>}<ImagePreview asset={asset}/></div><p className="tiny hash-text">来源 SHA256 {asset.originalHash}<br />处理后 SHA256 {asset.preparedHash}</p></details> : null}</Panel> : null}
      <button className="button button-primary" disabled={busy || !prepared.length || prepared.length > 20} onClick={() => { setConsent(false); setUpload(true); }}>开始识别（{prepared.length}张处理图）</button>{prepared.length > 20 ? <p role="alert">本次超过20张，请先排除部分图片。</p> : null}
    </>}
    {upload ? <Modal title="确认本次识别" busy={busy} onClose={() => setUpload(false)}><p>只发送下列处理图和当前分类字典。识图可能产生费用，失败或重试也可能计费。每笔候选必须另行人工批准。</p><div className="upload-previews">{prepared.map(a => <ImagePreview key={a.id} asset={a}/>)}</div><label>提供商<select value={provider} onChange={e => setProvider(e.target.value as 'deepseek' | 'mock')}><option value="deepseek">DeepSeek 真实图片识别</option><option value="mock">本地模拟（不出网，合成结果写草稿）</option></select></label><label className="check-row"><input type="checkbox" checked={forceNew} onChange={e => setForceNew(e.target.checked)}/>明确另建任务（默认同图复用；另建可能重复计费和产生重复候选）</label>{forceNew ? <label>另建理由<input value={reason} maxLength={500} onChange={e => setReason(e.target.value)}/></label> : null}<label className="check-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>我同意以上处理图用于本次识别，了解可能产生费用</label><div className="form-actions"><button className="button" disabled={busy} onClick={() => setUpload(false)}>取消</button><button className="button button-primary" disabled={busy || !consent || (forceNew && !reason.trim())} onClick={() => void start()}>{busy ? '正在建立任务…' : provider === 'mock' ? '生成本地模拟草稿' : '上传并识别'}</button></div></Modal> : null}
  </div>;
}
