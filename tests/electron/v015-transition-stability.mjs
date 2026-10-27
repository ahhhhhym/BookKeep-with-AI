/** Regressions for visible menu jitter and silent statistics updates. Synthetic data only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/qa.cjs')('playwright');
const out=process.env.BOOKKEEP_QA_OUTPUT??'evidence/V0.1.5/R1/red';mkdirSync(out,{recursive:true});
const report={ok:false,checks:[],failures:[],samples:[],errors:[],http:0,localAppData:mkdtempSync(path.join(tmpdir(),'BookKeep 015 R1 synthetic '))};
let app,page;
const check=(id,fn)=>{try{fn();report.checks.push({id,ok:true});console.log('PASS '+id);}catch(e){report.failures.push({id,error:e.stack});console.log('FAIL '+id+' '+e.message);}};
const settled=()=>page.locator('[data-main-transition][data-phase="stable"]').waitFor();
const nav=async id=>{await page.locator(`[data-nav-item="${id}"]`).click();await settled();};
async function sample(id,actions,duration=380){
 const rows=await page.evaluate(({actions,duration})=>new Promise(resolve=>{
  const rows=[],start=performance.now();for(const a of actions)setTimeout(()=>document.querySelector(`[data-nav-item="${a.id}"]`).click(),a.at);
  function frame(){const m=document.querySelector('.main'),s=document.querySelector('[data-main-transition]'),p=s.querySelector(':scope > .page:not([hidden])'),h=p?.querySelector('h1'),b=h?.getBoundingClientRect(),style=getComputedStyle(s),y=style.transform==='none'?0:new DOMMatrixReadOnly(style.transform).m42;
   rows.push({t:performance.now()-start,route:document.querySelector('.app').dataset.nav,phase:s.dataset.phase,opacity:+style.opacity,translateY:y,scrollTop:m.scrollTop,clientWidth:m.clientWidth,scrollHeight:m.scrollHeight,clientHeight:m.clientHeight,heading:b?.toJSON(),headingBaseY:b?b.y-y:null,mainTop:m.getBoundingClientRect().top,interactive:!s.inert,pages:s.querySelectorAll(':scope > .page:not([hidden])').length});
   if(performance.now()-start<duration)requestAnimationFrame(frame);else resolve(rows);
  }requestAnimationFrame(frame);
 }),{actions,duration});report.samples.push({id,rows});return rows;
}
try{
 app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT,'--force-device-scale-factor=1'],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:report.localAppData})});
 await app.evaluate(({BrowserWindow,session,ipcMain})=>{BrowserWindow.getAllWindows()[0].setContentSize(1450,850);globalThis.qaR1={delay:0,http:0};globalThis.fetch=async()=>{globalThis.qaR1.http++;throw Error('External HTTP forbidden');};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{globalThis.qaR1.http++;cb({cancel:true});});const series=ipcMain._invokeHandlers.get('statistics.series');ipcMain.removeHandler('statistics.series');ipcMain.handle('statistics.series',async(...args)=>{const reply=await series(...args);await new Promise(r=>setTimeout(r,globalThis.qaR1.delay));return reply;});});
 page=await app.firstWindow();await page.emulateMedia({colorScheme:null});page.on('pageerror',e=>report.errors.push(e.message));await page.locator('[data-ledger-total]').waitFor();
 const short=await sample('short-to-long',[{at:0,id:'settings'}]);await settled();
 const back=await sample('long-to-short',[{at:0,id:'ledger'}]);await settled();
 check('no-horizontal-reflow-during-main-transition',()=>{for(const rows of [short,back])assert.equal(new Set(rows.map(r=>r.clientWidth)).size,1,JSON.stringify(rows.map(r=>({t:r.t,w:r.clientWidth,phase:r.phase}))));});
 check('new-page-heading-has-no-horizontal-twitch',()=>{for(const rows of [short,back]){const enter=rows.filter(r=>r.phase==='entering');assert(Math.max(...enter.map(r=>r.heading.x))-Math.min(...enter.map(r=>r.heading.x))<1,'heading moved sideways while entering');}});
 await nav('settings');await page.locator('.main').evaluate(e=>{e.scrollTop=e.scrollHeight;});const fromScroll=await page.locator('.main').evaluate(e=>e.scrollTop);assert(fromScroll>0);
 const scrolled=await sample('scrolled-settings-to-data',[{at:0,id:'data'}]);await settled();
 check('new-primary-page-starts-at-top-before-visible',()=>{const rows=scrolled.filter(r=>r.route==='data');assert(rows.length);assert(rows.every(r=>r.scrollTop===0),'new page inherited '+Math.max(...rows.map(r=>r.scrollTop))+'px scroll');});
 await nav('ledger');const reverse=await sample('reverse-during-entry',[{at:0,id:'settings'},{at:90,id:'data'},{at:110,id:'settings'}],450);await settled();
 check('same-page-reversal-does-not-snap-to-full-opacity',()=>{for(let n=1;n<reverse.length;n++){const a=reverse[n-1],b=reverse[n];if(a.route===b.route&&b.t-a.t<40)assert(b.opacity-a.opacity<.45,'opacity jumped '+a.opacity+'→'+b.opacity);}});
 await nav('statistics');await page.locator('[data-statistics-total]').waitFor();
 await app.evaluate(()=>{globalThis.qaR1.delay=400;});await page.getByRole('group',{name:'统计周期'}).getByRole('button',{name:'周',exact:true}).click();await page.waitForTimeout(50);
 const status=await page.locator('.statistics-update').evaluate(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,position:getComputedStyle(e).position,text:e.innerText}));
 check('statistics-update-status-has-no-visible-row',()=>{assert(status.height<=1&&status.width<=1&&status.position==='absolute',JSON.stringify(status));});
 assert.equal(await page.locator('[data-statistics-total]').count(),1);assert.equal(await page.locator('.statistics-chart').getAttribute('aria-disabled'),'true');
 await page.locator('.statistics-snapshot[aria-busy="false"]').waitFor();report.ok=report.failures.length===0;
}catch(e){report.failures.push({id:'harness',error:e.stack});console.error(e);}
finally{if(app){report.http=await app.evaluate(()=>globalThis.qaR1.http);await app.close();}writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));}
if(!report.ok)process.exitCode=1;
