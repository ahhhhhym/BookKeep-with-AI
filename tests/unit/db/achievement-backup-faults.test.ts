import {afterEach,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,copyFileSync,truncateSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {LedgerStore} from '../../../src/main/services/ledger-store';
import {MIGRATIONS} from '../../../src/main/db/migrations';
import {inspectBackupArchive,sha256File} from '../../../src/main/storage/backup-archive';
import {createTestLayout,cleanupLayout,storeOptions,transactionInput,openWritable,openReadOnly} from './helpers';
import {CONTRACT_VERSION} from '../../../src/shared/constants';
const stores:LedgerStore[]=[],layouts:ReturnType<typeof createTestLayout>[]=[];
let time=Date.parse('2026-10-27T15:59:58.000Z');
function setup(extra:Parameters<typeof storeOptions>[2]={}){const layout=createTestLayout();layouts.push(layout);const options=storeOptions(layout,()=>time,extra),s=LedgerStore.open(options);stores.push(s);return{s,layout,options};}
const backup=(s:LedgerStore,id=randomUUID())=>s.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},id);
const restore=(s:LedgerStore,id:string)=>s.restoreBackup({mode:'commit',restoreToken:s.previewRestore(id).restoreToken,currentDataWillBeReplaced:true},randomUUID());
const inspect=(f:string)=>inspectBackupArchive(f,{latestSchemaVersion:4,contractVersion:CONTRACT_VERSION});
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const l of layouts.splice(0))cleanupLayout(l);time=Date.parse('2026-10-27T15:59:58.000Z');});
describe('C archive/registration/staging failures retain current data',()=>{
 it('discovered automatic pre_migration archive keeps its origin and never grants a manual backup',()=>{
  const old=setup({migrations:MIGRATIONS.slice(0,3)});old.s.createTransaction(transactionInput(),randomUUID());old.s.close();
  const upgraded=LedgerStore.open({...old.options,migrations:MIGRATIONS});stores.push(upgraded);
  const automatic=upgraded.listBackups().records.find(b=>b.kind==='pre_migration')!;expect(automatic).toBeDefined();
  const target=setup();copyFileSync(upgraded.diagnostics().backupPathOf(automatic.id),target.s.diagnostics().backupPathOf(automatic.id));target.s.refreshBackupCatalog();
  expect(target.s.backupRecord(automatic.id)?.kind).toBe('pre_migration');restore(target.s,automatic.id);expect(target.s.achievementsList().progress.backups).toBe(0);
 });
 it.each(['backup-before-archive','backup-before-verify','backup-before-register','backup-before-publish'])('no premature or later reward on %s failure, including retry',step=>{
  let fail=false;const{s,layout}=setup({fault:p=>{if(fail&&p===step){expect(s.achievementsList().progress.backups).toBe(0);throw Error('synthetic boundary failure');}}});s.createTransaction(transactionInput(),randomUUID());
  fail=true;const key=randomUUID();expect(()=>backup(s,key)).toThrow();expect(s.achievementsList().progress.backups).toBe(0);expect(s.snapshot().transactionCount).toBe(1);expect(readdirSync(layout.backups).filter(f=>f.endsWith('.bkdb'))).toEqual([]);
  fail=false;if(step==='backup-before-publish'){expect(()=>backup(s,key)).toThrowError(expect.objectContaining({code:'BACKUP_FAILED'}));expect(s.achievementsList().progress.backups).toBe(0);}
  backup(s);expect(s.achievementsList().progress.backups).toBe(1);
 });
 it('actual invalid private archive is rejected by verification; copied prepared archive cannot grant',()=>{
  let fail=false,captured='';const{s,layout}=setup({fault:p=>{if(fail&&p==='backup-before-verify'){const f=readdirSync(layout.temp).find(n=>n.endsWith('.db'))!;captured=path.join(layout.root,'uncommitted.bkdb');copyFileSync(path.join(layout.temp,f),captured);truncateSync(path.join(layout.temp,f),128);}}});
  fail=true;expect(()=>backup(s)).toThrow();expect(inspect(captured).ok).toBe(false);expect(s.achievementsList().progress.backups).toBe(0);
 });
 it('receipt SQL rejection rolls back registration and leaves no sealed file or reward',()=>{
  const{s,layout}=setup();s.withImports(true,c=>c.db.exec("CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON mutation_receipt WHEN NEW.operation='backup.create' BEGIN SELECT RAISE(ABORT,'synthetic'); END"));
  expect(()=>backup(s)).toThrow();expect(s.achievementsList().progress.backups).toBe(0);expect(readdirSync(layout.backups).filter(f=>f.endsWith('.bkdb'))).toEqual([]);
  s.withImports(true,c=>expect(c.db.prepare("SELECT id FROM mutation_receipt WHERE operation='backup.create'").all()).toEqual([]));
 });
 it('catalog IO failure leaves current business, no backup reward and no published archive',()=>{
  const{s,layout}=setup();s.createTransaction(transactionInput(),randomUUID());const catalog=path.join(layout.backups,'catalog.json');rmSync(catalog,{force:true});mkdirSync(catalog);
  expect(()=>backup(s)).toThrow();expect(s.achievementsList().progress.backups).toBe(0);expect(s.snapshot().transactionCount).toBe(1);expect(readdirSync(layout.backups).filter(f=>f.endsWith('.bkdb'))).toEqual([]);
 });
 it.each(['restore-achievement-before-commit','before-stage-open','before-publish'])('restore %s failure preserves active, achievements and original source archive',step=>{
  let fail=false;const{s,layout}=setup({fault:p=>{if(fail&&p===step)throw Error('synthetic restore failure');}});const b=backup(s);s.createTransaction(transactionInput(),randomUUID());
  const active=readFileSync(path.join(layout.data,'active.json'),'utf8'),file=s.diagnostics().backupPathOf(b.record.id),hash=sha256File(file),epoch=s.currentEpoch;
  fail=true;expect(()=>restore(s,b.record.id)).toThrow();expect(readFileSync(path.join(layout.data,'active.json'),'utf8')).toBe(active);expect(s.currentEpoch).toBe(epoch);expect(s.snapshot().transactionCount).toBe(1);expect(s.achievementsList().items.find(i=>i.id==='entry_first')!.unlocked).toBe(true);expect(sha256File(file)).toBe(hash);
  fail=false;restore(s,b.record.id);expect(s.snapshot().transactionCount).toBe(0);expect(s.achievementsList().notices.every(n=>n.status==='suppressed')).toBe(true);
 });
 it('v3 staging migration SQL failure cannot publish partial achievement tables or replace active',()=>{
  const legacy=setup({migrations:MIGRATIONS.slice(0,3)});legacy.s.createTransaction(transactionInput(),randomUUID());const b=backup(legacy.s);
  const migrations=[...MIGRATIONS],target=setup({migrations}),file=target.s.diagnostics().backupPathOf(b.record.id);copyFileSync(legacy.s.diagnostics().backupPathOf(b.record.id),file);target.s.refreshBackupCatalog();
  const active=readFileSync(path.join(target.layout.data,'active.json'),'utf8');migrations[3]={...MIGRATIONS[3]!,sql:MIGRATIONS[3]!.sql+'\nINVALID SYNTHETIC MIGRATION;'};
  expect(()=>restore(target.s,b.record.id)).toThrowError(expect.objectContaining({code:'RESTORE_FAILED'}));expect(readFileSync(path.join(target.layout.data,'active.json'),'utf8')).toBe(active);expect(target.s.snapshot().transactionCount).toBe(0);expect(target.s.achievementsList().progress.backups).toBe(0);
 });
 it('success date follows completion over Shanghai midnight; auto snapshots never add facts',()=>{
  let ticking=false;const layout=createTestLayout();layouts.push(layout);const s=LedgerStore.open(storeOptions(layout,()=>{if(ticking)time+=1000;return time;}));stores.push(s);ticking=true;
  const b=backup(s);expect(b.record.createdAt).toBe('2026-10-27T15:59:59.000Z');
  const checked=inspect(s.diagnostics().backupPathOf(b.record.id));expect(checked.ok).toBe(true);if(!checked.ok)throw Error('inspection');expect(checked.archive.success?.succeededAt).toBe('2026-10-27T16:00:01.000Z');expect(b.record.finishedAt).toBe(checked.archive.success?.succeededAt);
  restore(s,b.record.id);expect(s.achievementsList().progress).toMatchObject({backups:1,backupDays:1});
  openReadOnly(s.diagnostics().databasePath,db=>expect(db.prepare<{day:string}>("SELECT day FROM achievement_fact WHERE kind='manual_backup'").all()).toEqual([{day:'2026-10-28'}]));
 });
 it('modified success date, source, ID, signature or missing footer rejected even without a trusted outer hash',()=>{
  const{s,layout}=setup(),b=backup(s),original=readFileSync(s.diagnostics().backupPathOf(b.record.id));const file=path.join(layout.root,'tampered.bkdb');expect(inspect(s.diagnostics().backupPathOf(b.record.id)).ok).toBe(true);
  for(const [from,to]of [['2026-10-27T15:59:58.000Z','2026-10-28T15:59:58.000Z'],['"kind":"manual"','"kind":"foobar"'],[b.record.id,randomUUID()]]){const bytes=Buffer.from(original),at=bytes.lastIndexOf(from);expect(at).toBeGreaterThan(0);bytes.write(to,at,'utf8');writeFileSync(file,bytes);expect(inspect(file).ok).toBe(false);}
  writeFileSync(file,original.subarray(0,original.length-20));expect(inspect(file).ok).toBe(false);
  const bytes=Buffer.from(original),at=bytes.lastIndexOf('"signature":"')+'"signature":"'.length;bytes[at]=bytes[at]===65?66:65;writeFileSync(file,bytes);expect(inspect(file).ok).toBe(false);
 });
 it('legacy DB-only manifest remains readable, migrates and derives only provable snapshot history',()=>{
  const old=setup({migrations:MIGRATIONS.slice(0,3)});old.s.createTransaction(transactionInput(),randomUUID());const b=backup(old.s),file=old.s.diagnostics().backupPathOf(b.record.id);
  openWritable(file,db=>{const m=JSON.parse(db.prepare<{payload_json:string}>('SELECT payload_json FROM backup_manifest').get()!.payload_json);delete m.contentVersion;delete m.databaseDigest;delete m.excludes;delete m.backupKind;for(const f of m.files)delete f.hashMode;db.exec('DROP TABLE backup_content');db.prepare('UPDATE backup_manifest SET payload_json=?').run(JSON.stringify(m));});
  const target=setup();copyFileSync(file,target.s.diagnostics().backupPathOf(b.record.id));target.s.refreshBackupCatalog();restore(target.s,b.record.id);
  expect(target.s.achievementsList().progress).toMatchObject({entries:1,backups:0,activityDays:1});expect(target.s.achievementsList().notices.every(n=>n.status==='suppressed')).toBe(true);
 });
});
