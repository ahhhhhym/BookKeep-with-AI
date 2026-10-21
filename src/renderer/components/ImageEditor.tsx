import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react';
import { call } from '../lib/bridge';
import type { Asset, Rect } from '../../shared/imports';
function RectFields({ label, value, onChange }: {
    label: string;
    value: Rect;
    onChange: (r: Rect) => void;
}): JSX.Element {
    return <fieldset className="rect-fields"><legend>{label}</legend>{(['x', 'y', 'width', 'height'] as const).map(k => <label key={k}>{({ x: 'X', y: 'Y', width: '宽', height: '高' })[k]}<input aria-label={`${label} ${k}`} type="number" min={k === 'width' || k === 'height' ? 1 : 0} step="1" value={value[k]} onChange={e => onChange({ ...value, [k]: Number(e.target.value) })}/></label>)}</fieldset>;
}
export function ImageEditor({ asset, busy, onSave }: {
    asset: Asset;
    busy: boolean;
    onSave: (crop: Rect | null, masks: Rect[], retain: boolean) => void;
}): JSX.Element {
    const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, width: asset.width, height: asset.height });
    const [masks, setMasks] = useState<Rect[]>([]);
    const [retain, setRetain] = useState(asset.originalRetained);
    const [mode, setMode] = useState<'crop' | 'mask'>('crop');
    const [scale, setScale] = useState<number | null>(null);
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [loading, setLoading] = useState(true);
    const [previewError, setPreviewError] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const canvas = useRef<HTMLCanvasElement>(null);
    const drag = useRef<{
        x: number;
        y: number;
    } | null>(null);
    const variant = asset.preparedHash ? 'prepared' : 'original';
    useEffect(() => { let live = true; setLoading(true); setPreviewError(false); call(api => api.image.resource({ imageAssetId: asset.id, variant })).then(r => { const img = new Image(); img.onload = () => { if (live) {
        setImage(img);
        setLoading(false);
    } }; img.onerror = () => { if (live) {
        setLoading(false);
        setPreviewError(true);
    } }; img.src = r.url; }).catch(() => { if (live) {
        setLoading(false);
        setPreviewError(true);
    } }); return () => { live = false; }; }, [asset.id, variant, refresh]);
    const valid = crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0 && crop.x + crop.width <= asset.width && crop.y + crop.height <= asset.height;
    useEffect(() => {
        const el = canvas.current;
        const ctx = el?.getContext('2d');
        if (!el || !ctx || !image || !valid)
            return;
        el.width = mode === 'crop' ? asset.width : crop.width;
        el.height = mode === 'crop' ? asset.height : crop.height;
        ctx.clearRect(0, 0, el.width, el.height);
        if (mode === 'crop') {
            ctx.drawImage(image, 0, 0);
            ctx.strokeStyle = '#327b68';
            ctx.lineWidth = Math.max(2, asset.width / 300);
            ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
        }
        else {
            ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
            ctx.fillStyle = '#000';
            for (const m of masks)
                ctx.fillRect(m.x, m.y, m.width, m.height);
        }
    }, [image, crop, masks, mode, asset.width, asset.height, valid]);
    const point = (e: PointerEvent<HTMLCanvasElement>) => { const el = e.currentTarget; const box = el.getBoundingClientRect(); return { x: Math.max(0, Math.min(el.width - 1, Math.floor((e.clientX - box.left) * el.width / box.width))), y: Math.max(0, Math.min(el.height - 1, Math.floor((e.clientY - box.top) * el.height / box.height))) }; };
    return <div className="image-editor">
    <div className="form-actions"><button className="button" disabled={busy} onClick={() => setMode('crop')} aria-pressed={mode === 'crop'}>裁剪（源图像素）</button><button className="button" disabled={busy || !valid} onClick={() => setMode('mask')} aria-pressed={mode === 'mask'}>遮盖（裁剪后像素）</button><button className="button" onClick={() => setScale(null)}>适应窗口</button><button className="button" onClick={() => setScale(1)}>100%</button><button className="button" onClick={() => setScale(n => Math.min(4, (n ?? 1) * 1.25))}>放大</button><button className="button" onClick={() => setScale(n => Math.max(.1, (n ?? 1) / 1.25))}>缩小</button></div>
    <p className="tiny">在图片上拖出矩形，或键盘输入坐标。遮盖为不透明黑色；放大后可滚动查看。</p>
    {loading ? <p role="status">正在读取本地图像…</p> : null}{previewError ? <p role="alert">预览已过期或不可用。<button className="button" onClick={() => setRefresh(n => n + 1)}>重新读取本地图像</button></p> : null}
    <div className="image-workspace"><canvas ref={canvas} aria-label="裁剪遮盖预览" className={scale === null ? 'fit-image' : ''} style={scale === null ? undefined : { width: (mode === 'crop' ? asset.width : crop.width) * scale }} onPointerDown={e => { if (busy || !image || !valid)
        return; drag.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => { const start = drag.current; drag.current = null; if (!start)
        return; const end = point(e); const r = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x) + 1, height: Math.abs(end.y - start.y) + 1 }; if (mode === 'crop') {
        setCrop(r);
        setMasks([]);
    }
    else if (masks.length < 50)
        setMasks([...masks, r]); }}/></div>
    <RectFields label="裁剪" value={crop} onChange={r => { setCrop(r); setMasks([]); }}/>
    <div className="form-actions"><button className="button" disabled={masks.length >= 50 || busy} onClick={() => { setMode('mask'); setMasks([...masks, { x: 0, y: 0, width: Math.min(50, crop.width), height: Math.min(30, crop.height) }]); }}>添加遮盖</button><button className="button" disabled={!masks.length || busy} onClick={() => setMasks(m => m.slice(0, -1))}>撤销最后遮盖</button><button className="button" disabled={busy} onClick={() => { setCrop({ x: 0, y: 0, width: asset.width, height: asset.height }); setMasks([]); }}>取消编辑 / 重置</button></div>
    {masks.map((m, i) => <div key={i}><RectFields label={`遮盖${i + 1}`} value={m} onChange={r => setMasks(ms => ms.map((old, j) => j === i ? r : old))}/><button className="button" disabled={busy} onClick={() => setMasks(ms => ms.filter((_, j) => j !== i))}>删除遮盖{i + 1}</button></div>)}
    <label className="check-row"><input type="checkbox" checked={retain} onChange={e => setRetain(e.target.checked)}/>保留本地原图，便于核对</label>
    {!retain ? <p className="notice" data-tone="warn">原图将在处理保存成功后移除，之后只能核对处理后的图片。已有任务引用的原图会保留。</p> : null}
    <button className="button button-primary" disabled={busy || !valid || loading || previewError} onClick={() => onSave(crop, masks, retain)}>{busy ? '正在保存处理图…' : '保存预处理（仅本地）'}</button>
  </div>;
}
