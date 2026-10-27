/** E: a machine-readable witness per stable ID. Catches early grants, lost grants,
 * duplicate facts, and archive-self restore regressions; real isolated SQLite. */
import {afterEach,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {LedgerStore} from '../../../src/main/services/ledger-store';
import type {AchievementId,AchievementList} from '../../../src/shared/achievements';
import {createTestLayout,cleanupLayout,storeOptions,transactionInput,openReadOnly} from './helpers';
import {source,proposal,confirmed} from './review-fixture';
const stores:LedgerStore[]=[],layouts:ReturnType<typeof createTestLayout>[]=[];
let now=Date.parse('2026-09-01T04:00:00.000Z');
function setup(){const layout=createTestLayout();layouts.push(layout);const s=LedgerStore.open(storeOptions(layout,()=>now,{appVersion:'0.1.4'}));stores.push(s);return s;}
function record(id:AchievementId,input:unknown,before:AchievementList,after:AchievementList,extra:unknown={}){
 const negative=before.items.find(i=>i.id===id)!,positive=after.items.find(i=>i.id===id)!;
 expect(negative.unlocked).toBe(false);expect(positive.unlocked).toBe(true);
 const output=process.env.BOOKKEEP_E_RULE_OUTPUT;
 if(output){mkdirSync(output,{recursive:true});writeFileSync(path.join(output,id+'.json'),JSON.stringify({id,synthetic:true,input,expected:{beforeUnlocked:false,afterUnlocked:true,target:positive.target},actual:{before:negative,after:positive,beforeProgress:before.progress,afterProgress:after.progress},extra,ok:true},null,2),{encoding:'utf8',flag:'wx'});}
}
const list=(s:LedgerStore)=>s.achievementsList();
const backup=(s:LedgerStore)=>s.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},randomUUID());
function restore(s:LedgerStore,id:string){return s.restoreBackup({mode:'commit',restoreToken:s.previewRestore(id).restoreToken,currentDataWillBeReplaced:true},randomUUID());}
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const l of layouts.splice(0))cleanupLayout(l);now=Date.parse('2026-09-01T04:00:00.000Z');});
describe('E stable achievement delivery witnesses',()=>{
 it('entry awards cross exactly 1/10/100; editing, replay and delete cannot issue another award',()=>{
  const s=setup();let previous=list(s),last:ReturnType<LedgerStore['createTransaction']>|undefined;
  for(let n=1;n<=100;n++){
   const input=transactionInput({name:`E expense ${n}`,occurredDate:'2020-01-01'}),m=randomUUID();
   last=s.createTransaction(input,m);expect(s.createTransaction(input,m).replayed).toBe(true);
   const current=list(s);expect(current.progress.entries).toBe(n);
   if(n===1||n===10||n===100)record(n===1?'entry_first':n===10?'entry_10':'entry_100',{successfulCreates:n,amountFen:1800,occurredDate:'2020-01-01',duplicateMutationRequests:n},previous,current);
   previous=current;
  }
  s.updateTransaction({id:last!.transaction.id,expectedVersion:1,patch:{name:'E edited'}},randomUUID());
  s.softDeleteTransaction({id:last!.transaction.id,expectedVersion:2},randomUUID());
  const v=list(s);expect(v.progress).toMatchObject({entries:99,activityDays:1});expect(v.items.filter(i=>i.id.startsWith('entry')&&i.unlocked)).toHaveLength(3);
  openReadOnly(s.diagnostics().databasePath,db=>{expect(db.prepare('SELECT count(*) n FROM achievement_unlock').get()).toEqual({n:3});});
 });
 it('streak awards cross exactly 3/7/30 real Shanghai operation days; backfill, same day and gaps are distinct',()=>{
  const s=setup();let previous=list(s);
  for(let day=1;day<=30;day++){
   s.createTransaction(transactionInput({occurredDate:'2020-01-01'}),randomUUID());s.createTransaction(transactionInput(),randomUUID());
   const current=list(s);expect(current.progress).toMatchObject({activityDays:day,currentStreak:day,longestStreak:day});
   if(day===3||day===7||day===30)record(day===3?'streak_3':day===7?'streak_7':'streak_30',{operationDays:day,entriesEachDay:2,backfillOccurredDate:'2020-01-01',successUtc:new Date(now).toISOString()},previous,current);
   previous=current;now+=86400000;
  }
  expect(list(s).progress.currentStreak).toBe(30);now+=86400000;expect(list(s).progress).toMatchObject({currentStreak:0,longestStreak:30});
 });
 it('AI awards count 1/10 distinct approved candidates with receipts/postings; recognition and preview count zero',async()=>{
  const s=setup();now=Date.parse('2026-10-27T04:00:00.000Z');
  const f=await source(s,Array.from({length:10},(_,i)=>proposal({name:`E mock candidate ${i}`,amountFen:100+i})));
  f.review.preview(f.candidates.map(c=>confirmed(f.review.get(c.id))));let previous=list(s);expect(previous.progress.aiEntries).toBe(0);
  for(let n=1;n<=10;n++){
   const c=f.candidates[n-1]!,m=randomUUID(),input={mode:'single' as const,...confirmed(f.review.get(c.id))};
   f.review.approve(input,m);expect(f.review.approve(input,m)).toMatchObject({replayed:true});
   const current=list(s);expect(current.progress.aiEntries).toBe(n);
   if(n===1||n===10)record(n===1?'ai_first':'ai_10',{recognized:10,previewed:10,distinctApprovals:n,replayedApprovals:n},previous,current);
   previous=current;
  }
  openReadOnly(s.diagnostics().databasePath,db=>{expect(db.prepare('SELECT count(*) n FROM review_posting').get()).toEqual({n:10});expect(db.prepare("SELECT count(*) n FROM mutation_receipt WHERE operation='candidate.approve'").get()).toEqual({n:10});expect(db.prepare('SELECT count(*) n FROM review_posting p JOIN "transaction" t ON t.id=p.transaction_id AND t.source_candidate_id=p.candidate_id').get()).toEqual({n:10});});
 });
 it('backup awards survive their own first/third-day archive; repeated restore and same day backups cannot add days',()=>{
  const s=setup();const initial=list(s),first=backup(s);const afterFirst=list(s);
  restore(s,first.record.id);expect(list(s).progress).toMatchObject({backups:1,backupDays:1});
  record('backup_first',{manualSuccesses:1,restoredArchive:first.record.id},initial,list(s),{afterCreate:afterFirst.progress});
  restore(s,first.record.id);backup(s);expect(list(s).progress).toMatchObject({backups:2,backupDays:1});
  now+=86400000;backup(s);const day2=list(s);expect(day2.progress.backupDays).toBe(2);
  now+=86400000;const third=backup(s);restore(s,third.record.id);restore(s,third.record.id);
  const after=list(s);expect(after.progress).toMatchObject({backups:4,backupDays:3});expect(after.notices.every(n=>n.status==='suppressed'||n.status==='closed')).toBe(true);
  record('backup_days_3',{manualSuccesses:4,distinctShanghaiDays:3,repeatedRestores:2,restoredArchive:third.record.id},day2,after);
 });
});
