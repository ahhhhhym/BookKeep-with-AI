import { randomUUID } from 'node:crypto';
import { ACHIEVEMENTS, ACHIEVEMENT_RULE_VERSION, type AchievementList, type AchievementNotice, type AchievementProgress, type AchievementId, type AchievementOrigin, type NoticeConsumeInput } from '../../shared/achievements';
import { AppError } from '../../shared/errors';
import { isUuidV4 } from '../../shared/validation';
import { runInTransaction, translateSqliteError, type SqliteDb } from '../db/sqlite';
import type {BackupSuccess} from '../storage/backup-success';

interface Context { db:SqliteDb; ledgerId:string; epoch:string; clock:()=>number; fault?:(step:string)=>void }
/** Only canonical persisted instants qualify. Never use occurred_date, mtime or the evaluation day as fallback. */
function verifiedInstant(value:string,now:number):boolean {
 const ms=Date.parse(value);
 return Number.isFinite(ms) && ms>=0 && ms<=now && new Date(ms).toISOString()===value;
}
const dayFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
function shanghaiDay(instant:string):string {
 return dayFormatter.format(new Date(instant));
}
const dayNumber=(day:string)=>Date.parse(day+'T00:00:00Z')/86400000;
function checkEpoch(c:Context,expectedEpoch:string):void {
 const meta=c.db.prepare<{data_epoch:string;migration_state:string}>('SELECT data_epoch,migration_state FROM app_meta WHERE id=\'app\'').get();
 if(!meta || meta.data_epoch!==expectedEpoch || c.epoch!==expectedEpoch)throw new AppError('STALE_EPOCH');
 if(meta.migration_state!=='clean')throw new AppError('RECOVERY_REQUIRED');
}
/** The posting + approve event + bidirectional candidate relationship are required; task completion alone proves nothing. */
const AI_LINK = `EXISTS(SELECT 1 FROM candidate c
 JOIN review_posting p ON p.candidate_id=c.id AND p.transaction_id=t.id
 JOIN review_event e ON e.candidate_id=c.id AND e.transaction_id=t.id AND e.action='approve' AND e.ledger_id=t.ledger_id
 WHERE c.id=t.source_candidate_id AND t.review_candidate_id=c.id AND c.ledger_id=t.ledger_id
 AND c.review_state='approved' AND c.posted_transaction_id=t.id
 AND json_extract(e.after_json,'$.confirmation.amount')=1 AND json_extract(e.after_json,'$.confirmation.date')=1
 AND json_extract(e.after_json,'$.confirmation.name')=1 AND json_extract(e.after_json,'$.confirmation.category')=1)`;
