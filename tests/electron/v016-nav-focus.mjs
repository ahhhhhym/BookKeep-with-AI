/** Catches a deferred breakpoint focus handoff and stale drawer effects stealing editor focus.
 * Real BrowserWindow sizes and the real React tree; records every rAF, media, resize and commit.
 * The media-after-product checkpoint makes the pre-rAF handoff gap reproducible without delaying callbacks.
 */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES,'qa.cjs'))('playwright');
const out=process.env.BOOKKEEP_QA_OUTPUT;assert(out);fs.mkdirSync(out,{recursive:true});
const report={ok:false,checks:[],failures:[],traces:[],errors:[],method:'Native resize; unchanged callbacks and animation speed; every rAF from before crossing; media listener runs after product handler. No ignore window.'};
let app,page;
const save=()=>fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2)+'\n');
const size=async width=>{await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,650),width);};
const settle=()=>page.waitForTimeout(350);
async function setMode(mode){await size(900);await settle();if(await page.locator('.app').getAttribute('data-nav-mode')!==mode){await page.locator('.nav-mode-toggle').click();await settle();}}
async function start(id){await page.evaluate(id=>{
 const start=performance.now(),media=matchMedia('(max-width: 899px)'),frames=[],events=[];
 const state=type=>{const a=document.activeElement,s=getComputedStyle(a),r=a.getBoundingClientRect(),n=document.querySelector('#main-nav');return {type,t:performance.now()-start,width:innerWidth,matches:media.matches,mode:document.querySelector('.app').dataset.navMode,drawer:n.dataset.open,navInert:n.inert,mainInert:document.querySelector('main').inert,focus:{tag:a.tagName,id:a.id,label:a.getAttribute('aria-label'),class:a.className,display:s.display,visibility:s.visibility,hidden:!!a.closest('[hidden],[inert]')||s.display==='none'||s.visibility==='hidden',rect:r.toJSON()},target:{toggleVisible:document.querySelector('.nav-toggle').getBoundingClientRect().width>0,modeVisible:!!n.getBoundingClientRect().width&&!n.inert}};};
 window.navFocusTrace={id,frames,events,done:false};
 const event=e=>{events.push(state(e.type));if(e.type==='change')queueMicrotask(()=>events.push(state('media-after-product')));};
 for(const type of ['resize','focusin','focusout'])window.addEventListener(type,event,true);media.addEventListener('change',event);
 const observer=new MutationObserver(()=>events.push(state('react-commit')));observer.observe(document.querySelector('.app'),{subtree:true,attributes:true,attributeFilter:['inert','data-open','aria-expanded','data-mode']});
 const sample=()=>{frames.push(state('rAF'));if(!window.navFocusTrace.done)requestAnimationFrame(sample);};requestAnimationFrame(sample);
 window.stopNavFocusTrace=()=>{window.navFocusTrace.done=true;for(const type of ['resize','focusin','focusout'])window.removeEventListener(type,event,true);media.removeEventListener('change',event);observer.disconnect();};
 },id);}
async function finish(id,expected){await settle();await page.evaluate(()=>window.stopNavFocusTrace());const trace=await page.evaluate(()=>window.navFocusTrace);report.traces.push(trace);try{
 assert(trace.frames.length>0);assert(trace.frames.every(f=>!f.focus.hidden),'focus must not remain in hidden/inert region in ANY rAF');
 assert(trace.events.filter(e=>e.type==='media-after-product').every(f=>!f.focus.hidden),'breakpoint handler must finish focus handoff before yielding to rAF');
 if(expected)assert.equal(await page.evaluate(()=>document.activeElement.matches(window.expectedFocus)),true);
 report.checks.push(id);
 }catch(e){report.failures.push({id,error:e.stack});}save();}
