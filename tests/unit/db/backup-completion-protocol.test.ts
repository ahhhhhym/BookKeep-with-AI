import {afterEach,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync,rmSync,writeFileSync,copyFileSync,cpSync,mkdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildSync} from 'esbuild';
import {LedgerStore} from '../../../src/main/services/ledger-store';
import * as files from '../../../src/main/services/image-service';
import * as sqlite from '../../../src/main/db/sqlite';
import {sha256File} from '../../../src/main/storage/backup-archive';
import {completionPath,PREPARED_VERSION,SUCCESS_VERSION,backupSigningKey,sealBackup} from '../../../src/main/storage/backup-success';
import {createBackupArchive,inspectBackupArchive} from '../../../src/main/storage/backup-archive';
import {readAppMeta} from '../../../src/main/db/migrations';
import {storagePaths} from '../../../src/main/storage/layout';
import {CONTRACT_VERSION} from '../../../src/shared/constants';
import {MaintenanceService} from '../../../src/main/services/maintenance-service';
import * as content from '../../../src/main/storage/backup-content';
import {splitPortableBackup} from '../../../src/main/storage/backup-success';
import * as successStorage from '../../../src/main/storage/backup-success';
import {createTestLayout,cleanupLayout,storeOptions,openReadOnly} from './helpers';
const stores:LedgerStore[]=[],layouts:ReturnType<typeof createTestLayout>[]=[];
let now=Date.parse('2026-10-27T15:59:59.000Z');
function setup(extra:Parameters<typeof storeOptions>[2]={}){const layout=createTestLayout();layouts.push(layout);const options=storeOptions(layout,()=>now,extra);const s=LedgerStore.open(options);stores.push(s);return {s,layout,options};}
const backup=(s:LedgerStore,id:string=randomUUID())=>s.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},id);
function verify(s:LedgerStore,b:ReturnType<typeof backup>,at:string,day:string){
 const file=s.diagnostics().backupPathOf(b.record.id);
 expect(existsSync(file)).toBe(true);expect(sha256File(file)).toBe(b.artifact.sha256);
 expect(b.record).toMatchObject({status:'completed',finishedAt:at,archiveHash:b.artifact.sha256});
 const catalog=JSON.parse(readFileSync(s.diagnostics().root+'/backups/catalog.json','utf8')).entries.find((e:{id:string})=>e.id===b.record.id);
 expect(catalog).toMatchObject({status:'completed',finishedAt:at,archiveHash:b.artifact.sha256});
 openReadOnly(s.diagnostics().databasePath,db=>{
  expect(db.prepare('SELECT status,finished_at,archive_hash FROM backup_record WHERE id=?').get(b.record.id)).toEqual({status:'completed',finished_at:at,archive_hash:b.artifact.sha256});
  expect(db.prepare('SELECT succeeded_at,day FROM achievement_fact WHERE source_id=?').get(b.record.id)).toEqual({succeeded_at:at,day});
  const receipt=db.prepare<{result_snapshot_json:string;created_at:string}>("SELECT result_snapshot_json,created_at FROM mutation_receipt WHERE operation='backup.create' AND json_extract(result_snapshot_json,'$.record.id')=?").get(b.record.id)!;
  const prepared=JSON.parse(receipt.result_snapshot_json);expect(prepared).toMatchObject({successVersion:PREPARED_VERSION,record:{status:'processing',finishedAt:null}});
 });
 const checked=inspectBackupArchive(file,{latestSchemaVersion:4,contractVersion:CONTRACT_VERSION});expect(checked.ok).toBe(true);if(!checked.ok)throw Error('archive');expect(checked.archive.success).toMatchObject({succeededAt:at,payloadHash:b.artifact.sha256,backupId:b.record.id});
 expect(s.achievementsList().progress).toMatchObject({backups:1,backupDays:1});
}
afterEach(()=>{vi.restoreAllMocks();for(const s of stores.splice(0))s.close();for(const l of layouts.splice(0))cleanupLayout(l);now=Date.parse('2026-10-27T15:59:59.000Z');});
describe('backup final completion protocol',()=>{
 it('publishing_across_midnight_uses_post_publish_day',()=>{
  const {s}=setup(),publish=files.atomicFile;let crossed=false;
  vi.spyOn(files,'atomicFile').mockImplementation((file,bytes)=>{publish(file,bytes);if(file.endsWith('.bkdb')){crossed=true;now=Date.parse('2026-10-27T16:00:00.000Z');}});
  const b=backup(s);expect(crossed).toBe(true);verify(s,b,'2026-10-27T16:00:00.000Z','2026-10-28');
 });
 it('necessary_registration_commit_itself_crosses_midnight',()=>{
  const {s}=setup(),commit=sqlite.runInTransaction;let armed=true;
  vi.spyOn(sqlite,'runInTransaction').mockImplementation((db,fn)=>{const result=commit(db,fn);if(armed&&db.prepare("SELECT id FROM mutation_receipt WHERE operation='backup.create'").get()){armed=false;now=Date.parse('2026-10-27T16:00:00.000Z');}return result;});
  verify(s,backup(s),'2026-10-27T16:00:00.000Z','2026-10-28');expect(armed).toBe(false);
 });
 it.each([
  ['same_day_completion_keeps_day','2026-10-27T04:00:00.000Z','2026-10-27T04:00:01.000Z','2026-10-27'],
  ['month_rollover','2026-10-31T15:59:59.000Z','2026-10-31T16:00:00.000Z','2026-11-01'],
  ['year_rollover','2026-12-31T15:59:59.000Z','2026-12-31T16:00:00.000Z','2027-01-01'],
 ])('%s',(_name,start,end,day)=>{now=Date.parse(start!);const {s}=setup(),publish=files.atomicFile;vi.spyOn(files,'atomicFile').mockImplementation((f,b)=>{publish(f,b);if(f.endsWith('.bkdb'))now=Date.parse(end!);});verify(s,backup(s),end!,day!);});
 it('completed_fact_replay_keeps_original_day_after_response_loss_and_restart',()=>{
  const {s,options}=setup(),id=randomUUID(),b=backup(s); // a separate mutation is used below
  const original=backup(s,id);const hash=sha256File(s.diagnostics().backupPathOf(original.record.id));
  s.close();now+=3*86400000;const restarted=LedgerStore.open(options);stores.push(restarted);
  const replay=backup(restarted,id);expect(replay.replayed).toBe(true);expect(replay.record).toEqual(original.record);expect(replay.artifact).toEqual(original.artifact);expect(sha256File(restarted.diagnostics().backupPathOf(original.record.id))).toBe(hash);
  expect(restarted.achievementsList().progress).toMatchObject({backups:2,backupDays:1});expect(b.record.id).not.toBe(original.record.id);
 });
 it.each(['missing','corrupt'])('%s_archive_never_adds_a_deferred_fact',condition=>{
  let fail=false;const {s,options}=setup({fault:p=>{if(fail&&p==='backup-before-achievement-commit')throw Error('settlement');}});fail=true;
  const b=backup(s);openReadOnly(s.diagnostics().databasePath,db=>expect(db.prepare("SELECT * FROM achievement_fact WHERE kind='manual_backup'").all()).toEqual([]));
  const file=s.diagnostics().backupPathOf(b.record.id);if(condition==='missing')rmSync(file);else writeFileSync(file,Buffer.from('corrupt'));
  s.close();fail=false;now+=86400000;
  const restarted=LedgerStore.open(options);stores.push(restarted);expect(restarted.achievementsList().progress.backups).toBe(0);expect(()=>backup(restarted,openReadOnly(restarted.diagnostics().databasePath,db=>db.prepare<{mutation_id:string}>("SELECT mutation_id FROM mutation_receipt WHERE operation='backup.create'").get()!.mutation_id))).toThrow();
 });
 it('settlement_failure_retry_keeps_persisted_time_and_immutable_preparation_receipt',()=>{
  let fail=false;const {s}=setup({fault:p=>{if(fail&&p==='backup-before-achievement-commit')throw Error('settlement');}});fail=true;
  const mutation=randomUUID(),b=backup(s,mutation),cert=readFileSync(completionPath(s.diagnostics().backupPathOf(b.record.id)));
  const receipt=()=>openReadOnly(s.diagnostics().databasePath,db=>db.prepare("SELECT * FROM mutation_receipt WHERE operation='backup.create'").all());
  const before=receipt();openReadOnly(s.diagnostics().databasePath,db=>expect(db.prepare("SELECT * FROM achievement_fact WHERE kind='manual_backup'").all()).toEqual([]));fail=false;now+=86400000;
  const replay=backup(s,mutation);expect(replay.record.finishedAt).toBe('2026-10-27T15:59:59.000Z');expect(s.achievementsList().progress.backupDays).toBe(1);expect(receipt()).toEqual(before);expect(readFileSync(completionPath(s.diagnostics().backupPathOf(b.record.id)))).toEqual(cert);
  s.settleAchievements(s.currentEpoch);expect(s.achievementsList().progress.backups).toBe(1);
 });
 it('same_day_backups_and_three_distinct_success_days_keep_thresholds',()=>{
  const {s}=setup();backup(s);backup(s);expect(s.achievementsList().progress).toMatchObject({backups:2,backupDays:1});
  now+=86400000;backup(s);now+=86400000;const third=backup(s);expect(s.achievementsList().progress).toMatchObject({backups:4,backupDays:3});expect(s.achievementsList().items.find(i=>i.id==='backup_days_3')?.unlocked).toBe(true);
  s.restoreBackup({mode:'commit',restoreToken:s.previewRestore(third.record.id).restoreToken,currentDataWillBeReplaced:true},randomUUID());expect(s.achievementsList().progress).toMatchObject({backups:4,backupDays:3});
 });
 it('v2_single_file_export_import_restores_own_success_without_local_companion',async()=>{
  const a=setup(),b=backup(a.s),transportLayout=createTestLayout();layouts.push(transportLayout);const transport=path.join(transportLayout.root,'portable.bkdb');
  const exporter=new MaintenanceService(a.s,{open:async()=>null,save:async()=>transport},()=>1,()=>now),view=exporter.backup(b.record.id);await exporter.save(view.artifactId,randomUUID());
  expect(existsSync(completionPath(transport))).toBe(false);const target=setup(),importer=new MaintenanceService(target.s,{open:async()=>transport,save:async()=>null},()=>1,()=>now),token=await importer.select(),imported=await importer.import(token.selectionToken!,randomUUID());
  expect(sha256File(target.s.diagnostics().backupPathOf(imported.backupId))).toBe(b.artifact.sha256);
  target.s.restoreBackup({mode:'commit',restoreToken:target.s.previewRestore(imported.backupId).restoreToken,currentDataWillBeReplaced:true},randomUUID());expect(target.s.achievementsList().progress).toMatchObject({backups:1,backupDays:1});
 });
 it('old_v1_archive_self_success_keeps_its_original_time_and_bytes',()=>{
  const {s,layout}=setup(),id=randomUUID(),key=backupSigningKey();
  const archive=s.withImports(true,c=>createBackupArchive({db:c.db,paths:storagePaths(layout),backupId:id,appVersion:'0.1.5',contractVersion:CONTRACT_VERSION,now:'2026-10-27T15:59:58.000Z',kind:'manual',success:{version:SUCCESS_VERSION,publicKey:key.publicKey}}));
  const bytes=sealBackup(readFileSync(archive.archivePath),{backupId:id,ledgerId:s.currentLedgerId,mutationId:randomUUID(),kind:'manual',succeededAt:'2026-10-27T15:59:59.000Z'},key.privateKey),file=s.diagnostics().backupPathOf(id);writeFileSync(file,bytes);const hash=sha256File(file);s.refreshBackupCatalog();
  now+=86400000;s.restoreBackup({mode:'commit',restoreToken:s.previewRestore(id).restoreToken,currentDataWillBeReplaced:true},randomUUID());expect(sha256File(file)).toBe(hash);expect(s.achievementsList().progress.backups).toBe(1);
  openReadOnly(s.diagnostics().databasePath,db=>expect(db.prepare("SELECT day,succeeded_at FROM achievement_fact WHERE source_id=?").get(id)).toEqual({day:'2026-10-27',succeeded_at:'2026-10-27T15:59:59.000Z'}));
 });
 it.each([
  ['backup-after-catalog',false,false],['backup-after-register',false,false],['backup-before-publish',false,false],
  ['publishing-syscall-crash',true,false],['backup-after-publish',true,false],['backup-before-completion-log',true,false],['completion-log-torn',true,false],
  ['backup-after-completion-log',true,true],['backup-before-completion-projection',true,true],['backup-after-completion-projection',true,true],['response-lost',true,true],
 ])('process_interruption_at_%s_then_restart_keeps_evidence', (step,hasCore,hasTime)=>{
  const layout=createTestLayout();layouts.push(layout);const id=randomUUID(),bundle=path.join(layout.root,'worker.cjs');
  buildSync({entryPoints:[path.resolve('tests/fixtures/backup-protocol-worker.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',external:['better-sqlite3','sharp'],logLevel:'silent'});
  const child=spawnSync(process.execPath,[bundle,JSON.stringify(layout),id,step],{env:{...process.env,NODE_PATH:path.resolve('node_modules')},encoding:'utf8',timeout:15000});expect(child.status===null||child.status!==0).toBe(true);
  const archives=readdirSync(layout.backups).filter(f=>f.endsWith('.bkdb'));expect(archives.length).toBe(hasCore?1:0);
  const interruptedHashes=Object.fromEntries(archives.map(f=>[f,sha256File(path.join(layout.backups,f))]));
  const interruptedCatalog=JSON.parse(readFileSync(path.join(layout.backups,'catalog.json'),'utf8')).entries;
  for(const f of archives)expect(interruptedCatalog.find((e:{id:string})=>e.id===path.basename(f,'.bkdb')).archiveHash).toBe(interruptedHashes[f]);
  const evidence=process.env.BOOKKEEP_A_PROTOCOL_OUTPUT;if(evidence){mkdirSync(evidence,{recursive:true});cpSync(layout.root,path.join(evidence,step+'-'+id,'interrupted'),{recursive:true});}
  now+=3*86400000;const options=storeOptions(layout,()=>now),s=LedgerStore.open(options);stores.push(s);
  expect(s.achievementsList().progress.backups).toBe(hasTime?1:0);
  if(hasTime){const replay=backup(s,id);expect(replay.replayed).toBe(true);expect(replay.record.finishedAt).toBe('2026-10-27T15:59:59.000Z');expect(s.achievementsList().progress.backups).toBe(1);}
  else if(step!=='backup-after-catalog')expect(()=>backup(s,id)).toThrow();
  const rows=openReadOnly(s.diagnostics().databasePath,db=>({backups:db.prepare('SELECT * FROM backup_record').all(),receipts:db.prepare("SELECT * FROM mutation_receipt WHERE operation='backup.create'").all(),facts:db.prepare("SELECT * FROM achievement_fact WHERE kind='manual_backup'").all(),meta:readAppMeta(db)}));
  for(const f of archives){expect(sha256File(path.join(layout.backups,f))).toBe(interruptedHashes[f]);const registration=rows.backups.find((r:unknown)=>(r as {id:string}).id===path.basename(f,'.bkdb')) as {archive_hash:string;finished_at:string|null};expect(registration.archive_hash).toBe(interruptedHashes[f]);expect(registration.finished_at).toBe(hasTime?'2026-10-27T15:59:59.000Z':null);}
  if(hasCore&&!hasTime){
   const file=s.diagnostics().backupPathOf(archives[0]!.slice(0,-5));const checked=inspectBackupArchive(file,{latestSchemaVersion:4,contractVersion:CONTRACT_VERSION});expect(checked.ok).toBe(true);if(checked.ok)expect(checked.archive.success).toBeNull();
   if(step==='completion-log-torn'){const backupId=path.basename(file,'.bkdb');s.restoreBackup({mode:'commit',restoreToken:s.previewRestore(backupId).restoreToken,currentDataWillBeReplaced:true},randomUUID());expect(s.achievementsList().progress.backups).toBe(0);expect(sha256File(file)).toBe(interruptedHashes[archives[0]!]);}
  }
  if(evidence){const dir=path.join(evidence,step+'-'+id);writeFileSync(path.join(dir,'restart.json'),JSON.stringify({step,child:{status:child.status,signal:child.signal,stderr:child.stderr},interruptedHashes,interruptedCatalog,rows,progress:s.achievementsList().progress,tornCoreRestored:step==='completion-log-torn'},null,2));s.close();cpSync(layout.root,path.join(dir,'restarted'),{recursive:true});}
 });
 it('non_shanghai_host_timezone_does_not_change_day',()=>{
  const layout=createTestLayout();layouts.push(layout);const bundle=path.join(layout.root,'worker.cjs');buildSync({entryPoints:[path.resolve('tests/fixtures/backup-protocol-worker.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',external:['better-sqlite3','sharp'],logLevel:'silent'});
  const child=spawnSync(process.execPath,[bundle,JSON.stringify(layout),randomUUID(),'non-shanghai'],{env:{...process.env,NODE_PATH:path.resolve('node_modules'),TZ:'America/New_York'},encoding:'utf8',timeout:15000});expect(child.status,child.stderr).toBe(0);const result=JSON.parse(child.stdout);expect(result.hostTimezone).toBe('America/New_York');
  now=Date.parse('2026-10-27T16:00:00.000Z');const s=LedgerStore.open(storeOptions(layout,()=>now));stores.push(s);verify(s,result.result,'2026-10-27T16:00:00.000Z','2026-10-28');
 });
 it('missing_final_completion_time_is_not_guessed_and_data_core_remains_restorable_after_catalog_loss',()=>{
  let fail=false;const {s,layout,options}=setup({fault:p=>{if(fail&&p==='backup-before-completion-log')throw Error('log unavailable');}});
  s.createTransaction({amountFen:123,occurredDate:'2026-10-27',occurredTime:null,timePrecision:'date',name:'synthetic',categoryId:'cat_food',merchant:null,note:null},randomUUID());
  fail=true;const id=randomUUID();expect(()=>backup(s,id)).toThrow();const file=path.join(layout.backups,readdirSync(layout.backups).find(f=>f.endsWith('.bkdb'))!),hash=sha256File(file),backupId=path.basename(file,'.bkdb');
  s.close();rmSync(path.join(layout.backups,'catalog.json'));fail=false;now+=86400000;
  const restarted=LedgerStore.open(options);stores.push(restarted);expect(restarted.backupRecord(backupId)).toMatchObject({status:'processing',finishedAt:null});expect(restarted.achievementsList().progress.backups).toBe(0);expect(()=>backup(restarted,id)).toThrow();
  restarted.restoreBackup({mode:'commit',restoreToken:restarted.previewRestore(backupId).restoreToken,currentDataWillBeReplaced:true},randomUUID());expect(restarted.snapshot().transactionCount).toBe(1);expect(restarted.achievementsList().progress.backups).toBe(0);expect(sha256File(file)).toBe(hash);
 });
 it('copied_core_without_completion_does_not_invent_self_achievement',()=>{
  const source=setup(),b=backup(source.s),target=setup();copyFileSync(source.s.diagnostics().backupPathOf(b.record.id),target.s.diagnostics().backupPathOf(b.record.id));target.s.refreshBackupCatalog();
  expect(target.s.backupRecord(b.record.id)).toMatchObject({status:'processing',finishedAt:null});target.s.restoreBackup({mode:'commit',restoreToken:target.s.previewRestore(b.record.id).restoreToken,currentDataWillBeReplaced:true},randomUUID());expect(target.s.achievementsList().progress.backups).toBe(0);
 });
 it.each(['changed-time','changed-mutation','changed-signature'])('invalid_completion_certificate_%s_never_grants_a_fact',tamper=>{
  let fail=false;const {s,options}=setup({fault:p=>{if(fail&&p==='backup-before-achievement-commit')throw Error('settlement');}});fail=true;const b=backup(s),file=completionPath(s.diagnostics().backupPathOf(b.record.id)),cert=JSON.parse(readFileSync(file,'utf8'));
  if(tamper==='changed-time')cert.fact.succeededAt='2026-10-28T15:59:59.000Z';else if(tamper==='changed-mutation')cert.fact.mutationId=randomUUID();else cert.signature=cert.signature.replace(/^./,cert.signature[0]==='A'?'B':'A');writeFileSync(file,JSON.stringify(cert));s.close();fail=false;now+=2*86400000;const restarted=LedgerStore.open(options);stores.push(restarted);expect(restarted.achievementsList().progress.backups).toBe(0);
 });
 it('torn_settlement_log_does_not_destroy_verified_data_core_restore',()=>{
  const source=setup(),b=backup(source.s),target=setup(),file=target.s.diagnostics().backupPathOf(b.record.id);copyFileSync(source.s.diagnostics().backupPathOf(b.record.id),file);writeFileSync(completionPath(file),'{"fact":');target.s.refreshBackupCatalog();
  expect(target.s.backupRecord(b.record.id)).toMatchObject({status:'processing',finishedAt:null});
  const checked=inspectBackupArchive(file,{latestSchemaVersion:4,contractVersion:CONTRACT_VERSION});expect(checked.ok).toBe(true);if(checked.ok)expect(checked.archive.success).toBeNull();
  target.s.restoreBackup({mode:'commit',restoreToken:target.s.previewRestore(b.record.id).restoreToken,currentDataWillBeReplaced:true},randomUUID());expect(target.s.achievementsList().progress.backups).toBe(0);
 });
 it('later_imported_completion_upgrades_existing_pending_projection_without_merging_target_achievements',async()=>{
  const source=setup(),b=backup(source.s),target=setup(),file=target.s.diagnostics().backupPathOf(b.record.id);copyFileSync(source.s.diagnostics().backupPathOf(b.record.id),file);target.s.refreshBackupCatalog();expect(target.s.backupRecord(b.record.id)?.finishedAt).toBeNull();
  const importer=new MaintenanceService(target.s,{open:async()=>source.s.diagnostics().backupPathOf(b.record.id),save:async()=>null},()=>1,()=>now),selected=await importer.select();await importer.import(selected.selectionToken!,randomUUID());
  expect(target.s.backupRecord(b.record.id)).toMatchObject({status:'completed',finishedAt:'2026-10-27T15:59:59.000Z'});expect(JSON.parse(readFileSync(path.join(target.layout.backups,'catalog.json'),'utf8')).entries.find((e:{id:string})=>e.id===b.record.id)).toMatchObject({status:'completed',finishedAt:'2026-10-27T15:59:59.000Z'});expect(target.s.achievementsList().progress.backups).toBe(0);
 });
 it('export_uses_the_bounded_core_snapshot_it_already_hash_verified',async()=>{
  const source=setup(),b=backup(source.s),file=source.s.diagnostics().backupPathOf(b.record.id),original=readFileSync(file),outside=createTestLayout();layouts.push(outside);const target=path.join(outside.root,'export.bkdb'),digest=content.digest;let changed=false;
  vi.spyOn(content,'digest').mockImplementation(bytes=>{const hash=digest(bytes);if(!changed&&Buffer.isBuffer(bytes)&&bytes.equals(original)){changed=true;writeFileSync(file,'concurrent filesystem writer');}return hash;});
  const exporter=new MaintenanceService(source.s,{open:async()=>null,save:async()=>target},()=>1,()=>now),view=exporter.backup(b.record.id);await exporter.save(view.artifactId,randomUUID());expect(changed).toBe(true);expect(splitPortableBackup(readFileSync(target)).bytes).toEqual(original);
 });
 it('restart_replays_imported_completion_projection_without_external_achievement_merge',()=>{
  const source=setup(),b=backup(source.s),target=setup(),file=target.s.diagnostics().backupPathOf(b.record.id);copyFileSync(source.s.diagnostics().backupPathOf(b.record.id),file);target.s.refreshBackupCatalog();copyFileSync(completionPath(source.s.diagnostics().backupPathOf(b.record.id)),completionPath(file));target.s.close();now+=86400000;
  const restarted=LedgerStore.open(target.options);stores.push(restarted);expect(restarted.backupRecord(b.record.id)).toMatchObject({status:'completed',finishedAt:'2026-10-27T15:59:59.000Z'});expect(restarted.achievementsList().progress.backups).toBe(0);
 });
 it('clock_regression_before_final_observation_stays_unverified',()=>{
  const {s,layout}=setup({fault:p=>{if(p==='backup-after-publish')now=Date.parse('2026-10-27T15:59:58.000Z');}});
  expect(()=>backup(s)).toThrow();expect(readdirSync(layout.backups).filter(f=>f.endsWith('.bkdb'))).toHaveLength(1);openReadOnly(s.diagnostics().databasePath,db=>{expect(db.prepare("SELECT status,finished_at FROM backup_record WHERE archive_hash IS NOT NULL").get()).toEqual({status:'processing',finished_at:null});expect(db.prepare("SELECT * FROM achievement_fact WHERE kind='manual_backup'").all()).toEqual([]);});
 });
 it('settlement_log_io_may_cross_midnight_without_moving_the_already_observed_core_completion_day',()=>{
  const {s}=setup(),persist=successStorage.persistCompletion;let called=false;
  vi.spyOn(successStorage,'persistCompletion').mockImplementation((file,bytes)=>{expect(existsSync(file)).toBe(true);persist(file,bytes);called=true;now=Date.parse('2026-10-27T16:00:01.000Z');});
  verify(s,backup(s),'2026-10-27T15:59:59.000Z','2026-10-27');expect(called).toBe(true);
 });
});
