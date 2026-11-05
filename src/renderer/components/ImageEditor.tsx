import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react';
import { call } from '../lib/bridge';
import type { Rect } from '../../shared/imports';
import {keyboardRect,type ImageEditSession} from '../lib/image-edit-session';
export function ImageEditor({ session, busy, onSave,onChange }: {
    session:ImageEditSession;
    onChange:(patch:Partial<Pick<ImageEditSession,'crop'|'masks'|'retainOriginal'>>)=>void;
    busy: boolean;
    onSave: () => void;
}): JSX.Element {
    const {asset,crop,masks,retainOriginal:retain}=session;
    busy=busy||!!session.attempt;
    const setCrop=(crop:Rect)=>onChange({crop,masks:[]});
    const setMasks=(v:Rect[]|((m:Rect[])=>Rect[]))=>onChange({masks:typeof v==='function'?v(masks):v});
    const setRetain=(retainOriginal:boolean)=>onChange({retainOriginal});
    const [activeMask,setActiveMask]=useState(0);
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
    <p className="tiny">在图片上拖出矩形；Tab选择裁剪框或遮盖块，方向键移动1像素，Shift加速10像素，Alt加方向键调整宽高，Home选择完整裁剪，Delete删除所选遮盖。重置仅回到当前已保存图片，无法还原已裁掉内容。遮盖为不透明黑色。</p>
    {loading ? <p role="status">正在读取本地图像…</p> : null}{previewError ? <p role="alert">预览已过期或不可用。<button className="button" onClick={() => setRefresh(n => n + 1)}>重新读取本地图像</button></p> : null}
    <div className="image-workspace"><canvas ref={canvas} tabIndex={0} role="img" aria-label="裁剪遮盖预览" onKeyDown={e=>{
      if(busy)return;
      if(mode==='crop'&&e.key==='Home'){e.preventDefault();setCrop({x:0,y:0,width:asset.width,height:asset.height});return;}
      if(mode==='mask'&&e.key==='Delete'){e.preventDefault();setMasks(masks.filter((_,i)=>i!==activeMask));setActiveMask(0);return;}
      if(!e.key.startsWith('Arrow'))return;e.preventDefault();
      if(mode==='crop')setCrop(keyboardRect(crop,e.key,e.altKey,e.shiftKey?10:1,asset.width,asset.height));
      else if(masks[activeMask])setMasks(masks.map((m,i)=>i===activeMask?keyboardRect(m,e.key,e.altKey,e.shiftKey?10:1,crop.width,crop.height):m));
    }} className={scale === null ? 'fit-image' : ''} style={scale === null ? undefined : { width: (mode === 'crop' ? asset.width : crop.width) * scale }} onPointerDown={e => { if (busy || !image || !valid)
        return; drag.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => { const start = drag.current; drag.current = null; if (!start)
        return; const end = point(e); const r = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x) + 1, height: Math.abs(end.y - start.y) + 1 }; if (mode === 'crop') {
        setCrop(r);
        setMasks([]);
    }
    else if (masks.length < 50)
        setMasks([...masks, r]); }}/></div>
    <div className="form-actions"><button className="button" disabled={masks.length >= 50 || busy} onClick={() => { setMode('mask'); setMasks([...masks, { x: 0, y: 0, width: Math.min(50, crop.width), height: Math.min(30, crop.height) }]); }}>添加遮盖</button><button className="button" disabled={!masks.length || busy} onClick={() => setMasks(m => m.slice(0, -1))}>撤销最后遮盖</button><button className="button" disabled={busy} onClick={() => { setCrop({ x: 0, y: 0, width: asset.width, height: asset.height }); setMasks([]); }}>取消编辑 / 重置</button></div>
    <div role="group" aria-label="编辑对象"><button className="button" aria-pressed={mode==='crop'} onClick={()=>{setMode('crop');canvas.current?.focus();}}>选择裁剪框</button>{masks.map((_,i)=><button className="button" key={i} aria-pressed={mode==='mask'&&activeMask===i} onClick={()=>{setActiveMask(i);setMode('mask');canvas.current?.focus();}}>选择遮盖{i+1}</button>)}</div>
    <p role="status" aria-live="polite">{mode==='crop'?`裁剪框：${crop.width}×${crop.height}，位置${crop.x}、${crop.y}`:masks[activeMask]?`遮盖${activeMask+1}：${masks[activeMask].width}×${masks[activeMask].height}，位置${masks[activeMask].x}、${masks[activeMask].y}`:'请选择或添加遮盖'}</p>
    <label className="check-row"><input type="checkbox" checked={retain} onChange={e => setRetain(e.target.checked)}/>保留本地原图，便于核对</label>
    {!retain ? <p className="notice" data-tone="warn">原图将在处理保存成功后移除，之后只能核对处理后的图片。已有任务引用的原图会保留。</p> : null}
    <button className="button button-primary" disabled={session.saving || !valid || loading || previewError} onClick={onSave}>{session.saving ? '正在保存处理图…' : '保存处理（仅本地）'}</button>
  </div>;
}
