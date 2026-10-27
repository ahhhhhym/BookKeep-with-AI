import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const modules=process.env.BOOKKEEP_QA_NODE_MODULES??'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {_electron}=createRequire(path.join(modules,'qa.cjs'))('playwright');
const out=path.resolve(process.env.BOOKKEEP_QA_OUTPUT??'evidence/V0.1.5/red-statistics');mkdirSync(out,{recursive:true});
const localAppData=mkdtempSync(path.join(tmpdir(),'BookKeep 015 statistics synthetic '));
const result={ok:false,localAppData,checks:[],samples:[],errors:[],console:[]};let app,page;
const check=(id,data)=>{result.checks.push({id,data});console.log('PASS '+id);};
const raw=(method,input)=>page.evaluate(({method,input})=>{const[g,m]=method.split('.');return window.bookkeep[g][m](input);},{method,input});
async function invoke(method,input){const r=await raw(method,input);assert.equal(r.ok,true,JSON.stringify(r));return r.data;}
const config=async config=>app.evaluate((_e,c)=>{globalThis.statsQa.config=c;},config);
const period=p=>page.getByRole('group',{name:'统计周期',exact:true}).getByRole('button',{name:p,exact:true}).click();
try{
 app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT,'--force-device-scale-factor=1'],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});
 await app.evaluate(({ipcMain,session,BrowserWindow})=>{
  globalThis.statsQa={config:{},calls:[],http:0};globalThis.fetch=async()=>{globalThis.statsQa.http++;throw Error('HTTP forbidden');};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{globalThis.statsQa.http++;cb({cancel:true});});BrowserWindow.getAllWindows()[0].setContentSize(1400,850);
  for(const channel of ['statistics.series','statistics.summary','statistics.topCategories','statistics.topTransactions']){
   const original=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);
   ipcMain.handle(channel,async(event,request)=>{const cfg={...globalThis.statsQa.config},record={channel,input:request.payload,start:Date.now()};globalThis.statsQa.calls.push(record);const reply=await original(event,request);if(channel==='statistics.series'){await new Promise(r=>setTimeout(r,cfg[request.payload.period]??0));if(cfg.fail)reply.ok=false,reply.error={code:'INTERNAL_ERROR',message:'INTERNAL_ERROR',fieldErrors:[],details:{},retryable:true,retryAfterMs:null};}else if(channel==='statistics.summary'&&cfg.summary)await new Promise(r=>setTimeout(r,cfg.summary));record.end=Date.now();record.ok=reply.ok;return reply;});
  }
 });
 page=await app.firstWindow();await page.emulateMedia({colorScheme:null});page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))result.console.push(m.text());});page.setDefaultTimeout(10000);await page.locator('[data-ledger-total]').waitFor();
 for(const [date,amount,name] of [['2026-10-27',100,'周合成'],['2026-10-01',200,'月合成'],['2026-01-02',400,'年合成']])await invoke('transaction.create',{amountFen:amount,occurredDate:date,occurredTime:null,timePrecision:'date',name,merchant:null,categoryId:'cat_food',note:null});
 await page.locator('[data-nav-item="statistics"]').click();await page.locator('[data-statistics-total="300"]').waitFor();
 await page.evaluate(()=>{window.statsFrames=[];window.statsSampling=true;const start=performance.now();function sample(){if(!window.statsSampling)return;const s=document.querySelector('.statistics-snapshot'),t=document.querySelector('[data-statistics-total]'),i=document.querySelector('.statistics-page .segment-indicator');window.statsFrames.push({t:performance.now()-start,period:s?.dataset.period,scope:s?.dataset.scope,total:t?.dataset.statisticsTotal,range:document.querySelector('[data-statistics-displayed]')?.textContent,chart:!!document.querySelector('.statistics-chart'),selected:[...document.querySelectorAll('[aria-label="统计周期"] button')].find(b=>b.getAttribute('aria-pressed')==='true')?.textContent,slider:i?getComputedStyle(i).transform:null,updating:s?.getAttribute('aria-busy'),details:document.querySelectorAll('.point-detail').length});requestAnimationFrame(sample);}requestAnimationFrame(sample);});
 await config({week:600,year:150});await period('周');await page.waitForTimeout(40);
 assert.equal(await page.locator('[data-statistics-total="300"]').count(),1,'old completed month must remain mounted during week request');
 assert((await page.locator('.statistics-snapshot').innerText()).includes('月支出趋势'));check('pending-retains-month-snapshot');
 assert.equal(await page.locator('.statistics-chart').getAttribute('aria-disabled'),'true');
 await page.locator('[data-point-key="2026-10-27"]').click({force:true});assert.equal(await page.locator('.point-detail').count(),0);check('old-points-disabled-immediately');
 await period('年');await page.locator('.statistics-snapshot[data-period="year"][aria-busy="false"]').waitFor();assert.equal(await page.locator('[data-statistics-total]').getAttribute('data-statistics-total'),'700');await page.waitForTimeout(650);assert.equal(await page.locator('.statistics-snapshot').getAttribute('data-period'),'year');check('reverse-order-old-week-cannot-overwrite-year');
 await config({month:180,fail:true});await period('月');await page.getByText(/统计暂未读取成功/).waitFor();assert.equal(await page.locator('[data-statistics-total]').getAttribute('data-statistics-total'),'700');assert((await page.locator('[data-statistics-displayed]').innerText()).startsWith('年统计'));await page.screenshot({path:path.join(out,'failure-retained-year.png')});check('failure-retains-labelled-year-and-retry');
 await config({month:180});await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.statistics-snapshot[data-period="month"][aria-busy="false"]').waitFor();assert.equal(await page.locator('[data-statistics-total]').getAttribute('data-statistics-total'),'300');check('retry-atomically-commits-month');
 await page.getByRole('button',{name:'上一月',exact:true}).click();assert.equal(await page.locator('[data-statistics-total="300"]').count(),1);await page.locator('[data-statistics-total="0"]').waitFor();assert((await page.locator('[data-statistics-displayed]').innerText()).includes('2026-09-01'));check('date-change-keeps-old-until-new-snapshot');
 await page.getByRole('button',{name:'回到当前',exact:true}).click();await page.locator('[data-statistics-total="300"]').waitFor();
 await page.locator('.category-filter summary').click();await page.getByRole('checkbox',{name:'交通',exact:true}).check();await page.locator('[data-statistics-total="0"]').waitFor();assert((await page.locator('[data-statistics-displayed]').innerText()).includes('交通'));assert.equal(await page.locator('.category-ranking li').count(),0);check('category-range-and-total-same-snapshot');
 await page.getByRole('button',{name:'统计全部分类',exact:true}).click();await page.locator('[data-statistics-total="300"]').waitFor();
 await page.locator('[data-point-key="2026-10-27"]').click();await page.locator('.point-total').waitFor();assert((await page.locator('.point-total').innerText()).includes('1.00'));await page.locator('.top-items').waitFor();
 await page.getByRole('button',{name:'刷新统计',exact:true}).click();assert.equal(await page.locator('.point-detail').count(),0);await page.locator('.statistics-snapshot[aria-busy="false"]').waitFor();check('refresh-clears-detail-and-disables-old-chart');
 await page.locator('[data-point-key="2026-10-27"]').click();await page.locator('.top-items').waitFor();await page.getByRole('button',{name:'查看明细',exact:true}).click();await page.locator('[data-nav="ledger"]').waitFor();await page.locator('[data-ledger-total="100"]').waitFor();await page.locator('[data-main-transition][data-phase="stable"]').waitFor();check('point-details-navigates-to-matching-ledger');
 await page.locator('[data-nav-item="statistics"]').click();await page.locator('[data-statistics-total="300"]').waitFor();await page.locator('[data-main-transition][data-phase="stable"]').waitFor();check('return-retains-target-input');
 await config({month:250});await page.getByRole('button',{name:'刷新统计',exact:true}).click();await page.waitForTimeout(60);
 const revisionExtra=await invoke('transaction.create',{amountFen:50,occurredDate:'2026-10-27',occurredTime:null,timePrecision:'date',name:'同代际修订合成',merchant:null,categoryId:'cat_food',note:null});await page.waitForTimeout(280);
 assert.equal(await page.locator('[data-statistics-total="300"]').count(),1,'same-generation snapshot revision retry must keep prior completed content');await page.locator('[data-statistics-total="350"]').waitFor();check('same-epoch-revision-retry-never-clears-completed-content');await config({});await invoke('transaction.softDelete',{id:revisionExtra.transaction.id,expectedVersion:revisionExtra.transaction.version});await page.getByRole('button',{name:'刷新统计',exact:true}).click();await page.locator('[data-statistics-total="300"]').waitFor();
 const backup=await invoke('backup.create',{kind:'manual',containsPrivateDataAcknowledged:true});
 await invoke('transaction.create',{amountFen:800,occurredDate:'2026-10-27',occurredTime:null,timePrecision:'date',name:'恢复前额外合成',merchant:null,categoryId:'cat_food',note:null});
 await page.getByRole('button',{name:'刷新统计',exact:true}).click();await page.locator('[data-statistics-total="1100"]').waitFor();const oldEpoch=await page.locator('.statistics-snapshot').getAttribute('data-epoch');
 // A real restore while an old envelope is in flight; preload rejects it, and the observer clears the old generation before retry.
 await config({month:450,summary:450});await page.getByRole('button',{name:'刷新统计',exact:true}).click();await page.waitForTimeout(60);
 const preview=await invoke('backup.restore',{mode:'preview',backupId:backup.record.id});const restored=await invoke('backup.restore',{mode:'commit',restoreToken:preview.restoreToken,currentDataWillBeReplaced:true});assert.notEqual(restored.newDataEpoch,oldEpoch);
 await page.locator('.statistics-placeholder').waitFor();assert.equal(await page.locator('[data-statistics-total="1100"]').count(),0);await page.locator('[data-statistics-total="300"]').waitFor();assert.equal(await page.locator('.statistics-snapshot').getAttribute('data-epoch'),restored.newDataEpoch);check('real-restore-stale-envelope-clears-old-generation');
 await config({});
 await page.locator('[data-nav-item="ledger"]').click();await page.locator('[data-main-transition][data-phase="stable"]').waitFor();
 await config({month:350,fail:true});await page.locator('[data-nav-item="statistics"]').click();await page.locator('.statistics-placeholder').waitFor();
 const placeholder=await page.locator('.statistics-placeholder').evaluate(e=>({height:e.offsetHeight,rect:e.getBoundingClientRect().toJSON()}));result.placeholder=placeholder;
 assert(placeholder.height>=440);await page.getByText(/统计暂未读取成功/).waitFor();
 // Transforming quads can report 440.0000305px during entry; compare actual layout height.
 assert.equal(await page.locator('.statistics-placeholder').evaluate(e=>e.offsetHeight),placeholder.height);
 assert.equal(await page.locator('[data-statistics-total]').count(),0);await config({});await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('[data-statistics-total="300"]').waitFor();check('first-load-error-retry-stable-placeholder');
 const rows=await page.evaluate(()=>{window.statsSampling=false;return window.statsFrames;});result.samples=rows;
 const snapshots=rows.filter(r=>r.total);assert(snapshots.length>10);assert(snapshots.every(r=>r.chart&&r.range?.startsWith(({week:'周',month:'月',year:'年'})[r.period]+'统计')));assert(rows.some(r=>r.updating==='true'&&r.period==='month'&&r.selected==='周'));assert(rows.some(r=>r.updating==='true'&&r.period==='year'&&r.selected==='月'));check('dynamic-samples-no-cleared-content-or-relabelling-before-generation-change',{frames:rows.length});
 await page.screenshot({path:path.join(out,'final-statistics.png')});assert.deepEqual(result.errors,[]);assert.deepEqual(result.console,[]);
 result.ok=true;
}catch(e){result.failure=e.stack;console.error(e);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{if(app){result.ipc=await app.evaluate(()=>globalThis.statsQa);await app.close();}writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));}
if(!result.ok)process.exitCode=1;
