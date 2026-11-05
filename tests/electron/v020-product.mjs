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
 await check('G01 meaningful isolated screen, no startup modal',async()=>{assert.match(page.url(),/^bookkeep:\/\/app/);assert.equal(await page.locator('dialog[open]').count(),0);});
 await check('N01/N02 nine paired SVG states, keyboard, themes and layouts',async()=>{
  for(const theme of ['light','dark']){await api('appearance.apply',theme);
   for(const layout of ['detailed','compact','drawer']){
    await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setContentSize(w,950),layout==='drawer'?850:1400);
    if(layout==='drawer')await page.locator('.nav-toggle').click();
    else if(await page.locator('.app').getAttribute('data-nav-mode')!==layout)await page.locator('.nav-mode-toggle').click();
    for(const id of ['ledger','statistics','ai','data','achievements','settings']){
     if(layout==='drawer'&&await page.locator('#main-nav').getAttribute('data-open')!=='true')await page.locator('.nav-toggle').click();
     const b=page.locator('[data-nav-item="'+id+'"]');await b.focus();await page.keyboard.press('Enter');await page.locator('[data-main-transition][data-phase="stable"]').waitFor();
     const selected=page.locator('[data-nav-item="'+id+'"] svg');assert.equal(await selected.getAttribute('data-variant'),'solid');
     const all=await page.locator('.nav-item svg').evaluateAll(ns=>ns.map(n=>({name:n.dataset.navigationIcon,variant:n.dataset.variant,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));for(const n of all){assert.equal(n.variant,n.name===id?'solid':'outline');if(n.width){assert(Math.abs(n.width-23.28)<.1);assert.equal(n.width,n.height);}}report.geometry.push({theme,layout,id,all});
    }
   }
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1400,950));if(await page.locator('.app').getAttribute('data-nav-mode')!=='detailed')await page.locator('.nav-mode-toggle').click();
  for(const id of ['import','queue','review']){await nav(id);assert.equal(await page.locator('[data-nav-item="ai"] svg').getAttribute('data-variant'),'solid');assert.equal(await page.locator(`.ai-switcher [aria-pressed="true"] svg`).getAttribute('data-navigation-icon'),id);}
  await screen('navigation-dark');
 });
 await check('T01/T02/T03 all AI pages share peak/offpeak/unknown, focus+resume refresh, mock excludes',async()=>{
  await page.evaluate(()=>{globalThis.qaRealNow=Date.now;globalThis.qaNow=Date.parse('2026-11-04T01:00:00Z');Date.now=()=>globalThis.qaNow;window.dispatchEvent(new Event('focus'));});
  for(const id of ['import','queue','review']){await nav(id);await page.locator('[data-billing-state="peak"]').waitFor();assert(await page.getByText('当前处于 DeepSeek API 计费高峰时段，调用费用可能高于空闲时段，具体以官方计费为准。',{exact:true}).isVisible());}
  await page.evaluate(()=>{globalThis.qaNow=Date.parse('2026-11-04T04:00:00Z');window.dispatchEvent(new Event('focus'));});await page.locator('[data-billing-state="off_peak"]').waitFor({state:'attached'});assert.equal(await page.getByText('当前处于 DeepSeek API 计费高峰时段，调用费用可能高于空闲时段，具体以官方计费为准。',{exact:true}).count(),0);
  await page.evaluate(()=>{globalThis.qaNow=Date.parse('2027-01-01T01:00:00Z');});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('window.runtimeResumed'));await page.locator('[data-billing-state="unknown"]').waitFor();
  await app.evaluate(({shell})=>{globalThis.qaDocs=[];shell.openExternal=async url=>{globalThis.qaDocs.push(url);};});assert.equal(await page.getByText(/按当前识别接口及北京时间判断/).count(),0);assert.equal(await page.getByRole('link',{name:'官方说明',exact:true}).count(),0);await api('windowLifecycle.openBillingDocs');await until(async()=>await app.evaluate(()=>globalThis.qaDocs.length)===1);assert.deepEqual(await app.evaluate(()=>globalThis.qaDocs),['https://api-docs.deepseek.com/zh-cn/quick_start/pricing/']);
  await nav('import');await page.getByLabel('当前识别接口',{exact:true}).selectOption('mock');assert.equal(await page.locator('[data-billing-state]').count(),0);
  await page.getByLabel('当前识别接口',{exact:true}).selectOption('deepseek');await page.evaluate(()=>{Date.now=globalThis.qaRealNow;window.dispatchEvent(new Event('focus'));});assert.equal(await app.evaluate(()=>globalThis.qaHttp),0);
 });
 await check('P01 offline policy 0.2.0, release date, fixed copy and focus return',async()=>{
  await nav('settings');await page.getByRole('button',{name:'隐私政策',exact:true}).click();const modal=page.getByRole('dialog');assert.match(await modal.innerText(),/2026-11-05/);assert.match(await modal.innerText(),/瀚宇铭/);await modal.getByRole('button',{name:'复制全文'}).click();await page.getByText('全文已复制',{exact:true}).waitFor();const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.match(copied,/候选/);assert.match(copied,/计费/);report.policyCopyHash=createHash('sha256').update(copied).digest('hex');await screen('privacy');await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
 });
 let baseHash;
 await check('I01 single editor, keyboard crop/mask/reset/scale, save updates current image, local operations 0 requests',async()=>{
  const file=path.join(report.localAppData,'synthetic-image.png');writeFileSync(file,await sharp({create:{width:400,height:300,channels:3,background:'#dfc7a2'}}).png().toBuffer());
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),file);
  await nav('import');await page.getByRole('button',{name:'选择图片',exact:true}).click();await page.locator('canvas').waitFor();
  assert.equal(await page.locator('.rect-fields,input[type="number"]').count(),0);assert.equal(await page.getByText('核对原图（仅本地）与本次上传图',{exact:true}).count(),0);
  await until(async()=>await page.getByRole('button',{name:'保存处理（仅本地）',exact:true}).isEnabled());
  await page.locator('canvas').focus();await page.keyboard.press('Alt+ArrowLeft');await page.keyboard.press('Alt+ArrowUp');await page.getByRole('button',{name:'添加遮盖',exact:true}).click();await page.getByRole('button',{name:'选择遮盖1',exact:true}).click();await page.keyboard.press('Shift+ArrowRight');await page.getByRole('button',{name:'保存处理（仅本地）',exact:true}).click();
  await page.getByText('处理图已保存，当前编辑区已更新。开始识别时请重新检查并同意上传。',{exact:true}).waitFor();
  assert.match(await page.locator('.image-editor [role="status"]').innerText(),/399×299/);baseHash=await page.evaluate(async()=>{return 'saved';});await screen('single-image-editor');assert.equal(await app.evaluate(()=>globalThis.qaHttp),0);
 });
 await check('I02 dirty navigation three choices; save failure keeps draft and cancels continuation; retry same intent',async()=>{
  await page.getByRole('button',{name:'选择裁剪框',exact:true}).click();await page.keyboard.press('Alt+ArrowLeft');await page.locator('[data-nav-item="statistics"]').click();await page.getByRole('dialog',{name:'有未保存的图片修改'}).waitFor();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await page.locator('.app').getAttribute('data-nav'),'import');
  await app.evaluate(async()=>{const fs={default:process.getBuiltinModule('node:fs')};globalThis.qaOriginalRename=fs.default.renameSync;fs.default.renameSync=()=>{throw Error('synthetic storage failure');};});
  await page.locator('[data-nav-item="statistics"]').click();await page.getByRole('button',{name:'保存后继续',exact:true}).click();await page.getByText('保存尚未确认。重试使用同一提交，核实前暂时锁定编辑；也可以放弃本次修改。',{exact:true}).waitFor();assert.equal(await page.locator('.app').getAttribute('data-nav'),'import');await screen('save-failed');
  await app.evaluate(async()=>{const fs={default:process.getBuiltinModule('node:fs')};fs.default.renameSync=globalThis.qaOriginalRename;});
  await page.getByRole('button',{name:'保存后继续',exact:true}).click();await page.locator('[data-nav="statistics"]').waitFor();await nav('import');
 });
 await check('I03 immutable upload snapshot actual bytes hash, edits invalidate consent, no local recognition',async()=>{
  await page.getByRole('button',{name:/开始识别/}).click();const dialog=page.getByRole('dialog',{name:'确认本次识别'});const agree=dialog.getByRole('checkbox',{name:/我同意/});await until(()=>agree.isEnabled());await agree.check();const hashText=await dialog.locator('.hash-text').innerText();baseHash=hashText.match(/[a-f0-9]{64}/)[0];await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'添加遮盖',exact:true}).click();assert(await page.getByRole('button',{name:/开始识别/}).isDisabled());await page.getByRole('button',{name:'保存处理（仅本地）',exact:true}).click();await until(async()=>await page.getByRole('button',{name:/开始识别/}).isEnabled());await page.getByRole('button',{name:/开始识别/}).click();assert.equal(await agree.isChecked(),false);await until(()=>agree.isEnabled());const newHash=(await dialog.locator('.hash-text').innerText()).match(/[a-f0-9]{64}/)[0];assert.notEqual(newHash,baseHash);await agree.check();
  const status=await api('settings.readStatus');await api('settings.saveSecret',{action:'save',secret:'synthetic-only-never-a-real-key',persistence:'session',expectedVersion:status.version});
  await dialog.getByRole('button',{name:'上传并识别',exact:true}).click();await until(async()=>await app.evaluate(()=>globalThis.qaPayloads.length)>0);
  const dataUrl=await app.evaluate(()=>globalThis.qaPayloads[0].messages[1].content.find(x=>x.type==='image_url').image_url.url);const bytes=Buffer.from(dataUrl.split(',')[1],'base64');assert.equal(createHash('sha256').update(bytes).digest('hex'),newHash);report.hashes.push({baseHash,newHash,actual:createHash('sha256').update(bytes).digest('hex')});
 });
 let candidate;
 await check('R01/R02/R04 missing errors on entry, immediate correction, delete cancel/confirm/filter/restore clears checks',async()=>{
  await nav('import');await page.getByLabel('当前识别接口',{exact:true}).selectOption('mock');
  const s=await api('image.select');const imp=await api('image.import',{selectionTokens:s.tokens,retention:'keep_original'});const a=imp.results[0].asset;const p=await api('image.prepare',{imageAssetId:a.id,expectedVersion:a.version,crop:null,masks:[],retainOriginal:true});
  const job=(await api('recognition.start',{images:[{imageAssetId:p.id,preparedHash:p.preparedHash}],provider:'mock',promptVersion:'bk-receipt.s10.v1',uploadConsent:[{preparedHash:p.preparedHash,confirmed:true,noticeVersion:'recognition.v1'}],forceNew:true,reason:'synthetic UI review'})).jobs[0];
  await until(async()=>['failed','completed'].includes((await api('recognition.status',{jobId:job.id,statusFilter:[],page:{limit:100,cursor:null}})).status));
  candidate=(await api('candidate.list',{jobId:job.id,page:{limit:100,cursor:null}})).items[0];assert(candidate,'mock must produce a candidate');
  await api('candidate.update',{id:candidate.id,expectedVersion:candidate.version,action:'edit',reason:'synthetic missing fields',patch:{amountFen:null,occurredDate:null,occurredTime:null,timePrecision:'unknown',name:null,categoryId:null}});
  await nav('review');await card(candidate.id).waitFor();
  assert.equal(await card(candidate.id).locator('[aria-invalid="true"]').count(),4);await card(candidate.id).getByRole('button',{name:'批准本笔',exact:true}).click();assert.equal(await card(candidate.id).locator('[data-review-field="amountFen"]').evaluate(e=>e===document.activeElement),true);
  await card(candidate.id).getByLabel('实付金额（元）',{exact:true}).fill('12.34');assert.equal(await card(candidate.id).locator('[aria-invalid="true"]').count(),3);
  await card(candidate.id).getByLabel('完整实际日期',{exact:true}).fill('2026-11-04');await card(candidate.id).getByLabel('购买物或服务名称',{exact:true}).fill('合成补填');await card(candidate.id).getByLabel('分类',{exact:true}).selectOption('cat_food');assert.equal(await card(candidate.id).locator('[aria-invalid="true"]').count(),0);
  await card(candidate.id).getByLabel('处理理由',{exact:true}).fill('合成图对照补填');await card(candidate.id).getByRole('button',{name:'保存补填',exact:true}).click();await until(async()=>(await api('candidate.list',{jobId:job.id,page:{limit:100,cursor:null}})).items[0].current.name==='合成补填');candidate=(await api('candidate.list',{jobId:job.id,page:{limit:100,cursor:null}})).items[0];await screen('required-fields-corrected');
  await card(candidate.id).getByRole('button',{name:'删除本笔',exact:true}).click();await page.getByRole('dialog',{name:'删除本笔候选'}).getByRole('button',{name:'取消',exact:true}).click();assert.equal((await api('candidate.list',{jobId:job.id,page:{limit:100,cursor:null}})).items[0].reviewState,'pending_review');
  await card(candidate.id).getByRole('button',{name:'删除本笔',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.getByRole('group',{name:'候选状态筛选'}).getByRole('button',{name:/^已删除/}).click();await card(candidate.id).waitFor();assert.equal(await card(candidate.id).getByRole('button',{name:'批准本笔',exact:true}).count(),0);await screen('deleted-candidate');
  await card(candidate.id).getByRole('button',{name:'恢复本笔',exact:true}).click();await page.getByRole('button',{name:'确认恢复',exact:true}).click();await until(async()=>await card(candidate.id).count()===0);await page.getByRole('group',{name:'候选状态筛选'}).getByRole('button',{name:/^待审核/}).click();await card(candidate.id).waitFor();assert.equal(await card(candidate.id).locator('input[type="checkbox"]:checked').count(),0);
  const current=(await api('candidate.list',{jobId:job.id,page:{limit:100,cursor:null}})).items[0];assert.deepEqual(current.current,candidate.current);assert.equal(current.reviewState,'pending_review');
 });
 await check('I02 native close event uses image three-choice; cancel keeps window; discard closes once',async()=>{
  await nav('import');await page.getByRole('button',{name:'添加遮盖',exact:true}).click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.getByRole('dialog',{name:'有未保存的图片修改'}).waitFor();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  report.mockTransportCalls=await app.evaluate(()=>globalThis.qaHttp);assert.equal(report.mockTransportCalls,1);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.getByRole('dialog',{name:'有未保存的图片修改'}).waitFor();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await until(async()=>await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length).catch(()=>0)===0);
 });
 report.externalRecognitionRequests=0;assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.fatal=e.stack;try{await screen('failure');report.dom=await page.locator('body').innerText();}catch{}}
finally{if(app)await app.close().catch(()=>{});save();}
process.exit(report.ok?0:1);
