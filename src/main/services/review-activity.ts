import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors';
import type { ActivityInput } from '../../shared/maintenance';
import type { LedgerStore } from './ledger-store';
import { insertAuditEvent } from '../db/audit-repo';
import { runInTransaction } from '../db/sqlite';
import type { ImportContext } from './import-context';

/** Runs inside the same candidate mutation transaction; freezes the first full image session. */
export function completeReviewSessions(c:ImportContext,now:string):void {
  const jobs=c.db.prepare<{id:string}>(`SELECT j.id FROM import_job j WHERE j.ledger_id=? AND EXISTS(SELECT 1 FROM candidate WHERE job_id=j.id) AND NOT EXISTS(SELECT 1 FROM candidate WHERE job_id=j.id AND review_state='pending_review')`).all(c.ledgerId);
  for(const job of jobs){
    const audits=c.db.prepare<{action:string;diff_json:string}>("SELECT action,diff_json FROM audit_event WHERE entity_id=? AND action IN('review.activity','review.completed') ORDER BY rowid").all(job.id).map(a=>({action:a.action,values:Object.fromEntries((JSON.parse(a.diff_json) as {field:string;after:unknown}[]).map(d=>[d.field,d.after]))})).filter(a=>a.values.epoch===c.epoch);
    const first=audits.find(a=>a.action==='review.activity');
    if(first&&!audits.some(a=>a.action==='review.completed'))insertAuditEvent(c.db,{ledgerId:c.ledgerId,entityType:'job',entityId:job.id,action:'review.completed',actor:'local_user',diff:[{field:'epoch',before:null,after:c.epoch},{field:'sessionId',before:null,after:first.values.sessionId},{field:'reviewEventEnd',before:null,after:c.db.prepare<{n:number}>("SELECT coalesce(max(rowid),0) n FROM review_event").get()!.n}],mutationId:null,reason:null,now});
  }
}

