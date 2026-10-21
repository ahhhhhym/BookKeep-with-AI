/** Run after npm run build: BOOKKEEP_QA_NODE_MODULES points to an installed Playwright package. Outputs default to ignored .tmp/s11-review-ui; all data is synthetic and isolated. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const require=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES??path.join(ROOT,'node_modules'),'__qa__.cjs'));
const {_electron}=require('playwright');
const target=path.resolve(process.env.BOOKKEEP_QA_OUTPUT??path.join(ROOT,'.tmp/s11-review-ui'));mkdirSync(target,{recursive:true});
const localAppData=mkdtempSync(path.join(tmpdir(),'BookKeep S11 中文 空格 '));
const report={ok:false,kind:'S11 rework implementation SELFTEST: automated Electron UI / real IPC / SQLite, synthetic transport; not G3 or human acceptance',transport:'synthetic fetch; zero external HTTP; no real key',browser:'Playwright Electron automation; not human IME validation',checks:[],errors:[],notices:[],screens:[],localAppData};
let app,page;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,timeout=15000)=>{const end=Date.now()+timeout;while(!await fn()){if(Date.now()>end)throw Error('condition timeout');await sleep(50);}};
const check=(id,detail={})=>{report.checks.push({id,ok:true,detail});console.log('PASS '+id);};
const raw=async(method,input,options)=>page.evaluate(({method,input,options})=>{const [g,m]=method.split('.');return window.bookkeep[g][m](input,options);},{method,input,options});
const invoke=async(method,input,options)=>{const r=await raw(method,input,options);assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;};
const pageArg={limit:100,cursor:null};
const drafts=async()=>(await invoke('candidate.list',{jobId:null,page:pageArg})).items;
const cand=async id=>(await drafts()).find(c=>c.id===id);
const item=c=>({id:c.id,expectedVersion:c.version,confirmation:{amount:true,date:true,name:true,category:true,confirmedVersion:c.version,reviewDigest:c.reviewDigest}});
const nav=async id=>{await page.locator(`[data-nav-item="${id}"]`).click();await page.locator(`[data-nav="${id}"]`).waitFor();};
const card=id=>page.locator(`[data-candidate-id="${id}"]`);
const screen=async name=>{const file=path.join(target,name+'.png');await page.screenshot({path:file,fullPage:false});report.screens.push(file);};
async function launch(){app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.text().includes("frame-ancestors' is ignored"))report.notices.push(m.text());else if(m.type()==='error')report.errors.push(m.text());else if(m.type()==='warning')report.notices.push(m.text());});await page.locator('[data-ledger-total]').waitFor();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1400,1000));}
async function transport(proposals,fail=false){await app.evaluate((_e,{proposals,fail})=>{globalThis.qaS11={proposals,fail};globalThis.fetch=async()=>{if(globalThis.qaS11.fail)return new Response(JSON.stringify({error:{message:'synthetic invalid'}}),{status:400,headers:{'content-type':'application/json'}});return new Response(JSON.stringify({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({schemaVersion:'bk-candidate.v1',candidates:globalThis.qaS11.proposals,warnings:[]})}}]}),{status:200,headers:{'content-type':'application/json'}});};},{proposals,fail});}
function proposal(amountFen,name,extra={}){const p={amountFen,occurredDate:'2026-09-09',occurredTime:null,timePrecision:'date',name,merchant:null,categoryId:'cat_food',transactionKind:'expense',amountBasis:'line_payment',groupKey:crypto.randomUUID(),lineItems:[],evidence:[],missingFields:[],warnings:[],confidence:1,...extra};p.evidence=['amountFen','occurredDate','name','categoryId','transactionKind','amountBasis'].filter(f=>p[f]!==null).map(field=>({field,text:String(p[field]),source:'image',region:{x:0.05,y:0.05,width:0.9,height:0.1}}));return p;}
async function source(proposals,fail=false){
  await transport(proposals,fail);const file=path.join(localAppData,crypto.randomUUID()+'.png');
  const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const lines=['SYNTHETIC REVIEW FIXTURE',...proposals.map(p=>`${p.name??'Product unknown'} | ${p.occurredDate??'Date unknown'} | CNY ${(p.amountFen??0)/100}`),'No private user data'];
  writeFileSync(file,await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="550"><rect width="700" height="550" fill="#fff"/>${lines.map((t,i)=>`<text x="28" y="${60+i*70}" font-family="Microsoft YaHei" font-size="25">${escape(t)}</text>`).join('')}<text x="20" y="520" font-size="14">${crypto.randomUUID()}</text></svg>`)).png().toBuffer());
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  const tokens=await invoke('image.select',{}),imp=await invoke('image.import',{selectionTokens:tokens.tokens,retention:'keep_original'}),a=imp.results[0].asset;
  const prepared=await invoke('image.prepare',{imageAssetId:a.id,expectedVersion:a.version,crop:null,masks:[],retainOriginal:true});
  const job=(await invoke('recognition.start',{images:[{imageAssetId:prepared.id,preparedHash:prepared.preparedHash}],provider:'deepseek',promptVersion:'bk-receipt.s10.v1',uploadConsent:[{preparedHash:prepared.preparedHash,confirmed:true,noticeVersion:'recognition.v1'}],forceNew:false,reason:null})).jobs[0];
  await until(async()=>['failed','completed'].includes((await invoke('recognition.status',{jobId:job.id,statusFilter:[],page:pageArg})).status));
  return {job,candidates:(await drafts()).filter(c=>c.jobId===job.id).sort((a,b)=>a.ordinal-b.ordinal)};
}
const sql=()=>app.evaluate(({app})=>{const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),Db=require('better-sqlite3');const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),pointer=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),db=new Db(path.join(root,'data/generations',pointer.generationId,'ledger.db'),{readonly:true});try{return {schema:db.pragma('user_version',{simple:true}),formal:db.prepare('SELECT count(*) n,sum(amount_fen) total FROM "transaction" WHERE deleted_at IS NULL').get(),candidates:db.prepare('SELECT id,review_state,posted_transaction_id,current_json,version FROM candidate ORDER BY id').all(),jobs:db.prepare('SELECT id,status,error_code,candidate_count FROM import_job ORDER BY id').all(),events:db.prepare('SELECT candidate_id,action,reason,transaction_id,mutation_id,before_json,after_json FROM review_event ORDER BY created_at,id').all(),postings:db.prepare('SELECT * FROM review_posting').all(),quick:db.pragma('quick_check'),fk:db.pragma('foreign_key_check')};}finally{db.close();}});
const writable=sql=>app.evaluate(({app},sql)=>{const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),Db=require('better-sqlite3'),root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),p=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),db=new Db(path.join(root,'data/generations',p.generationId,'ledger.db'));try{db.exec(sql);}finally{db.close();}},sql);
async function tick(id){const c=card(id);await c.locator('img').first().waitFor();await until(async()=>await c.getByRole('checkbox',{name:'确认实付金额',exact:true}).isEnabled());for(const label of ['实付金额','实际日期及时间精度','购买物或服务名称','分类'])await c.getByRole('checkbox',{name:'确认'+label,exact:true}).check();}

const modal=()=>page.getByRole('dialog',{name:'确认本笔入账'});
const approveButton=id=>card(id).getByRole('button',{name:'批准本笔',exact:true});
const cancel=async()=>{await modal().getByRole('button',{name:'取消',exact:true}).click();await until(async()=>await modal().count()===0);};
const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function noPreview(id,label,init={}){
  const field=card(id).getByLabel('处理理由',{exact:true});await field.focus();
  await field.evaluate((el,init)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',ctrlKey:true,bubbles:true,cancelable:true,...init})),init);
  await frames();assert.equal(await page.getByRole('dialog').count(),0,label);check(label);
}
async function assertNoPosting(label){const s=await sql();assert.equal(s.formal.n,0);assert.equal(s.events.filter(e=>e.action==='approve').length,0);assert.equal(s.postings.length,0);check(label,s.formal);}
async function summary(name,date,category,amount,time){
  await modal().waitFor();const text=await modal().innerText();
  for(const value of [name,date,category,amount,time,'将入账1笔'])assert(text.includes(value),JSON.stringify({value,text}));
  report.dialogs??=[];report.dialogs.push({text,html:await modal().evaluate(el=>el.outerHTML)});
}
async function layout(width,height,name){
  await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
  const dimensions=await modal().evaluate(el=>{const r=el.getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth};});
  assert(dimensions.left>=0&&dimensions.right<=dimensions.width&&dimensions.top>=0&&dimensions.bottom<=dimensions.height);
  assert(dimensions.scrollWidth<=dimensions.clientWidth);
  for(const name of ['取消','确认本笔入账']){const b=modal().getByRole('button',{name,exact:true});await b.scrollIntoViewIfNeeded();assert(await b.isVisible());assert(await b.isEnabled());}
  await screen(name);check(name,dimensions);
}
try{
  await launch();
  await invoke('settings.saveSecret',{action:'save',expectedVersion:(await invoke('settings.readStatus',{})).version,persistence:'session',secret:'synthetic-s11-never-network'});
  const fixtures=(await source([
    proposal(9900,'单笔确认规格核验'),
    proposal(2350,'焦点第二笔',{occurredDate:'2026-09-10',occurredTime:'12:34',timePrecision:'minute',categoryId:'cat_fruit'}),
    proposal(430,'缺字段',{occurredDate:null,timePrecision:'unknown',categoryId:null,missingFields:['occurredDate','categoryId']}),
    proposal(520,'风险未处理',{transactionKind:'refund',warnings:[{code:'NON_EXPENSE',field:'transactionKind',message:'退款须核实'}]}),
    proposal(620,'图片不可读'),proposal(720,'已拒绝候选')
  ])).candidates;
  const [a,b,missing,risk,unreadable,rejected]=fixtures;report.fixtureIds=fixtures.map(c=>c.id);
  await invoke('candidate.reject',{id:rejected.id,expectedVersion:rejected.version,reason:'测试拒绝门控'});
  await nav('review');await card(a.id).waitFor();
  await noPreview(a.id,'unchecked-cannot-preview');
  await tick(a.id);await tick(b.id);
  await card(b.id).getByLabel('购买物或服务名称',{exact:true}).press('Control+Enter');
  await summary('焦点第二笔','2026-09-10','水果','¥23.50','12:34（精确到分钟）');
  await assertNoPosting('focused-second-card-preview-zero-transactions-audit-posting');
  const final=modal().getByRole('button',{name:'确认本笔入账',exact:true});await final.focus();
  await final.press('Control+Enter');await final.press('Control+Enter');await frames();
  assert.equal(await modal().count(),1);await assertNoPosting('existing-modal-ctrl-enter-never-confirms');
  await cancel();await assertNoPosting('cancel-zero-transactions-audit-posting');
  for(const [label,init] of [['IME-isComposing',{isComposing:true}],['IME-keyCode229',{keyCode:229}],['auto-repeat',{repeat:true}]])await noPreview(a.id,label,init);
  await card(a.id).getByLabel('处理理由',{exact:true}).dispatchEvent('compositionstart');
  await noPreview(a.id,'IME-composition-session');
  await card(a.id).getByLabel('处理理由',{exact:true}).dispatchEvent('compositionend');
  // Actual keyboard repeat on an enabled native button must not fall through to its Enter click.
  await approveButton(a.id).focus();await approveButton(a.id).evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,repeat:true,bubbles:true,cancelable:true})));
  await frames();assert.equal(await modal().count(),0);check('repeat-on-enabled-button-no-native-default-approval');
  await page.getByRole('button',{name:'重新读取',exact:true}).focus();await page.keyboard.press('Control+Enter');await frames();assert.equal(await modal().count(),0);check('focus-outside-card-no-implicit-target');
  await card(a.id).getByRole('checkbox',{name:'加入批量批准',exact:true}).check();await card(b.id).getByRole('checkbox',{name:'加入批量批准',exact:true}).check();
  await page.getByRole('button',{name:'预览批量批准',exact:true}).click();
  const batchModal=page.getByRole('dialog',{name:'批量批准预览'});await batchModal.waitFor();
  await batchModal.getByRole('button',{name:'确认入账2笔',exact:true}).press('Control+Enter');await frames();assert.equal(await batchModal.count(),1);assert.equal(await modal().count(),0);
  await batchModal.getByRole('button',{name:'取消',exact:true}).click();await assertNoPosting('batch-modal-ctrl-enter-and-cancel-zero-write');
  await approveButton(a.id).focus();await approveButton(a.id).press('Control+Enter');
  await summary('单笔确认规格核验','2026-09-09','餐饮','¥99.00','仅日期，精确时间未知');
  await layout(1400,1000,'single-preview-1400x1000');await layout(640,700,'single-preview-640x700');await cancel();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1400,1000));
  // Unmodified Enter and Space still activate the preview button.
  for(const key of ['Enter','Space']){await approveButton(a.id).press(key);await modal().waitFor();await cancel();}
  check('normal-enter-space-and-mouse-cancel-operable');
  await approveButton(a.id).click();await cancel();
  await card(a.id).getByLabel('商户',{exact:true}).fill('未保存不能批准');
  await noPreview(a.id,'dirty-cannot-preview');
  await page.locator('[data-nav-item="ledger"]').evaluate(el=>el.click());
  const leave=page.getByRole('dialog',{name:'还有未保存的补填'});await leave.waitFor();await leave.getByRole('button',{name:'继续补填',exact:true}).press('Control+Enter');await frames();assert.equal(await leave.count(),1);assert.equal(await modal().count(),0);
  await leave.getByRole('button',{name:'继续补填',exact:true}).click();assert.equal(await card(a.id).getByLabel('商户',{exact:true}).inputValue(),'未保存不能批准');check('navigation-modal-ctrl-enter-preserves-unsaved-input');
  await card(a.id).getByLabel('处理理由',{exact:true}).fill('保存合成补填');await card(a.id).getByRole('button',{name:'保存补填',exact:true}).click();await until(async()=>(await cand(a.id)).current.merchant==='未保存不能批准');
  await noPreview(a.id,'saved-version-needs-new-four-checks');
  await noPreview(missing.id,'missing-date-category-cannot-preview');await noPreview(risk.id,'unresolved-risk-cannot-preview');await noPreview(rejected.id,'rejected-cannot-preview');
  // Make the real prepared resource unavailable in this isolated DB, then restore it.
  await writable(`UPDATE image_asset SET prepared_ref=prepared_ref||'.qa-unreadable' WHERE id='${unreadable.imageAssetId}'`);
  await nav('ledger');await nav('review');await until(async()=>await card(unreadable.id).getByText('来源图片暂不可读，当前不能核对批准。',{exact:true}).count()>0);
  await noPreview(unreadable.id,'unreadable-source-cannot-preview');
  await writable(`UPDATE image_asset SET prepared_ref=replace(prepared_ref,'.qa-unreadable','') WHERE id='${unreadable.imageAssetId}'`);
  // Source is shared by all proposals; remount after restoring the resource.
  await nav('ledger');await nav('review');await tick(a.id);
  await approveButton(a.id).press('Control+Enter');
  let old=await cand(a.id);await invoke('candidate.update',{id:a.id,expectedVersion:old.version,action:'edit',patch:{merchant:'外部更新候选'},reason:'验证陈旧确认'});
  await modal().getByRole('button',{name:'确认本笔入账',exact:true}).click();await until(async()=>await modal().count()===0);await page.getByRole('alert').waitFor();await assertNoPosting('candidate-changed-after-preview-rejected-zero-write');
  await page.getByRole('button',{name:'重新读取',exact:true}).click();await tick(a.id);await approveButton(a.id).press('Control+Enter');
  const cat=(await invoke('category.list',{})).categories.find(c=>c.id==='cat_food');
  await invoke('category.update',{id:cat.id,expectedVersion:cat.version,patch:{name:'餐饮已更新'}});
  assert((await modal().innerText()).includes('餐饮'));assert(!(await modal().innerText()).includes('餐饮已更新'));
  await modal().getByRole('button',{name:'确认本笔入账',exact:true}).click();await until(async()=>await modal().count()===0);await assertNoPosting('category-changed-after-preview-rejected-zero-write');
  await page.getByRole('button',{name:'重新读取',exact:true}).click();await tick(a.id);await approveButton(a.id).press('Control+Enter');await summary('单笔确认规格核验','2026-09-09','餐饮已更新','¥99.00','精确时间未知');await cancel();
  await nav('ledger');await page.keyboard.press('Control+Enter');await frames();assert.equal(await page.getByRole('dialog').count(),0);check('unmounted-review-has-no-shortcut-listener');
  await nav('review');await tick(a.id);await approveButton(a.id).press('Control+Enter');await cancel();check('remounted-review-registers-once');
  // Delay only test IPC delivery, then call the original real handler unchanged.
  await app.evaluate(({ipcMain})=>{
    const channel='candidate.approve',original=ipcMain._invokeHandlers.get(channel);if(!original)throw Error('Missing real IPC handler');
    globalThis.qaApprovalCalls=0;globalThis.qaApprovalGate=new Promise(resolve=>{globalThis.qaReleaseApproval=resolve;});
    ipcMain.removeHandler(channel);ipcMain.handle(channel,async(...args)=>{globalThis.qaApprovalCalls++;await globalThis.qaApprovalGate;return original(...args);});
  });
  old=await cand(a.id);await approveButton(a.id).press('Control+Enter');
  await modal().getByRole('button',{name:'确认本笔入账',exact:true}).evaluate(el=>{el.click();el.click();});
  await until(async()=>await modal().getByRole('button',{name:'正在原子入账…',exact:true}).isDisabled());
  await modal().dispatchEvent('keydown',{key:'Enter',ctrlKey:true,repeat:true});await frames();
  assert.equal(await app.evaluate(()=>globalThis.qaApprovalCalls),1);assert.equal((await sql()).formal.n,0);check('busy-double-click-repeat-starts-only-one-real-IPC');
  await app.evaluate(()=>globalThis.qaReleaseApproval());await until(async()=>(await cand(a.id)).reviewState==='approved');
  let s=await sql();assert.deepEqual(s.formal,{n:1,total:9900});assert.equal(s.events.filter(e=>e.action==='approve').length,1);check('explicit-final-confirmation-posts-once');
  await card(a.id).getByRole('button',{name:'下一笔',exact:true}).focus();await page.keyboard.press('Control+Enter');await frames();assert.equal(await modal().count(),0);check('approved-card-cannot-preview-another-candidate');
  const replay=await invoke('candidate.approve',{mode:'single',...item(old)});assert(replay.alreadyApproved);assert.equal((await sql()).formal.n,1);
  const duplicate=(await source([proposal(9900,'单笔确认规格核验')])).candidates[0];
  await nav('ledger');await nav('review');await noPreview(duplicate.id,'unresolved-duplicate-cannot-preview');
  await tick(b.id);await approveButton(b.id).press('Control+Enter');
  await modal().getByRole('button',{name:'确认本笔入账',exact:true}).press('Space');await until(async()=>(await cand(b.id)).reviewState==='approved');assert.equal((await sql()).formal.n,2);check('final-space-explicitly-approves-focused-second-candidate');
  const enterCandidate=(await source([proposal(3550,'Enter显式确认',{occurredDate:'2026-09-11'})])).candidates[0];
  await nav('ledger');await nav('review');await tick(enterCandidate.id);await approveButton(enterCandidate.id).press('Control+Enter');
  await modal().getByRole('button',{name:'确认本笔入账',exact:true}).press('Enter');await until(async()=>(await cand(enterCandidate.id)).reviewState==='approved');check('final-enter-explicitly-confirms-without-shortcut-bypass');
  await app.close();app=null;await launch();
  assert((await invoke('candidate.approve',{mode:'single',...item(old)})).alreadyApproved);
  s=await sql();assert.deepEqual(s.formal,{n:3,total:15800});assert.equal(s.events.filter(e=>e.action==='approve').length,3);assert.deepEqual(s.fk,[]);assert.equal(s.quick[0].quick_check,'ok');report.finalSql=s;check('actual-restart-and-retry-zero-new-transaction-or-approve-audit');
  // The deliberately missing prepared image may log resource errors; preserve these separately.
  report.expectedResourceErrors=report.errors.filter(e=>/Failed to load resource|ERR_FILE_NOT_FOUND/.test(e));
  report.errors=report.errors.filter(e=>!report.expectedResourceErrors.includes(e));assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.failure=String(e.stack??e);if(page&&!page.isClosed())await screen('ui-failure').catch(()=>{});process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});writeFileSync(path.join(target,'review-ui.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,failure:report.failure}));
