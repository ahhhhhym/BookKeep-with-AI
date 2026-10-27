/** C real preload/IPC/generation regression; all data is synthetic in a new external root. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES,'__qa__.cjs'))('playwright');
const out=path.resolve(process.env.BOOKKEEP_QA_OUTPUT);mkdirSync(out,{recursive:true});
const localAppData=mkdtempSync(path.join(tmpdir(),'BookKeep C 合成 ')),result={ok:false,synthetic:true,localAppData,checks:[],errors:[],externalHttp:0};
let app,page;
const check=(id,data)=>{result.checks.push({id,ok:true,data});console.log('PASS '+id);};
const raw=(method,input,options)=>page.evaluate(({method,input,options})=>{const[g,m]=method.split('.');return window.bookkeep[g][m](input,options);},{method,input,options});
const invoke=async(...args)=>{const r=await raw(...args);assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
async function launch(){app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});page=await app.firstWindow();await page.locator('[data-ledger-total]').waitFor();page.on('pageerror',e=>result.errors.push(e.message));await app.evaluate(({session})=>{globalThis.cHttp=0;globalThis.fetch=async()=>{globalThis.cHttp++;throw Error('HTTP prohibited');};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{globalThis.cHttp++;cb({cancel:true});});});}
async function close(){result.externalHttp+=await app.evaluate(()=>globalThis.cHttp);await app.close();app=null;}
const snapshot=()=>app.evaluate(({app})=>{const r=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=r('node:fs'),path=r('node:path'),DB=r('better-sqlite3'),root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),p=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),db=new DB(path.join(root,'data/generations',p.generationId,'ledger.db'),{readonly:true});try{return{pointer:p,transactions:db.prepare('SELECT id,amount_fen FROM "transaction" ORDER BY id').all(),unlocks:db.prepare('SELECT * FROM achievement_unlock ORDER BY achievement_id').all(),facts:db.prepare('SELECT * FROM achievement_fact ORDER BY kind,source_id').all(),notices:db.prepare('SELECT * FROM achievement_notice').all(),receipts:db.prepare('SELECT operation,mutation_id FROM mutation_receipt').all(),postings:db.prepare('SELECT * FROM review_posting').all(),quick:db.pragma('quick_check',{simple:true}),fk:db.pragma('foreign_key_check')};}finally{db.close();}});
async function restore(id){const p=await invoke('backup.restore',{mode:'preview',backupId:id});return invoke('backup.restore',{mode:'commit',restoreToken:p.restoreToken,currentDataWillBeReplaced:true},{mutationId:crypto.randomUUID()});}
try{
 await launch();const input={amountFen:123,occurredDate:'2020-01-01',occurredTime:null,timePrecision:'date',name:'C synthetic',categoryId:'cat_food',merchant:null,note:null};
 await invoke('transaction.create',input,{mutationId:crypto.randomUUID()});const before=await invoke('achievement.list'),b=await invoke('backup.create',{kind:'manual',containsPrivateDataAcknowledged:true},{mutationId:crypto.randomUUID()});
 const created=await invoke('achievement.list');assert.equal(created.progress.backups,1);check('published-first-manual-backup-grants-once',created);
 await invoke('transaction.create',{...input,name:'after snapshot'},{mutationId:crypto.randomUUID()});
 await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('achievement.list');ipcMain.removeHandler('achievement.list');ipcMain.handle('achievement.list',async(e,req)=>{const r=await original(e,req);ipcMain.removeHandler('achievement.list');ipcMain.handle('achievement.list',original);return new Promise(resolve=>{globalThis.cReleaseOld=()=>resolve(r);});});});
 const delayed=raw('achievement.list');
 const deadline=Date.now()+10000;while(!await app.evaluate(()=>typeof globalThis.cReleaseOld==='function')){if(Date.now()>deadline)throw Error('delay capture timeout');await new Promise(r=>setTimeout(r,10));}
 const restored=await restore(b.record.id);assert.notEqual(restored.newDataEpoch,before.dataEpoch);
 await app.evaluate(()=>globalThis.cReleaseOld());const stale=await delayed;assert.equal(stale.ok,false);assert.equal(stale.error.code,'STALE_EPOCH');check('actual-delayed-old-preload-envelope-rejected',stale.error);
 const list=await invoke('achievement.list'),sql=await snapshot();assert.equal(list.progress.entries,1);assert.equal(list.progress.backups,1);assert.ok(list.items.find(i=>i.id==='backup_first').unlocked);assert.ok(list.notices.every(n=>n.status==='suppressed'||n.status==='closed'));assert.equal(sql.transactions.length,1);assert.equal(sql.transactions[0].amount_fen,123);assert.equal(sql.quick,'ok');assert.deepEqual(sql.fk,[]);check('restore-self-success-sql-notifications-and-new-epoch',sql);
 const consumed=await raw('achievement.consume',{noticeId:before.notices[0].id,state:'shown'},{mutationId:crypto.randomUUID(),dataEpoch:before.dataEpoch});assert.equal(consumed.ok,false);assert.equal(consumed.error.code,'STALE_EPOCH');check('old-generation-consumption-cannot-write',consumed.error);
 await restore(b.record.id);const twice=await invoke('achievement.list');assert.equal(twice.progress.backups,1);assert.equal(twice.progress.backupDays,1);assert.ok(twice.notices.every(n=>n.status==='suppressed'||n.status==='closed'));check('repeat-restore-no-extra-day-or-notice',twice);
 await close();await launch();const restarted=await invoke('achievement.list');assert.equal(restarted.progress.backups,1);assert.ok(restarted.notices.every(n=>n.status==='suppressed'||n.status==='closed'));check('actual-process-restart-preserves-facts-and-suppression',await snapshot());
 await close();assert.equal(result.externalHttp,0);assert.deepEqual(result.errors,[]);result.ok=true;
}catch(error){result.error=String(error.stack??error);throw error;}finally{if(app)await close().catch(()=>{});writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));}
