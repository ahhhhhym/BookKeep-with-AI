import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { MIGRATIONS } from '../../../src/main/db/migrations';
import { createTestLayout, cleanupLayout, storeOptions, transactionInput, openReadOnly } from './helpers';
import { source, proposal, approve } from './review-fixture';
const layouts: ReturnType<typeof createTestLayout>[]=[];
const stores: LedgerStore[]=[];
let time=Date.parse('2026-10-27T04:00:00.000Z');
function setup(extra:Parameters<typeof storeOptions>[2]={}) {
 const layout=createTestLayout();layouts.push(layout);
 const options=storeOptions(layout,()=>time,extra),store=LedgerStore.open(options);stores.push(store);return {store,layout,options};
}
function reopen(options:Parameters<typeof LedgerStore.open>[0]) {const s=LedgerStore.open(options);stores.push(s);return s;}
// RED target: no v4 tables, no persistent achievements service/API yet.
const list=(s:LedgerStore)=>s.achievementsList();
const settle=(s:LedgerStore,epoch=s.currentEpoch)=>s.settleAchievements(epoch);
const ids=(s:LedgerStore)=>list(s).items.filter((i)=>i.unlocked).map((i)=>i.id);
const count=(s:LedgerStore,table:string)=>openReadOnly(s.diagnostics().databasePath,db=>db.prepare<{n:number}>(`SELECT count(*) n FROM ${table}`).get()!.n);
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const l of layouts.splice(0))cleanupLayout(l);time=Date.parse('2026-10-27T04:00:00.000Z');});
describe('B achievements persistent rules (isolated SQLite, injected clock)',()=>{
 it('0/1/9/10/99/100, replay, edit, delete and permanent unlocks',()=>{
  const {store:s}=setup();expect(list(s).progress.entries).toBe(0);expect(ids(s)).toEqual([]);
  let tx: ReturnType<LedgerStore['createTransaction']> | undefined;
  for(let n=1;n<=100;n++) {const m=randomUUID(),input=transactionInput({name:`expense ${n}`});tx=s.createTransaction(input,m);s.createTransaction(input,m);
   if([1,9,10,99,100].includes(n)){expect(list(s).progress.entries).toBe(n);expect(ids(s).filter((x:string)=>x.startsWith('entry'))).toHaveLength(n===100?3:n>=10?2:1);}}
  s.updateTransaction({id:tx!.transaction.id,expectedVersion:1,patch:{name:'edited'}},randomUUID());
  time+=86400000;settle(s);expect(list(s).progress.activityDays).toBe(1);
  s.softDeleteTransaction({id:tx!.transaction.id,expectedVersion:2},randomUUID());expect(list(s).progress.entries).toBe(99);expect(ids(s)).toContain('entry_100');
  expect(count(s,'achievement_unlock')).toBe(3);expect(count(s,'achievement_notice')).toBe(3);
 });
 it('one recomputation crossing all thresholds unlocks each once',()=>{
  const {store:s}=setup();s.withImports(true,c=>{for(let i=0;i<100;i++)c.db.prepare(`INSERT INTO "transaction"(id,ledger_id,amount_fen,currency,occurred_date,occurred_time,time_precision,name,category_id,merchant,note,source,source_candidate_id,deleted_at,version,created_at,updated_at) VALUES(?,?,1,'CNY','2020-01-01',NULL,'date','synthetic','cat_food',NULL,NULL,'manual',NULL,NULL,1,?,?)`).run(randomUUID(),c.ledgerId,new Date(time).toISOString(),new Date(time).toISOString());});
  settle(s);expect(ids(s)).toEqual(['entry_first','entry_10','entry_100']);settle(s);expect(count(s,'achievement_unlock')).toBe(3);
 });
 it('AI requires approved unique candidate/posting; previews, task completion and replay do not count',async()=>{
  const {store:s}=setup(),f=await source(s,[proposal()]);expect(list(s).progress.aiEntries).toBe(0);
  const input={mode:'single' as const,...(await import('./review-fixture')).confirmed(f.review.get(f.candidates[0]!.id))};
  const result=approve(f.review,f.candidates[0]!.id);f.review.approve(input,randomUUID());
  expect(list(s).progress).toMatchObject({entries:1,aiEntries:1,activityDays:1});expect(ids(s)).toContain('ai_first');
  s.softDeleteTransaction({id:result.transactions[0]!.id,expectedVersion:1},randomUUID());
  expect(list(s).progress.aiEntries).toBe(0);expect(ids(s)).toContain('ai_first');expect(count(s,'review_posting')).toBe(1);
 });
 it.each([
  ['2024-02-28T15:59:59.000Z','2024-02-28T16:00:00.000Z','2024-02-29T16:00:00.000Z'],
  ['2025-12-30T16:00:00.000Z','2025-12-31T16:00:00.000Z','2026-01-01T16:00:00.000Z'],
  ['2026-04-29T16:00:00.000Z','2026-04-30T16:00:00.000Z','2026-05-01T16:00:00.000Z'],
 ])('Shanghai midnight/calendar streak %s',(...dates)=>{
  time=Date.parse(dates[0]!);const {store:s}=setup();const txs=[];
  for(const d of dates){time=Date.parse(d);txs.push(s.createTransaction(transactionInput(),randomUUID()));s.createTransaction(transactionInput(),randomUUID());}
  expect(list(s).progress).toMatchObject({activityDays:3,currentStreak:3,longestStreak:3});expect(ids(s)).toContain('streak_3');
  time+=86400000;expect(list(s).progress.currentStreak).toBe(3);
  time+=86400000;expect(list(s).progress.currentStreak).toBe(0);
  for(const tx of txs)s.softDeleteTransaction({id:tx!.transaction.id,expectedVersion:1},randomUUID());
  expect(list(s).progress.longestStreak).toBe(3);
  s.createTransaction(transactionInput({occurredDate:'2020-01-01'}),randomUUID());expect(list(s).progress).toMatchObject({activityDays:4,currentStreak:1,longestStreak:3});
 });
 it('30-day longest streak unlocks 3/7/30 once',()=>{const {store:s}=setup();for(let i=0;i<30;i++){s.createTransaction(transactionInput(),randomUUID());time+=86400000;}expect(list(s).progress.longestStreak).toBe(30);expect(ids(s).filter((x:string)=>x.startsWith('streak'))).toHaveLength(3);});
 it('manual verified registered backups only, same ID/day dedup, reliable facts survive archive deletion',()=>{
  const {store:s}=setup();const m=randomUUID(),input={kind:'manual' as const,containsPrivateDataAcknowledged:true as const};
  s.createBackup(input,m);s.createBackup(input,m);s.createBackup(input,randomUUID());expect(list(s).progress).toMatchObject({backups:2,backupDays:1});
  for(let i=0;i<2;i++){time+=86400000;s.createBackup(input,randomUUID());}expect(ids(s)).toContain('backup_days_3');
  s.withImports(true,c=>c.db.prepare('DELETE FROM backup_record').run());settle(s);expect(list(s).progress.backupDays).toBe(3);
 });
 it('history upgrade uses actual creation, soft deleted activity, null unlock time and one summary across restarts',()=>{
  const {store:s,options}=setup({migrations:MIGRATIONS.slice(0,3)});
  const tx=s.createTransaction(transactionInput(),randomUUID());s.softDeleteTransaction({id:tx!.transaction.id,expectedVersion:1},randomUUID());time+=86400000;s.createTransaction(transactionInput(),randomUUID());
  s.withImports(true,c=>c.db.prepare('UPDATE "transaction" SET created_at=? WHERE deleted_at IS NULL').run('unknown'));s.close();
  const u=reopen({...options,migrations:MIGRATIONS});expect(u.snapshot().dbSchemaVersion).toBe(4);const v=list(u);
  expect(v.progress).toMatchObject({entries:1,activityDays:1});expect(v.items.find((x)=>x.id==='entry_first')).toMatchObject({unlocked:true,unlockedAt:null,origin:'history'});
  expect(v.notices).toHaveLength(1);expect(v.notices[0]).toMatchObject({kind:'history_summary',achievementIds:['entry_first'],status:'pending'});
  u.close();const again=reopen({...options,migrations:MIGRATIONS});expect(list(again).notices).toHaveLength(1);expect(count(again,'achievement_unlock')).toBe(1);
 });
 it('initialization interruption rolls back facts/unlocks/summary and retries on restart',()=>{
  const {store:s,options}=setup({migrations:MIGRATIONS.slice(0,3)});s.createTransaction(transactionInput(),randomUUID());s.close();
  const fail=reopen({...options,migrations:MIGRATIONS,fault:step=>{if(step==='achievement-before-commit')throw Error('synthetic');}});
  expect(()=>list(fail)).toThrow();expect(count(fail,'achievement_unlock')).toBe(0);expect(count(fail,'achievement_fact')).toBe(0);fail.close();
  const good=reopen({...options,migrations:MIGRATIONS});expect(ids(good)).toContain('entry_first');expect(list(good).notices).toHaveLength(1);
 });
 it('achievement fault never reverses business receipt; retry/restart does not make another transaction',()=>{
  let fail=false;const {store:s,options}=setup({fault:step=>{if(fail&&step==='achievement-before-commit')throw Error('synthetic');}});fail=true;
  const input=transactionInput(),m=randomUUID(),r=s.createTransaction(input,m);expect(r.replayed).toBe(false);expect(s.createTransaction(input,m).replayed).toBe(true);
  expect(count(s,'"transaction"')).toBe(1);expect(count(s,'mutation_receipt')).toBe(1);expect(count(s,'achievement_unlock')).toBe(0);
  expect(()=>list(s)).toThrow();fail=false;expect(ids(s)).toEqual(['entry_first']);s.close();const good=reopen({...options,fault:undefined});expect(count(good,'"transaction"')).toBe(1);expect(ids(good)).toEqual(['entry_first']);
 });
 it('consumption is idempotent, query is not consumption, pending/shown/closed/suppressed stay separate',()=>{
  const {store:s,options}=setup();s.createTransaction(transactionInput(),randomUUID());const n=list(s).notices[0];expect(list(s).notices[0].status).toBe('pending');
  const consume=(state:string)=>s.consumeAchievementNotice({noticeId:n.id,state:state as import('../../../src/shared/achievements').NoticeConsumeInput['state']},s.currentEpoch);
  consume('shown');consume('shown');expect(list(s).notices[0].status).toBe('shown');consume('closed');consume('shown');expect(list(s).notices[0].status).toBe('closed');
  expect(()=>consume('unlock')).toThrow();expect(()=>s.consumeAchievementNotice({noticeId:n.id,state:'shown'},randomUUID())).toThrow();
  s.close();expect(list(reopen(options)).notices[0].status).toBe('closed');
 });
 it('v3 to v4 DDL failure rolls back whole migration and recovery mode refuses achievement writes/read errors explicitly',()=>{
  const {store:s,options}=setup({migrations:MIGRATIONS.slice(0,3)});s.createTransaction(transactionInput(),randomUUID());s.close();
  const bad={...MIGRATIONS[3]!,sql:MIGRATIONS[3]!.sql+'; INVALID_SQL;'};
  const r=reopen({...options,migrations:[...MIGRATIONS.slice(0,3),bad]});expect(r.snapshot()).toMatchObject({dbSchemaVersion:3,recoveryRequired:true,transactionCount:1});
  expect(()=>list(r)).toThrow();expect(()=>settle(r)).toThrow();openReadOnly(r.diagnostics().databasePath,db=>expect(db.prepare("SELECT name FROM sqlite_master WHERE name='achievement_unlock'").get()).toBeUndefined());
 });
 it('stale epoch recomputation cannot write even from a trusted old callback',()=>{const {store:s}=setup();expect(()=>settle(s,randomUUID())).toThrow();expect(count(s,'achievement_unlock')).toBe(0);});
});