function progress(c:Context,now:string):AchievementProgress {
 const totals=c.db.prepare<{entries:number;aiEntries:number}>(`SELECT count(*) entries,
 coalesce(sum(CASE WHEN t.source='ai' AND ${AI_LINK} THEN 1 ELSE 0 END),0) aiEntries
 FROM "transaction" t WHERE t.ledger_id=? AND t.deleted_at IS NULL`).get(c.ledgerId)!;
 const days=c.db.prepare<{day:string}>('SELECT day FROM achievement_activity_day WHERE ledger_id=? ORDER BY day').all(c.ledgerId).map(r=>dayNumber(r.day));
 let longestStreak=0,run=0,last=-Infinity;
 for(const d of days){run=d===last+1?run+1:1;longestStreak=Math.max(longestStreak,run);last=d;}
 const today=dayNumber(shanghaiDay(now)),set=new Set(days);
 let anchor=set.has(today)?today:today-1,currentStreak=0;
 while(set.has(anchor)){currentStreak++;anchor--;}
 const backups=c.db.prepare<{backups:number;backupDays:number}>("SELECT count(*) backups,count(DISTINCT day) backupDays FROM achievement_fact WHERE ledger_id=? AND kind='manual_backup'").get(c.ledgerId)!;
 return {...totals,...backups,activityDays:days.length,longestStreak,currentStreak};
}
export function settleAchievements(c:Context,expectedEpoch:string):void {
 try {runInTransaction(c.db,()=>{
  checkEpoch(c,expectedEpoch);
  const nowMs=c.clock(),now=new Date(nowMs).toISOString();
  const history=!c.db.prepare('SELECT ledger_id FROM achievement_initialization WHERE ledger_id=?').get(c.ledgerId);
  const fact=c.db.prepare('INSERT OR IGNORE INTO achievement_fact(ledger_id,kind,source_id,succeeded_at,day,evidence,recorded_at) VALUES(?,?,?,?,?,?,?)');
  const transactions=c.db.prepare<{id:string;source:string;created_at:string;validAi:number}>(`SELECT t.id,t.source,t.created_at,CASE WHEN t.source='ai' AND ${AI_LINK} THEN 1 ELSE 0 END validAi FROM "transaction" t WHERE t.ledger_id=?`).all(c.ledgerId);
  for(const t of transactions) {
   if(!verifiedInstant(t.created_at,nowMs) || (t.source!=='manual' && !t.validAi))continue;
   const day=shanghaiDay(t.created_at);
   fact.run(c.ledgerId,t.source==='manual'?'manual_entry':'ai_entry',t.id,t.created_at,day,t.source==='manual'?'transaction.created_at/manual':'transaction/candidate/approve/posting',now);
  }
  // Local manual backup receipts are written only after archive validation AND registration.
  // Catalog-only imported/reconciled records lack this proof. Archive-self recovery facts are C.
  const backups=c.db.prepare<{id:string;succeeded_at:string}>(`SELECT b.id,min(r.created_at) succeeded_at FROM backup_record b JOIN mutation_receipt r
   ON r.ledger_id=b.ledger_id AND r.operation='backup.create' AND json_extract(r.result_snapshot_json,'$.record.id')=b.id
   WHERE b.ledger_id=? AND b.kind='manual' AND b.status='completed' AND b.archive_hash IS NOT NULL AND b.archive_ref IS NOT NULL
   AND json_extract(r.result_snapshot_json,'$.successVersion') IS NULL
   GROUP BY b.id`).all(c.ledgerId);
  for(const b of backups)if(verifiedInstant(b.succeeded_at,nowMs))fact.run(c.ledgerId,'manual_backup',b.id,b.succeeded_at,shanghaiDay(b.succeeded_at),'backup.completed/backup.create-receipt',now);
  c.db.prepare(`INSERT OR IGNORE INTO achievement_activity_day(ledger_id,day,first_recorded_at)
   SELECT ledger_id,day,? FROM achievement_fact WHERE ledger_id=? AND kind IN('manual_entry','ai_entry')`).run(now,c.ledgerId);
  const p=progress(c,now),newIds:AchievementId[]=[];
  for(const def of ACHIEVEMENTS)if(p[def.metric]>=def.target) {
   const result=c.db.prepare(`INSERT OR IGNORE INTO achievement_unlock(ledger_id,achievement_id,condition_version,unlocked_at,origin,evaluated_at,evidence) VALUES(?,?,1,?,?,?,?)`)
    .run(c.ledgerId,def.id,history?null:now,history?'history':'live',now,`${def.metric}:${p[def.metric]};persistent-facts/v1`);
   if(result.changes)newIds.push(def.id);
  }
  const addNotice=(ids:AchievementId[],kind:'unlock'|'history_summary')=>{
   const id=randomUUID();c.db.prepare("INSERT INTO achievement_notice VALUES(?,?,?,'pending',?,?)").run(id,c.ledgerId,kind,now,now);
   for(const aid of ids)c.db.prepare('INSERT INTO achievement_notice_item VALUES(?,?,?)').run(c.ledgerId,aid,id);
  };
  if(history && newIds.length)addNotice(newIds,'history_summary');
  else for(const id of newIds)addNotice([id],'unlock');
  if(history)c.db.prepare('INSERT INTO achievement_initialization VALUES(?,1,?)').run(c.ledgerId,now);
  c.fault?.('achievement-before-commit');
 });}catch(e){throw translateSqliteError(e);}
}
/** Caller supplies a witness already verified against the immutable archive, never manifest claims alone. */
export function recordBackupSuccess(c:Context,success:BackupSuccess):void {
 checkEpoch(c,c.epoch);
 if(success.ledgerId!==c.ledgerId||!verifiedInstant(success.succeededAt,c.clock()))throw new AppError('BACKUP_INVALID');
 const old=c.db.prepare<{succeeded_at:string;day:string}>("SELECT succeeded_at,day FROM achievement_fact WHERE ledger_id=? AND kind='manual_backup' AND source_id=?").get(c.ledgerId,success.backupId);
 const day=shanghaiDay(success.succeededAt);
 if(old&&(old.succeeded_at!==success.succeededAt||old.day!==day))throw new AppError('BACKUP_INVALID');
 c.db.prepare("INSERT OR IGNORE INTO achievement_fact VALUES(?,'manual_backup',?,?,?,?,?)").run(c.ledgerId,success.backupId,success.succeededAt,day,'archive/verified-bk-success.v1',new Date(c.clock()).toISOString());
}
/** All restored and derived notices are consumed in staging, before the active commit point. */
export function restoreAchievements(c:Context,success:BackupSuccess|null):void {
 runInTransaction(c.db,()=>{
  checkEpoch(c,c.epoch);
  if(success)recordBackupSuccess(c,success);
  settleAchievements(c,c.epoch);
  c.db.prepare("UPDATE achievement_notice SET status='suppressed',state_at=? WHERE ledger_id=? AND status IN('pending','shown')").run(new Date(c.clock()).toISOString(),c.ledgerId);
  c.fault?.('restore-achievement-before-commit');
 });
}
export function readAchievements(c:Context):AchievementList {
 try {return runInTransaction(c.db,()=>{
  checkEpoch(c,c.epoch);
  const p=progress(c,new Date(c.clock()).toISOString());
  const unlocked=c.db.prepare<{achievement_id:AchievementId;unlocked_at:string|null;origin:AchievementOrigin;evaluated_at:string;evidence:string}>('SELECT * FROM achievement_unlock WHERE ledger_id=?').all(c.ledgerId);
  const notices=c.db.prepare<{id:string;kind:AchievementNotice['kind'];status:AchievementNotice['status'];created_at:string;state_at:string}>('SELECT * FROM achievement_notice WHERE ledger_id=? ORDER BY created_at,id').all(c.ledgerId);
  return {ruleVersion:ACHIEVEMENT_RULE_VERSION,ledgerId:c.ledgerId,dataEpoch:c.epoch,progress:p,
   items:ACHIEVEMENTS.map(d=>{const u=unlocked.find(x=>x.achievement_id===d.id);return {id:d.id,name:d.name,condition:d.condition,conditionVersion:ACHIEVEMENT_RULE_VERSION,target:d.target,progress:u?d.target:Math.min(d.target,p[d.metric]),unlocked:!!u,unlockedAt:u?.unlocked_at??null,origin:u?.origin??null,evaluatedAt:u?.evaluated_at??null,evidence:u?.evidence??null};}),
   notices:notices.map(n=>({id:n.id,kind:n.kind,status:n.status,createdAt:n.created_at,stateAt:n.state_at,achievementIds:c.db.prepare<{achievement_id:AchievementId}>('SELECT achievement_id FROM achievement_notice_item WHERE ledger_id=? AND notice_id=? ORDER BY rowid').all(c.ledgerId,n.id).map(r=>r.achievement_id)}))};
 });}catch(e){throw translateSqliteError(e);}
}
export function consumeAchievementNotice(c:Context,input:NoticeConsumeInput,expectedEpoch:string):AchievementNotice {
 if(!isUuidV4(input.noticeId)||!['shown','closed','suppressed'].includes(input.state))throw new AppError('PAYLOAD_INVALID');
 try {return runInTransaction(c.db,()=>{
  checkEpoch(c,expectedEpoch);
  const row=c.db.prepare<{status:AchievementNotice['status']}>('SELECT status FROM achievement_notice WHERE ledger_id=? AND id=?').get(c.ledgerId,input.noticeId);
  if(!row)throw new AppError('NOT_FOUND');
  // Terminal states never return to pending/shown. Marking shown alone prevents replay after restart.
  if(row.status==='pending'||(row.status==='shown'&&input.state==='closed'))c.db.prepare('UPDATE achievement_notice SET status=?,state_at=? WHERE ledger_id=? AND id=? AND status<>?').run(input.state,new Date(c.clock()).toISOString(),c.ledgerId,input.noticeId,input.state);
  return readAchievements(c).notices.find(n=>n.id===input.noticeId)!;
 });}catch(e){throw translateSqliteError(e);}
}
