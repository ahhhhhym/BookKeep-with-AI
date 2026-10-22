import { randomBytes, randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors';
import type { Candidate, CandidateQuery } from '../../shared/imports';
import type { Proposal } from '../../shared/candidate';
import type { ApprovalInput, ApprovalItem, ApprovalPreview, ApprovalResult, ReviewCandidate, ReviewUpdate } from '../../shared/review';
import type { TransactionInput } from '../../shared/entities';
import { checkRequiredText } from '../../shared/text';
import { isPossibleDuplicate } from '../../shared/duplicate';
import { isTransactionDate, isPrecisionConsistent } from '../../shared/date';
import type { LedgerStore } from './ledger-store';
import type { ImageService } from './image-service';
import type { RecognitionService } from './recognition-service';
import type { ImportContext } from './import-context';
import { hashPayload } from './canonical';
import { createTokenCodec } from './signed-token';
import { runInTransaction, translateSqliteError } from '../db/sqlite';
import { findReceipt, insertReceipt } from '../db/receipt-repo';
import { getTransactionById } from '../db/transaction-repo';
import { mapTransaction } from '../db/rows';
import { validateTransactionInput } from './ledger-service';
import { completeReviewSessions } from './review-activity';

type Resolution = { warnings?: Record<string,string>; duplicate?: { decision:'distinct'|'duplicate'; digest:string } };
interface Row { id:string; ledger_id:string; version:number; job_id:string; image_asset_id:string; prepared_hash:string; ordinal:number; proposal_json:string; current_json:string; missing_json:string; warnings_json:string; review_state:Candidate['reviewState']; posted_transaction_id:string|null; resolution_json:string; created_at:string }
const warningKey = (code:string,field:string|null) => `${code}:${field ?? ''}`;
const highCodes = new Set(['NON_EXPENSE','TOTAL_DETAIL_AMBIGUOUS','BLURRY','INSTRUCTION_IN_IMAGE','OTHER','AMOUNT_AMBIGUOUS','EVIDENCE_MISSING','DATE_UNCERTAIN','NAME_UNKNOWN']);

/** Every write is synchronous under BEGIN IMMEDIATE. No await or network inside approval. */
export class ReviewService {
  private readonly codec;
  constructor(private readonly store:LedgerStore, private readonly images:ImageService,
    private readonly owner:()=>number|null = ()=>null, private readonly clock:()=>number = Date.now) {
    this.codec=createTokenCodec(randomBytes(32),clock);
  }
  private row(c:ImportContext,id:string):Row {
    const r=c.db.prepare<Row>('SELECT * FROM candidate WHERE id=? AND ledger_id=?').get(id,c.ledgerId);
    if(!r)throw new AppError('NOT_FOUND'); return r;
  }
  private group(c:ImportContext,r:Row,p:Proposal) {
    return c.db.prepare<Row>('SELECT * FROM candidate WHERE job_id=? AND id<>? ORDER BY id').all(r.job_id,r.id)
      .filter(o=>{const q=JSON.parse(o.current_json) as Proposal; return !p.groupKey || !q.groupKey || q.groupKey===p.groupKey;});
  }
  private duplicates(c:ImportContext,r:Row,p:Proposal):Candidate['duplicateMatches'] {
    const matches:Candidate['duplicateMatches']=[];
    for(const j of c.db.prepare<{id:string;version:number;status:string}>(`SELECT j.id,j.version,j.status FROM import_job j JOIN image_asset a ON a.id=j.image_asset_id
      WHERE j.ledger_id=? AND j.id<>? AND (j.prepared_hash=? OR a.original_hash=(SELECT original_hash FROM image_asset WHERE id=?)) ORDER BY j.id`).all(c.ledgerId,r.job_id,r.prepared_hash,r.image_asset_id))
      matches.push({targetType:'job',targetId:j.id,targetVersion:j.version,basis:'exact_hash'});
    const same=(q:{amountFen:number|null;occurredDate:string|null;name:string|null;merchant:string|null})=>isPossibleDuplicate(p,q);
    for(const t of c.db.prepare<{id:string;version:number;amount_fen:number;occurred_date:string;name:string;merchant:string|null;source_candidate_id:string|null}>('SELECT id,version,amount_fen,occurred_date,name,merchant,source_candidate_id FROM "transaction" WHERE ledger_id=? ORDER BY id').all(c.ledgerId)) {
      if(t.source_candidate_id===r.id)continue;
      if(same({amountFen:t.amount_fen,occurredDate:t.occurred_date,name:t.name,merchant:t.merchant})) matches.push({targetType:'transaction',targetId:t.id,targetVersion:t.version,basis:'amount_date_name_or_merchant'});
    }
    for(const o of c.db.prepare<Row>("SELECT * FROM candidate WHERE ledger_id=? AND id<>? AND review_state='pending_review' ORDER BY id").all(c.ledgerId,r.id))
      if(same(JSON.parse(o.current_json) as Proposal))matches.push({targetType:'candidate',targetId:o.id,targetVersion:o.version,basis:'amount_date_name_or_merchant'});
    return matches;
  }
  private view(c:ImportContext,r:Row):ReviewCandidate {
    const p=JSON.parse(r.current_json) as Proposal, proposal=JSON.parse(r.proposal_json) as Proposal;
    const warnings=JSON.parse(r.warnings_json) as Candidate['warnings'];
    const resolution=JSON.parse(r.resolution_json) as Resolution;
    const group=this.group(c,r,p);
    const category=c.db.prepare('SELECT id,name,enabled,version FROM category WHERE id=? AND ledger_id=?').get(p.categoryId,c.ledgerId)??null;
    const contextDigest=hashPayload({p,group:group.map(g=>({id:g.id,version:g.version,state:g.review_state,p:JSON.parse(g.current_json)}))});
    const duplicates=this.duplicates(c,r,p), duplicateDigest=hashPayload(duplicates);
    const missing=(['amountFen','occurredDate','name','categoryId'] as const).filter(f=>p[f]===null || (typeof p[f]==='string' && !String(p[f]).trim()));
    const reasons:string[]=[];
    if(missing.length)reasons.push('REVIEW_INCOMPLETE');
    try { validateTransactionInput(c.db,c.ledgerId,this.transactionInput(p)); } catch(e) {reasons.push(e instanceof AppError ? e.code : 'FIELD_INVALID');}
    if(p.transactionKind!=='expense')reasons.push('NON_EXPENSE');
    if(!p.amountBasis)reasons.push('TOTAL_DETAIL_AMBIGUOUS');
    // No total + detail double posting, even if model omitted an ambiguity warning.
    const totals=group.filter(g=>(JSON.parse(g.current_json) as Proposal).amountBasis==='paid_total' && g.review_state!=='rejected');
    if(p.amountBasis==='paid_total' && group.some(g=>g.review_state!=='rejected'))reasons.push('TOTAL_DETAIL_AMBIGUOUS');
    if(p.amountBasis==='line_payment' && totals.length)reasons.push('TOTAL_DETAIL_AMBIGUOUS');
    const resolvedWarnings=warnings.filter(w=>resolution.warnings?.[warningKey(w.code,w.field)]===contextDigest).map(w=>warningKey(w.code,w.field));
    for(const w of warnings)if(!resolvedWarnings.includes(warningKey(w.code,w.field)))reasons.push(`WARNING:${warningKey(w.code,w.field)}`);
    const duplicateResolution=resolution.duplicate?.digest===duplicateDigest ? resolution.duplicate.decision : null;
    if(duplicates.length && duplicateResolution!=='distinct')reasons.push('DUPLICATE_UNRESOLVED');
    const job=c.db.prepare<{status:string}>('SELECT status FROM import_job WHERE id=? AND ledger_id=?').get(r.job_id,c.ledgerId);
    if(job?.status!=='completed')reasons.push('STATE_CONFLICT');
    const blockingReasons=[...new Set(reasons)];
    const duplicateDetails=duplicates.map(m=>{
      if(m.targetType==='transaction') {const t=getTransactionById(c.db,m.targetId)!;return {targetId:m.targetId,name:t.name,amountFen:t.amount_fen,date:t.occurred_date,merchant:t.merchant,state:t.deleted_at?'已删除':'正式交易'};}
      if(m.targetType==='candidate') {const o=this.row(c,m.targetId),q=JSON.parse(o.current_json) as Proposal;return {targetId:m.targetId,name:q.name,amountFen:q.amountFen,date:q.occurredDate,merchant:q.merchant,state:o.review_state};}
      return {targetId:m.targetId,name:null,amountFen:null,date:null,merchant:null,state:'相同来源图片的识别任务'};
    });
    return {id:r.id,version:r.version,jobId:r.job_id,imageAssetId:r.image_asset_id,preparedHash:r.prepared_hash,ordinal:r.ordinal,proposal,current:p,missingFields:missing,warnings,duplicateDetails,
      duplicateMatches:duplicates,reviewState:r.review_state,postedTransactionId:r.posted_transaction_id,excludedByDefault:p.transactionKind!=='expense',createdAt:r.created_at,
      blocking:blockingReasons.length>0,blockingReasons,resolvedWarnings,duplicateResolution,
      highRisk:proposal.transactionKind!=='expense' || proposal.amountFen===null || proposal.occurredDate===null || proposal.name===null || warnings.some(w=>highCodes.has(w.code)),
      reviewDigest:hashPayload({id:r.id,version:r.version,p,category,blockingReasons,duplicates,resolution,contextDigest})};
  }
  get(id:string):ReviewCandidate {return this.store.withImports(false,c=>this.view(c,this.row(c,id)));}
  list(query:CandidateQuery,recognition:RecognitionService) {
    const page=recognition.candidates(query);
    return this.store.withImports(false,c=>{
      const counts:Record<Candidate['reviewState'],number>={pending_review:0,rejected:0,approved:0};
      for(const r of c.db.prepare<{review_state:Candidate['reviewState'];n:number}>(`SELECT review_state,count(*) n FROM candidate WHERE ledger_id=? ${query.jobId?'AND job_id=?':''} GROUP BY review_state`).all(c.ledgerId,...(query.jobId?[query.jobId]:[])))counts[r.review_state]=r.n;
      return {...page,counts,items:page.items.map(i=>this.view(c,this.row(c,i.id)))};
    });
  }
  private transactionInput(p:Proposal):TransactionInput {
    return {amountFen:p.amountFen!,occurredDate:p.occurredDate!,occurredTime:p.occurredTime,timePrecision:p.timePrecision==='minute'?'minute':'date',name:p.name!,categoryId:p.categoryId!,merchant:p.merchant,note:null};
  }
  private version(r:Row,n:number) {if(r.version!==n)throw new AppError('VERSION_CONFLICT',{details:{currentVersion:r.version}});if(r.version>=2147483647)throw new AppError('VERSION_EXHAUSTED');}
  private event(c:ImportContext,r:Row,action:string,after:unknown,reason:string,mutationId:string,transactionId:string|null=null) {
    c.db.prepare('INSERT INTO review_event(id,ledger_id,candidate_id,action,before_json,after_json,reason,mutation_id,transaction_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),c.ledgerId,r.id,action,JSON.stringify({current:JSON.parse(r.current_json),state:r.review_state,resolution:JSON.parse(r.resolution_json)}),JSON.stringify(after),reason,mutationId,transactionId,new Date(this.clock()).toISOString());
  }
  private mutate<T>(operation:string,input:unknown,mutationId:string,fn:(c:ImportContext)=>T):T {
    if(!mutationId)throw new AppError('PAYLOAD_INVALID');
    try {return this.store.withImports(true,c=>runInTransaction(c.db,()=>{
      c.revision=c.db.prepare<{data_revision:number}>('SELECT data_revision FROM ledger WHERE id=?').get(c.ledgerId)!.data_revision;
      const digest=hashPayload(input),receipt=findReceipt(c.db,c.ledgerId,operation,mutationId);
      if(receipt){if(receipt.payload_hash!==digest)throw new AppError('IDEMPOTENCY_CONFLICT');return {...JSON.parse(receipt.result_snapshot_json),replayed:true} as T;}
      const result=fn(c), now=new Date(this.clock()).toISOString();
      completeReviewSessions(c,now);
      if(c.revision>=Number.MAX_SAFE_INTEGER)throw new AppError('COUNTER_EXHAUSTED');
      const alreadyApproved=!!result && typeof result==='object' && 'alreadyApproved' in result && result.alreadyApproved===true;
      if(!alreadyApproved)c.db.prepare('UPDATE ledger SET data_revision=data_revision+1,updated_at=? WHERE id=?').run(now,c.ledgerId);
      insertReceipt(c.db,{ledgerId:c.ledgerId,operation,mutationId,payloadHash:digest,resultType:operation,resultIds:[],snapshot:result,revision:c.revision+(alreadyApproved?0:1),now});
      return result;
    }));}catch(e){throw translateSqliteError(e);}
  }
  update(input:ReviewUpdate,mutationId:string):ReviewCandidate {
    return this.mutate('candidate.update',input,mutationId,c=>{
      const r=this.row(c,input.id);this.version(r,input.expectedVersion);
      const reason=checkRequiredText(input.reason,500);if(!reason.ok)throw new AppError('FIELD_INVALID');
      const p=JSON.parse(r.current_json) as Proposal, resolution=JSON.parse(r.resolution_json) as Resolution;
      if(input.action==='reopen'){if(r.review_state!=='rejected')throw new AppError('STATE_CONFLICT');}
      else if(r.review_state!=='pending_review')throw new AppError('STATE_CONFLICT');
      if(input.action==='edit') {
        Object.assign(p,input.patch);
        // Drafts can retain unknown fields but cannot save malformed known values.
        if(p.amountFen!==null && (!Number.isInteger(p.amountFen)||p.amountFen<1||p.amountFen>999999999))throw new AppError('AMOUNT_INVALID');
        if(p.occurredDate!==null && !isTransactionDate(p.occurredDate))throw new AppError('DATE_INVALID');
        if(p.timePrecision==='unknown' ? p.occurredDate!==null||p.occurredTime!==null : !p.occurredDate||!isPrecisionConsistent(p.timePrecision,p.occurredTime))throw new AppError('DATE_INVALID');
        for(const field of ['name','merchant'] as const)if(p[field]!==null){const t=checkRequiredText(p[field],100);if(!t.ok)throw new AppError('FIELD_INVALID');p[field]=t.value;}
        if(p.categoryId!==null && !c.db.prepare('SELECT id FROM category WHERE id=? AND ledger_id=? AND enabled=1').get(p.categoryId,c.ledgerId))throw new AppError('CATEGORY_DISABLED');
        resolution.warnings={};resolution.duplicate=undefined;
      } else if(input.action==='resolve_duplicate'||input.action==='resolve_warning') {
        const view=this.view(c,r);if(input.reviewDigest!==view.reviewDigest)throw new AppError('REVIEW_STALE');
        if(input.action==='resolve_duplicate')resolution.duplicate={decision:input.duplicateResolution,digest:hashPayload(view.duplicateMatches)};
        else {
          if(!view.warnings.some(w=>w.code===input.warningCode && w.field===input.field))throw new AppError('FIELD_INVALID');
          validateTransactionInput(c.db,c.ledgerId,this.transactionInput(p));
          if(p.transactionKind!=='expense')throw new AppError('NON_EXPENSE');
          if(!p.amountBasis || view.blockingReasons.includes('TOTAL_DETAIL_AMBIGUOUS'))throw new AppError('REVIEW_INCOMPLETE');
          resolution.warnings={...resolution.warnings,[warningKey(input.warningCode,input.field)]:hashPayload({p,group:this.group(c,r,p).map(g=>({id:g.id,version:g.version,state:g.review_state,p:JSON.parse(g.current_json)}))})};
        }
      } else {resolution.warnings={};resolution.duplicate=undefined;}
      c.db.prepare("UPDATE candidate SET current_json=?,resolution_json=?,review_state='pending_review',version=version+1,updated_at=? WHERE id=? AND version=?")
        .run(JSON.stringify(p),JSON.stringify(resolution),new Date(this.clock()).toISOString(),r.id,r.version);
      const after=this.view(c,this.row(c,r.id));
      c.db.prepare('UPDATE candidate SET missing_json=?,duplicates_json=?,blocking=?,excluded_by_default=? WHERE id=?').run(JSON.stringify(after.missingFields),JSON.stringify(after.duplicateMatches),after.blocking?1:0,after.excludedByDefault?1:0,r.id);
      this.event(c,r,input.action,{current:p,resolution,state:after.reviewState},reason.value,mutationId);return after;
    });
  }
  reject(input:{id:string;expectedVersion:number;reason:string},mutationId:string):ReviewCandidate {
    return this.mutate('candidate.reject',input,mutationId,c=>{const r=this.row(c,input.id);this.version(r,input.expectedVersion);
      if(r.review_state!=='pending_review')throw new AppError('STATE_CONFLICT');
      const reason=checkRequiredText(input.reason,500);if(!reason.ok)throw new AppError('FIELD_INVALID');
      c.db.prepare("UPDATE candidate SET review_state='rejected',resolution_json='{}',version=version+1,updated_at=? WHERE id=? AND version=?").run(new Date(this.clock()).toISOString(),r.id,r.version);
      this.event(c,r,'reject',{state:'rejected'},reason.value,mutationId);return this.view(c,this.row(c,r.id));});
  }
  private eligible(c:ImportContext,item:ApprovalItem,batch:boolean):ReviewCandidate {
    const r=this.row(c,item.id);this.version(r,item.expectedVersion);const v=this.view(c,r),cf=item.confirmation;
    if(v.reviewState!=='pending_review')throw new AppError('STATE_CONFLICT');
    if(cf.confirmedVersion!==v.version || cf.reviewDigest!==v.reviewDigest)throw new AppError('REVIEW_STALE');
    if(!cf.amount||!cf.date||!cf.name||!cf.category)throw new AppError('REVIEW_INCOMPLETE');
    if(batch && v.highRisk)throw new AppError('REVIEW_INCOMPLETE');
    if(v.blocking)throw new AppError(v.blockingReasons.includes('NON_EXPENSE')?'NON_EXPENSE':v.blockingReasons.includes('DUPLICATE_UNRESOLVED')?'DUPLICATE_UNRESOLVED':'REVIEW_INCOMPLETE');
    // Hash check reads real attachment bytes, not a successful placeholder preview.
    this.images.readPrepared(v.imageAssetId,v.preparedHash);return v;
  }
  preview(items:ApprovalItem[]):ApprovalPreview {
    if(items.length<1||items.length>100||new Set(items.map(i=>i.id)).size!==items.length)throw new AppError('BATCH_LIMIT');
    return this.store.withImports(false,c=>runInTransaction(c.db,()=>{
      c.revision=c.db.prepare<{data_revision:number}>('SELECT data_revision FROM ledger WHERE id=?').get(c.ledgerId)!.data_revision;
      const eligible:ReviewCandidate[]=[],excluded:ApprovalPreview['excluded']=[];
      for(const item of items)try{eligible.push(this.eligible(c,item,true));}catch(e){excluded.push({id:item.id,reasons:[e instanceof AppError?e.code:'INTERNAL_ERROR']});}
      const totalFen=eligible.reduce((n,v)=>n+BigInt(v.current.amountFen!),0n).toString();
      const selected=items.filter(i=>eligible.some(v=>v.id===i.id));
      return {eligible,excluded,count:eligible.length,totalFen,previewToken:eligible.length?this.codec.sign({v:1,x:this.clock()+60000,epoch:c.epoch,ledger:c.ledgerId,revision:c.revision,owner:this.owner(),items:selected,totalFen}):null};
    }));
  }
  approve(input:ApprovalInput,mutationId:string|null):ApprovalResult|ApprovalPreview {
    if(input.mode==='preview')return this.preview(input.items);
    return this.mutate('candidate.approve',input,mutationId!,c=>{
      let items:ApprovalItem[];
      if(input.mode==='single'){
        const r=this.row(c,input.id);
        if(r.review_state==='approved'){
          const tx=getTransactionById(c.db,r.posted_transaction_id!);
          if(!tx||tx.source_candidate_id!==r.id)throw new AppError('INTEGRITY_ERROR');
          return {transactions:[mapTransaction(tx)],candidateIds:[r.id],count:1,totalFen:String(tx.amount_fen),alreadyApproved:true,replayed:false};
        } items=[input];
      } else {
        const token=this.codec.verify(input.previewToken,200000);
        if(!token.ok)throw new AppError(token.reason==='TOKEN_EXPIRED'?'TOKEN_EXPIRED':'PAYLOAD_INVALID');
        const p=token.payload;if(p.epoch!==c.epoch||p.ledger!==c.ledgerId||p.owner!==this.owner()||p.revision!==c.revision)throw new AppError('REVIEW_STALE');
        items=p.items as ApprovalItem[];
      }
      // Validate ALL before writing any, then write exactly this fixed set.
      const views=items.map(i=>this.eligible(c,i,input.mode==='commit'));
      const transactions=views.map(v=>{
        const r=this.row(c,v.id),fields=validateTransactionInput(c.db,c.ledgerId,this.transactionInput(v.current));
        const id=randomUUID(),now=new Date(this.clock()).toISOString();
        c.db.prepare(`INSERT INTO "transaction"(id,ledger_id,amount_fen,currency,occurred_date,occurred_time,time_precision,name,category_id,merchant,note,source,source_candidate_id,review_candidate_id,deleted_at,version,created_at,updated_at)
          VALUES(?,?,?,'CNY',?,?,?,?,?,?,NULL,'ai',?,?,NULL,1,?,?)`).run(id,c.ledgerId,fields.amountFen,fields.occurredDate,fields.occurredTime,fields.timePrecision,fields.name,fields.categoryId,fields.merchant,r.id,r.id,now,now);
        this.event(c,r,'approve',{state:'approved',transactionId:id,confirmation:items.find(i=>i.id===r.id)!.confirmation},'用户逐项核对并确认入账',mutationId!,id);
        const result=c.db.prepare("UPDATE candidate SET review_state='approved',posted_transaction_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND review_state='pending_review'").run(id,now,r.id,r.version);
        if(result.changes!==1)throw new AppError('VERSION_CONFLICT');
        c.db.prepare('INSERT INTO review_posting(candidate_id,transaction_id) VALUES(?,?)').run(r.id,id);
        return mapTransaction(getTransactionById(c.db,id)!);
      });
      return {transactions,candidateIds:views.map(v=>v.id),count:views.length,totalFen:transactions.reduce((n,t)=>n+BigInt(t.amountFen),0n).toString(),alreadyApproved:false,replayed:false};
    });
  }
}