async function expected(selector){await page.evaluate(s=>window.expectedFocus=s,selector);}
try{
 app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT,'--force-device-scale-factor=1'],cwd:ROOT,env:electronSafeEnv()});page=await app.firstWindow();page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));await page.locator('[data-ledger-total]').waitFor();
 for(const mode of ['detailed','compact']){
  await setMode(mode);await page.locator('.nav-mode-toggle').focus();await start(mode+'-wide-to-narrow');await size(899);await expected('.nav-toggle');await finish(mode+'-wide-to-narrow',true);
  await start(mode+'-narrow-to-wide');await size(900);await expected('.nav-mode-toggle');await finish(mode+'-narrow-to-wide',true);
  await size(899);await settle();await page.locator('.nav-toggle').click();await settle();await page.locator('[data-nav-item="settings"]').focus();await start(mode+'-open-drawer-to-wide');await size(900);await expected('[data-nav-item="settings"]');await finish(mode+'-open-drawer-to-wide',true);
  assert.equal(await page.locator('#main-nav').getAttribute('data-open'),'false');assert.equal(await page.locator('main').evaluate(e=>e.inert),false);
  for(const close of ['Escape','toggle','backdrop']){
   await size(899);await settle();await page.locator('.nav-toggle').click();await settle();await start(mode+'-drawer-close-'+close);
   if(close==='Escape')await page.keyboard.press('Escape');else if(close==='toggle')await page.locator('.nav-mode-toggle').click();else await page.locator('.backdrop').click({position:{x:500,y:100}});
   await expected('.nav-toggle');await finish(mode+'-drawer-close-'+close,true);
  }
  await size(899);await settle();await page.locator('.nav-toggle').click();await settle();await page.locator('[data-nav-item="settings"]').focus();await start(mode+'-drawer-tab-cycle');
  await page.keyboard.press('Tab');assert(await page.locator('.nav-mode-toggle').evaluate(e=>e===document.activeElement));await page.keyboard.press('Shift+Tab');assert(await page.locator('[data-nav-item="settings"]').evaluate(e=>e===document.activeElement));await finish(mode+'-drawer-tab-cycle',false);await page.keyboard.press('Escape');
  await setMode(mode);await page.locator('.nav-mode-toggle').focus();await start(mode+'-rapid-reverse-repeated-breakpoints');
  await page.evaluate(()=>{document.querySelector('.nav-mode-toggle').click();setTimeout(()=>document.querySelector('.nav-mode-toggle').click(),70);});
  await page.waitForTimeout(105);for(const width of [899,900,899,900,899,900]){await size(width);await page.waitForTimeout(25);}
  await expected('.nav-mode-toggle');await finish(mode+'-rapid-reverse-repeated-breakpoints',true);assert.equal(await page.locator('.app').getAttribute('data-nav-mode'),mode);
 }
 await setMode('detailed');await page.getByRole('button',{name:/筛选支出/}).click();const filter=page.getByLabel('名称搜索',{exact:true});await filter.fill('导航返工筛选草稿');await filter.focus();
 const handle=await filter.elementHandle();await start('editing-filter-not-stolen');await size(899);await page.waitForTimeout(40);await size(900);await expected('input[type="search"]');await finish('editing-filter-not-stolen',true);assert.equal(await filter.inputValue(),'导航返工筛选草稿');assert(await filter.evaluate((e,original)=>e===original,handle));
 await page.getByRole('button',{name:'记一笔',exact:true}).click();const draft=page.getByLabel('购买物或服务名称（必填）',{exact:true});await draft.fill('导航返工未提交');await draft.focus();const draftHandle=await draft.elementHandle();
 await start('real-expense-modal-not-stolen');for(const width of [899,900,899,900]){await size(width);await page.waitForTimeout(40);}await expected('#expense-name');await finish('real-expense-modal-not-stolen',true);assert.equal(await draft.inputValue(),'导航返工未提交');assert(await draft.evaluate((e,original)=>e===original,draftHandle));
 await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();
 assert.deepEqual(report.errors,[]);report.checks.push('filter-and-modal-dom-values-preserved','no-renderer-errors');report.ok=report.failures.length===0;
}catch(e){report.failures.push({id:'harness',error:e.stack});console.error(e);}finally{if(app)await app.close();save();}
console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,failures:report.failures.map(f=>f.id),traces:report.traces.length}));if(!report.ok)process.exitCode=1;
