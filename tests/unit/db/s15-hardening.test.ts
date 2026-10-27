import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { MaintenanceService, csvCell } from '../../../src/main/services/maintenance-service';
import { ReviewService } from '../../../src/main/services/review-service';
import { ReviewActivityService } from '../../../src/main/services/review-activity';
import { ImageService } from '../../../src/main/services/image-service';
import { SecretStore } from '../../../src/main/services/settings/ai-settings';
import { RecognitionService } from '../../../src/main/services/recognition-service';
import { inspectBackupArchive } from '../../../src/main/storage/backup-archive';
import { regularPath } from '../../../src/main/storage/safe-file';
import { openSqlite } from '../../../src/main/db/sqlite';
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from '../../../src/main/db/migrations';
import { CONTRACT_VERSION } from '../../../src/shared/constants';
import { IMPORT_PROMPT, NOTICE_VERSION, type Job } from '../../../src/shared/imports';
import { CHANNEL_SPECS } from '../../../src/shared/ipc';
import { validateIpcRequest } from '../../../src/main/ipc/validate-request';
import { cleanupLayout, createTestLayout, storeOptions, transactionInput } from './helpers';
import { source, proposal, approve } from './review-fixture';
import { AppError } from '../../../src/shared/errors';
import { harness } from '../../fixtures/s13';
let layout:ReturnType<typeof createTestLayout>,store:LedgerStore;
const create=()=>store.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},randomUUID());
const restore=(id:string)=>store.restoreBackup({mode:'commit',restoreToken:store.previewRestore(id).restoreToken,currentDataWillBeReplaced:true},randomUUID());
const inspect=(file:string)=>inspectBackupArchive(file,{latestSchemaVersion:LATEST_SCHEMA_VERSION,contractVersion:CONTRACT_VERSION});
beforeEach(()=>{layout=createTestLayout();store=LedgerStore.open(storeOptions(layout,Date.now));});
afterEach(()=>{store.close();cleanupLayout(layout);});

