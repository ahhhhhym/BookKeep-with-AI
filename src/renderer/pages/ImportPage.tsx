import {useEffect,useRef,useState,type JSX} from 'react';
import {Notice,PageHeader,Panel} from '../components/ui';
import {Modal} from '../components/Modal';
import {ImagePreview} from '../components/ImagePreview';
import {ImageEditor} from '../components/ImageEditor';
import {call} from '../lib/bridge';
import {describeError} from '../lib/messages';
import {newImageSession,editImage,beginImageSave,finishImageSave,failImageSave,discardImage,type ImageEditSession} from '../lib/image-edit-session';
import type {LeaveGuard} from '../components/ExpenseEditor';
import {IMPORT_PROMPT,NOTICE_VERSION,type Asset,type StartInput} from '../../shared/imports';
export function ImportPage({onError,registerGuard,provider,onProviderChange}:{onError:(message:string|null)=>void;registerGuard:(g:LeaveGuard)=>void;provider:'deepseek'|'mock';onProviderChange:(v:'deepseek'|'mock')=>void}):JSX.Element{
 const [sessions,setSessions]=useState<ImageEditSession[]>([]),[selected,setSelected]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [snapshot,setSnapshot]=useState<{assets:Asset[];input:StartInput}|null>(null),[consent,setConsent]=useState(false),[readable,setReadable]=useState<Record<string,boolean>>({});
 const [forceNew,setForceNew]=useState(false),[reason,setReason]=useState('');
 const [leaving,setLeaving]=useState(false);
 const pending=useRef<(()=>void)|null>(null),saving=useRef(false),live=useRef(true);
 const current=useRef({sessions,selected,busy});current.current={sessions,selected,busy};
 const uploadMutation=useRef<string|null>(null);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const invalidate=()=>{setSnapshot(null);setConsent(false);setReadable({});uploadMutation.current=null;};
 const fail=(e:unknown)=>{const text=describeError(e);setError(text);onError(text);};
 const dirty=()=>current.current.sessions.some(s=>s.dirty||s.saving||s.failed);
 const guard=(next:()=>void)=>{if(pending.current||saving.current||current.current.busy)return;if(dirty()){pending.current=next;setLeaving(true);}else next();};
 useEffect(()=>{registerGuard(guard);return()=>registerGuard(null);},[registerGuard]);
 useEffect(()=>{const f=(e:BeforeUnloadEvent)=>{if(dirty()||saving.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',f);return()=>window.removeEventListener('beforeunload',f);},[]);
 useEffect(()=>{const cancel=()=>{pending.current=null;setLeaving(false);};window.addEventListener('bookkeep:close-cancelled',cancel);return()=>window.removeEventListener('bookkeep:close-cancelled',cancel);},[]);
 const replace=(id:string,s:ImageEditSession)=>{setSessions(old=>old.map(v=>v.asset.id===id?s:v));};
 async function saveSession(s:ImageEditSession):Promise<boolean>{
  if(saving.current)return false;saving.current=true;setBusy(true);setError('');invalidate();
  const attempt=beginImageSave(s,crypto.randomUUID());replace(s.asset.id,attempt);
  try{const a=await call(api=>api.image.prepare(attempt.attempt!.input,{mutationId:attempt.attempt!.mutationId}));
    if(!live.current)return false;
    replace(s.asset.id,finishImageSave(attempt,a,attempt.attempt!.mutationId));if(current.current.selected===s.asset.id)setSelected(a.id);
    setMessage('处理图已保存，当前编辑区已更新。开始识别时请重新检查并同意上传。');return true;
  }catch(e){if(live.current){replace(s.asset.id,failImageSave(attempt));fail(e);}return false;}
  finally{saving.current=false;if(live.current)setBusy(false);}
 }
 async function choose(files?:File[]){if(current.current.busy)return;setBusy(true);setError('');invalidate();try{
  const selection=await call(a=>files?a.image.drop(files):a.image.select());if(!selection.tokens.length)return;
  const result=await call(a=>a.image.import({selectionTokens:selection.tokens,retention:'keep_original'}));
  const assets=result.results.flatMap(r=>r.asset?[r.asset]:[]);
  setSessions(old=>[...old,...assets.filter(a=>!old.some(s=>s.asset.id===a.id)).map(newImageSession)]);setSelected(assets[0]?.id??current.current.selected);
  setMessage(`本地导入${assets.length}张图片，保存处理后再识别。`);setError(result.results.filter(r=>r.errorCode).map(r=>r.errorCode).join('；'));
 }catch(e){fail(e);}finally{setBusy(false);}}
 const assetSession=sessions.find(s=>s.asset.id===selected),prepared=sessions.filter(s=>s.asset.preparedHash).map(s=>s.asset);
 const start=async()=>{if(!snapshot||!consent||dirty()||busy)return;setBusy(true);setError('');try{
  uploadMutation.current??=crypto.randomUUID();const r=await call(a=>a.recognition.start(snapshot.input,{mutationId:uploadMutation.current!}));
  invalidate();setMessage(`已建立${r.createdIds.length}个任务，复用${r.reusedIds.length}个任务。请在任务队列查看；候选尚未入账。`);
 }catch(e){fail(e);setConsent(false);}finally{setBusy(false);}};
 const cancelLeave=()=>{pending.current=null;setLeaving(false);window.dispatchEvent(new Event('bookkeep:leave-cancel'));};
 const continueLeave=()=>{const next=pending.current;pending.current=null;setLeaving(false);next?.();};
 return <div className="page" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const files=[...e.dataTransfer.files];guard(()=>void choose(files));}}>
  <PageHeader title="图片导入" subtitle="JPEG / PNG / WebP · 单张10MiB · 每批20张" actions={<button className="button button-primary" disabled={busy} onClick={()=>guard(()=>void choose())}>选择图片</button>}/>
  <Notice title="先在本地整理，再决定上传">裁剪、遮盖与保存仅在本机进行，不会发起识别。识别可能计费，候选必须逐笔审核；不会自动加入训练或评测数据集。</Notice>
  {busy?<p role="status">正在处理本次操作…</p>:null}{message?<p role="status">{message}</p>:null}{error?<p role="alert">{error} 输入仍保留；请重试保存或继续编辑。</p>:null}
  <Panel title={`本批图片（${sessions.length}）`}><div className="import-assets">{sessions.map((s,i)=><div key={s.asset.id}><button className="button" disabled={busy} aria-pressed={selected===s.asset.id} onClick={()=>{if(selected!==s.asset.id)guard(()=>{invalidate();setSelected(s.asset.id);});}}>图片{i+1} · {s.dirty?'未保存':s.asset.preparedHash?'已处理':'待处理'}</button><button className="button" disabled={busy} onClick={()=>guard(()=>{invalidate();setSessions(old=>old.filter(x=>x.asset.id!==s.asset.id));if(selected===s.asset.id)setSelected(null);} )}>本次排除</button></div>)}</div>{!sessions.length?<p>选择或拖入图片，在一个编辑区完成处理。</p>:null}</Panel>
  {assetSession?<Panel title="图片编辑与隐私处理"><ImageEditor key={assetSession.asset.id} session={assetSession} busy={busy} onChange={patch=>{invalidate();setSessions(old=>old.map(s=>s.asset.id===selected?editImage(s,patch):s));}} onSave={()=>void saveSession(assetSession)}/>{assetSession.failed?<p role="alert">保存尚未确认。重试使用同一提交，核实前暂时锁定编辑；也可以放弃本次修改。</p>:null}</Panel>:null}
  <label>当前识别接口<select aria-label="当前识别接口" disabled={busy} value={provider} onChange={e=>{invalidate();onProviderChange(e.target.value as 'deepseek'|'mock');}}><option value="deepseek">DeepSeek 官方接口</option><option value="mock">本地模拟（不出网）</option></select></label>
  <button className="button button-primary" disabled={busy||dirty()||!prepared.length||prepared.length>20} onClick={()=>{setConsent(false);setReadable({});uploadMutation.current=null;setSnapshot({assets:prepared.map(a=>({...a})),input:{images:prepared.map(a=>({imageAssetId:a.id,preparedHash:a.preparedHash!})),provider,promptVersion:IMPORT_PROMPT,uploadConsent:prepared.map(a=>({preparedHash:a.preparedHash!,confirmed:true,noticeVersion:NOTICE_VERSION})),forceNew,reason:forceNew?reason:null}});}}>开始识别（{prepared.length}张处理图）</button>
  {dirty()?<p>有未保存的修改，请先保存处理，或明确放弃修改后继续。</p>:null}
  {snapshot?<Modal title="确认本次识别" busy={busy} onClose={invalidate}><p>只发送以下最终处理图、分类字典及提取提示。识别、失败或重试均可能计费；每笔候选须另行批准。</p><div className="upload-previews">{snapshot.assets.map(a=><div key={a.id}><ImagePreview asset={a} onReady={ready=>setReadable(old=>old[a.id]===ready?old:{...old,[a.id]:ready})}/><p className="tiny hash-text">SHA256 {a.preparedHash}</p></div>)}</div>
   <label className="check-row"><input type="checkbox" checked={forceNew} onChange={e=>{const value=e.target.checked;setForceNew(value);setConsent(false);setSnapshot(old=>old?{...old,input:{...old.input,forceNew:value,reason:value?reason:null}}:null);uploadMutation.current=null;}}/>明确另建任务（可能重复计费）</label>
   {forceNew?<label>另建理由<input value={reason} maxLength={500} onChange={e=>{setReason(e.target.value);setConsent(false);setSnapshot(old=>old?{...old,input:{...old.input,reason:e.target.value}}:null);uploadMutation.current=null;}}/></label>:null}
   <label className="check-row"><input type="checkbox" disabled={!snapshot.assets.every(a=>readable[a.id])} checked={consent} onChange={e=>setConsent(e.target.checked)}/>我同意以上处理图用于本次识别，了解可能产生费用</label><div className="form-actions"><button className="button" disabled={busy} onClick={invalidate}>取消</button><button className="button button-primary" disabled={busy||!consent||!snapshot.assets.every(a=>readable[a.id])||(forceNew&&!reason.trim())} onClick={()=>void start()}>{provider==='mock'?'生成本地模拟草稿':'上传并识别'}</button></div>
  </Modal>:null}
  {leaving?<Modal title="有未保存的图片修改" busy={busy} onClose={cancelLeave}><p>保存成功后才继续。保存失败会保留本次修改，不会使用旧图上传。</p><div className="form-actions"><button className="button" disabled={busy} onClick={cancelLeave}>继续编辑</button><button className="button" disabled={busy} onClick={()=>{invalidate();setSessions(old=>old.map(discardImage));continueLeave();}}>放弃修改</button><button className="button button-primary" disabled={busy} onClick={()=>void(async()=>{for(const s of current.current.sessions.filter(s=>s.dirty||s.failed))if(!await saveSession(s))return;continueLeave();})()}>保存后继续</button></div></Modal>:null}
 </div>;
}
