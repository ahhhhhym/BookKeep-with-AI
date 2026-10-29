import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { createTestLayout, cleanupLayout, storeOptions, transactionInput, openReadOnly } from './helpers';
import { source, proposal, approve, confirmed } from './review-fixture';
import { MIGRATIONS } from '../../../src/main/db/migrations';
import { settleAchievements } from '../../../src/main/services/achievement-service';
import { validateIpcRequest } from '../../../src/main/ipc/validate-request';
import { CHANNEL_SPECS } from '../../../src/shared/ipc';
import { CONTRACT_VERSION } from '../../../src/shared/constants';
let now=Date.parse('2026-10-27T04:00:00.000Z');
const stores:LedgerStore[]=[],layouts:ReturnType<typeof createTestLayout>[]=[];
function setup(extra:Parameters<typeof storeOptions>[2]={}){const layout=createTestLayout();layouts.push(layout);const options=storeOptions(layout,()=>now,extra),s=LedgerStore.open(options);stores.push(s);return {s,layout,options};}
const n=(s:LedgerStore,t:string)=>s.withImports(false,c=>c.db.prepare<{n:number}>(`SELECT count(*) n FROM ${t}`).get()!.n);
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const l of layouts.splice(0))cleanupLayout(l);now=Date.parse('2026-10-27T04:00:00.000Z');});
describe('B fault boundaries and source proof',()=>{
 it('ten distinct AI approvals unlock both AI gates once; preview does not grant; fault/replay cannot duplicate postings/receipts',async()=>{
  let fail=false;const {s}=setup({fault:step=>{if(fail&&step==='achievement-before-commit')throw Error('synthetic');}});
  const f=await source(s,Array.from({length:10},(_,i)=>proposal({name:`verified ${i}`,amountFen:100+i})));
  f.review.preview(f.candidates.map(c=>confirmed(f.review.get(c.id))));expect(s.achievementsList().progress.aiEntries).toBe(0);
  for(const c of f.candidates){fail=true;const m=randomUUID(),input={mode:'single' as const,...confirmed(f.review.get(c.id))};
   const r=f.review.approve(input,m);expect(r).toMatchObject({count:1,replayed:false});f.review.approve(input,m);}
  expect(n(s,'review_posting')).toBe(10);expect(n(s,'"transaction"')).toBe(10);
  expect(s.withImports(false,c=>c.db.prepare<{n:number}>("SELECT count(*) n FROM mutation_receipt WHERE operation='candidate.approve'").get()!.n)).toBe(10);
  expect(n(s,'achievement_unlock')).toBe(0);expect(n(s,'achievement_diagnostic')).toBe(1);
  fail=false;const v=s.achievementsList();expect(v.progress.aiEntries).toBe(10);expect(v.items.filter(i=>i.id.startsWith('ai')&&i.unlocked)).toHaveLength(2);
  const first=s.listTransactions({filter:{dateStart:null,dateEnd:null,categoryIds:[],nameQuery:null,deleted:'active'},page:{limit:1,cursor:null}}).items[0]!;s.softDeleteTransaction({id:first.id,expectedVersion:first.version},randomUUID());
  expect(s.achievementsList().progress.aiEntries).toBe(9);expect(s.achievementsList().items.find(i=>i.id==='ai_10')).toMatchObject({unlocked:true,progress:10});
 });
 it('an AI source without its approval evidence does not count for AI or create a trusted day',async()=>{
  const {s}=setup(),f=await source(s,[proposal()]);approve(f.review,f.candidates[0]!.id);
  s.withImports(true,c=>{c.db.exec('DROP TRIGGER trg_review_no_delete; DELETE FROM review_event; DROP TRIGGER trg_achievement_fact_no_delete; DELETE FROM achievement_fact; DROP TRIGGER trg_achievement_day_no_delete; DELETE FROM achievement_activity_day;');});
  expect(s.achievementsList().progress).toMatchObject({entries:1,aiEntries:0,activityDays:0});
 });
 it('failed/declined/manual catalog-only/automatic backups give no rewards',()=>{
  const {s}=setup();expect(()=>validateIpcRequest(CHANNEL_SPECS.backupCreate,{contractVersion:CONTRACT_VERSION,requestId:randomUUID(),mutationId:randomUUID(),dataEpoch:s.currentEpoch,payload:{kind:'manual',containsPrivateDataAcknowledged:false}},{expectedEpoch:s.currentEpoch})).toThrow();
  s.withImports(true,c=>c.db.exec("CREATE TRIGGER synthetic_backup_failure BEFORE INSERT ON backup_record WHEN NEW.kind='manual' BEGIN SELECT RAISE(ABORT,'synthetic'); END;"));
  expect(()=>s.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},randomUUID())).toThrow();
  s.withImports(true,c=>{
   c.db.exec('DROP TRIGGER synthetic_backup_failure');
   const insert=c.db.prepare(`INSERT INTO backup_record(id,ledger_id,kind,status,manifest_version,db_schema_version,app_version,archive_hash,archive_ref,error_code,finished_at,version,created_at,updated_at) VALUES(?,?,?,'completed','bk-backup.v1',4,'0.1.3',?,?,NULL,?,1,?,?)`);
   for(const kind of ['manual','pre_restore','pre_migration'])insert.run(randomUUID(),c.ledgerId,kind,'a'.repeat(64),'backups/synthetic.bkdb',new Date(now).toISOString(),new Date(now).toISOString(),new Date(now).toISOString());
  });
  expect(s.achievementsList().progress).toMatchObject({backups:0,backupDays:0});expect(s.achievementsList().items.filter(i=>i.id.startsWith('backup')&&i.unlocked)).toEqual([]);
 });
 it('receipt completion time crosses Shanghai midnight; deleting actual archive preserves reliable success',()=>{
  const layout=createTestLayout();layouts.push(layout);let ticking=false,t=Date.parse('2026-10-27T15:59:58.000Z');
  const s=LedgerStore.open(storeOptions(layout,()=>{if(ticking)t+=1000;return t;}));stores.push(s);ticking=true;
  const result=s.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},randomUUID());
  const fact=s.withImports(false,c=>c.db.prepare<{day:string;succeeded_at:string}>("SELECT day,succeeded_at FROM achievement_fact WHERE kind='manual_backup'").get()!);
  expect(result.record.createdAt).toBe('2026-10-27T15:59:59.000Z');expect(fact.succeeded_at).toBe('2026-10-27T16:00:01.000Z');expect(result.record.finishedAt).toBe(fact.succeeded_at);expect(fact.day).toBe('2026-10-28');
  rmSync(s.diagnostics().backupPathOf(result.record.id));expect(s.achievementsList().progress.backups).toBe(1);
 });
 it('N=0 history emits no summary and impossible future/invalid creation times never become days',()=>{
  const {s,options}=setup({migrations:MIGRATIONS.slice(0,3)});for(const stamp of ['unknown','2099-01-01T00:00:00.000Z','2026-02-30T00:00:00.000Z']){const tx=s.createTransaction(transactionInput(),randomUUID());s.withImports(true,c=>c.db.prepare('UPDATE "transaction" SET created_at=? WHERE id=?').run(stamp,tx.transaction.id));s.softDeleteTransaction({id:tx.transaction.id,expectedVersion:1},randomUUID());}
  s.close();const u=LedgerStore.open({...options,migrations:MIGRATIONS});stores.push(u);const v=u.achievementsList();expect(v.progress).toMatchObject({entries:0,activityDays:0});expect(v.notices).toEqual([]);
 });
 it('read-only connection cannot settle; no fallback zero data; suppressed notices survive without a new unlock',()=>{
  const {s}=setup();s.createTransaction(transactionInput(),randomUUID());const notice=s.achievementsList().notices[0]!;
  s.consumeAchievementNotice({noticeId:notice.id,state:'suppressed'},s.currentEpoch);s.consumeAchievementNotice({noticeId:notice.id,state:'shown'},s.currentEpoch);
  expect(s.achievementsList().notices[0]!.status).toBe('suppressed');expect(n(s,'achievement_unlock')).toBe(1);
  openReadOnly(s.diagnostics().databasePath,db=>expect(()=>settleAchievements({db,ledgerId:s.currentLedgerId,epoch:s.currentEpoch,clock:()=>now},s.currentEpoch)).toThrowError(expect.objectContaining({code:'STORAGE_UNAVAILABLE'})));
 });
});