describe('S15 consistent backup and recovery',()=>{
  it('restores real attachments/candidates/official records and rejects old resource token; pre-restore recovers newer data',async()=>{
    const {images,candidates,review}=await source(store,[proposal()]);approve(review,candidates[0]!.id);
    const imageId=candidates[0]!.imageAssetId,hash=candidates[0]!.preparedHash;
    const bytes=images.readPrepared(imageId,hash),token=images.resource({imageAssetId:imageId,variant:'prepared'}).url.split('/').at(-1)!;
    const b=create();store.createTransaction(transactionInput({name:'备份后新增'}),randomUUID());
    const old=store.currentEpoch,result=restore(b.record.id);expect('newDataEpoch' in result).toBe(true);expect(store.currentEpoch).not.toBe(old);
    expect(store.snapshot().transactionCount).toBe(1);expect(images.readPrepared(imageId,hash)).toEqual(bytes);
    await expect(images.readResource(token)).rejects.toMatchObject({code:'PERMISSION_DENIED'});
    const pre=store.listBackups().records.find(r=>r.kind==='pre_restore')!;restore(pre.id);expect(store.snapshot().transactionCount).toBe(2);
    const again=new ImageService(store,()=>1);expect(again.readPrepared(imageId,hash)).toEqual(bytes);
    expect(store.withImports(false,c=>c.db.pragma('foreign_key_check'))).toEqual([]);
  });
  it.each(['before-stage-open','before-publish'])('write/switch failure at %s preserves old active/data/attachments and restart',async step=>{
    await source(store,[proposal()]);const b=create();store.createTransaction(transactionInput(),randomUUID());
    const before=store.snapshot(),pointer=readFileSync(path.join(layout.data,'active.json'));
    store.close();store=LedgerStore.open(storeOptions(layout,Date.now,{fault:s=>{if(s===step)throw new Error('synthetic private path and key');}}));
    expect(()=>restore(b.record.id)).toThrow('RESTORE_FAILED');expect(readFileSync(path.join(layout.data,'active.json'))).toEqual(pointer);
    expect(store.snapshot().transactionCount).toBe(before.transactionCount);expect(store.currentEpoch).toBe(before.dataEpoch);
    const pre=store.listBackups().records.find(r=>r.kind==='pre_restore')!;expect(inspect(store.diagnostics().backupPathOf(pre.id)).ok).toBe(true);
    store.close();store=LedgerStore.open(storeOptions(layout,Date.now));expect(store.snapshot().transactionCount).toBe(1);
  });
  it('rejects damaged/missing source attachments without creating a completed backup',async()=>{
    const {images,candidates}=await source(store,[proposal()]);const ref=images.asset(candidates[0]!.imageAssetId).prepared_ref!;
    const file=path.join(path.dirname(store.diagnostics().databasePath),'attachments',ref);writeFileSync(file,'broken');expect(()=>create()).toThrow('BACKUP_INVALID');rmSync(file);expect(()=>create()).toThrow('ARTIFACT_MISSING');expect(store.listBackups().records.filter(r=>r.status==='completed')).toHaveLength(0);expect(store.snapshot().transactionCount).toBe(0);
  });
  it.each(['missing','corrupt','traversal','extra'])('rejects rehashed backup with %s embedded content and leaves original data',async mode=>{
    await source(store,[proposal()]);const b=create(),file=store.diagnostics().backupPathOf(b.record.id),db=openSqlite(file,{configure:false});
    try{
      if(mode==='missing')db.exec('DELETE FROM backup_content');
      if(mode==='corrupt')db.exec("UPDATE backup_content SET bytes=x'010203'");
      if(mode==='extra')db.prepare('INSERT INTO backup_content VALUES (?,?)').run('unexpected',Buffer.from('extra'));
      if(mode==='traversal'){const row=db.prepare<{payload_json:string}>("SELECT payload_json FROM backup_manifest").get()!,m=JSON.parse(row.payload_json);m.files.find((f:{role:string})=>f.role==='attachment').path='../../escape.png';db.prepare('UPDATE backup_manifest SET payload_json=?').run(JSON.stringify(m));}
    }finally{db.close();}
    expect(inspect(file).ok).toBe(false);expect(store.snapshot().transactionCount).toBe(0);expect(existsSync(path.join(layout.root,'escape.png'))).toBe(false);
  });
  it('database digest rejects business tampering even after external hash is recomputed',()=>{store.createTransaction(transactionInput(),randomUUID());const b=create(),file=store.diagnostics().backupPathOf(b.record.id),db=openSqlite(file,{configure:false});try{db.exec('UPDATE "transaction" SET amount_fen=999');}finally{db.close();}expect(inspect(file)).toMatchObject({ok:false,reason:'DATABASE_DIGEST'});});
  it('database digest covers removed atomicity triggers and indexes',()=>{const b=create(),file=store.diagnostics().backupPathOf(b.record.id),db=openSqlite(file,{configure:false});try{db.exec('DROP TRIGGER trg_receipt_no_update');}finally{db.close();}expect(inspect(file)).toMatchObject({ok:false,reason:'DATABASE_DIGEST'});});
  it('data set withdrawal and test-contact files remain byte-identical through restore, old grants get new epoch',async()=>{
    await source(store,[proposal()]);const dir=path.join(layout.root,'datasets',store.currentLedgerId);mkdirSync(dir,{recursive:true});
    const files=['state.json','withdrawals.json','test-contacts.json'];for(const f of files)writeFileSync(path.join(dir,f),JSON.stringify({synthetic:f,value:randomUUID()}));
    const b=create(),before=files.map(f=>readFileSync(path.join(dir,f)));const old=store.currentEpoch;
    writeFileSync(path.join(dir,'withdrawals.json'),'newer withdrawal must survive');writeFileSync(path.join(dir,'test-contacts.json'),'newer pollution must survive');
    restore(b.record.id);expect(store.currentEpoch).not.toBe(old);expect(readFileSync(path.join(dir,files[0]))).toEqual(before[0]);expect(readFileSync(path.join(dir,files[1]),'utf8')).toBe('newer withdrawal must survive');expect(readFileSync(path.join(dir,files[2]),'utf8')).toBe('newer pollution must survive');
  });
  it('actual dataset withdrawal and contaminated test survive ledger restore and block old authorization',()=>{
    const h=harness(layout.root,{ledgerId:()=>store.currentLedgerId,epoch:()=>store.currentEpoch});
    try{
      const samples=Array.from({length:50},()=>h.sample()),versionId=h.version(samples.map(s=>s.id));
      const version=h.service.read({kind:'version',id:versionId}) as import('../../../src/shared/dataset').DatasetVersion;expect(Object.values(version.splits)).toContain('test');
      const b=create();h.command({op:'contaminate',versionId,reason:'S15 local diagnostic contacts locked test'});h.command({op:'withdraw',sampleId:samples[0]!.id,reason:'S15 withdrawal after backup'});
      const directory=path.join(layout.root,'datasets',store.currentLedgerId),tombstones=readFileSync(path.join(directory,'withdrawals.json')),contacts=readFileSync(path.join(directory,'test-contacts.json'));
      restore(b.record.id);h.restart();expect(readFileSync(path.join(directory,'withdrawals.json'))).toEqual(tombstones);expect(readFileSync(path.join(directory,'test-contacts.json'))).toEqual(contacts);
      expect(h.summary().samples.some(s=>s.id===samples[0]!.id)).toBe(false);expect(h.summary().versions.find(v=>v.id===versionId)?.contaminated).toBe(true);
      expect(()=>h.command({op:'export',versionId,sampleIds:null,includeImages:true,purpose:'evaluation',recipient:'local-selftest',confirmed:true})).toThrow();
    }finally{h.service.shutdown();}
  });
  it('paginates backups and invalidates cursor when directory changes',()=>{for(let i=0;i<4;i++)create();const first=store.listBackups({limit:2,cursor:null});expect(first.records).toHaveLength(2);expect(first.totalCount).toBe(4);expect(store.listBackups({limit:2,cursor:first.nextCursor}).records).toHaveLength(2);create();expect(()=>store.listBackups({limit:2,cursor:first.nextCursor})).toThrow('SNAPSHOT_STALE');});
  it('restore status survives restart without replaying an expired token',()=>{const b=create(),id=randomUUID();store.restoreBackup({mode:'commit',restoreToken:store.previewRestore(b.record.id).restoreToken,currentDataWillBeReplaced:true},id);expect(store.backupStatus(id).status).toBe('committed');store.close();store=LedgerStore.open(storeOptions(layout,Date.now));expect(store.backupStatus(id).status).toBe('committed');});
  it('same restore intent with a new preview never overwrites subsequent valid data',()=>{const b=create(),id=randomUUID();store.restoreBackup({mode:'commit',restoreToken:store.previewRestore(b.record.id).restoreToken,currentDataWillBeReplaced:true},id);const epoch=store.currentEpoch;store.createTransaction(transactionInput(),randomUUID());const result=store.restoreBackup({mode:'commit',restoreToken:store.previewRestore(b.record.id).restoreToken,currentDataWillBeReplaced:true},id);expect(result).toMatchObject({replayed:true});expect(store.currentEpoch).toBe(epoch);expect(store.snapshot().transactionCount).toBe(1);});
  it('backup receipt write failure compensates archive and record, retry creates one usable backup',()=>{store.withImports(true,c=>c.db.exec("CREATE TRIGGER qa_receipt BEFORE INSERT ON mutation_receipt WHEN NEW.operation='backup.create' BEGIN SELECT RAISE(ABORT,'synthetic'); END;"));expect(()=>create()).toThrow('BACKUP_FAILED');expect(store.listBackups().records.filter(r=>r.status==='completed')).toHaveLength(0);store.withImports(true,c=>c.db.exec('DROP TRIGGER qa_receipt'));expect(create().record.status).toBe('completed');expect(store.listBackups().records.filter(r=>r.status==='completed')).toHaveLength(1);});
  it('migration from schema1 uses validated pre-migration snapshot, retains transaction',()=>{store.close();cleanupLayout(layout);layout=createTestLayout();store=LedgerStore.open(storeOptions(layout,Date.now,{migrations:MIGRATIONS.slice(0,1)}));store.createTransaction(transactionInput(),randomUUID());store.close();store=LedgerStore.open(storeOptions(layout,Date.now));expect(store.snapshot().dbSchemaVersion).toBe(LATEST_SCHEMA_VERSION);expect(store.snapshot().transactionCount).toBe(1);const pre=store.listBackups().records.find(r=>r.kind==='pre_migration')!;expect(inspect(store.diagnostics().backupPathOf(pre.id)).ok).toBe(true);});
  it('rejects directory junction escape including parent component',()=>{const target=path.join(layout.root,'actual');mkdirSync(target);writeFileSync(path.join(target,'x'),'data');const junction=path.join(layout.root,'junction');symlinkSync(target,junction,'junction');expect(()=>regularPath(path.join(junction,'x'),layout.root)).toThrow('PERMISSION_DENIED');expect(regularPath(path.join(target,'x'),path.parse(target).root)).toBe(path.join(target,'x'));});
  it('legacy DB-only archive is explicit and usable only with no image refs',()=>{store.close();cleanupLayout(layout);layout=createTestLayout();store=LedgerStore.open(storeOptions(layout,Date.now,{migrations:MIGRATIONS.slice(0,3)}));const b=create(),file=store.diagnostics().backupPathOf(b.record.id),db=openSqlite(file,{configure:false});try{const m=JSON.parse(db.prepare<{payload_json:string}>('SELECT payload_json FROM backup_manifest').get()!.payload_json);delete m.contentVersion;delete m.databaseDigest;db.exec('DROP TABLE backup_content');db.prepare('UPDATE backup_manifest SET payload_json=?').run(JSON.stringify(m));}finally{db.close();}expect(inspect(file).ok).toBe(true);});
});

