/** Synthetic SQLite fixture, no recognition or keys. Run against an isolated build.
 * BOOKKEEP_QA_APP_ROOT, BOOKKEEP_QA_OUTPUT and BOOKKEEP_QA_NODE_MODULES select local paths.
 * Logical viewport / Electron zoom regression only; never native DPI or human acceptance.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const appRoot=path.resolve(process.env.BOOKKEEP_QA_APP_ROOT??ROOT);
const target=path.resolve(process.env.BOOKKEEP_QA_OUTPUT??path.join(ROOT,'.tmp/review-layout'));
mkdirSync(target,{recursive:true});
const require=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES??path.join(ROOT,'node_modules'),'qa.cjs'));
const {_electron}=require('playwright');
const localAppData=mkdtempSync(path.join(tmpdir(),'BookKeep layout synthetic '));
const report={ok:false,kind:'implementation selftest; logical viewport and Electron zoom; no native DPI/human acceptance',harnessDeviceScaleFactor:1,appRoot,localAppData,rows:[],sql:[],errors:[],http:0};
let app,page;
const save=(name,data)=>writeFileSync(path.join(target,name),JSON.stringify(data,null,2));
const invoke=async(method,input)=>{const result=await page.evaluate(({method,input})=>{const [group,name]=method.split('.');return window.bookkeep[group][name](input);},{method,input});assert.equal(result.ok,true,JSON.stringify(result.error));return result.data;};
const sql=async label=>{const result=await app.evaluate(({app})=>{
  const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),Db=require('better-sqlite3');
  const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),active=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),dbPath=path.join(root,'data/generations',active.generationId,'ledger.db'),db=new Db(dbPath,{readonly:true});
  try{return {dbPath,active,formal:db.prepare('select count(*) n,coalesce(sum(amount_fen),0) total from "transaction" where deleted_at is null').get(),audit:db.prepare('select * from audit_event order by rowid').all(),review:db.prepare('select * from review_event order by rowid').all(),postings:db.prepare('select * from review_posting').all(),candidates:db.prepare('select * from candidate').all(),jobs:db.prepare('select id,status,total_attempts from import_job').all(),quick:db.pragma('quick_check'),fk:db.pragma('foreign_key_check')};}finally{db.close();}
});report.sql.push({label,...result});save(`sql-${label}.json`,result);return result;};
const noPosting=s=>{assert.deepEqual(s.formal,{n:0,total:0});assert.equal(s.postings.length,0);assert.equal(s.review.filter(e=>e.action==='approve').length,0);assert.equal(s.audit.filter(e=>/approv|posting/.test(e.action)).length,0);assert(s.jobs.every(j=>j.total_attempts===0));assert.equal(s.fk.length,0);};
async function fixture(){
  const file=path.join(localAppData,'synthetic.png');
  writeFileSync(file,await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="700" height="550"><rect width="700" height="550" fill="white"/><text x="30" y="70" font-size="26">SYNTHETIC ONLY - CNY 99.00</text><text x="30" y="130" font-size="26">2026-09-09 / FOOD / TEST ITEM</text></svg>')).png().toBuffer());
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  const tokens=await invoke('image.select',{}),imported=await invoke('image.import',{selectionTokens:tokens.tokens,retention:'keep_original'}),asset=imported.results[0].asset;
  const prepared=await invoke('image.prepare',{imageAssetId:asset.id,expectedVersion:asset.version,crop:null,masks:[],retainOriginal:true});
  // Seed a completed synthetic job directly; never start a recognizer or touch settings.
  return app.evaluate(({app},asset)=>{
    const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),Db=require('better-sqlite3'),{randomUUID}=require('node:crypto');
    const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),active=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),db=new Db(path.join(root,'data/generations',active.generationId,'ledger.db'));
    try{const job=randomUUID(),id=randomUUID(),now=new Date().toISOString(),p={amountFen:9900,occurredDate:'2026-09-09',occurredTime:null,timePrecision:'date',name:'布局合成商品',merchant:null,categoryId:'cat_food',transactionKind:'expense',amountBasis:'line_payment',groupKey:randomUUID(),lineItems:[],evidence:[],missingFields:[],warnings:[],confidence:1};
      db.pragma('foreign_keys=ON');db.transaction(()=>{
        db.prepare("insert into import_job(id,ledger_id,image_asset_id,prepared_hash,status,provider,model,prompt_version,schema_version,categories_json,consent_json,force_new,created_at,updated_at,finished_at,candidate_count) values(?,?,?,?, 'completed','mock','synthetic-layout','bk-receipt.s10.v1','bk-candidate.v1','[]','[]',0,?,?,?,1)").run(job,active.ledgerId,asset.id,asset.preparedHash,now,now,now);
        db.prepare("insert into candidate(id,ledger_id,job_id,image_asset_id,prepared_hash,ordinal,proposal_json,current_json,evidence_json,missing_json,warnings_json,duplicates_json,blocking,excluded_by_default,created_at,updated_at) values(?,?,?,?,?,0,?,?,'[]','[]','[]','[]',0,0,?,?)").run(id,active.ledgerId,job,asset.id,asset.preparedHash,JSON.stringify(p),JSON.stringify(p),now,now);
      })();return id;
    }finally{db.close();}
  },prepared);
}
async function viewport(width,height,zoom){
  // Harness-only minimum override exercises below-minimum logical workspaces without
  // changing the application's window configuration or the user's system settings.
  await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setMinimumSize(0,0);w.webContents.setZoomFactor(zoom);w.setContentSize(Math.round(width*zoom),Math.round(height*zoom));},{width,height,zoom});
  // Windows DIP rounding and Electron zoom settle asynchronously. Adjust content
  // dimensions from observed renderer size; never substitute requested for actual.
  for(let attempt=0;attempt<8;attempt++){
    await page.waitForTimeout(150);
    const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    if(actual.width===width&&actual.height===height)break;
    await app.evaluate(({BrowserWindow},{width,height,actual,zoom})=>{const w=BrowserWindow.getAllWindows()[0],s=w.getContentSize();w.setContentSize(Math.round(s[0]+(width-actual.width)*zoom),Math.round(s[1]+(height-actual.height)*zoom));},{width,height,actual,zoom});
  }
  const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  save(`viewport-${width}x${height}-z${zoom}.json`,{requested:{width,height,zoom},actual});
  assert.deepEqual(actual,{width,height},'exact observed logical viewport');
  return app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {zoom:w.webContents.getZoomFactor(),contentSize:w.getContentSize(),harnessMinimumOverride:true};});
}
async function reachable(locator){
  await locator.focus();
  const r=await locator.evaluate(el=>{el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();const ancestors=[];for(let p=el.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll|hidden/.test(s.overflow+s.overflowX+s.overflowY)){const b=p.getBoundingClientRect();ancestors.push({left:b.left,right:b.right,top:b.top,bottom:b.bottom,scrollTop:p.scrollTop,scrollLeft:p.scrollLeft});}if(p.matches('dialog[open]'))break;/* Top-layer dialog escapes ancestor clipping. */}return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewport:[innerWidth,innerHeight],focused:document.activeElement===el,ancestors};});
  assert(r.focused);assert(r.x>=-1&&r.y>=-1&&r.right<=r.viewport[0]+1&&r.bottom<=r.viewport[1]+1,JSON.stringify(r));
  for(const a of r.ancestors)assert(r.x>=a.left-1&&r.right<=a.right+1&&r.y>=a.top-1&&r.bottom<=a.bottom+1,JSON.stringify(r));
  return r;
}
try{
  app=await _electron.launch({executablePath:electronExecutable(),args:[appRoot,'--force-device-scale-factor=1'],cwd:appRoot,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});
  report.pid=app.process().pid;page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
  await app.evaluate(({session})=>{globalThis.layoutHttp=0;globalThis.fetch=async()=>{globalThis.layoutHttp++;throw Error('Layout selftest forbids network');};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{globalThis.layoutHttp++;callback({cancel:true});});});
  await page.locator('[data-ledger-total]').waitFor();const id=await fixture();report.fixtureId=id;
  // The fixture must survive a real process restart, without loading a key or recognition.
  noPosting(await sql('fixture'));report.http+=await app.evaluate(()=>globalThis.layoutHttp);assert.equal(report.http,0);await app.close();app=null;
  app=await _electron.launch({executablePath:electronExecutable(),args:[appRoot,'--force-device-scale-factor=1'],cwd:appRoot,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});
  report.restartPid=app.process().pid;page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
  await app.evaluate(({session})=>{globalThis.layoutHttp=0;globalThis.fetch=async()=>{globalThis.layoutHttp++;throw Error('Layout selftest forbids network');};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,c)=>{globalThis.layoutHttp++;c({cancel:true});});});
  await page.locator('[data-ledger-total]').waitFor();await page.locator('[data-nav-item="review"]').click();
  const card=page.locator(`[data-candidate-id="${id}"]`);await card.waitFor();await card.locator('img').first().waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-candidate-id] img')?.naturalWidth>0);
  const modes=card.getByRole('group',{name:'审核对照模式'}),compare=card.locator('.review-compare');
  const sizes=[[853,480],[640,360],[875,441],[729,368],[640,480],[1280,720],[899,640],[900,640],[1200,639],[1200,640],[639,479]];
  for(const [width,height] of sizes)for(const zoom of [1,1.25,1.5,2]){
    const key=`${width}x${height}-z${zoom}`,native=await viewport(width,height,zoom);
    if(await modes.count())await modes.getByRole('button',{name:'并排对照',exact:true}).click();
    await compare.scrollIntoViewIfNeeded();
    const geometry=await compare.evaluate(el=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};const image=el.firstElementChild,fields=el.lastElementChild,scroll=el.parentElement;return {viewport:{width:innerWidth,height:innerHeight},image:rect(image),fields:rect(fields),receipt:rect(image.querySelector('img')),inputs:[...fields.querySelectorAll('input,select')].slice(0,4).map(rect),gap:fields.getBoundingClientRect().left-image.getBoundingClientRect().right,scroll:{width:scroll.clientWidth,scrollWidth:scroll.scrollWidth},panels:[image,fields].map(p=>({clientHeight:p.clientHeight,scrollHeight:p.scrollHeight,overflow:getComputedStyle(p).overflow}))};});
    save(`geometry-${key}.json`,{native,...geometry});
    assert(geometry.image.right<=geometry.fields.x&&Math.min(geometry.image.bottom,geometry.fields.bottom)>Math.max(geometry.image.y,geometry.fields.y),'image and fields must be side by side: '+key);
    assert(geometry.image.width>=279.9&&geometry.fields.width>=279.9,'280px minimum: '+key);assert(Math.abs(geometry.gap-12)<0.2,'12px gutter: '+key);
    assert.equal(await modes.count(),1,'mode controls required');
    const access={};for(const name of ['实付金额（元）','完整实际日期','分类','购买物或服务名称'])access[name]=await reachable(card.getByLabel(name,{exact:true}));
    // Unsaved values and check state live in the mounted card through every mode round trip.
    await card.getByLabel('购买物或服务名称',{exact:true}).fill('布局往返保留'+key);await card.getByLabel('实付金额（元）',{exact:true}).fill('123.45');
    await card.getByLabel('完整实际日期',{exact:true}).fill('2026-10-01');await card.getByLabel('分类',{exact:true}).selectOption('cat_fruit');
    await card.getByLabel('处理理由',{exact:true}).fill('合成布局往返；不保存');
    for(const mode of ['原图','字段','并排对照']){await modes.getByRole('button',{name:mode,exact:true}).click();assert.equal(await modes.getByRole('button',{name:mode,exact:true}).evaluate(e=>document.activeElement===e),true);assert.equal(await card.locator('.review-image-panel').isVisible(),mode!=='字段');assert.equal(await card.locator('.review-fields-panel').isVisible(),mode!=='原图');assert.equal(await card.getByLabel('购买物或服务名称',{exact:true}).inputValue(),'布局往返保留'+key);assert.equal(await card.getByLabel('实付金额（元）',{exact:true}).inputValue(),'123.45');assert.equal(await card.getByLabel('完整实际日期',{exact:true}).inputValue(),'2026-10-01');assert.equal(await card.getByLabel('分类',{exact:true}).inputValue(),'cat_fruit');}
    const divider=card.getByRole('separator');await divider.focus();await page.keyboard.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'55');await page.keyboard.press('Home');assert.equal(await divider.getAttribute('aria-valuenow'),'50');
    if(width===1280){const box=await divider.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+20);await page.mouse.down();await page.mouse.move(box.x+box.width/2+60,box.y+20,{steps:4});await page.mouse.up();assert(Number(await divider.getAttribute('aria-valuenow'))>50);await card.getByRole('button',{name:'恢复默认比例',exact:true}).click();assert.equal(await divider.getAttribute('aria-valuenow'),'50');}
    await reachable(card.getByLabel('实付金额（元）',{exact:true}));await page.keyboard.press('Tab');assert.equal(await card.getByLabel('完整实际日期',{exact:true}).evaluate(e=>document.activeElement===e),true);await page.keyboard.press('Shift+Tab');assert.equal(await card.getByLabel('实付金额（元）',{exact:true}).evaluate(e=>document.activeElement===e),true);
    // Discard through navigation so the existing card is unmounted, without saving.
    const menu=page.getByRole('button',{name:'菜单',exact:true});if(await menu.isVisible())await menu.click();
    await page.locator('[data-nav-item="ledger"]').click();await page.getByRole('button',{name:'放弃未保存修改并离开',exact:true}).click();
    if(await menu.isVisible())await menu.click();await page.locator('[data-nav-item="review"]').click();
    await card.getByLabel('购买物或服务名称',{exact:true}).filter({visible:true}).waitFor();
    await page.waitForFunction(id=>document.querySelector(`[data-candidate-id="${id}"] input[aria-label="购买物或服务名称"]`)?.value==='布局合成商品',id);
    for(const name of ['实付金额','实际日期及时间精度','购买物或服务名称','分类'])await card.getByRole('checkbox',{name:'确认'+name,exact:true}).check();
    for(const mode of ['原图','字段','并排对照']){await modes.getByRole('button',{name:mode,exact:true}).click();for(const name of ['实付金额','实际日期及时间精度','购买物或服务名称','分类'])assert.equal(await card.getByRole('checkbox',{name:'确认'+name,exact:true,includeHidden:true}).isChecked(),true);}
    const before=await sql(key+'-before-preview');noPosting(before);
    await card.getByRole('button',{name:'批准本笔',exact:true}).click();const dialog=page.getByRole('dialog',{name:'确认本笔入账'});await dialog.waitFor();
    access.cancel=await reachable(dialog.getByRole('button',{name:'取消',exact:true}));assert.equal(await dialog.getByRole('button',{name:'取消',exact:true}).evaluate(e=>document.activeElement===e),true);
    await page.screenshot({path:path.join(target,`preview-${key}.png`)});await dialog.getByRole('button',{name:'取消',exact:true}).click();
    await dialog.waitFor({state:'hidden'});assert.equal(await card.getByRole('button',{name:'批准本笔',exact:true}).evaluate(e=>document.activeElement===e),true,'cancel returns focus to trigger');
    const after=await sql(key+'-after-cancel');noPosting(after);assert.deepEqual(after.candidates,before.candidates);assert.deepEqual(after.review,before.review);
    // Existing activity tracking appends interaction/cancel audit records; verify the
    // immutable prefix and each added action instead of incorrectly requiring no audit.
    assert.deepEqual(after.audit.slice(0,before.audit.length),before.audit);
    const auditAdded=after.audit.slice(before.audit.length);assert(auditAdded.length>0);
    for(const event of auditAdded){assert.equal(event.action,'review.activity');const kind=JSON.parse(event.diff_json).find(d=>d.field==='event')?.after;assert(['interaction','cancel','focus','blur'].includes(kind));}
    assert(auditAdded.some(e=>JSON.parse(e.diff_json).some(d=>d.field==='event'&&d.after==='cancel')));
    await card.getByRole('button',{name:'并排对照',exact:true}).click();await compare.evaluate(el=>{el.firstElementChild.scrollTop=0;el.lastElementChild.scrollTop=0;el.parentElement.scrollLeft=0;});await compare.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(target,`compare-${key}.png`)});report.rows.push({key,requested:{width,height,zoom},native,geometry,access,modesPreserved:true,previewCancelLedgerUnchanged:true,auditAdded});console.log('PASS '+key);
  }
  noPosting(await sql('final'));assert.equal(report.http+await app.evaluate(()=>globalThis.layoutHttp),0);assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.failure=String(e.stack??e);if(page){await page.screenshot({path:path.join(target,'failure.png')}).catch(()=>{});report.failureState=await page.locator('[data-candidate-id]').evaluateAll(nodes=>nodes.map(n=>({text:n.innerText,fields:[...n.querySelectorAll('input,select,textarea')].map(e=>({label:e.getAttribute('aria-label'),value:e.value}))}))).catch(()=>null);}process.exitCode=1;}
finally{if(app){report.http+=await app.evaluate(()=>globalThis.layoutHttp??0).catch(()=>0);await app.close().catch(()=>{});}report.finishedAt=new Date().toISOString();save('result.json',report);}
console.log(JSON.stringify({ok:report.ok,rows:report.rows.length,http:report.http,failure:report.failure}));
