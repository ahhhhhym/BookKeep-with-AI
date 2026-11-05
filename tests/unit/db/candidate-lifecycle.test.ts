import {afterEach,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {LedgerStore} from '../../../src/main/services/ledger-store';
import {ImageService} from '../../../src/main/services/image-service';
import {ReviewService} from '../../../src/main/services/review-service';
import {MIGRATIONS} from '../../../src/main/db/migrations';
import {collectBusinessViolations} from '../../../src/main/db/integrity';
import {openSqlite,runInTransaction} from '../../../src/main/db/sqlite';
import {inspectBackupArchive} from '../../../src/main/storage/backup-archive';
import {CONTRACT_VERSION} from '../../../src/shared/constants';
import {ReviewActivityService} from '../../../src/main/services/review-activity';
import {cleanupLayout,createTestLayout,storeOptions} from './helpers';
import {source,proposal,confirmed,approve,clock} from './review-fixture';
let store:LedgerStore,layout:ReturnType<typeof createTestLayout>;
beforeEach(()=>{layout=createTestLayout();store=LedgerStore.open(storeOptions(layout,clock));});
afterEach(()=>{store.close();cleanupLayout(layout);});
const n=(table:string)=>store.withImports(false,c=>c.db.prepare<{n:number}>(`SELECT count(*) n FROM ${table}`).get()!.n);
it('delete/restore preserves fields and source, replays before version check, invalidates old approval and survives restart',async()=>{
 const {review,candidates}=await source(store,[proposal()]); const old=review.get(candidates[0]!.id),item=confirmed(old),preview=review.preview([item]);
 const before=[n('image_asset'),n('import_job'),n('"transaction"')],key=randomUUID();
 const input={id:old.id,expectedVersion:old.version};
 expect(review.deleteCandidate(input,key).candidate.reviewState).toBe('deleted');
 expect(review.deleteCandidate(input,key).replayed).toBe(true);
 expect(()=>review.deleteCandidate({...input,expectedVersion:2},key)).toThrowError('IDEMPOTENCY_CONFLICT');
 expect(()=>review.deleteCandidate(input,randomUUID())).toThrowError('VERSION_CONFLICT');
 expect(()=>review.approve({mode:'single',...item},randomUUID())).toThrowError('VERSION_CONFLICT');
 expect(()=>review.update({id:old.id,expectedVersion:2,action:'reopen',reason:'不允许'},randomUUID())).toThrowError('STATE_CONFLICT');
 expect([n('image_asset'),n('import_job'),n('"transaction"')]).toEqual(before);
 store.close();store=LedgerStore.open(storeOptions(layout,clock));
 const next=new ReviewService(store,new ImageService(store,()=>1),()=>1,clock);
 const restored=next.restoreCandidate({id:old.id,expectedVersion:2},randomUUID()).candidate;
 expect(restored.current).toEqual(old.current);expect(restored.reviewState).toBe('pending_review');expect(restored.version).toBe(3);
 expect(()=>review.approve({mode:'commit',previewToken:preview.previewToken!},randomUUID())).toThrow();
 expect(()=>next.approve({mode:'single',...item},randomUUID())).toThrowError('VERSION_CONFLICT');
 expect(approve(next,old.id).count).toBe(1);expect(n('candidate_lifecycle_event')).toBe(2);
 expect(()=>next.deleteCandidate({id:old.id,expectedVersion:4},randomUUID())).toThrowError('STATE_CONFLICT');
 expect(store.withImports(false,c=>collectBusinessViolations(c.db))).toEqual([]);
});
it('lifecycle event failure rolls back candidate, revision and receipt',async()=>{
 const {review,candidates}=await source(store,[proposal()]); const input={id:candidates[0]!.id,expectedVersion:1},revision=store.currentRevision,key=randomUUID();
 store.withImports(true,c=>c.db.exec("CREATE TRIGGER fail_lifecycle BEFORE INSERT ON candidate_lifecycle_event BEGIN SELECT RAISE(ABORT,'TEST'); END"));
 expect(()=>review.deleteCandidate(input,key)).toThrow();expect(review.get(input.id).reviewState).toBe('pending_review');expect(store.currentRevision).toBe(revision);
 store.withImports(true,c=>c.db.exec('DROP TRIGGER fail_lifecycle'));expect(review.deleteCandidate(input,key).replayed).toBe(false);
});
it('v4 migration keeps all old migration checksums and records',async()=>{
 store.close();cleanupLayout(layout);layout=createTestLayout();store=LedgerStore.open(storeOptions(layout,clock,{migrations:MIGRATIONS.slice(0,4)}));
 const {candidates}=await source(store,[proposal()]);const checks=store.withImports(false,c=>c.db.prepare('SELECT * FROM migration_record').all());
 store.close();store=LedgerStore.open(storeOptions(layout,clock));expect(store.snapshot().dbSchemaVersion).toBe(5);
 expect(store.withImports(false,c=>c.db.prepare('SELECT * FROM migration_record WHERE to_version<=4').all())).toEqual(checks);
 const review=new ReviewService(store,new ImageService(store,()=>1),()=>1,clock);expect(review.get(candidates[0]!.id).deletedAt).toBeNull();
});
it.each(['delete','approve'] as const)('two SQLite connections: %s commits first, losing stale operation writes nothing',async winner=>{
 const {review,images,candidates}=await source(store,[proposal()]);const original=review.get(candidates[0]!.id),item=confirmed(original);
 const db=openSqlite(store.diagnostics().databasePath);
 const alternate={withImports:(write:boolean,fn:Parameters<LedgerStore['withImports']>[1])=>store.withImports(write,c=>fn({...c,db})),get currentEpoch(){return store.currentEpoch;},settleAchievementsAfterSuccess:()=>{}} as unknown as LedgerStore;
 const second=new ReviewService(alternate,images,()=>1,clock);
 try{
  if(winner==='delete'){review.deleteCandidate({id:original.id,expectedVersion:1},randomUUID());expect(()=>second.approve({mode:'single',...item},randomUUID())).toThrowError('VERSION_CONFLICT');expect(n('"transaction"')).toBe(0);}
  else{approve(review,original.id);expect(()=>second.deleteCandidate({id:original.id,expectedVersion:1},randomUUID())).toThrowError('VERSION_CONFLICT');expect(n('"transaction"')).toBe(1);}
  expect(n('review_posting')).toBe(winner==='approve'?1:0);expect(n('candidate_lifecycle_event')).toBe(winner==='delete'?1:0);
 }finally{db.close();}
});
it('deleted source excluded from new duplicate matching, restore recalculates duplicates and saved warning authorization',async()=>{
 const first=await source(store,[proposal({name:'same'})]);let c=first.review.get(first.candidates[0]!.id);
 first.review.deleteCandidate({id:c.id,expectedVersion:c.version},randomUUID());const deletedVersion=first.review.get(c.id).version;
 const second=await source(store,[proposal({name:'same'})]);const other=second.review.get(second.candidates[0]!.id);
 expect(other.duplicateMatches.some(m=>m.targetId===c.id)).toBe(false);
 expect(first.review.get(c.id).version).toBe(deletedVersion);
 c=first.review.restoreCandidate({id:c.id,expectedVersion:deletedVersion},randomUUID()).candidate;
 expect(c.duplicateMatches.some(m=>m.targetId===other.id)).toBe(true);expect(c.resolvedWarnings).toEqual([]);expect(c.duplicateResolution).toBeNull();
});
it('delete affects total/detail digest; stale batch cannot be reused after restore',async()=>{
 const {review,candidates}=await source(store,[proposal({name:'total',amountBasis:'paid_total',groupKey:'one'}),proposal({name:'detail',groupKey:'one'})]);
 const before=review.get(candidates[0]!.id),detail=review.get(candidates[1]!.id);
 review.deleteCandidate({id:detail.id,expectedVersion:detail.version},randomUUID());expect(review.get(before.id).reviewDigest).not.toBe(before.reviewDigest);
 expect(review.get(before.id).blockingReasons).not.toContain('TOTAL_DETAIL_AMBIGUOUS');
 review.restoreCandidate({id:detail.id,expectedVersion:detail.version+1},randomUUID());expect(review.get(before.id).blockingReasons).toContain('TOTAL_DETAIL_AMBIGUOUS');
});
it('snapshots before deletion, after deletion and after restore retain exactly their own lifecycle and postings',async()=>{
 const {review,candidates}=await source(store,[proposal()]);const id=candidates[0]!.id;
 const backup=()=>store.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},randomUUID()).record.id;
 const pre=backup();review.deleteCandidate({id,expectedVersion:1},randomUUID());const deleted=backup();review.restoreCandidate({id,expectedVersion:2},randomUUID());const restored=backup();
 for(const [archive,state,version,events] of [[deleted,'deleted',2,1],[pre,'pending_review',1,0],[restored,'pending_review',3,2]] as const){
  const token=store.previewRestore(archive).restoreToken;store.restoreBackup({mode:'commit',restoreToken:token,currentDataWillBeReplaced:true},randomUUID());
  const next=new ReviewService(store,new ImageService(store,()=>1),()=>1,clock);expect(next.get(id)).toMatchObject({reviewState:state,version});expect(n('candidate_lifecycle_event')).toBe(events);expect(n('review_posting')).toBe(0);
 }
 expect(inspectBackupArchive(store.diagnostics().backupPathOf(restored),{latestSchemaVersion:4,contractVersion:CONTRACT_VERSION}).ok).toBe(false);
});
it('DB rejects delete of rejected/approved and cross-ledger lifecycle; append-only lifecycle cannot be altered',async()=>{
 const {review,candidates}=await source(store,[proposal()]);const id=candidates[0]!.id;review.deleteCandidate({id,expectedVersion:1},randomUUID());
 expect(()=>store.withImports(true,c=>runInTransaction(c.db,()=>c.db.prepare("UPDATE candidate SET review_state='rejected' WHERE id=?").run(id)))).toThrow();
 expect(()=>store.withImports(true,c=>c.db.exec('DELETE FROM candidate_lifecycle_event'))).toThrow();
 expect(()=>review.deleteCandidate({id:randomUUID(),expectedVersion:1},randomUUID())).toThrowError('NOT_FOUND');
});
it('deleted remains unfinished, separately counted, and cannot grant a review completion',async()=>{
 const {review,job,candidates}=await source(store,[proposal()]);review.deleteCandidate({id:candidates[0]!.id,expectedVersion:1},randomUUID());
 const metrics=new ReviewActivityService(store).metrics(job.id) as {sessions:unknown[]};expect(metrics.sessions[0]).toMatchObject({deletedCount:1,unprocessed:1,completed:false});
 expect(store.withImports(false,c=>c.db.prepare<{n:number}>("SELECT count(*) n FROM audit_event WHERE action='review.completed'").get()!.n)).toBe(0);
});
it('integrity detects a corrupted deletion without matching lifecycle evidence',async()=>{
 const {review,candidates}=await source(store,[proposal()]);const id=candidates[0]!.id;
 store.withImports(true,c=>c.db.prepare('UPDATE candidate SET deleted_at=? WHERE id=?').run(new Date(clock()).toISOString(),id));
 expect(review.get(id).reviewState).toBe('deleted');expect(store.withImports(false,c=>collectBusinessViolations(c.db))).toContain('CANDIDATE_LIFECYCLE_STATE');
});
it.each(['receipt','revision'] as const)('injected %s failure leaves no half deletion and same-key retry commits once',async kind=>{
 const {review,candidates}=await source(store,[proposal()]);const id=candidates[0]!.id,revision=store.currentRevision,key=randomUUID();
 store.withImports(true,c=>c.db.exec(kind==='receipt'?"CREATE TRIGGER fail_lifecycle_write BEFORE INSERT ON mutation_receipt WHEN NEW.operation='candidate.delete' BEGIN SELECT RAISE(ABORT,'TEST'); END":"CREATE TRIGGER fail_lifecycle_write BEFORE UPDATE OF data_revision ON ledger BEGIN SELECT RAISE(ABORT,'TEST'); END"));
 expect(()=>review.deleteCandidate({id,expectedVersion:1},key)).toThrow();expect(review.get(id).reviewState).toBe('pending_review');expect(n('candidate_lifecycle_event')).toBe(0);expect(store.currentRevision).toBe(revision);
 store.withImports(true,c=>c.db.exec('DROP TRIGGER fail_lifecycle_write'));expect(review.deleteCandidate({id,expectedVersion:1},key).replayed).toBe(false);expect(n('candidate_lifecycle_event')).toBe(1);
});
it('main-process stale approval reports the first invalid field for UI focus without writing',async()=>{
 const {review,candidates}=await source(store,[proposal()]);const before=review.get(candidates[0]!.id),item=confirmed(before),category=store.listCategories(true).categories.find(c=>c.id==='cat_food')!;
 store.disableCategory({id:category.id,expectedVersion:category.version},randomUUID());
 try{review.approve({mode:'single',...item},randomUUID());throw Error('expected stale failure');}catch(e){expect(e).toMatchObject({code:'REVIEW_STALE',fieldErrors:[{path:'payload.categoryId',code:'CATEGORY_DISABLED'}]});}
 expect(n('review_posting')).toBe(0);
});
