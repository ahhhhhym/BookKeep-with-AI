import { useEffect, useState, type JSX } from 'react';
import { call } from '../lib/bridge';
import type { Asset } from '../../shared/imports';
import type { Region } from '../../shared/candidate';
/** Token refresh only reads local resource, never starts recognition. */
export function ImagePreview({ asset, variant = 'prepared', onReady, region }: {
    asset: Asset | {
        id: string;
    };
    variant?: 'original' | 'prepared';
    onReady?: (ready:boolean)=>void;
    region?:Region|null;
}): JSX.Element {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => { let live = true; setUrl(null); setError(false); onReady?.(false); call(api => api.image.resource({ imageAssetId: asset.id, variant })).then(r => { if (live)
        setUrl(r.url); }).catch(() => { if (live)
        {setError(true);onReady?.(false);} }); return () => { live = false; }; }, [asset.id, variant, refresh, onReady]);
    if (error)
        return <span>原图未保留或预览不可用。<button className="button" onClick={() => setRefresh(n => n + 1)}>重读预览</button></span>;
    return url ? <span className="receipt-frame"><img className="receipt-preview" src={url} alt={variant === 'original' ? '原图（仅本地）' : '本次上传图'} onLoad={()=>onReady?.(true)} onError={() => { setError(true); setUrl(null);onReady?.(false); }}/>{region&&variant==='prepared'?<span className="evidence-region" aria-label="所选字段的图像证据区域" style={{left:`${region.x*100}%`,top:`${region.y*100}%`,width:`${region.width*100}%`,height:`${region.height*100}%`}}/>:null}</span> : <span>正在读取本地图像…</span>;
}
