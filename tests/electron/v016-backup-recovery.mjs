/** Catches disabled processing recovery, bypassed preview/confirmation, and invented completion/awards. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES,'qa.cjs'))('playwright');
const {buildSync}=createRequire(path.join(ROOT,'package.json'))('esbuild');
const out=path.resolve(process.env.BOOKKEEP_QA_OUTPUT);fs.mkdirSync(out,{recursive:true});
const bundle=path.join(out,'fixture.cjs');buildSync({entryPoints:[path.join(ROOT,'tests/fixtures/backup-ui-recovery.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',external:['better-sqlite3','sharp'],logLevel:'silent'});
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={ok:false,kind:'implementation selftest, automated UI confirmation; not human acceptance',cases:[],errors:[]};
let app,page;
const raw=(method,input)=>page.evaluate(({method,input})=>{const[g,m]=method.split('.');return window.bookkeep[g][m](input);},{method,input});
const data=async(method,input)=>{const r=await raw(method,input);assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
const snapshot=()=>app.evaluate(({app})=>{
 const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),DB=require('better-sqlite3');
 const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),pointer=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),db=new DB(path.join(root,'data/generations',pointer.generationId,'ledger.db'),{readonly:true});
 try{return {pointer,transactions:db.prepare('SELECT id,name,amount_fen FROM "transaction" ORDER BY id').all(),backups:db.prepare('SELECT * FROM backup_record ORDER BY id').all(),facts:db.prepare('SELECT * FROM achievement_fact ORDER BY kind,source_id').all(),unlocks:db.prepare('SELECT * FROM achievement_unlock ORDER BY achievement_id').all(),postings:db.prepare('SELECT * FROM review_posting').all(),meta:db.prepare('SELECT * FROM app_meta').all(),quick:db.pragma('quick_check',{simple:true}),fk:db.pragma('foreign_key_check'),catalog:JSON.parse(fs.readFileSync(path.join(root,'backups/catalog.json'),'utf8'))};}finally{db.close();}
});
try{
 for(const scenario of ['missing-log','torn-log','bad-log','missing-core','corrupt-core','hash-conflict','completed']){
  const c={scenario,ok:false,checks:[],dialogs:[]};report.cases.push(c);const dir=path.join(out,scenario);fs.mkdirSync(dir);
  const local=fs.mkdtempSync(path.join(process.env.LOCALAPPDATA,'bk-v016-rework-ui-'));
  const child=spawnSync(process.execPath,[bundle,local,scenario],{env:{...process.env,NODE_PATH:path.join(ROOT,'node_modules')},encoding:'utf8',windowsHide:true});
  fs.writeFileSync(dir+'/fixture.stdout.json',child.stdout);fs.writeFileSync(dir+'/fixture.stderr.log',child.stderr);assert.equal(child.status,0,child.stderr);c.fixture=JSON.parse(child.stdout);
  const file=path.join(local,'BookKeepAI/backups',c.fixture.record.id+'.bkdb'),comp=file+'.completion.json',compBefore=fs.existsSync(comp)?fs.readFileSync(comp,'utf8'):null;
  c.hashBefore=fs.existsSync(file)?hash(fs.readFileSync(file)):null;
  app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT,'--force-device-scale-factor=1'],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:local})});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));await page.locator('[data-ledger-total]').waitFor();
  await app.evaluate(({BrowserWindow,ipcMain})=>{BrowserWindow.getAllWindows()[0].setContentSize(1400,1000);globalThis.recoveryTrace=[];const original=ipcMain._invokeHandlers.get('backup.restore');ipcMain.removeHandler('backup.restore');ipcMain.handle('backup.restore',async(e,req)=>{const r=await original(e,req);globalThis.recoveryTrace.push({request:req,response:r});return r;});});
  let accept=false;page.on('dialog',async d=>{c.dialogs.push({type:d.type(),message:d.message(),accepted:accept});await(accept?d.accept():d.dismiss());});
  await data('transaction.create',{amountFen:987,occurredDate:'2026-10-28',occurredTime:null,timePrecision:'date',name:'恢复前当前合成业务',categoryId:'cat_food',merchant:null,note:null});
  c.before=await snapshot();assert.equal(c.before.transactions.length,2);assert.equal(c.before.quick,'ok');
  await page.locator('[data-nav-item="data"]').click();await page.locator('[data-main-transition][data-phase="stable"]').waitFor();
  const list=await raw('backup.list',{page:{limit:50,cursor:null}});c.list=list;assert.equal(list.ok,true);
  const record=list.data.records.find(r=>r.id===c.fixture.record.id);assert(record);c.recordBefore=record;
  const row=page.locator('tbody tr').filter({hasText:record.archiveHash.slice(0,12)});await row.waitFor();await row.scrollIntoViewIfNeeded();
  const button=row.getByRole('button',{name:'校验并恢复',exact:true});c.rowText=await row.innerText();c.buttonEnabled=await button.isEnabled();await page.screenshot({path:dir+'/target-row.png'});
  const blocked=['missing-core','hash-conflict'].includes(scenario);
  if(blocked){assert.equal(c.buttonEnabled,false);const rejected=await raw('backup.restore',{mode:'preview',backupId:record.id});assert.equal(rejected.ok,false);c.rejected=rejected;c.checks.push('main-rejects-unavailable-core-and-ui-disabled');}
  else{
   assert.equal(c.buttonEnabled,true,'Existing processing core must have a real UI validation entry');
   await button.click();
   if(scenario==='corrupt-core'){await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('region',{name:'恢复预览',exact:true}).count(),0);c.checks.push('ui-validation-rejected-corrupt-core');}
   else{
    const preview=page.getByRole('region',{name:'恢复预览',exact:true});await preview.waitFor();await preview.scrollIntoViewIfNeeded();await page.screenshot({path:dir+'/preview.png'});
    const previewState=await snapshot();assert.deepEqual(previewState.pointer,c.before.pointer);assert.deepEqual(previewState.transactions,c.before.transactions);c.checks.push('ui-preview-is-read-only');
    await preview.getByRole('button',{name:'确认覆盖当前数据并恢复',exact:true}).click();assert.equal(c.dialogs.length,1);assert.equal(c.dialogs[0].accepted,false);assert.deepEqual((await snapshot()).pointer,c.before.pointer);c.checks.push('cancel-confirm-does-not-restore');
    accept=true;await preview.getByRole('button',{name:'确认覆盖当前数据并恢复',exact:true}).click();await page.getByText(/^恢复完成：已切换数据世代/).waitFor();assert.equal(c.dialogs.length,2);assert.equal(c.dialogs[1].accepted,true);c.checks.push('actual-ui-preview-and-explicit-confirm-restore');
   }
  }
  c.trace=await app.evaluate(()=>globalThis.recoveryTrace);c.after=await snapshot();c.achievements=await data('achievement.list');c.afterList=await data('backup.list',{page:{limit:50,cursor:null}});c.recordAfter=c.afterList.records.find(r=>r.id===record.id);
  assert.equal(c.after.quick,'ok');assert.deepEqual(c.after.fk,[]);assert.deepEqual(c.after.postings,[]);assert.equal(c.hashBefore,fs.existsSync(file)?hash(fs.readFileSync(file)):null);assert.equal(compBefore,fs.existsSync(comp)?fs.readFileSync(comp,'utf8'):null);
  if(blocked||scenario==='corrupt-core'){
   assert.deepEqual(c.after.pointer,c.before.pointer);assert.deepEqual(c.after.transactions,c.before.transactions);assert.deepEqual(c.after.facts,c.before.facts);assert.equal(c.trace.some(t=>t.request.payload.mode==='commit'),false);c.checks.push('rejected-core-keeps-current-ledger');
  }else{
   assert.notEqual(c.after.pointer.generationId,c.before.pointer.generationId);assert.deepEqual(c.after.transactions,[{id:c.fixture.transaction.id,name:'备份核心合成业务',amount_fen:321}]);
   const commit=c.trace.filter(t=>t.request.payload.mode==='commit');assert.equal(commit.length,1);assert.equal(commit[0].response.ok,true);assert.equal(commit[0].request.payload.currentDataWillBeReplaced,true);assert.notEqual(commit[0].response.data.newDataEpoch,commit[0].request.dataEpoch);assert.equal(commit[0].response.data.appliedBackupHash,c.fixture.coreHash);
   const protection=c.after.backups.find(b=>b.id===commit[0].response.data.preRestoreBackupId);assert.equal(protection.kind,'pre_restore');assert.equal(protection.status,'completed');
   const expected=scenario==='completed'?1:0;assert.equal(c.achievements.progress.backups,expected);assert.equal(c.after.facts.filter(f=>f.kind==='manual_backup').length,expected);assert.equal(c.achievements.items.find(i=>i.id==='backup_first').unlocked,expected===1);
   assert.equal(c.recordAfter.status,scenario==='completed'?'completed':'processing');assert.equal(c.recordAfter.finishedAt,scenario==='completed'?'2026-10-27T15:59:59.000Z':null);assert.equal(c.recordAfter.archiveHash,c.fixture.coreHash);
   const catalog=c.after.catalog.entries.find(e=>e.id===record.id);assert.equal(catalog.finishedAt,c.recordAfter.finishedAt);assert.equal(catalog.status,c.recordAfter.status);c.checks.push('core-hash-proof-catalog-generation-data-awards-and-pre-restore-preserved');
  }
  c.checks.push('completion-log-bytes-unchanged','integrity-and-no-automatic-posting');
  await app.close();app=null;c.ok=true;fs.writeFileSync(dir+'/result.json',JSON.stringify(c,null,2)+'\n');console.log('PASS '+scenario);
 }
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.failure=e.stack;console.error(e);if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{if(app)await app.close();fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2)+'\n');}
if(!report.ok)process.exitCode=1;
