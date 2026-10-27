import {afterEach,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,copyFileSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {LedgerStore} from '../../../src/main/services/ledger-store';
import {MIGRATIONS,migrationChecksum} from '../../../src/main/db/migrations';
import {inspectBackupArchive,sha256File} from '../../../src/main/storage/backup-archive';
import {MaintenanceService} from '../../../src/main/services/maintenance-service';
import {CONTRACT_VERSION} from '../../../src/shared/constants';
import {createTestLayout,cleanupLayout,storeOptions,transactionInput,openReadOnly,openWritable} from './helpers';
import {source,proposal,approve} from './review-fixture';
const stores:LedgerStore[]=[],layouts:ReturnType<typeof createTestLayout>[]=[];
let time=Date.parse('2026-10-27T04:00:00.000Z');
function setup(extra:Parameters<typeof storeOptions>[2]={}){const layout=createTestLayout();layouts.push(layout);const options=storeOptions(layout,()=>time,extra),s=LedgerStore.open(options);stores.push(s);return{s,layout,options};}
function restore(s:LedgerStore,id:string){return s.restoreBackup({mode:'commit',restoreToken:s.previewRestore(id).restoreToken,currentDataWillBeReplaced:true},randomUUID());}
const backup=(s:LedgerStore)=>s.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},randomUUID());
const list=(s:LedgerStore)=>s.achievementsList();
const ids=(s:LedgerStore)=>list(s).items.filter(i=>i.unlocked).map(i=>i.id);
const inspect=(file:string)=>inspectBackupArchive(file,{latestSchemaVersion:4,contractVersion:CONTRACT_VERSION});
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const l of layouts.splice(0))cleanupLayout(l);time=Date.parse('2026-10-27T04:00:00.000Z');});
describe('C backup own success and generation boundaries',()=>{
 // Break caught: snapshot precedes its own receipt, so first/third backup awards disappear.
 it('first archive restores its own success once, suppresses old and newly derived notices',()=>{
  const{s}=setup();s.createTransaction(transactionInput(),randomUUID());const b=backup(s),file=s.diagnostics().backupPathOf(b.record.id),frozen=sha256File(file);
  expect(list(s).progress.backups).toBe(1);const old=s.currentEpoch;
  restore(s,b.record.id);expect(ids(s)).toContain('backup_first');expect(list(s).progress).toMatchObject({entries:1,backups:1,backupDays:1,activityDays:1});
  expect(list(s).notices.every(n=>n.status==='suppressed'||n.status==='closed')).toBe(true);
  expect(()=>s.settleAchievements(old)).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
  restore(s,b.record.id);expect(list(s).progress.backups).toBe(1);expect(sha256File(file)).toBe(frozen);
 });
 it('third Shanghai day archive keeps third-day award; same-day and repeated restore do not add days',()=>{
  const{s}=setup();backup(s);backup(s);time+=86400000;backup(s);time+=86400000;const b=backup(s);
  restore(s,b.record.id);expect(ids(s)).toContain('backup_days_3');expect(list(s).progress).toMatchObject({backups:4,backupDays:3});
  restore(s,b.record.id);expect(list(s).progress).toMatchObject({backups:4,backupDays:3});
 });
 it('snapshot rollback never merges newer awards or backup facts from external catalog',()=>{
  const{s}=setup();const b=backup(s);for(let i=0;i<10;i++)s.createTransaction(transactionInput(),randomUUID());time+=86400000;backup(s);time+=86400000;backup(s);
  expect(ids(s)).toContain('entry_10');expect(ids(s)).toContain('backup_days_3');restore(s,b.record.id);
  expect(ids(s)).toEqual(['backup_first']);expect(list(s).progress).toMatchObject({entries:0,backups:1,backupDays:1,activityDays:0});
 });
 it('portable imported archive verifies self fact without merging target history or local preferences',async()=>{
  const a=setup();const b=backup(a.s),file=a.s.diagnostics().backupPathOf(b.record.id);const target=setup();
  mkdirSync(target.layout.shell,{recursive:true});const pref=path.join(target.layout.shell,'achievement-notices.json');writeFileSync(pref,'{"enabled":false,"position":"bottom-right"}');
  const m=new MaintenanceService(target.s,{open:async()=>file,save:async()=>null},()=>1,()=>time),selection=await m.select();const imported=await m.import(selection.selectionToken!,randomUUID());
  restore(target.s,imported.backupId);expect(ids(target.s)).toEqual(['backup_first']);expect(list(target.s).progress.backups).toBe(1);expect(readFileSync(pref,'utf8')).toBe('{"enabled":false,"position":"bottom-right"}');
 });
 it('round trips attachments, AI posting/approve receipts, activity and awards',async()=>{
  const{s}=setup();const f=await source(s,[proposal()]);approve(f.review,f.candidates[0]!.id);
  const before=openReadOnly(s.diagnostics().databasePath,db=>Object.fromEntries(['transaction','review_event','review_posting','mutation_receipt','image_asset','achievement_activity_day'].map(t=>[t,db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()])));
  const b=backup(s);restore(s,b.record.id);
  openReadOnly(s.diagnostics().databasePath,db=>{for(const[t,rows]of Object.entries(before))expect(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().slice(0,rows.length)).toEqual(rows);expect(db.pragma('foreign_key_check')).toEqual([]);});
  expect(list(s).progress).toMatchObject({entries:1,aiEntries:1,activityDays:1,backups:1});
  const refs=openReadOnly(s.diagnostics().databasePath,db=>db.prepare<{prepared_ref:string}>('SELECT prepared_ref FROM image_asset WHERE prepared_ref IS NOT NULL').all());expect(refs.length).toBeGreaterThan(0);for(const r of refs)expect(existsSync(path.join(path.dirname(s.diagnostics().databasePath),'attachments',r.prepared_ref))).toBe(true);
 });
 it('old v3 library and old archive migrate once, no invented self backup fact, no old notice replay',()=>{
  const{s,options}=setup({migrations:MIGRATIONS.slice(0,3)});s.createTransaction(transactionInput(),randomUUID());const b=backup(s);s.close();
  const upgraded=LedgerStore.open({...options,migrations:MIGRATIONS});stores.push(upgraded);expect(ids(upgraded)).toContain('entry_first');
  restore(upgraded,b.record.id);expect(list(upgraded).progress.backups).toBe(0);expect(ids(upgraded)).toEqual(['entry_first']);expect(list(upgraded).notices.every(n=>n.status==='suppressed')).toBe(true);
  const dbfile=upgraded.diagnostics().databasePath;upgraded.close();const again=LedgerStore.open({...options,migrations:MIGRATIONS});stores.push(again);expect(list(again).progress.backups).toBe(0);
  openReadOnly(dbfile,db=>expect(db.prepare<{checksum:string}>("SELECT checksum FROM migration_record WHERE to_version=4 AND status='completed'").get()?.checksum).toBe(migrationChecksum(MIGRATIONS[3]!)));
 });
 it('tampered new self metadata and unsupported protocol rejected before active publication',()=>{
  const{s}=setup();const b=backup(s),file=s.diagnostics().backupPathOf(b.record.id),copy=file+'.copy';copyFileSync(file,copy);
  openWritable(copy,db=>{const row=db.prepare<{payload_json:string}>('SELECT payload_json FROM backup_manifest').get()!,m=JSON.parse(row.payload_json);m.successVersion='unsupported.future';db.prepare('UPDATE backup_manifest SET payload_json=?').run(JSON.stringify(m));});
  expect(inspect(copy).ok).toBe(false);expect(s.snapshot().transactionCount).toBe(0);
 });
 it('pending native dialog and cached mutation results cannot escape old epoch after restore',async()=>{
  const{s}=setup();const b=backup(s);let resolve!:(v:string|null)=>void;const m=new MaintenanceService(s,{open:()=>new Promise(r=>resolve=r),save:async()=>null},()=>1,()=>time);
  const pending=m.select();restore(s,b.record.id);resolve(s.diagnostics().backupPathOf(b.record.id));await expect(pending).rejects.toMatchObject({code:'STALE_EPOCH'});
  const filter={deleted:'active' as const,dateStart:null,dateEnd:null,categoryIds:[],nameQuery:null},key=randomUUID();const old=await m.csv({filter,snapshotRevision:null},key);restore(s,b.record.id);
  const fresh=await m.csv({filter,snapshotRevision:null},key);expect(fresh.artifactId).not.toBe(old.artifactId);
  restore(s,b.record.id);
  const selecting=m.select();resolve(s.diagnostics().backupPathOf(b.record.id));const selected=await selecting;
  await expect(m.import(selected.selectionToken!,randomUUID())).resolves.toEqual({backupId:b.record.id});
 });
});
