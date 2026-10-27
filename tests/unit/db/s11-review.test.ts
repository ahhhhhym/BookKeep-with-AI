import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { ImageService } from '../../../src/main/services/image-service';
import { ReviewService } from '../../../src/main/services/review-service';
import { MIGRATIONS } from '../../../src/main/db/migrations';
import { runInTransaction } from '../../../src/main/db/sqlite';
import { collectBusinessViolations } from '../../../src/main/db/integrity';
import { cleanupLayout, createTestLayout, storeOptions, transactionInput } from './helpers';
import { source, proposal, confirmed, approve, clock } from './review-fixture';
import type { ApprovalResult, ReviewCandidate, EditableFields } from '../../../src/shared/review';
import { CHANNEL_SPECS } from '../../../src/shared/ipc';
import { validateIpcRequest } from '../../../src/main/ipc/validate-request';
import { CONTRACT_VERSION } from '../../../src/shared/constants';
let store:LedgerStore,layout:ReturnType<typeof createTestLayout>;
beforeEach(()=>{layout=createTestLayout();store=LedgerStore.open(storeOptions(layout,clock));});
afterEach(()=>{store.close();cleanupLayout(layout);});
const count=(table:string,where='1')=>store.withImports(false,c=>c.db.prepare<{n:number}>(`SELECT count(*) n FROM ${table} WHERE ${where}`).get()!.n);
const scope=(period:'week'|'month'|'year'='month')=>({period,anchorDate:'2026-09-09',categoryIds:[],snapshotRevision:null});
const update=(review:ReviewService,c:ReviewCandidate,patch:Partial<EditableFields>)=>review.update({id:c.id,expectedVersion:c.version,action:'edit',patch,reason:'人工对照合成图核实'},randomUUID());
function formal(){return ['week','month','year'].map(p=>{const s=scope(p as 'week'|'month'|'year');return {series:store.statisticsSeries(s),summary:store.statisticsSummary(s),rank:store.statisticsTopCategories({...s,pointMonth:null}),top:s.period==='year'?store.statisticsTopCategories({...s,pointMonth:'2026-09'}):store.statisticsTopTransactions({...s,pointDate:'2026-09-09'})};});}
const strip=(v:unknown)=>JSON.parse(JSON.stringify(v),(k,v)=>['scope','revision','snapshotRevision','dataRevision'].includes(k)?undefined:v);
describe('S11 true persistent human review',()=>{
 it('D49 F03-I-C: pending9900/rejected8800/failed + merchant edit survive restart, every official view unchanged, approved delta exactly9900',async()=>{
  for(const [amountFen,occurredDate,categoryId,name] of [[1800,'2026-09-08','cat_food','午餐'],[1626,'2026-09-08','cat_fruit','购买水果'],[1000,'2026-09-08','cat_food','晚餐'],[85000,'2026-09-09','cat_repair','iPad维修'],[5554,'2026-09-09','cat_digital','iPad保护膜'],[1550,'2026-09-09','cat_food','午餐']] as const)store.createTransaction(transactionInput({amountFen,occurredDate,categoryId,name}),randomUUID());
  const baseline=strip(formal());const {review,candidates}=await source(store,[proposal(),proposal({name:'拒绝隔离测试',amountFen:8800})]);
  const id=candidates[0]!.id;review.reject({id:candidates[1]!.id,expectedVersion:1,reason:'合成拒绝测试'},randomUUID());update(review,review.get(id),{merchant:'合成测试商户'});await source(store,[],true);
  expect(strip(formal())).toEqual(baseline);store.close();store=LedgerStore.open(storeOptions(layout,clock));
  expect(store.snapshot()).toMatchObject({dbSchemaVersion:4,transactionCount:6,recoveryRequired:false});expect(count('candidate',"review_state='rejected'")).toBe(1);expect(count('import_job',"status='failed'")).toBe(1);
  const next=new ReviewService(store,new ImageService(store,()=>1),()=>1,clock);expect(next.get(id).current.merchant).toBe('合成测试商户');expect(strip(formal())).toEqual(baseline);
  expect(approve(next,id).totalFen).toBe('9900');for(const f of formal()){expect(f.summary).toMatchObject({count:7,totalFen:'106430'});expect(f.rank.items.find(i=>i.categoryId==='cat_food')?.totalFen).toBe('14250');}
  expect(store.statisticsTopTransactions({...scope(),pointDate:'2026-09-09'}).pointTotalFen).toBe('102004');
  expect(count('review_event',"action='approve'")).toBe(1);expect(store.withImports(false,c=>collectBusinessViolations(c.db))).toEqual([]);
 });
 it('double click, same mutation response-loss retry, concurrent requests, reopen, soft delete and restore never make a second link',async()=>{
  const {review,candidates}=await source(store,[proposal()]);const id=candidates[0]!.id,item=confirmed(review.get(id)),key=randomUUID();
  const results=await Promise.all(Array.from({length:12},(_,i)=>Promise.resolve().then(()=>review.approve({mode:'single',...item},i<6?key:randomUUID()) as ApprovalResult)));
  expect(new Set(results.map(r=>r.transactions[0]!.id)).size).toBe(1);expect(count('"transaction"')).toBe(1);expect(count('review_event',"action='approve'")).toBe(1);
  const first=results[0]!.transactions[0]!;const deleted=store.softDeleteTransaction({id:first.id,expectedVersion:first.version},randomUUID());
  expect(approve(review,id).transactions[0]!.deletedAt).not.toBeNull();expect(count('"transaction"')).toBe(1);expect(store.statisticsSummary(scope()).totalFen).toBe('0');
  store.restoreTransaction({id:first.id,expectedVersion:deleted.transaction.version},randomUUID());store.close();store=LedgerStore.open(storeOptions(layout,clock));
  const next=new ReviewService(store,new ImageService(store,()=>1),()=>1,clock);expect(approve(next,id).alreadyApproved).toBe(true);expect(store.statisticsSummary(scope()).totalFen).toBe('9900');
  const approved=next.get(id);expect(()=>next.update({id,expectedVersion:approved.version,action:'reopen',reason:'不能重开已批准'},randomUUID())).toThrowError('STATE_CONFLICT');
  expect(()=>update(next,approved,{name:'必须走正式交易编辑'})).toThrowError('STATE_CONFLICT');
 });
 it('approval failure after transaction insertion rolls back transaction, event, candidate, posting, receipt and revision; same-key retry succeeds',async()=>{
  const {review,candidates}=await source(store,[proposal()]);const item=confirmed(review.get(candidates[0]!.id)),key=randomUUID(),rev=store.currentRevision;
  store.withImports(true,c=>c.db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON review_event WHEN NEW.action='approve' BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END;"));
  expect(()=>review.approve({mode:'single',...item},key)).toThrow();expect(count('"transaction"')).toBe(0);expect(count('review_event')).toBe(0);expect(count('review_posting')).toBe(0);expect(store.currentRevision).toBe(rev);expect(review.get(item.id).reviewState).toBe('pending_review');
  store.withImports(true,c=>c.db.exec('DROP TRIGGER injected_failure'));expect((review.approve({mode:'single',...item},key) as ApprovalResult).count).toBe(1);
 });
 it('stale field edit loses race against approval; approval loses race against edit without overwrite',async()=>{
  const {review,candidates}=await source(store,[proposal()]);const old=review.get(candidates[0]!.id),item=confirmed(old);update(review,old,{amountFen:1234});
  expect(()=>review.approve({mode:'single',...item},randomUUID())).toThrowError('VERSION_CONFLICT');expect(count('"transaction"')).toBe(0);
  const current=review.get(old.id);approve(review,old.id);expect(()=>update(review,current,{name:'不应覆盖'})).toThrowError('VERSION_CONFLICT');expect(count('"transaction"')).toBe(1);
 });
 it('category rename invalidates single confirmation and batch preview; fresh review alone can post',async()=>{
  const {review,candidates}=await source(store,[proposal()]);
  const old=review.get(candidates[0]!.id),item=confirmed(old),preview=review.preview([item]);
  const category=store.listCategories(true).categories.find(c=>c.id==='cat_food')!;
  store.updateCategory({id:category.id,expectedVersion:category.version,patch:{name:'餐饮核对新版'}},randomUUID());
  expect(review.get(old.id).version).toBe(old.version);
  expect(review.get(old.id).reviewDigest).not.toBe(old.reviewDigest);
  expect(()=>review.approve({mode:'single',...item},randomUUID())).toThrowError('REVIEW_STALE');
  expect(()=>review.approve({mode:'commit',previewToken:preview.previewToken!},randomUUID())).toThrowError('REVIEW_STALE');
  expect(count('"transaction"')).toBe(0);expect(count('review_event',"action='approve'")).toBe(0);
  expect(approve(review,old.id).count).toBe(1);
 });
 it('unknown product, date or category cannot be bypassed by high confidence or warning resolve; explicit supplement and warning reason required',async()=>{
  const {review,candidates}=await source(store,[proposal({name:null,categoryId:null,confidence:1,missingFields:['name','categoryId'],warnings:[{code:'NAME_UNKNOWN',message:'未知商品',field:'name'}]})]);let c=review.get(candidates[0]!.id);
  expect(()=>approve(review,c.id)).toThrowError('REVIEW_INCOMPLETE');expect(()=>review.update({id:c.id,expectedVersion:c.version,action:'resolve_warning',warningCode:'NAME_UNKNOWN',field:'name',reviewDigest:c.reviewDigest,reason:'不能忽略未知'},randomUUID())).toThrow();
  c=update(review,c,{name:'人工确认早餐',categoryId:'cat_food'});for(const w of c.warnings)c=review.update({id:c.id,expectedVersion:c.version,action:'resolve_warning',warningCode:w.code,field:w.field,reviewDigest:c.reviewDigest,reason:'依据真实付款事实人工补填'},randomUUID());
  expect(approve(review,c.id).count).toBe(1);expect(JSON.parse(store.withImports(false,x=>x.db.prepare<{proposal_json:string}>('SELECT proposal_json FROM candidate WHERE id=?').get(c.id)!.proposal_json)).name).toBeNull();
 });
 it.each([0,-1,1.5,1000000000])('invalid amount %s cannot be saved or approved',async amountFen=>{const {review,candidates}=await source(store,[proposal()]);expect(()=>update(review,review.get(candidates[0]!.id),{amountFen})).toThrowError('AMOUNT_INVALID');expect(count('"transaction"')).toBe(0);});
 it('similar transaction requires distinct reason and newly appearing match invalidates resolution/digest',async()=>{
  const {review,candidates}=await source(store,[proposal()]);const id=candidates[0]!.id;store.createTransaction(transactionInput({amountFen:9900,occurredDate:'2026-09-09',name:'待审隔离测试'}),randomUUID());let c=review.get(id);
  expect(()=>approve(review,id)).toThrowError('DUPLICATE_UNRESOLVED');c=review.update({id,expectedVersion:c.version,action:'resolve_duplicate',duplicateResolution:'distinct',reviewDigest:c.reviewDigest,reason:'同日另一次真实消费'},randomUUID());const stale=confirmed(c);
  store.createTransaction(transactionInput({amountFen:9900,occurredDate:'2026-09-09',name:'待审隔离测试'}),randomUUID());expect(()=>review.approve({mode:'single',...stale},randomUUID())).toThrowError('REVIEW_STALE');c=review.get(id);
  c=review.update({id,expectedVersion:c.version,action:'resolve_duplicate',duplicateResolution:'distinct',reviewDigest:c.reviewDigest,reason:'已逐项核对三次独立付款'},randomUUID());expect(approve(review,id).count).toBe(1);expect(count('"transaction"')).toBe(3);
 });
 it('reject/reopen retain immutable events and do not affect formal totals',async()=>{const {review,candidates}=await source(store,[proposal()]);let c=review.get(candidates[0]!.id);c=review.reject({id:c.id,expectedVersion:c.version,reason:'已确认为重复'},randomUUID());expect(()=>approve(review,c.id)).toThrowError('STATE_CONFLICT');c=review.update({id:c.id,expectedVersion:c.version,action:'reopen',reason:'重新核对依据'},randomUUID());expect(c.reviewState).toBe('pending_review');expect(count('review_event')).toBe(2);expect(count('"transaction"')).toBe(0);expect(()=>store.withImports(true,x=>x.db.exec("UPDATE review_event SET reason='篡改'"))).toThrow();});
 it('batch preview excludes missing/high-risk, sums integers; revision/field changes invalidate entire batch',async()=>{
  const {review,candidates}=await source(store,[proposal({name:'午餐',amountFen:1800}),proposal({name:'水果',amountFen:1626}),proposal({name:null,missingFields:['name']}),proposal({name:'高风险',warnings:[{code:'BLURRY',message:'模糊',field:null}]})]);
  const items=candidates.map(c=>confirmed(review.get(c.id))),p=review.preview(items);expect(p).toMatchObject({count:2,totalFen:'3426'});expect(p.excluded).toHaveLength(2);
  update(review,review.get(items[1]!.id),{name:'修改'});expect(()=>review.approve({mode:'commit',previewToken:p.previewToken!},randomUUID())).toThrowError('REVIEW_STALE');expect(count('"transaction"')).toBe(0);
 });
 it('batch second approval fails: zero transactions, zero approve events; retry exact token after rollback creates exactly two',async()=>{
  const {review,candidates}=await source(store,[proposal({name:'午餐',amountFen:1800}),proposal({name:'水果',amountFen:1626})]);const p=review.preview(candidates.map(c=>confirmed(review.get(c.id)))),key=randomUUID();
  store.withImports(true,c=>c.db.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON review_event WHEN NEW.action='approve' AND NEW.candidate_id='${candidates[1]!.id}' BEGIN SELECT RAISE(ABORT,'TEST'); END;`));
  expect(()=>review.approve({mode:'commit',previewToken:p.previewToken!},key)).toThrow();expect(count('"transaction"')).toBe(0);expect(count('review_event')).toBe(0);expect(count('review_posting')).toBe(0);
  store.withImports(true,c=>c.db.exec('DROP TRIGGER fail_second'));expect(review.approve({mode:'commit',previewToken:p.previewToken!},key)).toMatchObject({count:2,totalFen:'3426'});
 });
 it('60-second token, wrong window, changed epoch and intervening single approval block batch commit',async()=>{
  const {images,candidates}=await source(store,[proposal({name:'甲'}),proposal({name:'乙'})]);let now=clock(),owner=1;const review=new ReviewService(store,images,()=>owner,()=>now),items=candidates.map(c=>confirmed(review.get(c.id)));
  let p=review.preview(items);owner=2;expect(()=>review.approve({mode:'commit',previewToken:p.previewToken!},randomUUID())).toThrowError('REVIEW_STALE');owner=1;now+=60001;expect(()=>review.approve({mode:'commit',previewToken:p.previewToken!},randomUUID())).toThrowError('TOKEN_EXPIRED');
  p=review.preview(items);approve(review,items[0]!.id);expect(()=>review.approve({mode:'commit',previewToken:p.previewToken!},randomUUID())).toThrowError('REVIEW_STALE');expect(count('"transaction"')).toBe(1);
 });
 it('same mutation different payload conflicts; confirmation false and stale digest cannot approve',async()=>{const {review,candidates}=await source(store,[proposal()]);const item=confirmed(review.get(candidates[0]!.id));expect(()=>review.approve({mode:'single',...item,confirmation:{...item.confirmation,amount:false}},randomUUID())).toThrowError('REVIEW_INCOMPLETE');const key=randomUUID();review.approve({mode:'single',...item},key);expect(()=>review.approve({mode:'single',...item,expectedVersion:8},key)).toThrowError('IDEMPOTENCY_CONFLICT');});
 it('unreadable or modified source image blocks approval in service, not only UI',async()=>{const {review,candidates}=await source(store,[proposal()]);store.withImports(false,c=>{const r=c.db.prepare<{prepared_ref:string}>('SELECT prepared_ref FROM image_asset WHERE id=?').get(candidates[0]!.imageAssetId)!;writeFileSync(path.join(c.directory,r.prepared_ref),'tampered');});expect(()=>approve(review,candidates[0]!.id)).toThrowError('HASH_MISMATCH');expect(count('"transaction"')).toBe(0);});
 it('database constraints independently reject orphan, half-posted, duplicate-source and mismatched links even with direct SQL',async()=>{
  const {review,candidates}=await source(store,[proposal()]);const c=candidates[0]!;
  const insert=(id:string,candidateId:string)=>store.withImports(true,x=>runInTransaction(x.db,()=>x.db.prepare(`INSERT INTO "transaction"(id,ledger_id,amount_fen,currency,occurred_date,occurred_time,time_precision,name,category_id,merchant,note,source,source_candidate_id,review_candidate_id,deleted_at,version,created_at,updated_at) VALUES(?,?,100,'CNY','2026-09-09',NULL,'date','直接SQL','cat_food',NULL,NULL,'ai',?,?,NULL,1,'t','t')`).run(id,x.ledgerId,candidateId,candidateId)));
  expect(()=>insert(randomUUID(),randomUUID())).toThrow();expect(()=>insert(randomUUID(),c.id)).toThrow();expect(count('"transaction"')).toBe(0);
  const result=approve(review,c.id);expect(()=>insert(randomUUID(),c.id)).toThrow();expect(()=>store.withImports(true,x=>x.db.prepare('UPDATE "transaction" SET source_candidate_id=? WHERE id=?').run(randomUUID(),result.transactions[0]!.id))).toThrow();expect(count('"transaction"')).toBe(1);
  const indexes=store.withImports(false,x=>x.db.prepare<{name:string;sql:string}>("SELECT name,sql FROM sqlite_master WHERE name='ux_transaction_candidate'").get()!);expect(indexes.sql).toContain('UNIQUE');expect(indexes.sql).toContain('source_candidate_id IS NOT NULL');expect(indexes.sql).not.toContain('deleted_at');
  store.withImports(true,x=>x.db.exec('DROP TRIGGER trg_ai_candidate_insert'));expect(()=>insert(randomUUID(),c.id)).toThrowError(/UNIQUE constraint/);
 });
 it('v2→v4 migration backs up and preserves actual pending and failed source records',async()=>{
  store.close();cleanupLayout(layout);layout=createTestLayout();store=LedgerStore.open(storeOptions(layout,clock,{migrations:MIGRATIONS.slice(0,2)}));await source(store,[proposal()]);await source(store,[],true);const before=count('candidate');store.close();store=LedgerStore.open(storeOptions(layout,clock));expect(store.snapshot()).toMatchObject({dbSchemaVersion:4,recoveryRequired:false});expect(count('candidate')).toBe(before);expect(store.listBackups().records.some(b=>b.kind==='pre_migration')).toBe(true);
 });
 it('strict restricted IPC rejects source overrides, malformed confirmations, >100 batch and absent mutation at service',async()=>{
  const request=(payload:unknown)=>({contractVersion:CONTRACT_VERSION,requestId:randomUUID(),dataEpoch:store.currentEpoch,payload});
  expect(()=>validateIpcRequest(CHANNEL_SPECS.candidateApprove,request({mode:'single',id:randomUUID(),expectedVersion:1,confirmation:{amount:true,date:true,name:true,category:true,confirmedVersion:1,reviewDigest:'a'.repeat(64)},source:'ai'}),{expectedEpoch:store.currentEpoch})).toThrowError('PAYLOAD_INVALID');
  expect(()=>validateIpcRequest(CHANNEL_SPECS.candidateApprove,request({mode:'preview',items:Array(101).fill({})}),{expectedEpoch:store.currentEpoch})).toThrow();
  expect(()=>validateIpcRequest(CHANNEL_SPECS.candidateApprove,request({mode:'preview',items:[{id:randomUUID(),expectedVersion:1,confirmation:{amount:true}}]}),{expectedEpoch:store.currentEpoch})).toThrow();
  const {review,candidates}=await source(store,[proposal()]);expect(()=>review.approve({mode:'single',...confirmed(review.get(candidates[0]!.id))},null)).toThrowError('PAYLOAD_INVALID');
 });
 it('total/detail group cannot post both: reject detail before resolving total; high-risk remains single only',async()=>{
  const {review,candidates}=await source(store,[proposal({amountFen:10000,name:'合计',amountBasis:'paid_total',groupKey:'order'}),proposal({amountFen:6000,name:'明细',groupKey:'order'})]);
  let total=review.get(candidates[0]!.id),detail=review.get(candidates[1]!.id);expect(()=>approve(review,total.id)).toThrowError('REVIEW_INCOMPLETE');
  detail=review.reject({id:detail.id,expectedVersion:detail.version,reason:'合计包含此商品，不能重复入账'},randomUUID());
  total=review.get(total.id);for(const w of total.warnings)total=review.update({id:total.id,expectedVersion:total.version,action:'resolve_warning',warningCode:w.code,field:w.field,reviewDigest:total.reviewDigest,reason:'核实合计实付，明细已拒绝'},randomUUID());
  expect(review.preview([confirmed(total)]).count).toBe(0);expect(approve(review,total.id).totalFen).toBe('10000');
  detail=review.update({id:detail.id,expectedVersion:detail.version,action:'reopen',reason:'仍须检查不能重复入账'},randomUUID());expect(()=>approve(review,detail.id)).toThrowError('REVIEW_INCOMPLETE');expect(count('"transaction"')).toBe(1);
 });
 it('refund/failed requires explicit expense correction, reason and fresh confirmation; disabled category blocks old review',async()=>{
  const {review,candidates}=await source(store,[proposal({transactionKind:'refund'})]);let c=review.get(candidates[0]!.id);expect(()=>approve(review,c.id)).toThrowError('NON_EXPENSE');
  c=update(review,c,{transactionKind:'expense'});for(const w of c.warnings)c=review.update({id:c.id,expectedVersion:c.version,action:'resolve_warning',warningCode:w.code,field:w.field,reviewDigest:c.reviewDigest,reason:'人工已查证为实际支出，纠正误识别'},randomUUID());
  expect(review.preview([confirmed(c)]).count).toBe(0);const stale=confirmed(c),cat=store.listCategories(true).categories.find(x=>x.id==='cat_food')!;store.disableCategory({id:cat.id,expectedVersion:cat.version},randomUUID());expect(()=>review.approve({mode:'single',...stale},randomUUID())).toThrowError('REVIEW_STALE');
  expect(count('"transaction"')).toBe(0);
 });
 it('review state filters use real SQL counts and cursor scope; do not silently mix filtered pages',async()=>{
  const {review,images,candidates}=await source(store,[proposal({name:'甲'}),proposal({name:'乙'}),proposal({name:'丙'})]);
  review.reject({id:candidates[1]!.id,expectedVersion:1,reason:'拒绝测试'},randomUUID());approve(review,candidates[2]!.id);
  const {RecognitionService}=await import('../../../src/main/services/recognition-service');const {SecretStore}=await import('../../../src/main/services/settings/ai-settings');
  const q=new RecognitionService(store,images,new SecretStore(layout.secrets,{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''}));
  try{const all=review.list({jobId:null,page:{limit:1,cursor:null}},q);expect(all.counts).toEqual({pending_review:1,rejected:1,approved:1});expect(all.totalCount).toBe(3);
    const rejected=review.list({jobId:null,page:{limit:1,cursor:null},reviewStates:['rejected']},q);expect(rejected.items.map(c=>c.id)).toEqual([candidates[1]!.id]);expect(rejected.totalCount).toBe(1);
    expect(()=>review.list({jobId:null,page:{limit:1,cursor:all.nextCursor},reviewStates:['rejected']},q)).toThrowError('SNAPSHOT_STALE');
  }finally{q.shutdown();}
 });
});