describe('S15 safe export and secret boundaries',()=>{
  it.skipIf(process.platform!=='win32')('native save cannot overwrite internal data using different Windows path case',async()=>{
    const target=path.join(layout.root.toUpperCase(),'forbidden-export.csv');
    const service=new MaintenanceService(store,{save:async()=>target,open:async()=>null},()=>1);
    const artifact=await service.csv({filter:{dateStart:null,dateEnd:null,categoryIds:[],nameQuery:null,deleted:'active'},snapshotRevision:null},randomUUID());
    await expect(service.save(artifact.artifactId,randomUUID())).rejects.toMatchObject({code:'PERMISSION_DENIED'});
    expect(existsSync(target)).toBe(false);
  });
  it.each(['encrypt','decrypt'])('actual %s failure falls back to session and cannot revive old persistent key',failure=>{
    const encryption={isEncryptionAvailable:()=>true,encryptString:(v:string)=>Buffer.from('cipher:'+v),decryptString:(v:Buffer)=>v.toString().slice(7)};
    const secret=new SecretStore(layout.secrets,encryption);
    secret.save({expectedVersion:0,action:'save',secret:'synthetic-old',persistence:'encrypted'},randomUUID());
    if(failure==='encrypt')encryption.encryptString=()=>{throw Error('synthetic-secret-must-not-be-logged');};
    else encryption.decryptString=()=>{throw Error('synthetic-secret-must-not-be-logged');};
    const saved=secret.save({expectedVersion:1,action:'save',secret:'synthetic-new',persistence:'encrypted'},randomUUID());
    expect(saved.mode).toBe('session');expect(secret.readForProvider()).toBe('synthetic-new');
    const persisted=readFileSync(path.join(layout.secrets,'deepseek.secret.json'),'utf8');
    expect(JSON.parse(persisted)).toMatchObject({mode:'absent',blob:null});expect(persisted).not.toContain('synthetic-');
    secret.clearSession();expect(new SecretStore(layout.secrets,encryption).status().configured).toBe(false);
  });
  it('failed session marker write preserves original encrypted secret and version',()=>{
    const encryption={isEncryptionAvailable:()=>true,encryptString:(v:string)=>Buffer.from('cipher:'+v),decryptString:(v:Buffer)=>v.toString().slice(7)};
    const secret=new SecretStore(layout.secrets,encryption);
    secret.save({expectedVersion:0,action:'save',secret:'synthetic-old',persistence:'encrypted'},randomUUID());
    const file=path.join(layout.secrets,'deepseek.secret.json'),original=readFileSync(file);rmSync(file);mkdirSync(file);
    expect(()=>secret.save({expectedVersion:1,action:'save',secret:'synthetic-new',persistence:'session'},randomUUID())).toThrow('STORAGE_UNAVAILABLE');
    expect(secret.status()).toMatchObject({mode:'encrypted',version:1});rmdirSync(file);writeFileSync(file,original);
    expect(secret.readForProvider()).toBe('synthetic-old');
  });
  it('oversized attachment preview is rejected before reading or decoding content',async()=>{
    const {images,candidates}=await source(store,[proposal()]);const candidate=candidates[0]!;
    const token=images.resource({imageAssetId:candidate.imageAssetId,variant:'prepared'}).url.split('/').at(-1)!;
    const ref=images.asset(candidate.imageAssetId).prepared_ref!;
    writeFileSync(path.join(path.dirname(store.diagnostics().databasePath),'attachments',ref),Buffer.alloc(10*1024*1024+1));
    await expect(images.readResource(token)).rejects.toMatchObject({code:'BACKUP_LIMIT'});
    expect(store.snapshot().transactionCount).toBe(0);
  });
  it.each(['=HYPERLINK("x")','+1','-1','@SUM(A1)','  =1','\tformula','\rformula','\nformula'])('quotes formula-leading text %j',value=>{expect(csvCell(value)).toBe('"\''+value.replaceAll('"','""')+'"');});
  it('Chinese BOM/CRLF CSV preserves quoting, filters deleted; failed save protects old target',async()=>{
    const outside=path.join(layout.root,'..','s15-'+randomUUID()+'.csv');
    const a=store.createTransaction(transactionInput({name:'中文,"金额"',note:'两行\n备注'}),randomUUID());const removed=store.createTransaction(transactionInput({name:'不应导出'}),randomUUID());store.softDeleteTransaction({id:removed.transaction.id,expectedVersion:1},randomUUID());
    const service=new MaintenanceService(store,{save:async()=>outside,open:async()=>null},()=>1);
    try{const artifact=await service.csv({filter:{dateStart:null,dateEnd:null,categoryIds:[],nameQuery:null,deleted:'active'},snapshotRevision:null},randomUUID());expect(artifact.recordCount).toBe(1);await service.save(artifact.artifactId,randomUUID());const bytes=readFileSync(outside),csv=bytes.toString('utf8');expect([...bytes.subarray(0,3)]).toEqual([239,187,191]);expect(csv).toContain('中文,""金额""');expect(csv).toContain('两行\n备注');expect(csv).not.toContain('不应导出');expect(csv).toContain('\r\n');expect(csv).toContain(a.transaction.id);}finally{if(existsSync(outside))rmSync(outside);}
  });
  it('native save cancelled, write fails and external import rejects bad container without touching ledger',async()=>{
    const outside=path.join(layout.root,'..','s15-'+randomUUID());mkdirSync(outside);const file=path.join(outside,'old.csv');writeFileSync(file,'OLD');
    let target:string|null=null;const service=new MaintenanceService(store,{save:async()=>target,open:async()=>file},()=>1);
    const input={filter:{dateStart:null,dateEnd:null,categoryIds:[],nameQuery:null,deleted:'active' as const},snapshotRevision:null},a=await service.csv(input,randomUUID());
    expect(await service.save(a.artifactId,randomUUID())).toEqual({saved:false});target=path.join(outside,'missing','file.csv');await expect(service.save(a.artifactId,randomUUID())).rejects.toThrow();expect(readFileSync(file,'utf8')).toBe('OLD');
    const selected=await service.select();await expect(service.import(selected.selectionToken!,randomUUID())).rejects.toThrow('BACKUP_INVALID');expect(store.snapshot().transactionCount).toBe(0);rmSync(outside,{recursive:true});
  });
  it('unavailable or throwing crypto never stores plaintext, clearSession invalidates provider access',()=>{const encryption={isEncryptionAvailable:()=>{throw Error('synthetic failure');},encryptString:()=>Buffer.from(''),decryptString:()=>''};const secret=new SecretStore(layout.secrets,encryption);expect(secret.save({expectedVersion:0,action:'save',secret:'synthetic-only',persistence:'encrypted'},randomUUID()).mode).toBe('session');expect(readFileSync(path.join(layout.secrets,'deepseek.secret.json'),'utf8')).not.toContain('synthetic-only');secret.clearSession();expect(secret.status().configured).toBe(false);expect(()=>secret.readForProvider()).toThrow('SECRET_REQUIRED');});
  it('IPC rejects malicious path and unknown secret key without echoing it',()=>{const raw={requestId:randomUUID(),contractVersion:CONTRACT_VERSION,dataEpoch:store.currentEpoch,payload:{artifactId:randomUUID(),'synthetic-sensitive-unknown':true},mutationId:randomUUID()};try{validateIpcRequest(CHANNEL_SPECS.maintenanceSave,raw,{expectedEpoch:store.currentEpoch});throw Error('expected rejection');}catch(e){expect(e).toBeInstanceOf(AppError);expect(JSON.stringify((e as AppError).toPayload())).not.toContain('synthetic-sensitive-unknown');}});
});

