import { useEffect, useState, type JSX } from 'react';
import { call } from '../lib/bridge';
import type { Asset } from '../../shared/imports';
/** Token refresh only reads local resource, never starts recognition. */
export function ImagePreview({ asset, variant = 'prepared' }: {
    asset: Asset | {
        id: string;
    };
    variant?: 'original' | 'prepared';
}): JSX.Element {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => { let live = true; setUrl(null); setError(false); call(api => api.image.resource({ imageAssetId: asset.id, variant })).then(r => { if (live)
        setUrl(r.url); }).catch(() => { if (live)
        setError(true); }); return () => { live = false; }; }, [asset.id, variant, refresh]);
    if (error)
        return <span>原图未保留或预览不可用。<button className="button" onClick={() => setRefresh(n => n + 1)}>重读预览</button></span>;
    return url ? <img className="receipt-preview" src={url} alt={variant === 'original' ? '原图（仅本地）' : '本次上传图'} onError={() => { setError(true); setUrl(null); }}/> : <span>正在读取本地图像…</span>;
}
