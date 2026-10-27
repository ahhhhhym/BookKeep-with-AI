/** E coherent delivery/restart/restore flow, real app + synthetic data only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES,'qa.cjs'))('playwright');
const out=path.resolve(process.env.BOOKKEEP_QA_OUTPUT);mkdirSync(out,{recursive:true});
const localAppData=mkdtempSync(path.join(tmpdir(),'BookKeep E 0.1.4 合成 '));
const result={ok:false,localAppData,checks:[],errors:[],externalHttp:0};let app,page;
const check=(id,actual)=>{result.checks.push({id,ok:true,actual});console.log('PASS '+id);};
async function invoke(method,input,options){const r=await page.evaluate(({method,input,options})=>{const[g,m]=method.split('.');return window.bookkeep[g][m](input,options);},{method,input,options});assert.equal(r.ok,true,JSON.stringify(r));return r.data;}
async function nav(id){await page.locator(`[data-nav-item="${id}"]`).click();await page.locator(`[data-nav="${id}"]`).waitFor();}
async function launch(){
 app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});
 await app.evaluate(({session})=>{globalThis.eHttp=0;globalThis.fetch=async()=>{globalThis.eHttp++;throw Error('network prohibited');};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{globalThis.eHttp++;cb({cancel:true});});});
 page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>result.errors.push(e.message));await page.emulateMedia({colorScheme:null});await page.locator('[data-ledger-total]').waitFor();
 await nav('settings');assert((await page.getByRole('region',{name:'关于',exact:true}).innerText()).includes('BookKeepAI 0.1.4'));assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.1.4');
}
async function close(){if(app){result.externalHttp+=await app.evaluate(()=>globalThis.eHttp);await app.close();app=null;}}
async function sql(){return app.evaluate(({app})=>{const r=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=r('node:fs'),path=r('node:path'),DB=r('better-sqlite3'),root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),pointer=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),db=new DB(path.join(root,'data/generations',pointer.generationId,'ledger.db'),{readonly:true});try{return {pointer,transactions:db.prepare('SELECT * FROM "transaction" ORDER BY id').all(),postings:db.prepare('SELECT * FROM review_posting').all(),receipts:db.prepare('SELECT * FROM mutation_receipt ORDER BY mutation_id').all(),facts:db.prepare('SELECT * FROM achievement_fact ORDER BY kind,source_id').all(),unlocks:db.prepare('SELECT * FROM achievement_unlock ORDER BY achievement_id').all(),notices:db.prepare('SELECT * FROM achievement_notice ORDER BY id').all(),quick:db.pragma('quick_check',{simple:true}),fk:db.pragma('foreign_key_check')};}finally{db.close();}});}
try{
 await launch();check('first-start-native-and-rendered-version-014',{version:'0.1.4',localAppData});
 await invoke('achievement.applyPreferences',{enabled:false,position:'bottom-right'});
 await nav('ledger');const input={amountFen:321,occurredDate:'2020-01-01',occurredTime:null,timePrecision:'date',name:'E delivered expense',categoryId:'cat_food',merchant:null,note:null},mutationId=crypto.randomUUID();
 await invoke('transaction.create',input,{mutationId});const replay=await invoke('transaction.create',input,{mutationId});assert.equal(replay.replayed,true);
 await nav('achievements');await page.locator('.achievement-card').first().waitFor();const live=await invoke('achievement.list');assert.equal(live.progress.entries,1);assert.equal(live.items.find(i=>i.id==='entry_first').unlocked,true);assert(live.notices.every(n=>n.status==='suppressed'));check('navigation-real-business-unlock-disabled-notice',live);
 const backup=await invoke('backup.create',{kind:'manual',containsPrivateDataAcknowledged:true});assert.equal(backup.record.appVersion,'0.1.4');
 const before=await sql();writeFileSync(path.join(out,'before-restart.json'),JSON.stringify(before,null,2));await close();await launch();const restarted=await sql();assert.deepEqual(restarted,before);assert.deepEqual(await invoke('achievement.readPreferences'),{enabled:false,position:'bottom-right'});check('restart-014-preserves-complete-sql-and-local-preferences',{backupVersion:backup.record.appVersion,epoch:restarted.pointer.dataEpoch});
 const preview=await invoke('backup.restore',{mode:'preview',backupId:backup.record.id});
 const restored=await invoke('backup.restore',{mode:'commit',restoreToken:preview.restoreToken,currentDataWillBeReplaced:true});
 assert.notEqual(restored.newDataEpoch,before.pointer.dataEpoch);const data=await invoke('achievement.list');assert.equal(data.progress.entries,1);assert.equal(data.progress.backups,1);assert(data.items.find(i=>i.id==='backup_first').unlocked);assert(data.notices.every(n=>n.status==='suppressed'||n.status==='closed'));assert.deepEqual(await invoke('achievement.readPreferences'),{enabled:false,position:'bottom-right'});
 const after=await sql();assert.deepEqual(after.transactions,before.transactions);assert.deepEqual(after.postings,before.postings);assert.equal(after.quick,'ok');assert.deepEqual(after.fk,[]);writeFileSync(path.join(out,'after-restore.json'),JSON.stringify(after,null,2));check('version014-backup-self-award-restore-and-epoch-isolation',{restored,data});
 await nav('achievements');await page.locator('.achievement-card').first().waitFor();const capture=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));writeFileSync(path.join(out,'delivered-achievements.png'),Buffer.from(capture,'base64'));
 await close();assert.equal(result.externalHttp,0);assert.deepEqual(result.errors,[]);result.ok=true;
}catch(e){result.error=e.stack;console.error(e);}finally{await close();writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));}
process.exitCode=result.ok?0:1;
