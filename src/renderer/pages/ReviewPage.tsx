import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { ReviewCandidate, ReviewList, ReviewUpdate, ApprovalItem, ApprovalInput, ApprovalPreview, EditableFields } from '../../shared/review';
import type { CategoryView } from '../../shared/entities';
import { parseAmountYuanToFen, formatFenToYuan } from '../../shared/amount';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { formatAmountFen } from '../lib/format';
import { Notice, PageHeader, Panel } from '../components/ui';
import { ImagePreview } from '../components/ImagePreview';
import { Modal } from '../components/Modal';
import type { LeaveGuard } from '../components/ExpenseEditor';
import type { Evidence } from '../../shared/candidate';

const fieldNames={amount:'实付金额',date:'实际日期及时间精度',name:'购买物或服务名称',category:'分类'} as const;
const emptyChecks=()=>({amount:false,date:false,name:false,category:false});
const statusNames={pending_review:'待审核',rejected:'已拒绝',approved:'已入账'};
const reasonNames:Record<string,string>={REVIEW_INCOMPLETE:'字段缺失或尚未逐项核对',DUPLICATE_UNRESOLVED:'重复疑点尚未处理',NON_EXPENSE:'尚未核实为真实支出',TOTAL_DETAIL_AMBIGUOUS:'合计与明细须先明确并拒绝重复项',CATEGORY_DISABLED:'分类已停用',REVIEW_STALE:'候选或账本已变化，请重新核对',STATE_CONFLICT:'状态已变化',VERSION_CONFLICT:'版本已变化，请重新读取'};
const humanReason=(s:string)=>reasonNames[s]??(s.startsWith('WARNING:')?'仍有字段疑点需要核实':s);

