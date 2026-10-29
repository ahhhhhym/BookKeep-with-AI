import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const modules=process.env.BOOKKEEP_QA_NODE_MODULES??'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {_electron}=createRequire(path.join(modules,'qa.cjs'))('playwright');
const expectedVersion=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')).version;
const out=process.env.BOOKKEEP_QA_OUTPUT??'evidence/V0.1.5/empty-01';mkdirSync(out,{recursive:true});
const localAppData=mkdtempSync(path.join(tmpdir(),'BookKeep 015 empties synthetic '));const report={ok:false,checks:[],errors:[],http:0,localAppData};let app,page;
const check=(id,data)=>{report.checks.push({id,data});console.log('PASS '+id);};
const invoke=async(method,input)=>{const r=await page.evaluate(({method,input})=>{const[g,m]=method.split('.');return window.bookkeep[g][m](input);},{method,input});assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
const cfg=c=>app.evaluate((_e,c)=>{globalThis.emptyQa.config=c;},c);
try{
 app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT,'--force-device-scale-factor=1'],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:localAppData})});
 await app.evaluate(({ipcMain,session,BrowserWindow})=>{globalThis.emptyQa={config:{},http:0};BrowserWindow.getAllWindows()[0].setContentSize(1400,850);globalThis.fetch=async()=>{globalThis.emptyQa.http++;throw Error('HTTP forbidden');};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{globalThis.emptyQa.http++;cb({cancel:true});});const original=ipcMain._invokeHandlers.get('transaction.list');ipcMain.removeHandler('transaction.list');ipcMain.handle('transaction.list',async(...args)=>{const c={...globalThis.emptyQa.config},r=await original(...args);await new Promise(resolve=>setTimeout(resolve,c.delay??0));if(c.fail){r.ok=false;r.error={code:'INTERNAL_ERROR',message:'INTERNAL_ERROR',fieldErrors:[],details:{},retryable:true,retryAfterMs:null};}return r;});});
 page=await app.firstWindow();await page.emulateMedia({colorScheme:null});page.on('pageerror',e=>report.errors.push(e.message));await page.locator('.ledger-empty-book').waitFor();
 assert.equal(await page.locator('.ledger-empty-book').innerText(),'还没有支出，记下第一笔吧');assert.equal(await page.locator('.ledger-empty-book strong').evaluate(e=>getComputedStyle(e).fontWeight),'700');
 assert.equal(await page.locator('.ledger-empty-book .empty').count(),0,'active empty text must not use the bordered generic EmptyState');
 const plain=await page.locator('.ledger-empty-book').evaluate(e=>{const b=e.getBoundingClientRect(),p=e.querySelector('p').getBoundingClientRect();return {border:getComputedStyle(e).borderStyle,background:getComputedStyle(e).backgroundColor,paragraphBorder:getComputedStyle(e.querySelector('p')).borderStyle,centerError:[Math.abs(b.x+b.width/2-p.x-p.width/2),Math.abs(b.y+b.height/2-p.y-p.height/2)]};});
 assert.equal(plain.border,'none');assert.equal(plain.paragraphBorder,'none');assert.equal(plain.background,'rgba(0, 0, 0, 0)');assert(plain.centerError.every(v=>v<1));
 await page.screenshot({path:path.join(out,'active-empty-bold-no-box.png')});check('active-empty-bold-centered-no-box',plain);
 await page.getByRole('button',{name:/筛选支出/}).click();await page.getByRole('searchbox').fill('未匹配合成');await page.getByRole('button',{name:'应用筛选',exact:true}).click();await page.getByText('没有符合条件的记录。',{exact:true}).waitFor();assert.equal(await page.locator('.ledger-empty-book,.ledger-empty-deleted').count(),0);check('filtered-empty-distinct');
 await page.getByRole('button',{name:'已删除记录',exact:true}).click();await page.getByText('没有符合条件的记录。',{exact:true}).waitFor();assert.equal(await page.getByText('暂无已删除记录',{exact:true}).count(),0);check('deleted-filter-no-match-not-empty-ledger');
 await cfg({delay:350});await page.getByRole('button',{name:'清空筛选',exact:true}).click();await page.waitForTimeout(50);assert.equal(await page.locator('.ledger-empty-book,.ledger-empty-deleted').count(),0);await page.locator('.ledger-empty-deleted').waitFor();check('loading-never-renders-empty-prompt');
 await cfg({fail:true,delay:100});await page.getByRole('button',{name:'返回正式支出',exact:true}).click();await page.getByRole('button',{name:'重新读取',exact:true}).waitFor();assert.equal(await page.locator('.ledger-empty-book,.ledger-empty-deleted').count(),0);check('error-never-renders-empty-prompt');await cfg({});await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.locator('.ledger-empty-book').waitFor();
 const created=await invoke('transaction.create',{amountFen:123,occurredDate:'2026-10-27',occurredTime:null,timePrecision:'date',name:'删除视图合成',categoryId:'cat_food',merchant:null,note:null});
 await invoke('transaction.softDelete',{id:created.transaction.id,expectedVersion:created.transaction.version});await page.getByRole('button',{name:'已删除记录',exact:true}).click();await page.locator('[data-transaction-id]').waitFor();assert.equal(await page.getByText('已删除记录：此处金额不计入正式统计。',{exact:true}).count(),0);assert.equal(await page.locator('.ledger-empty-deleted').count(),0);check('deleted-with-data-no-removed-explanation-or-empty');
 await page.screenshot({path:path.join(out,'deleted-with-data.png')});
 // About field and actual native app version share the package source.
 await page.locator('[data-nav-item="settings"]').click();await page.getByRole('region',{name:'关于',exact:true}).waitFor();const about=await page.getByRole('region',{name:'关于',exact:true}).innerText();assert(about.includes(`BookKeepAI ${expectedVersion}`));assert(about.includes('发行者')&&about.includes('瀚宇铭'));assert.equal(await app.evaluate(({app})=>app.getVersion()),expectedVersion);check('about-publisher-and-actual-electron-version',about);
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.failure=e.stack;console.error(e);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{if(app){report.http=await app.evaluate(()=>globalThis.emptyQa.http);await app.close();}writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));}
if(!report.ok)process.exitCode=1;
