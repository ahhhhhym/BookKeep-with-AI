/** Isolated Electron UI integration: no real secrets or external recognition. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES,'qa.cjs'))('playwright');
const out=process.env.BOOKKEEP_QA_OUTPUT;assert(out);mkdirSync(out,{recursive:true});assert(!readable(path.join(out,'result.json')),'new output required');
function readable(p){try{readFileSync(p);return true;}catch{return false;}}
const report={ok:false,checks:[],failures:[],errors:[],screens:[],geometry:[],hashes:[],localAppData:mkdtempSync(path.join(tmpdir(),'BookKeep V020 合成 ')),networkRequests:0};
let app,page;
const save=()=>writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
async function check(id,fn){try{await fn();report.checks.push(id);console.log('PASS '+id);}catch(e){report.failures.push({id,error:e.stack});console.log('FAIL '+id+' '+e.message);throw e;}finally{save();}}
const until=async fn=>{const end=Date.now()+10000;while(!await fn()){if(Date.now()>end)throw Error('condition timeout');await new Promise(r=>setTimeout(r,50));}};
const raw=(method,input={},options)=>page.evaluate(async({method,input,options})=>{const [g,m]=method.split('.');return window.bookkeep[g][m](input,options);},{method,input,options});
const api=async(m,i={},o)=>{const r=await raw(m,i,o);assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;};
const screen=async name=>{const p=path.join(out,name+'.png');await page.screenshot({path:p});report.screens.push(p);};
const nav=async id=>{if(['import','queue','review'].includes(id)){await page.locator('[data-nav-item="ai"]').click();await page.getByRole('group',{name:'AI记账子页'}).getByRole('button',{name:({import:'图片导入',queue:'任务队列',review:'候选审核'})[id],exact:true}).click();}else await page.locator(`[data-nav-item="${id}"]`).click();await page.locator(`[data-nav="${id}"]`).waitFor();await page.locator('[data-main-transition][data-phase="stable"]').waitFor();};
const card=id=>page.locator(`[data-candidate-id="${id}"]`);
try{
 app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT,'--force-device-scale-factor=1'],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:report.localAppData}),timeout:30000});
 await app.evaluate(({session})=>{globalThis.qaHttp=0;globalThis.qaPayloads=[];globalThis.fetch=async(_url,o)=>{globalThis.qaHttp++;const body=JSON.parse(o.body);globalThis.qaPayloads.push(body);return new Response(JSON.stringify({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({schemaVersion:'bk-candidate.v1',candidates:globalThis.qaProposals??[],warnings:[]})}}]}),{status:200,headers:{'content-type':'application/json'}});};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));});
 page=await app.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(e.message));await page.locator('[data-ledger-total]').waitFor();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1400,950));

 const file=path.join(report.localAppData,'synthetic.png');writeFileSync(file,await sharp({create:{width:200,height:150,channels:3,background:'#abc'}}).png().toBuffer());
 await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),file);
 const s=await api('image.select'),imp=await api('image.import',{selectionTokens:s.tokens,retention:'keep_original'}),a=imp.results[0].asset;
 const p=await api('image.prepare',{imageAssetId:a.id,expectedVersion:a.version,crop:null,masks:[],retainOriginal:true});
 const job=(await api('recognition.start',{images:[{imageAssetId:p.id,preparedHash:p.preparedHash}],provider:'mock',promptVersion:'bk-receipt.s10.v1',uploadConsent:[{preparedHash:p.preparedHash,confirmed:true,noticeVersion:'recognition.v1'}],forceNew:false,reason:null})).jobs[0];
 await until(async()=>(await api('recognition.status',{jobId:job.id,statusFilter:[],page:{limit:100,cursor:null}})).status==='completed');
 const cs=(await api('candidate.list',{jobId:job.id,page:{limit:100,cursor:null}})).items;assert.equal(cs.length,2);const [one,two]=cs;
 await api('candidate.update',{id:two.id,expectedVersion:two.version,action:'edit',reason:'合成同组测试',patch:{groupKey:one.current.groupKey}});
 await nav('review');
 for(const test of ['own-discard-cancel','sibling-draft-lifecycle'])try{await check(test,async()=>{
  if(test==='own-discard-cancel'){
   await card(one.id).getByLabel('购买物或服务名称',{exact:true}).fill('已放弃的草稿');await card(one.id).getByRole('button',{name:'删除本笔',exact:true}).click();
   await page.getByRole('button',{name:'放弃修改并继续',exact:true}).click();await page.getByRole('dialog',{name:'删除本笔候选'}).getByRole('button',{name:'取消',exact:true}).click();
   assert.equal(await card(one.id).getByLabel('购买物或服务名称',{exact:true}).inputValue(),one.current.name);
  }else{
   await card(two.id).getByLabel('购买物或服务名称',{exact:true}).fill('另一笔未保存');await card(one.id).getByRole('button',{name:'删除本笔',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
   await page.getByRole('dialog',{name:'还有未保存的补填'}).waitFor();await page.getByRole('button',{name:'继续补填',exact:true}).click();
   assert.equal(await card(two.id).getByLabel('购买物或服务名称',{exact:true}).inputValue(),'另一笔未保存');
   const current=(await api('candidate.list',{jobId:job.id,page:{limit:100,cursor:null}})).items.find(c=>c.id===one.id);assert.equal(current.reviewState,'pending_review');
  }
 });}catch{}
 if(!report.failures.length)await check('main stale category failure clears checks and focuses red category',async()=>{
  await page.locator('[data-nav-item="ai"]').click();await page.getByRole('group',{name:'AI记账子页'}).getByRole('button',{name:'任务队列',exact:true}).click();await page.getByRole('button',{name:'放弃未保存修改并离开',exact:true}).click();await nav('review');
  let latest=(await api('candidate.list',{jobId:job.id,page:{limit:100,cursor:null}})).items.find(c=>c.id===one.id);
  latest=await api('candidate.update',{id:latest.id,expectedVersion:latest.version,action:'edit',reason:'合成有效字段',patch:{amountFen:1800,occurredDate:'2026-11-04',occurredTime:null,timePrecision:'date',name:'合成有效支出',categoryId:'cat_food',transactionKind:'expense',amountBasis:'line_payment'}});
  for(const warning of latest.warnings){if(latest.resolvedWarnings.includes(warning.code+':'+(warning.field??'')))continue;latest=await api('candidate.update',{id:latest.id,expectedVersion:latest.version,action:'resolve_warning',warningCode:warning.code,field:warning.field,reviewDigest:latest.reviewDigest,reason:'合成字段证据复核'});}
  await nav('queue');await nav('review');
  const checks=card(one.id).locator('input[aria-label^="确认"]');await until(async()=>await checks.first().isEnabled());for(const c of await checks.all())await c.check();await card(one.id).getByRole('button',{name:'批准本笔',exact:true}).click();
  const category=(await api('category.list')).categories.find(c=>c.id==='cat_food');await api('category.disable',{id:category.id,expectedVersion:category.version});await page.getByRole('button',{name:'确认本笔入账',exact:true}).click();
  await until(async()=>await card(one.id).locator('[data-review-field="categoryId"]').getAttribute('aria-invalid')==='true');await until(()=>card(one.id).locator('[data-review-field="categoryId"]').evaluate(e=>e===document.activeElement));assert.equal(await card(one.id).locator('input[type="checkbox"]:checked').count(),0);
 });
 report.ok=report.failures.length===0;await screen('review-guards');
}catch(e){report.fatal=e.stack;try{report.dom=await page.locator('body').innerText();await screen('failure');}catch{}}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});save();}process.exit(report.ok?0:1);