export function ReviewPage({registerGuard}:{registerGuard?:(g:LeaveGuard)=>void}):JSX.Element {
  const [data,setData]=useState<ReviewList|null>(null),[categories,setCategories]=useState<CategoryView[]>([]);
  const [error,setError]=useState<string|null>(null),[message,setMessage]=useState('');
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [filter,setFilter]=useState<'all'|ReviewCandidate['reviewState']>('all');
  const [selected,setSelected]=useState<Record<string,ApprovalItem>>({});
  const [preview,setPreview]=useState<ApprovalPreview|null>(null),[single,setSingle]=useState<{item:ApprovalItem;candidate:ReviewCandidate;categoryName:string}|null>(null);
  const [leave,setLeave]=useState<(()=>void)|null>(null);
  const dirty=useRef(new Set<string>()),inFlight=useRef(false),approvalInFlight=useRef(false),intent=useRef<{payload:string;id:string}|null>(null);
  const load=useCallback(async(cursor:string|null=null)=>{
    if(inFlight.current)return;inFlight.current=true;setLoading(true);
    try{const [next,cats]=await Promise.all([call(a=>a.candidate.list({jobId:null,page:{limit:100,cursor},reviewStates:filter==='all'?[]:[filter]})),call(a=>a.category.list())]);
      setData(old=>cursor&&old?{...next,items:[...old.items,...next.items]}:next);setCategories(cats.categories);setSelected({});setError(null);
    }catch(e){setError(describeError(e));}finally{inFlight.current=false;setLoading(false);}
  },[filter]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{registerGuard?.(next=>{if(busy)return;if(dirty.current.size)setLeave(()=>next);else next();});return()=>registerGuard?.(null);},[registerGuard,busy]);
  const changeDirty=useCallback((id:string,value:boolean)=>{if(value)dirty.current.add(id);else dirty.current.delete(id);},[]);
  const select=useCallback((id:string,item:ApprovalItem|null)=>setSelected(old=>{const next={...old};if(item)next[id]=item;else delete next[id];return next;}),[]);
  const changed=useCallback((v:ReviewCandidate)=>{setData(old=>{if(!old)return old;const before=old.items.find(i=>i.id===v.id),counts={...old.counts};if(before&&before.reviewState!==v.reviewState){counts[before.reviewState]--;counts[v.reviewState]++;}return {...old,counts,items:old.items.map(i=>i.id===v.id?v:i)};});select(v.id,null);dirty.current.delete(v.id);},[select]);
  const refresh=()=>{const go=()=>{dirty.current.clear();void load();};if(dirty.current.size)setLeave(()=>go);else go();};
  const approve=async(input:ApprovalInput)=>{
    if(approvalInFlight.current)return;approvalInFlight.current=true;setBusy(true);setError(null);
    try {
      const payload=JSON.stringify(input);if(intent.current?.payload!==payload)intent.current={payload,id:crypto.randomUUID()};
      const result=await call(a=>a.candidate.approve(input,{mutationId:intent.current!.id}));
      if('eligible' in result)setPreview(result);
      else {setMessage(result.alreadyApproved?'这笔候选已入账，未新增记录。':`已入账${result.count}笔，合计${formatAmountFen(Number(result.totalFen))}。`);setPreview(null);setSingle(null);intent.current=null;await load();window.dispatchEvent(new Event('bookkeep:committed'));}
    }catch(e){setError(describeError(e));setPreview(null);setSingle(null);setSelected({});}finally{approvalInFlight.current=false;setBusy(false);}
  };
  const openSingle=(item:ApprovalItem)=>{
    if(approvalInFlight.current||busy||loading||single||preview||leave||document.querySelector('dialog[open]'))return;
    const candidate=data?.items.find(c=>c.id===item.id);
    if(!candidate||candidate.version!==item.expectedVersion||candidate.reviewDigest!==item.confirmation.reviewDigest)return;
    setSingle({item,candidate,categoryName:categories.find(cat=>cat.id===candidate.current.categoryId)?.name??'分类已不可用，请返回重新核对'});
  };
  return <div className="page" onKeyDownCapture={e=>{
    // 模态内 Ctrl+Enter 也不能激活最终确认；普通 Enter/Space 仍由按钮处理。
    if(e.ctrlKey&&e.key==='Enter'&&document.querySelector('dialog[open]')){e.preventDefault();e.stopPropagation();}
  }}><PageHeader title="候选审核" subtitle="对照图片逐项核实，确认后才进入正式账本" actions={<button className="button" disabled={busy||loading} onClick={refresh}>重新读取</button>}/>
    <Notice title="每笔均需人工确认">未知商品请填写实际购买物或服务；模型置信度仅供参考。待审核、拒绝和识别失败都不影响正式统计。</Notice>
    <div className="segmented review-status" role="group" aria-label="候选状态筛选">{(['all','pending_review','approved','rejected'] as const).map(state=><button key={state} aria-pressed={filter===state} disabled={busy||loading} onClick={()=>{const go=()=>{dirty.current.clear();setFilter(state);};if(dirty.current.size)setLeave(()=>go);else go();}}>{state==='all'?'全部':statusNames[state]}（{state==='all'?Object.values(data?.counts??{}).reduce((s,n)=>s+n,0):data?.counts[state]??0}）</button>)}</div>
    {data?.items.length?<details className="review-source-nav"><summary>按来源图片定位（当前已加载{data.items.length}笔）</summary>{[...new Set(data.items.map(c=>c.jobId))].map(job=><p key={job}>来源任务 {job.slice(0,8)}：{data.items.filter(c=>c.jobId===job).map(c=><button className="button" key={c.id} onClick={()=>document.getElementById(`candidate-${c.id}`)?.scrollIntoView({block:'start'})}>{c.current.name??'未知商品'} · {statusNames[c.reviewState]}</button>)}</p>)}</details>:null}
    {error?<p role="alert">{error} 请重新读取并核对；不会自动重试批准。</p>:null}{message?<p role="status">{message}</p>:null}
    <div className="review-toolbar"><span>已逐笔选择 {Object.keys(selected).length} 笔（最多100笔）</span><button className="button primary" disabled={busy||!Object.keys(selected).length} onClick={()=>void approve({mode:'preview',items:Object.values(selected)})}>预览批量批准</button></div>
    <Panel title={`候选记录（${data?.totalCount??0}）`}>{loading&&!data?<p role="status">正在读取候选和证据…</p>:!data?.items.length?<p>暂无待审核记录。</p>:data.items.map(c=><ReviewCard key={`${c.id}:${c.version}:${c.reviewDigest}`} candidate={c} categories={categories} onChange={changed} onDirty={changeDirty} onSelect={select} selected={!!selected[c.id]} onApprove={openSingle} disabled={busy||loading}/>)}
      {data?.nextCursor?<button className="button" disabled={loading||busy||dirty.current.size>0} onClick={()=>void load(data.nextCursor)}>加载更多候选</button>:null}
    </Panel>
    {single?<Modal title="确认本笔入账" busy={busy} onClose={()=>setSingle(null)}><p>将入账1笔，合计{formatAmountFen(single.candidate.current.amountFen)}。</p><dl><dt>购买物或服务名称</dt><dd>{single.candidate.current.name}</dd><dt>实际日期及时间精度</dt><dd>{single.candidate.current.occurredDate} · {single.candidate.current.timePrecision==='minute'?`${single.candidate.current.occurredTime}（精确到分钟）`:'仅日期，精确时间未知'}</dd><dt>分类</dt><dd>{single.categoryName}</dd></dl><p>请确认已对照图片核实金额、日期、名称和分类。</p><div className="form-actions"><button className="button" disabled={busy} onClick={()=>setSingle(null)}>取消</button><button className="button primary" disabled={busy} onClick={()=>void approve({mode:'single',...single.item})}>{busy?'正在原子入账…':'确认本笔入账'}</button></div></Modal>:null}
    {preview?<Modal title="批量批准预览" busy={busy} onClose={()=>setPreview(null)}><p className="point-total">将入账{preview.count}笔，合计{formatAmountFen(Number(preview.totalFen))}</p><ul>{preview.eligible.map(c=><li key={c.id}>{c.current.name} · {formatAmountFen(c.current.amountFen!)} · {c.current.occurredDate} · {categories.find(cat=>cat.id===c.current.categoryId)?.name} <small>{c.id}</small></li>)}</ul>
      {preview.excluded.length?<><h3>已排除（不入账）</h3><ul>{preview.excluded.map(e=><li key={e.id}>{e.id}：{e.reasons.map(humanReason).join('；')}</li>)}</ul></>:null}<p>确认有效期60秒；候选或账本变化后需重新预览。</p><div className="form-actions"><button className="button" disabled={busy} onClick={()=>setPreview(null)}>取消</button><button className="button primary" disabled={busy||!preview.previewToken} onClick={()=>void approve({mode:'commit',previewToken:preview.previewToken!})}>{busy?'正在原子入账…':`确认入账${preview.count}笔`}</button></div></Modal>:null}
    {leave?<Modal title="还有未保存的补填" onClose={()=>setLeave(null)}><p>请返回各候选保存补填，或明确放弃本次未保存修改。已经保存的草稿会保留。</p><button className="button" onClick={()=>setLeave(null)}>继续补填</button><button className="button" onClick={()=>{const next=leave;setLeave(null);dirty.current.clear();next();}}>放弃未保存修改并离开</button></Modal>:null}
  </div>;
}

