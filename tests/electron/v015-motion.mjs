/** 0.1.5 isolated renderer regression. Dynamic rAF samples, never a human smoothness claim. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const modules=process.env.BOOKKEEP_QA_NODE_MODULES??'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {_electron}=createRequire(path.join(modules,'qa.cjs'))('playwright');
const out=path.resolve(process.env.BOOKKEEP_QA_OUTPUT??'evidence/V0.1.5/red-motion');mkdirSync(out,{recursive:true});
const localAppData=mkdtempSync(path.join(tmpdir(),'BookKeep 015 synthetic '));
const result={ok:false,localAppData,checks:[],samples:[],errors:[],console:[],http:0};
let app,page;
const check=(id,data)=>{result.checks.push({id,data});console.log('PASS '+id);};
const settle=()=>page.waitForTimeout(280);
async function nav(id){const toggle=page.getByRole('button',{name:'菜单',exact:true});if(await toggle.isVisible()&&await page.locator('#main-nav').getAttribute('data-open')!=='true')await toggle.click();await page.locator(`[data-nav-item="${id}"]`).click();await settle();}
try{
 app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT,'--force-device-scale-factor=1'],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});
 await app.evaluate(({session,BrowserWindow})=>{globalThis.qaHttp=0;globalThis.fetch=async()=>{globalThis.qaHttp++;throw Error('HTTP forbidden');};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{globalThis.qaHttp++;cb({cancel:true});});BrowserWindow.getAllWindows()[0].setContentSize(1400,850);});
 page=await app.firstWindow();await page.emulateMedia({colorScheme:null});page.setDefaultTimeout(10000);page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))result.console.push(m.text());});await page.locator('[data-ledger-total]').waitFor();
 const g=await page.locator('[data-nav-item="ledger"]').evaluate(e=>({font:getComputedStyle(e).fontSize,icon:e.querySelector('svg').getBoundingClientRect().width,min:getComputedStyle(e).minHeight}));
 assert.equal(g.font,'17px');assert.equal(g.icon,24);assert.equal(g.min,'44px');check('menu-17-24-44',g);
 assert.equal(await page.locator('.ledger-empty-book').innerText(),'还没有支出，记下第一笔吧');
 await page.getByRole('button',{name:'已删除记录',exact:true}).click();await page.getByText('暂无已删除记录',{exact:true}).waitFor();
 const empty=await page.locator('.ledger-empty-deleted').evaluate(e=>{const b=e.getBoundingClientRect(),m=document.querySelector('.main').getBoundingClientRect(),s=document.querySelector('.ledger-summary').getBoundingClientRect(),p=e.querySelector('p').getBoundingClientRect();return {weight:getComputedStyle(e.querySelector('p')).fontWeight,center:[p.x+p.width/2,p.y+p.height/2],expected:[b.x+b.width/2,b.y+b.height/2],box:b.toJSON(),main:m.toJSON(),summary:s.toJSON()};});
 assert.equal(empty.weight,'400');assert(Math.abs(empty.center[1]-empty.expected[1])<1);assert(empty.box.bottom>empty.main.bottom-30);assert.equal(await page.getByText('已删除记录：此处金额不计入正式统计。',{exact:true}).count(),0);check('deleted-plain-centered',empty);
 await nav('statistics');await page.locator('[data-statistics-total]').waitFor();
 assert.equal(await page.locator('.statistics-page .segment-indicator').count(),1);
 await nav('ai');assert.equal(await page.locator('.ai-switcher .segment-indicator').count(),1);
 check('two-independent-sliders');
 const sample=async(selector,actions,duration=450)=>page.evaluate(({selector,actions,duration})=>new Promise(resolve=>{
  const rows=[],start=performance.now(),surface=document.querySelector('[data-main-transition]');
  for(const a of actions)setTimeout(()=>document.querySelector(a.selector)?.click(),a.at);
  function frame(){const now=performance.now(),e=document.querySelector(selector),r=e?.getBoundingClientRect(),s=e?getComputedStyle(e):null,main=getComputedStyle(surface),nav=document.querySelector('#main-nav').getBoundingClientRect(),top=document.querySelector('.topbar').getBoundingClientRect();rows.push({t:now-start,x:r?.x,y:r?.y,width:r?.width,transform:s?.transform,opacity:s?.opacity,phase:surface.dataset.phase,route:document.querySelector('.app').dataset.nav,inert:surface.inert,mainOpacity:+main.opacity,mainTransform:main.transform,pages:document.querySelectorAll('.main-content-transition > .page:not([hidden])').length,focusHidden:!!document.activeElement?.closest('[hidden],[inert]'),nav:[nav.x,nav.y],top:[top.x,top.y],animations:surface.getAnimations().map(a=>a.effect.getTiming().duration)});if(now-start<duration)requestAnimationFrame(frame);else resolve(rows);}requestAnimationFrame(frame);
 }),{selector,actions,duration});
 const segment=(group,label)=>`[aria-label="${group}"] button:nth-of-type(${label})`;
 for(const mode of ['light','dark']){
  await nav('settings');await page.getByLabel('界面主题',{exact:true}).selectOption(mode);await settle();assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches),mode==='dark');
  assert.equal(await page.locator('.app').evaluate(e=>getComputedStyle(e).backgroundColor),mode==='dark'?'rgb(15, 15, 15)':'rgb(245, 247, 251)');check(mode+'-native-theme-reaches-whole-app');
  await page.screenshot({path:path.join(out,mode+'-settings.png')});await nav('ai');await page.getByRole('group',{name:'AI记账子页'}).getByRole('button',{name:'图片导入',exact:true}).click();await settle();
  const ai=await sample('.ai-switcher .segment-indicator',[{at:0,selector:segment('AI记账子页',3)},{at:55,selector:segment('AI记账子页',1)},{at:95,selector:segment('AI记账子页',2)},{at:125,selector:segment('AI记账子页',3)}]);
  result.samples.push({id:mode+'-AI-reverse',rows:ai});assert(ai.some(r=>r.x>ai[0].x+1&&r.x<ai.at(-1).x-1));assert(ai.every(r=>r.mainTransform==='none'&&r.phase==='stable'));assert.equal(await page.locator('.app').getAttribute('data-nav'),'review');
  const aiBox=await page.locator('.ai-switcher button[aria-pressed="true"]').boundingBox();assert(Math.abs(ai.at(-1).x-aiBox.x)<1);assert(Math.abs(ai.at(-1).width-aiBox.width)<1);check(mode+'-AI-slider-intermediate-reverse-no-main-displacement',{frames:ai.length});
  await nav('statistics');await page.locator('[data-statistics-total]').waitFor();await page.getByRole('group',{name:'统计周期'}).getByRole('button',{name:'月',exact:true}).click();await settle();
  const stat=await sample('.statistics-page .segment-indicator',[{at:0,selector:segment('统计周期',3)},{at:55,selector:segment('统计周期',1)},{at:95,selector:segment('统计周期',2)},{at:125,selector:segment('统计周期',3)}]);result.samples.push({id:mode+'-statistics-reverse',rows:stat});
  assert(new Set(stat.map(r=>Math.round(r.x))).size>5);const sb=await page.locator('[aria-label="统计周期"] button[aria-pressed="true"]').boundingBox();assert(Math.abs(stat.at(-1).x-sb.x)<1);check(mode+'-statistics-slider-intermediate-reverse',{frames:stat.length});
  await page.screenshot({path:path.join(out,mode+'-statistics.png')});
  const mains=await sample('[data-main-transition]',[{at:0,selector:'[data-nav-item="data"]'},{at:300,selector:'[data-nav-item="achievements"]'},{at:600,selector:'[data-nav-item="settings"]'},{at:900,selector:'[data-nav-item="ledger"]'},{at:1200,selector:'[data-nav-item="ai"]'},{at:1500,selector:'[data-nav-item="statistics"]'}],1800);result.samples.push({id:mode+'-all-main-pages',rows:mains});
  assert(mains.every(r=>r.pages===1&&!r.focusHidden));assert(mains.filter(r=>r.phase==='leaving').every(r=>r.inert));assert(mains.some(r=>r.mainOpacity>0&&r.mainOpacity<1));assert(mains.some(r=>r.mainTransform!=='none'&&+r.mainTransform.split(',').at(-1).replace(')','')>0));assert(mains.some(r=>r.animations.includes(60)));assert(mains.some(r=>r.animations.includes(160)));assert(mains.every(r=>JSON.stringify(r.nav)===JSON.stringify(mains[0].nav)&&JSON.stringify(r.top)===JSON.stringify(mains[0].top)));check(mode+'-six-pages-60-160-inert-fixed-shell',{frames:mains.length});
  const rapid=await sample('[data-main-transition]',[{at:0,selector:'[data-nav-item="data"]'},{at:20,selector:'[data-nav-item="settings"]'},{at:40,selector:'[data-nav-item="ledger"]'},{at:95,selector:'[data-nav-item="ai"]'},{at:115,selector:'[data-nav-item="achievements"]'}]);result.samples.push({id:mode+'-main-retarget',rows:rapid});assert.equal(rapid.at(-1).route,'achievements');assert(rapid.every(r=>r.pages===1));assert(!rapid.some(r=>['data','settings'].includes(r.route)));check(mode+'-rapid-targets-never-mount-obsolete-pages');
 }
 // A resize changes actual button coordinates; both indicators remeasure without a remount.
 for(const [width,height] of [[1000,650],[680,500],[1400,850]]){
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),[width,height]);await settle();
  await nav('ai');await page.getByRole('group',{name:'AI记账子页'}).getByRole('button',{name:'任务队列',exact:true}).click();await settle();
  const aligned=await page.locator('.ai-switcher').evaluate(e=>{const b=e.querySelector('[aria-pressed="true"]').getBoundingClientRect(),i=e.querySelector('.segment-indicator').getBoundingClientRect();return {dx:i.x-b.x,dy:i.y-b.y,dw:i.width-b.width};});assert(Object.values(aligned).every(v=>Math.abs(v)<1));check('resize-AI-alignment-'+width,aligned);
  await nav('statistics');await page.locator('[data-statistics-total]').waitFor();
  const statAligned=await page.locator('[aria-label="统计周期"]').evaluate(e=>{const b=e.querySelector('[aria-pressed="true"]').getBoundingClientRect(),i=e.querySelector('.segment-indicator').getBoundingClientRect();return {dx:i.x-b.x,dy:i.y-b.y,dw:i.width-b.width,duration:getComputedStyle(e.querySelector('.segment-indicator')).transitionDuration};});assert(['dx','dy','dw'].every(k=>Math.abs(statAligned[k])<1));assert(statAligned.duration.includes('0.2s'));check('resize-statistics-alignment-'+width,statAligned);
 }
 await page.emulateMedia({reducedMotion:'reduce',colorScheme:null});await settle();
 const reduced=await sample('[data-main-transition]',[{at:0,selector:'[data-nav-item="settings"]'},{at:50,selector:'[data-nav-item="ledger"]'}],100);result.samples.push({id:'reduced-motion',rows:reduced});assert(reduced.every(r=>r.phase==='stable'&&r.mainTransform==='none'&&r.mainOpacity===1&&r.animations.length===0));
 await nav('statistics');assert.equal(await page.locator('.segment-indicator').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');check('reduced-motion-immediate-main-and-sliders');await page.emulateMedia({reducedMotion:'no-preference',colorScheme:null});
 const repeated=await sample('[data-main-transition]',[{at:0,selector:'[data-nav-item="statistics"]'}],150);assert(repeated.every(r=>r.phase==='stable'&&r.animations.length===0));check('same-page-does-not-replay');
 await nav('settings');await page.getByRole('button',{name:'打开数据管理',exact:true}).click();await page.locator('[data-nav="data"]').waitFor();await settle();check('settings-internal-navigation-shares-transition');
 await nav('ledger');await page.getByRole('button',{name:'记一笔',exact:true}).click();const modal=page.getByRole('dialog',{name:'记一笔',exact:true});await modal.getByLabel('购买物或服务名称（必填）',{exact:true}).fill('尚未保存的合成');
 await page.locator('[data-nav-item="statistics"]').evaluate(e=>e.click());const guard=page.getByRole('dialog',{name:'有未保存的修改',exact:true});await guard.waitFor();assert.equal(await page.locator('[data-main-transition]').getAttribute('data-phase'),'stable');await guard.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await modal.getByLabel('购买物或服务名称（必填）',{exact:true}).inputValue(),'尚未保存的合成');check('ledger-guard-cancel-keeps-page-before-animation');
 await page.locator('[data-nav-item="statistics"]').evaluate(e=>e.click());await guard.getByRole('button',{name:'放弃修改',exact:true}).click();await page.locator('[data-nav="statistics"]').waitFor();await settle();check('ledger-discard-before-main-transition');
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.console,[]);
 result.ok=true;
}catch(e){result.failure=e.stack;console.error(e);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{if(app){result.http=await app.evaluate(()=>globalThis.qaHttp);await app.close();}writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));}
if(!result.ok)process.exitCode=1;