type Activity = { seq:number; reviewEventStart:number; sessionId:string; jobId:string; event:string; activeMs:number; at:string; epoch:string };
/** Only real focus/interaction edges add time. No timers infer unattended or crashed time. */
export class ReviewActivityService {
  private live=new Map<string,{last:number;focused:boolean;epoch:string}>();
  constructor(private readonly store:LedgerStore,private readonly clock=Date.now){}
  private activities(jobId:string|null):Activity[]{
    return this.store.withImports(false,c=>c.db.prepare<{seq:number;entity_id:string;diff_json:string;created_at:string}>("SELECT rowid seq,entity_id,diff_json,created_at FROM audit_event WHERE ledger_id=? AND action='review.activity' ORDER BY rowid").all(c.ledgerId).filter(r=>jobId===null||r.entity_id===jobId).map(r=>{
      const values=Object.fromEntries((JSON.parse(r.diff_json) as {field:string;after:unknown}[]).map(d=>[d.field,d.after]));
      return {seq:r.seq,reviewEventStart:Number(values.reviewEventStart??0),sessionId:String(values.sessionId),jobId:r.entity_id,event:String(values.event),activeMs:Number(values.activeMs),at:r.created_at,epoch:String(values.epoch)};
    }));
  }
  record(input:ActivityInput):{recorded:true}{
    const now=this.clock(),epoch=this.store.currentEpoch,key=epoch+input.jobId;
    const finished=this.store.withImports(false,c=>c.db.prepare<{diff_json:string}>("SELECT diff_json FROM audit_event WHERE entity_id=? AND action='review.completed'").all(input.jobId).some(r=>(JSON.parse(r.diff_json) as {field:string;after:unknown}[]).some(d=>d.field==='epoch'&&d.after===epoch)));
    if(finished)return {recorded:true};
    const prior=this.activities(input.jobId).filter(a=>a.epoch===epoch),sessionId=prior[0]?.sessionId??randomUUID();
    const live=this.live.get(key),activeMs=live?.focused?Math.min(60000,Math.max(0,now-live.last)):0;
    const focused=input.event==='focus'||input.event==='interaction';
    this.store.withImports(true,c=>runInTransaction(c.db,()=>{
      if(!c.db.prepare('SELECT id FROM import_job WHERE id=? AND ledger_id=?').get(input.jobId,c.ledgerId))throw new AppError('NOT_FOUND');
      insertAuditEvent(c.db,{ledgerId:c.ledgerId,entityType:'job',entityId:input.jobId,action:'review.activity',actor:'local_user',diff:[
        {field:'sessionId',before:null,after:sessionId},{field:'event',before:null,after:input.event},{field:'activeMs',before:null,after:activeMs},{field:'epoch',before:null,after:epoch},{field:'reviewEventStart',before:null,after:prior[0]?.reviewEventStart??c.db.prepare<{n:number}>("SELECT coalesce(max(rowid),0) n FROM review_event").get()!.n},
      ],mutationId:null,reason:null,now:new Date(now).toISOString()});
    }));
    this.live.set(key,{last:now,focused,epoch});return {recorded:true};
  }
  metrics(jobId:string|null):Record<string,unknown>{
    const activity=this.activities(jobId).filter(a=>a.epoch===this.store.currentEpoch);
    return this.store.withImports(false,c=>{
      const jobs=c.db.prepare<{id:string}>('SELECT id FROM import_job WHERE ledger_id=? ORDER BY created_at,id').all(c.ledgerId).filter(j=>jobId===null||j.id===jobId);
      const sessions=jobs.map(job=>{
        const completion=c.db.prepare<{seq:number;created_at:string;diff_json:string}>("SELECT rowid seq,created_at,diff_json FROM audit_event WHERE entity_id=? AND action='review.completed' ORDER BY rowid").all(job.id).find(r=>(JSON.parse(r.diff_json) as {field:string;after:unknown}[]).some(d=>d.field==='epoch'&&d.after===c.epoch));
        const a=activity.filter(a=>a.jobId===job.id&&(!completion||a.seq<completion.seq)),first=a[0];
        const rows=c.db.prepare<{id:string;review_state:string}>('SELECT id,review_state FROM candidate WHERE job_id=? ORDER BY ordinal').all(job.id);
        const events=c.db.prepare<{seq:number;action:string;before_json:string;after_json:string;created_at:string}>(`SELECT e.rowid seq,e.action,e.before_json,e.after_json,e.created_at FROM review_event e JOIN candidate c ON c.id=e.candidate_id WHERE c.job_id=? ORDER BY e.rowid`).all(job.id).filter(e=>first&&e.seq>first.reviewEventStart&&(!completion||e.seq<=Number((JSON.parse(completion.diff_json) as {field:string;after:unknown}[]).find(d=>d.field==='reviewEventEnd')?.after??0)));
        let edits=0,fills=0,rejected=0,reopened=0;
        const byField:Record<string,number>={};
        for(const e of events){if(e.action==='reject')rejected++;if(e.action==='reopen')reopened++;if(e.action!=='edit')continue;
          const before=JSON.parse(e.before_json).current,after=JSON.parse(e.after_json).current;
          for(const field of ['amountFen','occurredDate','occurredTime','timePrecision','name','categoryId','merchant','transactionKind','amountBasis','groupKey'])if(JSON.stringify(before?.[field])!==JSON.stringify(after?.[field])){edits++;byField[field]=(byField[field]??0)+1;if(before?.[field]===null&&after?.[field]!==null)fills++;}
        }
        const completed=!!completion;
        return {jobId:job.id,collected:!!first,sessionId:first?.sessionId??null,completed,activeMs:first?a.reduce((n,e)=>n+e.activeMs,0):null,substantiveEdits:first?edits:null,missingFills:first?fills:null,byField:first?byField:null,rejected:first?rejected:null,reopened:first?reopened:null,cancelled:first?a.filter(e=>e.event==='cancel').length:null,unprocessed:rows.filter(r=>r.review_state==='pending_review').length};
      });
      const collected=sessions.filter(s=>s.collected),complete=collected.filter(s=>s.completed);
      return {collected:collected.length>0,completedSessions:complete.length,incompleteSessions:collected.length-complete.length,uncollectedJobs:sessions.length-collected.length,
        activeMs:collected.length?collected.reduce((n,s)=>n+s.activeMs!,0):null,incompleteActiveMs:collected.length?collected.filter(s=>!s.completed).reduce((n,s)=>n+s.activeMs!,0):null,sessions,
        timing:'focus and real interaction edges; idle after 60 seconds; no extrapolation after crash',cost:{currency:'CNY',actual:null,estimated:null,source:null},inferenceTimeIsHumanTime:false};
    });
  }
}