function ReviewCard({candidate:c,categories,onChange,onDirty,onSelect,selected,onApprove,disabled}:{candidate:ReviewCandidate;categories:CategoryView[];onChange:(v:ReviewCandidate)=>void;onDirty:(id:string,v:boolean)=>void;onSelect:(id:string,item:ApprovalItem|null)=>void;selected:boolean;onApprove:(item:ApprovalItem)=>void;disabled:boolean}):JSX.Element {
  const [fields,setFields]=useState<EditableFields>(()=>({amountFen:c.current.amountFen,occurredDate:c.current.occurredDate,occurredTime:c.current.occurredTime,timePrecision:c.current.timePrecision,name:c.current.name,merchant:c.current.merchant,categoryId:c.current.categoryId,transactionKind:c.current.transactionKind,amountBasis:c.current.amountBasis,groupKey:c.current.groupKey})),[amount,setAmount]=useState(c.current.amountFen===null?'':formatFenToYuan(c.current.amountFen));
  const [reason,setReason]=useState(''),[checks,setChecks]=useState(emptyChecks),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState<string|null>(null),[later,setLater]=useState(false);
  const [evidence,setEvidence]=useState<Evidence|null>(null);
  const intent=useRef<{payload:string;id:string}|null>(null),composing=useRef(false);
  const pending=c.reviewState==='pending_review',locked=disabled||busy;
  const item=():ApprovalItem=>({id:c.id,expectedVersion:c.version,confirmation:{...checks,confirmedVersion:c.version,reviewDigest:c.reviewDigest}});
  const all=Object.values(checks).every(Boolean)&&ready&&!dirty;
  const canApprove=pending&&!locked&&all&&!c.blocking&&!later;
  const edit=(patch:Partial<EditableFields>)=>{setFields(p=>({...p,...patch}));setDirty(true);onDirty(c.id,true);setChecks(emptyChecks());onSelect(c.id,null);};
  const run=async(input:ReviewUpdate|{id:string;expectedVersion:number;reason:string},reject=false)=>{
    if(locked)return;setBusy(true);setError(null);try{
      const payload=JSON.stringify({input,reject});if(intent.current?.payload!==payload)intent.current={payload,id:crypto.randomUUID()};
      const next=await call(a=>reject?a.candidate.reject(input as {id:string;expectedVersion:number;reason:string},{mutationId:intent.current!.id}):a.candidate.update(input as ReviewUpdate,{mutationId:intent.current!.id}));
      onChange(next);setDirty(false);onDirty(c.id,false);setChecks(emptyChecks());intent.current=null;
    }catch(e){setError(describeError(e));setChecks(emptyChecks());onSelect(c.id,null);}finally{setBusy(false);}
  };
  const save=async()=>{
    let amountFen:number|null=null;if(amount.trim()){const parsed=parseAmountYuanToFen(amount);if(!parsed.ok){setError('请输入正数金额，最多两位小数。');return;}amountFen=parsed.fen;}
    await run({id:c.id,expectedVersion:c.version,action:'edit',patch:{...fields,amountFen},reason});
  };
  const locate=(field:string)=>{setEvidence(c.proposal.evidence.find(e=>e.field===field)??{field,text:'此字段没有图像证据，请依据实际事实补填并说明原因。',region:null,source:'image'});document.getElementById(`image-${c.id}`)?.scrollIntoView({block:'center'});};
  const adjacent=(delta:number)=>{const nodes=Array.from(document.querySelectorAll<HTMLElement>('[data-candidate-id]')),index=nodes.findIndex(n=>n.dataset.candidateId===c.id);nodes[index+delta]?.scrollIntoView({block:'start'});};
  return <article className="candidate-card" id={`candidate-${c.id}`} data-candidate-id={c.id} data-state={c.reviewState}
    onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
    onKeyDown={e=>{
      if(!e.ctrlKey||e.key!=='Enter')return;
      e.preventDefault();e.stopPropagation();
      if(e.altKey||e.metaKey||e.shiftKey||e.repeat||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229||composing.current||!canApprove||document.querySelector('dialog[open]'))return;
      if(!e.currentTarget.contains(document.activeElement)||!(e.target instanceof Element)||e.target.closest('[data-candidate-id]')!==e.currentTarget)return;
      onApprove(item());
    }}>
    <h3>{c.current.name??'购买内容未知，请补填'} <span className="badge">{statusNames[c.reviewState]}</span></h3>
    <div className="form-actions"><button className="button" onClick={()=>adjacent(-1)}>上一笔</button><button className="button" onClick={()=>adjacent(1)}>下一笔</button></div>
    {c.reviewState==='approved'?<><p>已关联正式交易 {c.postedTransactionId}。后续编辑、删除与恢复请前往“支出明细”。</p><p>此候选不会再次生成交易。</p></>:<>
    {later?<><p>已保留草稿，稍后继续；尚未入账。</p><button className="button" onClick={()=>setLater(false)}>继续核对</button></>:<div className="image-compare review-compare"><div id={`image-${c.id}`}><h4>本次上传图（可能已经裁剪或遮盖）</h4><ImagePreview asset={{id:c.imageAssetId}} onReady={setReady} region={evidence?.region}/>{evidence?<p role="status">{evidence.field}依据：{evidence.text??'所选图片区域'}{!evidence.region?'（无区域，仅显示原文）':''}</p>:null}<details><summary>查看原图（如已保留）</summary><ImagePreview asset={{id:c.imageAssetId}} variant="original"/></details><p className="tiny">字段区域均相对本次上传图。原图未保留时仅可核对处理后的图片。</p><details open><summary>原始字段证据</summary><ul>{c.proposal.evidence.map((e,i)=><li key={i}><button className="button" onClick={()=>setEvidence(e)}>查看{e.field}依据</button>：{e.text??'区域证据'}{e.region?`（x=${e.region.x}, y=${e.region.y}, w=${e.region.width}, h=${e.region.height}）`:''}</li>)}</ul></details></div>
    <div><p>金额 {c.current.amountFen===null?'未知':formatAmountFen(c.current.amountFen)} · 模型置信度{c.proposal.confidence===null?'未知':`${Math.round(c.proposal.confidence*100)}%`}（不免审）</p>
      {c.highRisk?<p className="notice" data-tone="warn">高风险项：核实并处理疑点后逐笔批准，不参与批量。</p>:null}
      {c.missingFields.length?<p role="status">缺失：{c.missingFields.join('、')}。商品未知请手动填写。</p>:null}
      {c.duplicateMatches.length?<div className="notice" data-tone="warn"><strong>疑似重复，请对照实际消费</strong><ul>{c.duplicateMatches.map(m=>{const d=c.duplicateDetails.find(x=>x.targetId===m.targetId);return <li key={`${m.targetType}:${m.targetId}`}>{d?.name??'相同来源图片'} · {formatAmountFen(d?.amountFen??null)} · {d?.date??'日期未知'} · {d?.merchant??'商户未知'} · {d?.state} <small>{m.targetId} · {m.basis}</small></li>;})}</ul><p>当前处理：{c.duplicateResolution==='distinct'?'已说明为另一笔真实消费':c.duplicateResolution==='duplicate'?'认定重复，不可批准':'尚未处理'}</p><button className="button" disabled={locked||dirty||!reason.trim()||!pending} onClick={()=>void run({id:c.id,expectedVersion:c.version,action:'resolve_duplicate',duplicateResolution:'distinct',reviewDigest:c.reviewDigest,reason})}>这是另一笔真实消费</button><button className="button" disabled={locked||dirty||!reason.trim()||!pending} onClick={()=>void run({id:c.id,expectedVersion:c.version,reason},true)}>确为同一笔，拒绝本项</button></div>:null}
      {!c.current.amountFen||!c.current.occurredDate?<p>字段不足，暂无法判断重复。</p>:null}
      {c.warnings.map((w,i)=><div className="review-warning" key={i}><p>{w.code}：{w.message}</p>{c.resolvedWarnings.includes(`${w.code}:${w.field??''}`)?<span>已核实并保留处理记录</span>:<button className="button" disabled={locked||dirty||!reason.trim()||!pending||!ready} onClick={()=>void run({id:c.id,expectedVersion:c.version,action:'resolve_warning',warningCode:w.code,field:w.field,reviewDigest:c.reviewDigest,reason})}>已对照图核实此疑点</button>}</div>)}
      <fieldset disabled={locked||!pending}><legend>补填与修改（不会直接入账）</legend><div className="review-fields">
        <label>实付金额（元）<input aria-label="实付金额（元）" inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);edit({});}}/></label>
        <label>完整实际日期<input aria-label="完整实际日期" type="date" value={fields.occurredDate??''} onChange={e=>edit({occurredDate:e.target.value||null,timePrecision:e.target.value?'date':'unknown',occurredTime:null})}/></label>
        <label>购买物或服务名称<input aria-label="购买物或服务名称" value={fields.name??''} maxLength={100} placeholder="未知时请填写真实购买内容" onChange={e=>edit({name:e.target.value||null})}/></label>
        <label>分类<select aria-label="分类" value={fields.categoryId??''} onChange={e=>edit({categoryId:e.target.value||null})}><option value="">请选择</option>{categories.filter(cat=>cat.enabled).map(cat=><option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label>
        <label>精确到分钟的时间（未知留空）<input aria-label="精确到分钟的时间" type="time" value={fields.occurredTime??''} onChange={e=>edit({occurredTime:e.target.value||null,timePrecision:e.target.value?'minute':fields.occurredDate?'date':'unknown'})}/></label>
        <label>商户（可空）<input aria-label="商户" value={fields.merchant??''} maxLength={100} onChange={e=>edit({merchant:e.target.value||null})}/></label>
        <label>交易状态<select aria-label="交易状态" value={fields.transactionKind??''} onChange={e=>edit({transactionKind:(e.target.value||null) as EditableFields['transactionKind']})}><option value="">未知</option>{[['expense','真实支出'],['refund','退款'],['transfer','转账'],['income','收入'],['failed','支付失败'],['closed','订单关闭']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
        <label>实付口径<select aria-label="实付口径" value={fields.amountBasis??''} onChange={e=>edit({amountBasis:(e.target.value||null) as EditableFields['amountBasis']})}><option value="">未知</option><option value="paid_total">订单实付合计</option><option value="line_payment">一次独立付款</option></select></label>
        <label>付款组（同订单须相同）<input aria-label="付款组" value={fields.groupKey??''} maxLength={64} onChange={e=>edit({groupKey:e.target.value||null})}/></label>
      </div></fieldset>
      <details className="review-original"><summary>AI原值 → 当前值 / 字段依据</summary><dl>{(['amountFen','occurredDate','name','categoryId','occurredTime','merchant','transactionKind','amountBasis','groupKey'] as const).map(field=><div key={field}><dt>{field}</dt><dd>{String(c.proposal[field]??'未知')} → {String(c.current[field]??'未知')} <button className="button" onClick={()=>locate(field)}>查看{field}依据</button></dd></div>)}</dl></details>
      <label className="review-reason">修改、核实或拒绝理由（必填）<textarea aria-label="处理理由" value={reason} maxLength={500} disabled={locked} onChange={e=>setReason(e.target.value)} placeholder="请说明实际依据；重复消费需解释为何是另一笔"/></label>
      {error?<p role="alert">{error} 补填仍保留在表单，请重新读取后对照处理。</p>:null}
      {pending?<><div className="form-actions"><button className="button" disabled={locked||!dirty||!reason.trim()} onClick={()=>void save()}>保存补填</button><button className="button" disabled={locked||dirty} onClick={()=>setLater(true)}>稍后处理</button><button className="button danger" disabled={locked||dirty||!reason.trim()} onClick={()=>void run({id:c.id,expectedVersion:c.version,reason},true)}>拒绝本笔</button></div>
        <fieldset disabled={locked||dirty||!ready||c.blocking}><legend>已对照图片逐项核实</legend>{Object.entries(fieldNames).map(([k,label])=><label className="check-row" key={k}><input type="checkbox" aria-label={`确认${label}`} checked={checks[k as keyof typeof checks]} onChange={e=>{setChecks(old=>({...old,[k]:e.target.checked}));onSelect(c.id,null);}}/>{label}</label>)}</fieldset>
        {!ready?<p>来源图片暂不可读，当前不能核对批准。</p>:null}{c.blocking?<p>待处理：{c.blockingReasons.map(humanReason).join('；')}</p>:null}
        <div className="form-actions"><button className="button primary" disabled={!canApprove} onClick={()=>onApprove(item())}>批准本笔</button><label className="check-row"><input type="checkbox" aria-label="加入批量批准" disabled={locked||!all||c.blocking||c.highRisk} checked={selected} onChange={e=>onSelect(c.id,e.target.checked?item():null)}/>加入批量批准</label></div></>:<button className="button" disabled={locked||!reason.trim()} onClick={()=>void run({id:c.id,expectedVersion:c.version,action:'reopen',reason})}>恢复审核</button>}
    </div></div>}</>}
    <p className="tiny hash-text">候选 {c.id} · v{c.version} · 来源任务 {c.jobId} · SHA256 {c.preparedHash}</p>
  </article>;
}