describe('S15 review effort and cancelled attempt accounting',()=>{
  it('records real clock edges, caps idle60s and counts repeated field saves with missing fill',async()=>{
    const {job,images,candidates}=await source(store,[proposal({name:null}),proposal({name:'第二笔',amountFen:100})]);let now=Date.parse('2026-10-22T05:00:00Z');const review=new ReviewService(store,images,()=>1,()=>now);
    const activity=new ReviewActivityService(store,()=>now);expect(activity.metrics(job.id)).toMatchObject({collected:false,activeMs:null});activity.record({jobId:job.id,event:'focus'});now+=120000;activity.record({jobId:job.id,event:'interaction'});now+=1000;activity.record({jobId:job.id,event:'blur'});now+=90000;activity.record({jobId:job.id,event:'focus'});
    let c=review.get(candidates[0]!.id);c=review.update({id:c.id,expectedVersion:c.version,action:'edit',patch:{name:'补填'},reason:'真实保存'},randomUUID());review.update({id:c.id,expectedVersion:c.version,action:'edit',patch:{name:'再次保存'},reason:'再次核对'},randomUUID());
    const m=activity.metrics(job.id) as {activeMs:number;completedSessions:number;sessions:{substantiveEdits:number;missingFills:number}[]};expect(m.activeMs).toBe(61000);expect(m.completedSessions).toBe(0);expect(m.sessions[0]).toMatchObject({substantiveEdits:2,missingFills:1});
    for(const row of candidates){const current=review.get(row.id);review.reject({id:current.id,expectedVersion:current.version,reason:'拒绝合成测试'},randomUUID());}expect(activity.metrics(job.id).completedSessions).toBe(1);
    const resumed=new ReviewActivityService(store,()=>now+1000000);expect(resumed.metrics(job.id).activeMs).toBe(61000);expect(store.snapshot().transactionCount).toBe(0);
  });
  it('cancelled late valid response preserves known usage in audit and cannot commit candidates; retry alone completes',async()=>{
    const first=await source(store,[proposal()]),images=first.images,asset=images.asset(first.candidates[0]!.imageAssetId);
    const secret=new SecretStore(layout.secrets,{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''});
    let release:()=>void=()=>{};let attempts=0;const queue=new RecognitionService(store,images,secret,{execute:async request=>{attempts++;request.metadata.requestSent=true;request.onRequestSent?.();if(attempts===1)await new Promise<void>(r=>{release=r;});request.metadata.usage={promptTokens:7,completionTokens:3,totalTokens:10};return {schemaVersion:'bk-candidate.v1',candidates:[proposal()],warnings:[]};}});
    try{const input={images:[{imageAssetId:asset.id,preparedHash:asset.prepared_hash!}],provider:'mock' as const,promptVersion:IMPORT_PROMPT as typeof IMPORT_PROMPT,uploadConsent:[{preparedHash:asset.prepared_hash!,confirmed:true as const,noticeVersion:NOTICE_VERSION as typeof NOTICE_VERSION}],forceNew:true,reason:'单独取消复验'};const j=queue.start(input,randomUUID()).jobs[0]!;
      const current=()=>queue.status({jobId:j.id,statusFilter:[],page:{limit:100,cursor:null}}) as Job;
      queue.cancel({jobId:j.id,expectedVersion:current().version},randomUUID());release();await new Promise(r=>setTimeout(r,30));expect(current().status).toBe('cancelled');expect(queue.candidates({jobId:j.id,page:{limit:100,cursor:null}}).items).toHaveLength(0);
      const audit=store.withImports(false,c=>c.db.prepare<{diff_json:string}>("SELECT diff_json FROM audit_event WHERE entity_id=? AND action='recognition.attempt'").all(j.id));expect(audit.some(r=>r.diff_json.includes('totalTokens'))).toBe(true);
      queue.retry({jobId:j.id,expectedVersion:current().version,uploadConsent:input.uploadConsent[0]!,possibleChargeAccepted:true},randomUUID());for(let i=0;i<100&&current().status!=='completed';i++)await new Promise(r=>setTimeout(r,5));expect(current().status).toBe('completed');expect(queue.candidates({jobId:j.id,page:{limit:100,cursor:null}}).items).toHaveLength(1);expect(store.snapshot().transactionCount).toBe(0);
    }finally{queue.shutdown();}
  });
});
