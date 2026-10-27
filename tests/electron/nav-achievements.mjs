/** Step A self-test: real isolated Electron, synthetic fixture, logical sizes only.
 * Browser plugin not available; use the project's existing Playwright Electron workflow.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';
const require = createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES ?? path.join(ROOT,'node_modules'),'qa.cjs'));
const { _electron } = require('playwright');
const output = path.resolve(process.env.BOOKKEEP_QA_OUTPUT ?? path.join(ROOT,'.tmp/nav-achievements'));
const appRoot = path.resolve(process.env.BOOKKEEP_QA_APP_ROOT ?? ROOT);
mkdirSync(output,{recursive:true});
const localAppData = mkdtempSync(path.join(tmpdir(),'BookKeep 014 A synthetic '));
const ids = ['ledger','statistics','ai','data','achievements','settings'];
const names = ['记账','统计','AI记账','数据管理','成就','设置'];
const report = {ok:false,localAppData,checks:[],rows:[],screens:[],windows:[],errors:[],console:[],http:0,
  kind:'Step A implementation self-test; logical viewports, not native DPI or human/reader acceptance',
  browser:'Browser plugin not available; existing project Playwright Electron workflow'};
let app,page;
const save = (name,data) => writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n');
const check = (id,actual) => {report.checks.push({id,actual,ok:true});console.log('PASS '+id);};
const settle = () => page.waitForTimeout(320);
const invoke = async (method,input) => {
  const r = await page.evaluate(({method,input})=>{const [g,m]=method.split('.');return window.bookkeep[g][m](input);},{method,input});
  assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;
};
async function launch(){
  app = await _electron.launch({executablePath:electronExecutable(),args:[appRoot,'--force-device-scale-factor=1'],cwd:appRoot,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});
  await app.evaluate(({session})=>{
    globalThis.navQaHttp=0;
    globalThis.fetch=async()=>{globalThis.navQaHttp++;throw Error('External HTTP forbidden in navigation QA');};
    session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{globalThis.navQaHttp++;cb({cancel:true});});
  });
  page=await app.firstWindow();page.setDefaultTimeout(10000);
  await page.emulateMedia({colorScheme:null});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(['error','warning'].includes(m.type()))report.console.push(m.text());});
  await page.locator('[data-ledger-total]').waitFor();
}
async function close(){report.http+=await app.evaluate(()=>globalThis.navQaHttp);await app.close();app=null;}
async function viewport(width,height,zoom=1){
  await app.evaluate(({BrowserWindow},{width,height,zoom})=>{
    const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.webContents.setZoomFactor(zoom);
    if(width===640&&height===480)w.setSize(width,height);else w.setContentSize(width,height);
  },{width,height,zoom});await settle();
  report.windows.push(await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const w=BrowserWindow.getAllWindows()[0];return {requested:{width,height,zoom,sizeKind:width===640&&height===480?'outer minimum':'content'},bounds:w.getBounds(),contentSize:w.getContentSize(),minimum:w.getMinimumSize(),zoom:w.webContents.getZoomFactor()};},{width,height,zoom}));
  return page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));
}
async function openDrawer(keyboard=false){
  if(await page.getByRole('button',{name:'菜单',exact:true}).isVisible()&&await page.locator('#main-nav').getAttribute('data-open')!=='true'){
    const toggle=page.getByRole('button',{name:'菜单',exact:true});
    if(keyboard){await toggle.focus();await page.keyboard.press('Enter');}else await toggle.click();
    await settle();
  }
}
async function nav(id){await openDrawer();await page.locator(`[data-nav-item="${id}"]`).click();await settle();}
async function screen(name){
  const c=await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0],im=await w.webContents.capturePage();return {png:im.toPNG().toString('base64'),pixels:im.getSize(),contentSize:w.getContentSize(),zoom:w.webContents.getZoomFactor()};});
  writeFileSync(path.join(output,name+'.png'),Buffer.from(c.png,'base64'));delete c.png;
  report.screens.push({name,...c,logical:await page.evaluate(()=>({width:innerWidth,height:innerHeight}))});
}
async function reachable(button){
  const r=await button.evaluate(el=>{const b=el.getBoundingClientRect(),n=el.closest('nav').getBoundingClientRect(),s=getComputedStyle(el);return {name:el.getAttribute('aria-label'),focus:document.activeElement===el,top:b.top,bottom:b.bottom,left:b.left,right:b.right,nav:n.toJSON(),outline:s.outlineStyle,hit:el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};});
  assert(r.focus,JSON.stringify(r));assert(r.top>=r.nav.top-1&&r.bottom<=r.nav.bottom+1,JSON.stringify(r));
  assert(r.left>=r.nav.left&&r.right<=r.nav.right+1,JSON.stringify(r));assert(r.hit,JSON.stringify(r));assert.notEqual(r.outline,'none');return r;
}
async function menu(label){
  await openDrawer(true);await page.locator('#main-nav').evaluate(el=>{el.scrollTop=0;});await settle();
  const g=await page.locator('#main-nav').evaluate(n=>{
    const a=[...n.querySelectorAll('.nav-item')],rects=a.map(e=>e.getBoundingClientRect()),box=n.getBoundingClientRect(),s=getComputedStyle(n);
    return {viewport:[innerWidth,innerHeight],nav:box.toJSON(),scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,top:rects[0].top-box.top-parseFloat(s.paddingTop),bottom:box.bottom-rects.at(-1).bottom-parseFloat(s.paddingBottom),
      gaps:rects.slice(1).map((r,i)=>r.top-rects[i].bottom),ids:a.map(e=>e.dataset.navItem),bottomIds:[...n.querySelectorAll('.nav-bottom .nav-item')].map(e=>e.dataset.navItem),
      styles:a.map(e=>{const b=e.getBoundingClientRect(),svg=e.querySelector('svg'),i=svg.getBoundingClientRect(),l=e.querySelector('.nav-label'),t=l.getBoundingClientRect(),show=getComputedStyle(l).display!=='none';return {font:getComputedStyle(e).fontSize,labelFont:getComputedStyle(l).fontSize,icon:[i.width,i.height],slug:svg.dataset.iconSlug,center:Math.abs(((show?Math.min(i.left,t.left):i.left)+(show?Math.max(i.right,t.right):i.right)-b.left-b.right)/2),labelClipped:show&&l.scrollWidth>l.clientWidth};})};
  });
  report.rows.push({label,...g});save('geometry.json',report.rows);
  assert.deepEqual(g.ids,ids);assert.deepEqual(g.bottomIds,['achievements','settings']);
  assert(Math.abs(g.top)<=1,JSON.stringify(g));
  assert(g.gaps.every((x,i)=>i===3?x>=9:Math.abs(x-10)<=1),JSON.stringify(g));
  if(g.scrollHeight<=g.clientHeight+1)assert(Math.abs(g.bottom)<=1,JSON.stringify(g));
  for(const s of g.styles){assert.equal(s.font,'17px');assert.equal(s.labelFont,'17px');assert.deepEqual(s.icon,[24,24]);assert(s.center<=1,JSON.stringify(s));assert(!s.labelClipped);}
  assert.equal(g.styles[4].slug,'party-popper');
  const focus=[];await page.locator('[data-nav-item="ledger"]').focus();
  // Establish keyboard modality; programmatic focus after a mouse click is not :focus-visible.
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  for(let i=0;i<ids.length;i++){
    if(i)await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-nav-item')),ids[i]);
    focus.push(await reachable(page.locator(`[data-nav-item="${ids[i]}"]`)));
  }
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-nav-item')),'achievements');
  await page.keyboard.press('Enter');await page.locator('[data-nav="achievements"]').waitFor();
  assert.equal(await page.getByRole('heading',{name:'成就',exact:true}).count(),1);
  const achievements=page.locator('[data-achievements-stage="complete"]');assert(await achievements.isVisible());
  await page.locator('.achievement-card').first().waitFor();assert.equal(await page.locator('.achievement-card').count(),10);
  assert((await achievements.innerText()).includes('已解锁 0 / 10')); // This regression owns a verified empty synthetic ledger.
  assert.equal(await page.locator('[data-nav-item="achievements"]').getAttribute('aria-current'),'page');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  check('menu-'+label,{viewport:g.viewport,scrollRequired:g.scrollHeight>g.clientHeight,focus});
}
async function fixture(){
  const file=path.join(localAppData,'synthetic.png');writeFileSync(file,await sharp({create:{width:360,height:240,channels:3,background:'#eeeeee'}}).png().toBuffer());
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  const tokens=await invoke('image.select',{}),imported=await invoke('image.import',{selectionTokens:tokens.tokens,retention:'keep_original'}),asset=imported.results[0].asset;
  const prepared=await invoke('image.prepare',{imageAssetId:asset.id,expectedVersion:asset.version,crop:null,masks:[],retainOriginal:true});
  return app.evaluate(({app},asset)=>{
    const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),Db=require('better-sqlite3'),{randomUUID}=require('node:crypto');
    const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),active=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),db=new Db(path.join(root,'data/generations',active.generationId,'ledger.db'));
    try{const job=randomUUID(),id=randomUUID(),now=new Date().toISOString(),p={amountFen:9900,occurredDate:'2026-09-09',occurredTime:null,timePrecision:'date',name:'导航合成商品',merchant:null,categoryId:'cat_food',transactionKind:'expense',amountBasis:'line_payment',groupKey:randomUUID(),lineItems:[],evidence:[],missingFields:[],warnings:[],confidence:1};
      db.pragma('foreign_keys=ON');db.transaction(()=>{
        db.prepare("insert into import_job(id,ledger_id,image_asset_id,prepared_hash,status,provider,model,prompt_version,schema_version,categories_json,consent_json,force_new,created_at,updated_at,finished_at,candidate_count) values(?,?,?,?, 'completed','mock','synthetic-nav','bk-receipt.s10.v1','bk-candidate.v1','[]','[]',0,?,?,?,1)").run(job,active.ledgerId,asset.id,asset.preparedHash,now,now,now);
        db.prepare("insert into candidate(id,ledger_id,job_id,image_asset_id,prepared_hash,ordinal,proposal_json,current_json,evidence_json,missing_json,warnings_json,duplicates_json,blocking,excluded_by_default,created_at,updated_at) values(?,?,?,?,?,0,?,?,'[]','[]','[]','[]',0,0,?,?)").run(id,active.ledgerId,job,asset.id,asset.preparedHash,JSON.stringify(p),JSON.stringify(p),now,now);
      })();return id;
    }finally{db.close();}
  },prepared);
}
async function sql(){return app.evaluate(({app})=>{
  const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),Db=require('better-sqlite3');
  const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),active=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),db=new Db(path.join(root,'data/generations',active.generationId,'ledger.db'),{readonly:true});
  try{return {formal:db.prepare('select count(*) n from "transaction"').get().n,postings:db.prepare('select count(*) n from review_posting').get().n,candidates:db.prepare('select * from candidate').all(),attempts:db.prepare('select total_attempts from import_job').all(),quick:db.pragma('quick_check'),fk:db.pragma('foreign_key_check')};}finally{db.close();}
});}
try{
  await launch();assert.equal(await page.title(),'BookKeepAI');assert((await page.url()).startsWith('bookkeep://app/'));assert.equal(await page.locator('vite-error-overlay').count(),0);
  assert.deepEqual(await page.locator('[data-nav-item]').allTextContents(),names);check('identity-six-entries-no-error-overlay');
  report.minimum=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getMinimumSize());assert.deepEqual(report.minimum,[640,480]);
  for(const theme of ['light','dark']){
    await viewport(1450,900);await nav('settings');await page.getByLabel('界面主题',{exact:true}).selectOption(theme);await settle();
    assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches),theme==='dark');
    const handle=page.getByRole('separator',{name:'调整侧栏宽度'});
    for(const width of [176,160,240,280]){
      await handle.focus();await page.keyboard.press(width===280?'End':'Home');
      for(let n=160;n<width&&width!==280;n+=8)await page.keyboard.press('ArrowRight');
      await settle();assert.equal(await handle.getAttribute('aria-valuenow'),String(width));
      await menu(theme+'-expanded-'+width);assert(Math.abs((await page.locator('#main-nav').boundingBox()).width-width)<=1);
    }
    await screen(theme+'-expanded');
    await viewport(1000,650);await menu(theme+'-rail');
    assert.equal(await page.locator('.nav-label').first().isVisible(),false);await screen(theme+'-rail');
    await viewport(680,650);await menu(theme+'-drawer');
    assert.equal(await page.locator('#main-nav').getAttribute('data-open'),'false');await openDrawer();await screen(theme+'-drawer');
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'菜单',exact:true}).evaluate(el=>document.activeElement===el),true);
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#main-nav')),false);check(theme+'-closed-drawer-inert-and-Escape-focus');
    await viewport(640,480);await menu(theme+'-original-minimum');await screen(theme+'-minimum');
    await viewport(640,480,2);await menu(theme+'-minimum-zoom200');await openDrawer();await screen(theme+'-minimum-zoom200');
    for(let n=0;n<5;n++)await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-nav-item')),'settings');
    await screen(theme+'-minimum-zoom200-bottom');await nav('achievements');
    const p=await page.locator('[data-achievements-stage]').evaluate(e=>({font:getComputedStyle(e).fontSize,color:getComputedStyle(e).color,bg:getComputedStyle(document.querySelector('.main')).backgroundColor,overflow:e.scrollWidth>e.clientWidth}));
    assert.equal(p.font,'14px');assert(!p.overflow);check(theme+'-achievements-theme-body-font-unchanged',p);
  }
  await viewport(1450,900);await nav('ledger');
  const handle=page.getByRole('separator',{name:'调整侧栏宽度'});await handle.focus();await page.keyboard.press('Home');await settle();
  const b=await handle.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+70);await page.mouse.down();await page.mouse.move(240,b.y+70,{steps:12});await page.mouse.up();await settle();assert.equal(await handle.getAttribute('aria-valuenow'),'240');check('pointer-resize-240');
  await nav('achievements');const indicator=page.locator('.nav-indicator');
  assert((await indicator.evaluate(e=>getComputedStyle(e).transitionDuration)).includes('0.24s'));
  let ib=await indicator.boundingBox(),sb=await page.locator('[data-nav-item="achievements"]').boundingBox();assert(Math.abs(ib.y-sb.y)<=1);check('bottom-group-indicator-offset', {indicator:ib,selected:sb});
  await page.evaluate(()=>{for(const id of ['settings','ledger','achievements','data','achievements'])document.querySelector(`[data-nav-item="${id}"]`).click();});await settle();
  assert.equal(await page.locator('.app').getAttribute('data-nav'),'achievements');ib=await indicator.boundingBox();sb=await page.locator('[aria-current="page"]').boundingBox();assert(Math.abs(ib.y-sb.y)<=1);check('interruptible-selection-final-target');
  await page.emulateMedia({colorScheme:null,reducedMotion:'reduce'});assert.equal(await indicator.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');check('reduced-motion');await page.emulateMedia({colorScheme:null,reducedMotion:'no-preference'});
  await close();await launch();await viewport(1450,900);assert.equal(await page.getByRole('separator',{name:'调整侧栏宽度'}).getAttribute('aria-valuenow'),'240');check('width-240-restart-persistence');
  await page.getByRole('separator',{name:'调整侧栏宽度'}).dblclick();await settle();assert.equal(await page.getByRole('separator',{name:'调整侧栏宽度'}).getAttribute('aria-valuenow'),'176');check('width-default-doubleclick-reset');
  const candidate=await fixture();const before=await sql();save('sql-before-guard.json',before);
  for(const [width,height,label] of [[1450,900,'expanded'],[1000,650,'rail'],[640,480,'drawer-minimum']]){
    await viewport(width,height);await nav('ai');await page.getByRole('group',{name:'AI记账子页'}).getByRole('button',{name:'候选审核',exact:true}).click();
    const card=page.locator(`[data-candidate-id="${candidate}"]`),field=card.getByLabel('购买物或服务名称',{exact:true});await field.fill('未保存-'+label);
    await nav('achievements');const guard=page.getByRole('dialog',{name:'还有未保存的补填',exact:true});await guard.waitFor();assert.equal(await page.locator('.app').getAttribute('data-nav'),'review');
    await guard.getByRole('button',{name:'继续补填',exact:true}).click();assert.equal(await field.inputValue(),'未保存-'+label);
    await nav('achievements');await guard.getByRole('button',{name:'放弃未保存修改并离开',exact:true}).click();await page.locator('[data-nav="achievements"]').waitFor();check(label+'-review-cancel-retains-draft-discard-enters-achievements');
  }
  const after=await sql();save('sql-after-guard.json',after);assert.deepEqual(after,before);assert.equal(after.formal,0);assert.equal(after.postings,0);assert(after.attempts.every(j=>j.total_attempts===0));assert.deepEqual(after.fk,[]);check('synthetic-fixture-no-save-no-approval-no-recognition');
  await close();assert.equal(report.http,0);assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);check('zero-external-http-clean-console-and-page');report.ok=true;
}catch(e){report.failure=e.stack;console.error(e);if(page)await screen('failure').catch(()=>{});}
finally{if(app)await close();save('result.json',report);}
if(!report.ok)process.exitCode=1;
