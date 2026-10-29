/** Task B: isolated logical viewport / actual rAF geometry. No human smoothness claim. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES,'qa.cjs'))('playwright');
const out=process.env.BOOKKEEP_QA_OUTPUT;assert(out,'explicit evidence directory required');mkdirSync(out,{recursive:true});
const report={ok:false,checks:[],failures:[],geometry:[],samples:[],errors:[],http:0,localAppData:mkdtempSync(path.join(tmpdir(),'BookKeep 016 B synthetic '))};
let app,page;
const save=()=>writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
const check=(id,fn)=>{try{fn();report.checks.push(id);console.log('PASS '+id);}catch(e){report.failures.push({id,error:e.stack});console.log('FAIL '+id+' '+e.message);}};
const settle=()=>page.waitForTimeout(350);
async function launch(){
  app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT,'--force-device-scale-factor=1'],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:report.localAppData})});
  await app.evaluate(({session})=>{globalThis.qaNavHttp=0;globalThis.fetch=async()=>{globalThis.qaNavHttp++;throw Error('HTTP forbidden');};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{globalThis.qaNavHttp++;cb({cancel:true});});});
  page=await app.firstWindow();page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));await page.emulateMedia({colorScheme:null});await page.locator('[data-ledger-total]').waitFor();
}
async function close(){report.http+=await app.evaluate(()=>globalThis.qaNavHttp);await app.close();app=null;}
async function viewport(width,height=760){await app.evaluate(({BrowserWindow},{width,height})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(width,height);},{width,height});await settle();assert.equal(await page.evaluate(()=>innerWidth),width);}
const modeButton=()=>page.locator('.nav-mode-toggle');
async function mode(value){if(await page.locator('.app').getAttribute('data-nav-mode')!==value){await modeButton().click();await settle();}}
async function drawer(){await page.locator('.nav-toggle').click();await settle();}
async function nav(id){await page.locator(`[data-nav-item="${id}"]`).click();await page.locator('[data-main-transition][data-phase="stable"]').waitFor();}
async function geometry(label,compact=false){
  const g=await page.locator('#main-nav').evaluate(n=>{
    const rect=e=>e.getBoundingClientRect().toJSON(),ns=getComputedStyle(n),items=[...n.querySelectorAll('.nav-item')];
    return {viewport:[innerWidth,innerHeight],nav:rect(n),padding:[parseFloat(ns.paddingLeft),parseFloat(ns.paddingRight)],resizer:getComputedStyle(n.querySelector('.nav-resizer')).display,items:items.map(e=>{const v=e.querySelector('.nav-visual')??e,i=e.querySelector('svg'),l=e.querySelector('.nav-label');return {id:e.dataset.navItem,name:e.getAttribute('aria-label'),title:e.title,hit:rect(e),visual:rect(v),icon:rect(i),label:rect(l),font:getComputedStyle(e).fontSize,radius:getComputedStyle(v).borderRadius,labelOpacity:getComputedStyle(l).opacity};}),toggle:{hit:rect(n.querySelector('.nav-mode-toggle')??n.querySelector('button')),visual:rect(n.querySelector('.nav-mode-toggle .nav-visual')??n.querySelector('button')),icon:rect(n.querySelector('.nav-mode-toggle svg')??n.querySelector('svg'))},indicator:rect(n.querySelector('.nav-indicator'))};
  });report.geometry.push({label,...g});save();
  check(label,()=>{
    assert.deepEqual(g.items.map(x=>x.name),['账本','统计','AI记账','数据管理','成就','设置']);
    for(const item of [...g.items,g.toggle]){
      assert(item.hit.width>=44&&item.hit.height>=44,JSON.stringify(item));assert(Math.abs(item.visual.height-42.68)<.1,JSON.stringify(item));assert(Math.abs(item.icon.width-23.28)<.1);assert(Math.abs((item.icon.top+item.icon.bottom-item.visual.top-item.visual.bottom)/2)<=1);
      if(compact||item===g.toggle){assert(Math.abs((item.icon.left+item.icon.right-item.visual.left-item.visual.right)/2)<=1);}
      else {assert(Math.abs((item.icon.left+item.label.right-item.visual.left-item.visual.right)/2)<=1);}
      if(compact){assert(Math.abs(item.visual.width-42.68)<.1);assert.equal(item.visual.width,item.visual.height);if(item.radius)assert.equal(item.radius,'50%');}
      else assert(Math.abs(item.visual.width-item.hit.width*.97)<.1);
    }
    for(const item of g.items){assert.equal(item.font,'16.49px');assert.equal(item.title,item.name);}
    for(let i=1;i<4;i++)assert(Math.abs(g.items[i].hit.top-g.items[i-1].hit.bottom-10)<1);
    assert(g.items[0].hit.top>=g.toggle.hit.bottom+9);
    if(g.viewport[1]>=650)assert(Math.abs(g.nav.bottom-g.items.at(-1).hit.bottom-16)<=1);
    assert.equal(g.resizer,compact||g.viewport[0]<900?'none':'block');
    const selected=g.items.find(x=>x.id===documentSelected);assert(selected);
    assert(Math.abs(g.indicator.x-selected.visual.x)<=1&&Math.abs(g.indicator.y-selected.visual.y)<=1&&Math.abs(g.indicator.width-selected.visual.width)<=1&&Math.abs(g.indicator.height-selected.visual.height)<=1,JSON.stringify({indicator:g.indicator,selected}));
  });return g;
}
let documentSelected='ledger';
async function sample(id,actions,duration=650){
  const rows=await page.evaluate(({actions,duration})=>new Promise(resolve=>{
    const rows=[],start=performance.now();for(const a of actions)setTimeout(()=>document.querySelector(a.selector??'.nav-mode-toggle').click(),a.at);
    function frame(){const n=document.querySelector('#main-nav'),v=n.querySelector('.nav-item .nav-visual'),i=v?.querySelector('svg'),m=document.querySelector('.main'),r=n.getBoundingClientRect();rows.push({t:performance.now()-start,width:r.width,mainX:m.getBoundingClientRect().x,visual:v?.getBoundingClientRect().toJSON(),icon:i?.getBoundingClientRect().toJSON(),focus:{tag:document.activeElement?.tagName,id:document.activeElement?.id,label:document.activeElement?.getAttribute('aria-label'),hidden:!!document.activeElement?.closest('[hidden],[inert]')||!!document.activeElement&&['none'].includes(getComputedStyle(document.activeElement).display)||!!document.activeElement&&getComputedStyle(document.activeElement).visibility==='hidden'},radius:v?getComputedStyle(v).borderRadius:null,labelOpacity:v?getComputedStyle(v.querySelector('.nav-label')).opacity:null,indicator:document.querySelector('.nav-indicator').getBoundingClientRect().toJSON(),toggle:n.querySelector('.nav-mode-toggle .nav-visual')?.getBoundingClientRect().toJSON(),toggleIcon:n.querySelector('.nav-mode-toggle svg')?.getBoundingClientRect().toJSON(),mode:document.querySelector('.app').dataset.navMode,route:document.querySelector('.app').dataset.nav,phase:document.querySelector('[data-main-transition]').dataset.phase,pages:document.querySelectorAll('[data-main-transition] > .page:not([hidden])').length});if(performance.now()-start<duration)requestAnimationFrame(frame);else resolve(rows);}requestAnimationFrame(frame);
  }),{actions,duration});report.samples.push({id,rows});save();return rows;
}
try{
  await launch();await viewport(1400);
  report.initialNames=await page.locator('[data-nav-item]').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));
  check('only-ledger-navigation-renamed',()=>assert.deepEqual(report.initialNames,['账本','统计','AI记账','数据管理','成就','设置']));
}catch(e){report.failures.push({id:'harness-initial',error:e.stack});}
// Initial checks deliberately continue to preserve all old-input findings.
const awaitedToggleCount=page?await modeButton().count():0;
try{
  check('mode-button-and-svg',()=>assert.equal(awaitedToggleCount,1));
  await geometry('first-default-detailed');
  if(!awaitedToggleCount)throw Error('Task B mode button absent in input');
  check('first-use-detailed',()=>assert.equal(report.geometry[0].nav.width,176));
  for(const width of [900,1199,1200,1400]){
    await viewport(width);await mode('detailed');
    for(const [key,size] of [['Home',160],['End',280]]){await page.locator('.nav-resizer').focus();await page.keyboard.press(key);await settle();assert.equal(Math.round((await page.locator('#main-nav').boundingBox()).width),size);await geometry(`detailed-${width}-${size}`);}
    await page.locator('.nav-resizer').dblclick();await settle();await geometry(`detailed-${width}-176`);
    await mode('compact');assert.equal(Math.round((await page.locator('#main-nav').boundingBox()).width),56);await geometry(`compact-${width}`,true);
  }
  await mode('detailed');
  const reverse=await sample('rapid-reverse',[{at:0},{at:90},{at:165}]);
  check('actual-intermediate-frames-and-reversal',()=>{assert(reverse.some(r=>r.width>57&&r.width<175));assert(reverse.some(r=>r.t>90&&r.t<165&&r.mode==='detailed'));assert.equal(Math.round(reverse.at(-1).width),56);for(let i=1;i<reverse.length;i++){if(reverse[i].t-reverse[i-1].t<35)assert(Math.abs(reverse[i].width-reverse[i-1].width)<2*(reverse[i].t-reverse[i-1].t)+3);}assert(reverse.every(r=>Math.abs(r.mainX-r.width)<=1&&r.route==='ledger'&&r.phase==='stable'&&r.pages===1));});
  for(const row of reverse){assert(Math.abs(row.indicator.width-row.visual.width)<=1);assert(Math.abs(row.toggle.width-row.visual.width)<=1);assert(Math.abs((row.toggleIcon.left+row.toggleIcon.right-row.toggle.left-row.toggle.right)/2)<=1);}check('mode-toggle-and-indicator-synchronized-through-frames',()=>{});
  assert.equal(await page.locator('.nav-mode-toggle svg path').count(),3);assert.equal(await page.getByRole('heading',{name:'记账',exact:true}).count(),1);
  await page.screenshot({path:path.join(out,'compact-final.png')});
  await mode('detailed');
  const captured=sample('captured-mode-morph',[{at:0}],700);
  for(let i=0;i<4;i++){await page.waitForTimeout(45);await page.screenshot({path:path.join(out,`morph-${i}.png`),animations:'allow'});}
  await captured;await mode('detailed');
  await page.getByRole('button',{name:/筛选支出/}).click();await page.getByLabel('名称搜索',{exact:true}).fill('B未提交筛选');
  const filterNode=await page.getByLabel('名称搜索',{exact:true}).elementHandle();await mode('compact');await mode('detailed');
  assert.equal(await page.getByLabel('名称搜索',{exact:true}).inputValue(),'B未提交筛选');assert(await page.getByLabel('名称搜索',{exact:true}).evaluate((e,original)=>e===original,filterNode));
  check('ledger-filter-and-dom-preserved',()=>{});
  await page.getByRole('button',{name:'记一笔',exact:true}).click();await page.getByLabel('购买物或服务名称（必填）',{exact:true}).fill('B未提交草稿');
  await page.evaluate(()=>{window.qaDraft=document.querySelector('#expense-name');document.querySelector('.nav-mode-toggle').click();});await settle();
  assert.equal(await page.getByLabel('购买物或服务名称（必填）',{exact:true}).inputValue(),'B未提交草稿');assert(await page.evaluate(()=>window.qaDraft===document.querySelector('#expense-name')));
  await page.evaluate(()=>document.querySelector('.nav-mode-toggle').click());await settle();
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();
  check('manual-draft-dom-and-value-preserved',()=>{});
  const selection=await sample('selection-240ms-retarget',[{at:0,selector:'[data-nav-item="statistics"]'},{at:65,selector:'[data-nav-item="data"]'},{at:110,selector:'[data-nav-item="settings"]'}]);await page.locator('[data-main-transition][data-phase="stable"]').waitFor();documentSelected='settings';const selected=await page.locator('[data-nav-item="settings"] .nav-visual').boundingBox();assert(new Set(selection.map(r=>Math.round(r.indicator.y))).size>5);assert(Math.abs(selection.at(-1).indicator.y-selected.y)<=1);check('selection-intermediate-frames-and-retarget-final-alignment',()=>{});
  await page.locator('.main').evaluate(e=>e.scrollTop=e.scrollHeight);const scroll=await page.locator('.main').evaluate(e=>e.scrollTop);
  await page.evaluate(()=>{window.qaPage=document.querySelector('.main-content-transition > .page:not([hidden])');window.qaMounts=0;window.qaObserver=new MutationObserver(records=>{for(const r of records)for(const e of r.removedNodes)if(e===window.qaPage)window.qaMounts++;});window.qaObserver.observe(document.querySelector('.main-content-transition'),{childList:true});});
  await mode('compact');await mode('detailed');
  check('page-scroll-and-mount-preserved',()=>assert(scroll>0));assert.equal(await page.locator('.main').evaluate(e=>e.scrollTop),scroll);assert.equal(await page.evaluate(()=>window.qaMounts),0);
  for(const theme of ['light','dark','system']){await page.getByLabel('界面主题',{exact:true}).selectOption(theme);await settle();await geometry('theme-'+theme);await mode('compact');await geometry('theme-'+theme+'-compact',true);await mode('detailed');}
  await page.screenshot({path:path.join(out,'detailed-final.png')});
  await page.emulateMedia({reducedMotion:'reduce'});await mode('compact');
  check('reduced-motion-immediate',()=>{});assert.equal(await page.locator('.app').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');await page.emulateMedia({reducedMotion:'no-preference'});
  await viewport(899);await drawer();await geometry('899-detailed-drawer');
  assert.equal(await page.locator('.app').getAttribute('data-nav-mode'),'compact');assert.equal(await page.locator('.main').evaluate(e=>e.inert),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.nav-toggle').evaluate(e=>e===document.activeElement),true);assert.equal(await page.locator('#main-nav').evaluate(e=>e.inert),true);
  await drawer();await modeButton().click();await settle();assert.equal(await page.locator('.nav-toggle').evaluate(e=>e===document.activeElement),true);
  await drawer();await page.locator('.backdrop').click({position:{x:500,y:100}});await settle();assert.equal(await page.locator('#main-nav').getAttribute('data-open'),'false');
  await drawer();await page.locator('[data-nav-item="settings"]').focus();await viewport(900);assert.equal(await page.locator('#main-nav').getAttribute('data-open'),'false');assert.equal(await page.locator('.main').evaluate(e=>e.inert),false);await geometry('900-restores-compact',true);
  check('drawer-close-escape-backdrop-focus-and-breakpoint',()=>{});
  await mode('detailed');const crossing=sample('reverse-across-breakpoint',[{at:0},{at:70}],650);await page.waitForTimeout(105);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(899,650));await page.waitForTimeout(80);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,650));const crossingRows=await crossing;assert(crossingRows.every(r=>!r.focus.hidden),'focus must not remain in a hidden or inert region during breakpoint crossing');await settle();assert.equal(await page.locator('#main-nav').getAttribute('data-open'),'false');assert.equal(await page.locator('.app').getAttribute('data-nav-mode'),'detailed');assert.equal(await page.locator('#main-nav').evaluate(e=>e.inert),false);assert(await page.evaluate(()=>!document.activeElement?.closest('[hidden],[inert]')&&getComputedStyle(document.activeElement).display!=='none'&&getComputedStyle(document.activeElement).visibility!=='hidden'));check('crossing-mid-transition-cleanup-and-visible-focus',()=>{});
  await viewport(1400,480);for(const m of ['detailed','compact']){await mode(m);for(const id of ['ledger','statistics','ai','data','achievements','settings']){const b=page.locator(`[data-nav-item="${id}"]`);await b.focus();await b.scrollIntoViewIfNeeded();assert(await b.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));}}check('low-height-six-menus-reachable',()=>{});
  await viewport(899,480);await drawer();for(const id of ['ledger','statistics','ai','data','achievements','settings']){const b=page.locator(`[data-nav-item="${id}"]`);await b.focus();await b.scrollIntoViewIfNeeded();assert(await b.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=44&&r.bottom<=innerHeight;}));}await page.keyboard.press('Escape');check('low-height-drawer-six-menus-reachable',()=>{});
  await viewport(1800,480);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));await settle();assert.equal(await page.evaluate(()=>innerWidth),900);await mode('compact');await page.locator('#main-nav').evaluate(e=>e.scrollTop=0);await geometry('compact-low-height-240-css',true);assert(await page.locator('#main-nav').evaluate(e=>e.scrollWidth<=e.clientWidth));
  for(const button of await page.locator('[data-nav-item]').all()){await button.focus();await button.scrollIntoViewIfNeeded();assert(await button.evaluate(e=>{const r=e.getBoundingClientRect(),n=e.closest('nav').getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=n.left&&r.right<=n.right&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));}check('low-height-compact-scroll-keeps-hit-areas-and-contours-aligned',()=>{});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));await settle();
  await viewport(1400);await mode('detailed');await page.locator('.nav-resizer').focus();await page.keyboard.press('End');await settle();await mode('compact');
  await viewport(899);await drawer();assert.equal(Math.round((await page.locator('#main-nav').boundingBox()).width),280);assert.equal(await page.locator('.app').getAttribute('data-nav-mode'),'compact');await viewport(900);await mode('detailed');assert.equal(Math.round((await page.locator('#main-nav').boundingBox()).width),280);check('drawer-uses-saved-detailed-width-without-overwriting-mode',()=>{});
  await mode('compact');await close();await launch();await viewport(1400);assert.equal(await page.locator('.app').getAttribute('data-nav-mode'),'compact');await mode('detailed');assert.equal(Math.round((await page.locator('#main-nav').boundingBox()).width),280);check('mode-and-nondefault-width-restart',()=>{});
  await page.evaluate(()=>{localStorage.setItem('bookkeep.navMode','bad');localStorage.setItem('bookkeep.sidebarWidth','999');});await close();await launch();await viewport(1400);assert.equal(await page.locator('.app').getAttribute('data-nav-mode'),'detailed');assert.equal(Math.round((await page.locator('#main-nav').boundingBox()).width),176);check('invalid-preferences-default',()=>{});
  await page.addInitScript(()=>{Object.defineProperty(Storage.prototype,'getItem',{value(){throw Error('read denied');},configurable:true});Object.defineProperty(Storage.prototype,'setItem',{value(){throw Error('write denied');},configurable:true});});
  await page.reload();await page.locator('[data-ledger-total]').waitFor();await settle();assert.equal(await page.locator('.app').getAttribute('data-nav-mode'),'detailed');await mode('compact');await mode('detailed');check('storage-read-and-write-failure-session-switch',()=>{});
  assert.deepEqual(report.errors,[]);check('page-health',()=>{});report.ok=report.failures.length===0;
}catch(e){report.failures.push({id:'harness',error:e.stack});console.error(e);}
finally{if(app)await close();save();}
if(!report.ok)process.exitCode=1;
