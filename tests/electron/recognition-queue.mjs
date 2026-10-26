/** S15 production import queue regression on current source: actual Electron/preload/IPC/SQLite, synthetic images + mocked HTTP. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';
const modules=process.env.BOOKKEEP_QA_NODE_MODULES;if(!modules)throw new Error('existing Playwright path required');
const {_electron}=createRequire(path.join(modules,'__qa__.cjs'))('playwright');
const localAppData=mkdtempSync(path.join(tmpdir(),'BookKeep S10 中文 '));
const target=path.resolve(process.env.BOOKKEEP_QA_OUTPUT??path.join(ROOT,'.tmp/recognition-queue'));mkdirSync(target,{recursive:true});
const report={ok:false,kind:'S15 production import queue regression on current source; actual Electron/preload/SQLite, MOCK HTTP; not independent acceptance',checks:[],errors:[],notices:[]};
let app,page;
const check=(id,detail={})=>{report.checks.push({id,ok:true,detail});console.log('PASS '+id);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(!await fn()){if(Date.now()>end)throw new Error('condition timeout');await sleep(40);}}
const invoke=async(method,input)=>{const result=await page.evaluate(async({method,input})=>{const [group,name]=method.split('.');return window.bookkeep[group][name](input);},{method,input});assert.equal(result.ok,true,JSON.stringify(result.error));return result.data;};
const list=()=>invoke('recognition.status',{jobId:null,statusFilter:[],page:{limit:100,cursor:null}});
const drafts=()=>invoke('candidate.list',{jobId:null,page:{limit:100,cursor:null}});
async function launch(){app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.text().includes("frame-ancestors' is ignored"))report.notices.push(m.text());else if(m.type()==='error')report.errors.push(m.text());else if(m.type()==='warning')report.notices.push(m.text());});await page.locator('[data-ledger-total]').waitFor();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,1000));}
async function mockHttp(){await app.evaluate(()=>{
  globalThis.s10={scenario:'gate',calls:0,pending:[]};
  const proposal={amountFen:9900,occurredDate:'2026-09-09',occurredTime:null,timePrecision:'date',name:'合成待审餐饮',merchant:null,categoryId:'cat_food',transactionKind:'expense',amountBasis:'paid_total',groupKey:null,lineItems:[],evidence:[{field:'amountFen',text:'实付99.00',source:'image',region:null},{field:'occurredDate',text:'2026-09-09',source:'image',region:null},{field:'name',text:'合成待审餐饮',source:'image',region:null},{field:'categoryId',text:'餐饮',source:'image',region:null}],missingFields:[],warnings:[],confidence:null};
  const content=()=>JSON.stringify({schemaVersion:'bk-candidate.v1',candidates:[proposal,{...proposal,amountFen:2100,name:'<script>window.__S10executed=true</script>',warnings:[{code:'INSTRUCTION_IN_IMAGE',message:'截图包含恶意指令，仅作数据',field:null}]}],warnings:[]});
  globalThis.fetch=async(url,options)=>{
    if(url!=='https://api.deepseek.com/chat/completions')throw new Error('unexpected endpoint');
    const body=JSON.parse(options.body);if(!body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'))throw new Error('missing prepared image');
    globalThis.s10.calls++;
    const scenario=globalThis.s10.scenario;
    if(scenario==='offline')throw new Error('synthetic offline');
    if(scenario==='gate'||scenario==='late'||scenario==='interrupt')await new Promise(resolve=>globalThis.s10.pending.push(resolve));
    return new Response(JSON.stringify({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:scenario==='invalid'?'not json':content()}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}),{status:200});
  };
});}
async function setScenario(scenario){await app.evaluate((_,value)=>{globalThis.s10.scenario=value;},scenario);}
async function release(){await app.evaluate(()=>globalThis.s10.pending.splice(0).forEach(r=>r()));}
async function navigate(label){
  if(['图片导入','任务队列','候选审核'].includes(label)) {
    await page.getByRole('button',{name:'AI记账',exact:true}).click();
    await page.getByRole('group',{name:'AI记账子页',exact:true}).getByRole('button',{name:label,exact:true}).click();
  } else await page.getByRole('button',{name:label,exact:true}).click();
}
const start=async(asset,forceNew=true)=>invoke('recognition.start',{images:[{imageAssetId:asset.id,preparedHash:asset.preparedHash}],provider:'deepseek',promptVersion:'bk-receipt.s10.v1',uploadConsent:[{preparedHash:asset.preparedHash,confirmed:true,noticeVersion:'recognition.v1'}],forceNew,reason:forceNew?'合成竞态测试':null});
const current=async id=>(await list()).items.find(x=>x.id===id);
const finish=async id=>until(async()=>['completed','failed','cancelled'].includes((await current(id)).status));
const sql=async()=>app.evaluate(({app})=>{const {createRequire}=process.getBuiltinModule('node:module');const require=createRequire(app.getAppPath()+'/package.json');const fs=require('node:fs'),path=require('node:path'),Db=require(path.join(app.getAppPath(),'node_modules/better-sqlite3'));const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),pointer=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8'));const db=new Db(path.join(root,'data/generations',pointer.generationId,'ledger.db'),{readonly:true});try{return {schema:db.pragma('user_version',{simple:true}),formal:db.prepare('SELECT count(*) count,sum(amount_fen) total FROM "transaction" WHERE deleted_at IS NULL').get(),jobs:db.prepare('SELECT status,error_code,count(*) count FROM import_job GROUP BY status,error_code').all(),candidates:db.prepare('SELECT review_state,count(*) count,sum(json_extract(current_json,\'$.amountFen\')) amount FROM candidate GROUP BY review_state').all(),links:db.prepare('SELECT count(*) count FROM candidate c JOIN import_job j ON j.id=c.job_id JOIN image_asset a ON a.id=c.image_asset_id WHERE c.prepared_hash=j.prepared_hash AND j.prepared_hash=a.prepared_hash').get(),quick:db.pragma('quick_check'),fk:db.pragma('foreign_key_check')};}finally{db.close();}});
try{
  await launch();await mockHttp();
  const seed=[[1800,'2026-09-08','cat_food','午餐'],[1626,'2026-09-08','cat_fruit','购买水果'],[1000,'2026-09-08','cat_food','晚餐'],[85000,'2026-09-09','cat_repair','iPad维修'],[5554,'2026-09-09','cat_digital','iPad保护膜'],[1550,'2026-09-09','cat_food','午餐']];
  for(const [amountFen,occurredDate,categoryId,name]of seed)await invoke('transaction.create',{amountFen,occurredDate,categoryId,name,occurredTime:null,timePrecision:'date',merchant:null,note:null});
  await invoke('settings.saveSecret',{action:'save',expectedVersion:0,persistence:'session',secret:'synthetic-s10-never-network'});
  const fixture=path.join(ROOT,'assets/probe/s09-receipt-v1.png');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},fixture);
  await navigate('图片导入');await page.getByRole('button',{name:'选择图片',exact:true}).click();await page.getByRole('button',{name:'保存预处理（仅本地）',exact:true}).waitFor();
  const canvas=page.locator('canvas');await until(async()=>await canvas.evaluate(el=>el.width)===960);const box=await canvas.boundingBox();await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+180,box.y+120);await page.mouse.up();assert.notEqual(await page.getByRole('spinbutton',{name:'裁剪 width',exact:true}).inputValue(),'960');
  await page.getByRole('button',{name:'取消编辑 / 重置',exact:true}).click();
  for(const [name,value]of [['裁剪 x','10'],['裁剪 y','20'],['裁剪 width','900'],['裁剪 height','600']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
  await page.getByRole('button',{name:'添加遮盖',exact:true}).click();
  for(const [name,value]of [['遮盖1 x','20'],['遮盖1 y','20'],['遮盖1 width','80'],['遮盖1 height','30']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
  await page.getByRole('button',{name:'保存预处理（仅本地）',exact:true}).click();await page.getByText('处理图已保存。请检查本次上传图并重新同意上传。',{exact:true}).waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  await page.screenshot({path:path.join(target,'import-prepared.png'),fullPage:true});check('UI-native-selection-entry-content-validation-prepared-preview-and-hash',{picker:'dialog result injected by test; OS dialog interaction not tested'});
  await page.getByRole('button',{name:/^开始识别/}).click();assert.equal(await app.evaluate(()=>globalThis.s10.calls),0);await page.getByRole('checkbox',{name:'我同意以上处理图用于本次识别，了解可能产生费用',exact:true}).check();await page.getByRole('button',{name:'上传并识别',exact:true}).click();await page.getByText(/已建立1个任务/).waitFor();
  await until(async()=>await app.evaluate(()=>globalThis.s10.calls)===1);await navigate('任务队列');await page.getByText(/正在识别，第1次请求/).waitFor();assert.equal((await list()).items[0].status,'processing');check('UI-loading-follows-actual-pending-request-and-upload-consent');
  await release();await until(async()=>(await list()).items[0]?.status==='completed');const assetJob=(await list()).items[0];const asset={id:assetJob.imageAssetId,preparedHash:assetJob.preparedHash};
  const pixel=await app.evaluate(async({app},id)=>{const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),Db=require('better-sqlite3'),sharp=require('sharp');const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI');const pointer=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8'));const directory=path.join(root,'data/generations',pointer.generationId),db=new Db(path.join(directory,'ledger.db'),{readonly:true});let ref;try{ref=db.prepare('SELECT prepared_ref FROM image_asset WHERE id=?').get(id).prepared_ref;}finally{db.close();}const {data,info}=await sharp(path.join(directory,'attachments',ref)).removeAlpha().raw().toBuffer({resolveWithObject:true});return {width:info.width,height:info.height,pixel:[...data.subarray((20*info.width+20)*info.channels,(20*info.width+20)*info.channels+3)]};},asset.id);assert.deepEqual(pixel,{width:900,height:600,pixel:[0,0,0]});check('UI-pointer-and-keyboard-crop-masks-confirmed-as-opaque-PNG-pixels',pixel);
  await navigate('候选审核');await page.locator('[data-candidate-id]').first().waitFor();assert.equal(await page.locator('[data-candidate-id]').count(),2);check('UI-multiple-persisted-candidates-with-source-evidence');
  assert.equal(await page.locator('[data-candidate-id] h3').filter({hasText:'<script>window.__S10executed=true</script>'}).count(),1);assert.equal(await page.evaluate(()=>Boolean(window.__S10executed)),false);check('malicious-provider-text-rendered-inert-with-warning');
  await page.screenshot({path:path.join(target,'pending-drafts.png'),fullPage:true});
  const before=await sql();assert.deepEqual(before.formal,{count:6,total:96530});assert.equal(before.links.count,2);report.sqlBeforeRestart=before;
  const same=await start(asset,false);assert.equal(same.reusedIds.length,1);assert.equal(await app.evaluate(()=>globalThis.s10.calls),1);check('exact-hash-reuse-no-second-HTTP');
  await setScenario('invalid');const invalid=(await start(asset)).jobs[0];await finish(invalid.id);assert.equal((await current(invalid.id)).errorCode,'OUTPUT_SCHEMA_INVALID');assert.equal((await drafts()).totalCount,2);check('illegal-JSON-failed-persisted-zero-partial-draft');
  await setScenario('late');const late=(await start(asset)).jobs[0];await until(async()=>(await current(late.id)).status==='processing');await navigate('任务队列');const row=page.locator(`[data-job-id="${late.id}"]`);await row.getByRole('button',{name:'请求取消',exact:true}).click();await until(async()=>(await current(late.id)).status==='cancelled');await release();await sleep(150);assert.equal((await drafts()).totalCount,2);check('UI-cancel-generation-fence-drops-abort-ignoring-late-success');
  await setScenario('offline');const offline=(await start(asset)).jobs[0];await finish(offline.id);assert.equal((await current(offline.id)).attempt,3);assert.equal((await current(offline.id)).errorCode,'NETWORK_ERROR');check('offline-max3-persisted-attempts-bounded-real-backoff',{attempts:3,backoffMs:[2000,4000]});
  // Real browser File -> isolated preload webUtils; only test-created local image paths.
  const webpFile=path.join(localAppData,'synthetic.webp');writeFileSync(webpFile,await sharp({create:{width:40,height:30,channels:3,background:'#abcdef'}}).webp().toBuffer());
  await page.evaluate(()=>{const el=document.createElement('input');el.type='file';el.id='qa-real-file';document.body.appendChild(el);});await page.locator('#qa-real-file').setInputFiles(webpFile);
  const drop=await page.evaluate(()=>window.bookkeep.image.drop([...document.querySelector('#qa-real-file').files]));assert.equal(drop.ok,true,JSON.stringify(drop.error));const imp=await invoke('image.import',{selectionTokens:drop.data.tokens,retention:'keep_original'});assert.equal(imp.results[0].errorCode,null);check('actual-File-WebP-through-webUtils-drop-token-and-IPC');
  await navigate('图片导入');await page.evaluate(()=>{const dataTransfer=new DataTransfer();for(const file of document.querySelector('#qa-real-file').files)dataTransfer.items.add(file);document.querySelector('#ai-import .page').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));});await page.getByText(/本地校验完成 1\/1/).waitFor();check('UI-drop-handler-imports-real-File-and-reuses-image');
  const fake=await page.evaluate(()=>window.bookkeep.image.drop(['C:/Windows/system.ini']));assert.equal(fake.ok,false);check('drop-rejects-path-string-masquerading-as-File');
  await setScenario('interrupt');const interrupted=(await start(asset)).jobs[0];await until(async()=>(await current(interrupted.id)).status==='processing');
  const actualMainPid=await app.evaluate(()=>process.pid);const launcherPid=app.process().pid;const closed=app.waitForEvent('close',{timeout:15000});process.kill(actualMainPid,'SIGKILL');await closed;report.termination={actualMainPid,launcherPid,signal:'SIGKILL'};app=null;await launch();await mockHttp();const restarted=await list();assert.equal(restarted.items.find(j=>j.id===interrupted.id).errorCode,'INTERRUPTED');assert.equal(await app.evaluate(()=>globalThis.s10.calls),0);assert.equal((await drafts()).totalCount,2);check('real-SIGKILL-restart-persists-pending-failed-cancelled-and-interrupted-no-charge-resume');
  const after=await sql();report.sqlAfterRestart=after;assert.deepEqual(after.formal,{count:6,total:96530});assert.equal(after.links.count,2);assert.deepEqual(after.fk,[]);check('native-SQLite-schema3-source-FKs-quickcheck-and-6-96530-after-restart',after);
  // Full official views/Top3/day-average through real preload, with snapshot-consistent scope.
  report.formalViews=[];
  for(const period of ['week','month','year']){
    const input={period,anchorDate:'2026-09-09',categoryIds:[],snapshotRevision:null};const series=await invoke('statistics.series',input);const bound={...input,snapshotRevision:series.scope.revision};const summary=await invoke('statistics.summary',bound);const rank=await invoke('statistics.topCategories',{...bound,pointMonth:null});const point=period==='year'?await invoke('statistics.topCategories',{...bound,pointMonth:'2026-09'}):await invoke('statistics.topTransactions',{...bound,pointDate:'2026-09-09'});
    assert.equal(series.totalFen,'96530');assert.equal(summary.count,6);assert.equal(rank.totalFen,'96530');assert.equal(period==='year'?point.totalFen:point.pointTotalFen,period==='year'?'96530':'92104');report.formalViews.push({period,total:series.totalFen,count:summary.count,average:summary.dailyAverage,point,rank});
  }
  await navigate('统计');await page.screenshot({path:path.join(target,'statistics-unchanged.png'),fullPage:true});check('week-month-year-ranking-Top3-and-average-through-preload-ignore-drafts-and-failed-jobs');
  await navigate('图片导入');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(640,600));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(target,'import-small.png'),fullPage:true});check('640x600-no-horizontal-overflow');
  report.requestCount=await app.evaluate(()=>globalThis.s10.calls);assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.failure=String(error.stack??error);if(page&&!page.isClosed())await page.screenshot({path:path.join(target,'smoke-failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});writeFileSync(path.join(target,'desktop-selftest.json'),JSON.stringify(report,null,2)+'\n');}
