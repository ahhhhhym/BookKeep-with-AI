/** S13 implementation SELFTEST: actual Electron UI, preload IPC, file persistence. All inputs synthetic. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const require=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES??path.join(ROOT,'node_modules'),'__qa__.cjs'));
const {_electron}=require('playwright');
const target=path.resolve(process.env.BOOKKEEP_QA_OUTPUT??path.join(ROOT,'.tmp/s13-electron'));mkdirSync(target,{recursive:true});
const localAppData=mkdtempSync(path.join(tmpdir(),'BookKeep S13 中文 空格 '));
const report={ok:false,kind:'S13 implementation selftest; not stage acceptance or model training',localAppData,checks:[],errors:[],network:[],screens:[],modelTrained:false};
let app,page;
const check=(id,detail={})=>{report.checks.push({id,ok:true,detail});console.log('PASS '+id);};
const raw=(method,input)=>page.evaluate(({method,input})=>{const [g,m]=method.split('.');return window.bookkeep[g][m](input);},{method,input});
const invoke=async(method,input)=>{const r=await raw(method,input);assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;};
const cmd=c=>invoke('dataset.command',c);
const summary=()=>invoke('dataset.read',{kind:'summary',id:null});
const until=async(fn)=>{const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw Error('condition timeout');await new Promise(r=>setTimeout(r,40));}};
const shot=async(name)=>{const file=path.join(target,name+'.png');await page.screenshot({path:file});report.screens.push(file);};
async function launch(){
  app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:localAppData}),timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.locator('[data-ledger-total]').waitFor();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1400,1100));
  // Block all real API traffic in the isolated selftest. No key is configured.
  await app.evaluate(()=>{globalThis.qaDatasetHttp=0;globalThis.fetch=async()=>{globalThis.qaDatasetHttp++;throw Error('selftest forbids external HTTP');};});
  await page.locator('[data-nav-item="data"]').click();await page.locator('[data-dataset-panel]').waitFor();
}
async function formalCount(){return app.evaluate(({app})=>{const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),DB=require('better-sqlite3');const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI'),pointer=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8')),db=new DB(path.join(root,'data/generations',pointer.generationId,'ledger.db'),{readonly:true});try{return {transactions:db.prepare('SELECT count(*) n FROM "transaction"').get().n,candidates:db.prepare('SELECT count(*) n FROM candidate').get().n,integrity:db.pragma('quick_check',{simple:true})};}finally{db.close();}});}
try{
  await launch();assert((await page.locator('[data-dataset-panel]').innerText()).includes('模型未训练'));check('uiClearlySeparatesFrameworkFromTraining');
  const original=await formalCount();assert.equal(original.transactions,0);
  const im=path.join(localAppData,'synthetic-only.png');writeFileSync(im,await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="white"/><text x="30" y="80" font-size="28">SYNTHETIC ONLY - NO PRIVATE DATA</text><text x="30" y="170" font-size="28">CNY 18.00 - 2026-09-08 - lunch</text></svg>')).png().toBuffer());
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},im);
  await page.getByText('1. 选择已脱敏图片，分别确认许可、脱敏及纳入数据集',{exact:true}).click();
  await page.getByRole('button',{name:'选择已脱敏图片（只导入，不联网、不入集）',exact:true}).click();
  await page.getByRole('img',{name:'本次上传图',exact:true}).waitFor();await until(async()=>await page.getByRole('button',{name:'记录独立数据集同意',exact:true}).isEnabled());
  assert.equal((await summary()).samples.length,0);assert(await page.getByRole('button',{name:'显式登记当前样本',exact:true}).isDisabled());check('importDoesNotRegisterAndConsentDefaultsOff');
  const denied=await raw('dataset.command',{op:'register',imageAssetId:crypto.randomUUID(),preparedHash:'a'.repeat(64),kind:'synthetic',consentId:crypto.randomUUID(),predictionJobId:null,primaryScene:'synthetic',secondaryScenes:[],relations:[]});assert.equal(denied.ok,false);check('realIpcRejectsNoConsent',denied.error);
  const section=page.locator('[data-dataset-panel]');
  await section.getByLabel('来源匿名别名',{exact:true}).fill('S13 synthetic UI');await section.getByLabel('许可依据匿名别名',{exact:true}).fill('authored-synthetic');
  await section.getByLabel('登记/脱敏复核人别名',{exact:true}).fill('synthetic-human');await section.getByLabel('允许接收方范围',{exact:true}).fill('local-selftest');await section.getByLabel('保留及到期复核期限',{exact:true}).fill('2099-01-01T12:00');await section.getByLabel('素材类型',{exact:true}).selectOption('synthetic');
  await section.getByRole('checkbox',{name:'我有权提供该图及许可范围',exact:true}).check();await section.getByRole('checkbox',{name:'我已逐张检查脱敏像素及可见证据',exact:true}).check();await section.getByRole('checkbox',{name:'独立同意本地登记、人工标注和评测；不等于上传识图同意',exact:true}).check();await section.getByRole('checkbox',{name:'另行允许未来训练准备用途（本步不训练）',exact:true}).check();await section.getByRole('checkbox',{name:'允许向上述接收方导出prepared图片',exact:true}).check();
  await section.getByRole('button',{name:'记录独立数据集同意',exact:true}).click();await until(async()=>await section.getByRole('button',{name:'显式登记当前样本',exact:true}).isEnabled());assert.equal((await summary()).samples.length,0);check('datasetGrantDoesNotAutomaticallyCreateSample');
  await section.getByRole('button',{name:'显式登记当前样本',exact:true}).click();await section.getByRole('heading',{name:/人工标注/}).waitFor();const sample=(await summary()).samples[0];assert(sample);check('explicitRegistrationPersists');
  await section.getByLabel('实付人民币元（未知留空）',{exact:true}).fill('18.00');await section.getByLabel('完整日期（缺年留空）',{exact:true}).fill('2026-09-08');await section.getByLabel('购买物/服务',{exact:true}).fill('午餐');await section.getByLabel('分类',{exact:true}).selectOption('cat_food');await section.getByRole('button',{name:'加入一笔人工真值',exact:true}).click();
  await section.getByLabel('修订或关联原因',{exact:true}).fill('synthetic visible payment');await section.getByRole('button',{name:'保存人工标签/纠错版本',exact:true}).click();await until(async()=>(await summary()).samples[0].reviewStatus==='labelled');
  await section.getByRole('button',{name:'完成第二次人工复核（同人会明示记录）',exact:true}).click();await until(async()=>(await summary()).samples[0].reviewStatus==='reviewed');const record=await invoke('dataset.read',{kind:'sample',id:sample.id});assert.equal(record.sample.labels[0].value.amountFen,1800);assert.equal(record.sample.reviewMode,'same_person');assert.equal(record.history.length,3);check('actualUiLabelsAndSecondHumanReview');
  await section.getByRole('checkbox',{name:'选择样本 '+sample.id,exact:true}).check();await section.getByLabel('不可复用版本名',{exact:true}).fill('ui-synthetic.v1');await section.getByRole('button',{name:'整组划分并冻结版本/test',exact:true}).click();await until(async()=>(await summary()).versions.length===1);const version=(await summary()).versions[0];check('versionedGroupedSplitIsFrozen');
  await section.getByText('3. 校验、授权导出及推理评测',{exact:true}).click();await section.getByRole('button',{name:'校验schema、许可、图片和清单',exact:true}).click();await until(async()=>(await section.locator('.dataset-result').innerText()).includes('"valid": true'));check('actualUiSchemaValidation');
  page.on('dialog',d=>d.accept());const saveDir=path.join(localAppData,'synthetic-export');mkdirSync(saveDir);await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},saveDir);
  await section.getByRole('button',{name:'确认范围并选择目录导出',exact:true}).click();await until(async()=>readdirSync(saveDir).length===1);const exportDir=path.join(saveDir,readdirSync(saveDir)[0]);const manifest=JSON.parse(readFileSync(path.join(exportDir,'manifest.json'),'utf8'));assert.equal(manifest.includeImages,true);assert.equal(manifest.purpose,'future_training');assert.equal(JSON.parse(readFileSync(path.join(exportDir,'samples.jsonl'),'utf8')).sample.labels[0].value.amountFen,1800);check('nativeDirectoryExportProducesJsonlManifestAndImage',{files:readdirSync(exportDir)});
  await section.getByLabel('评测split',{exact:true}).selectOption('train');await section.getByRole('button',{name:'运行合成框架mock（空预测基线）',exact:true}).click();await until(async()=>(await summary()).runs[0]?.status==='completed');const run=(await summary()).runs[0];assert.equal(run.provider,'mock');await section.getByRole('button',{name:'确认盲对齐并生成分母报告',exact:true}).click();await until(async()=>(await summary()).runs[0]?.report!==null);const quality=(await summary()).runs[0].report;assert.equal(quality.modelTrained,false);assert.equal(quality.qualityConclusion,'not_evaluated');assert(quality.metrics.some(m=>m.key==='amount_exact'&&m.numerator===0&&m.denominator===1));check('actualRunnerAndFailureAwareDenominators');
  await shot('dataset-framework-untrained');
  const unsupported=await raw('dataset.command',{op:'submit',versionId:version.id});assert.equal(unsupported.error.code,'UNSUPPORTED');assert.equal(unsupported.error.details.reason,'unsupported');assert.equal(unsupported.error.retryable,false);check('trainingSubmitUnsupportedNoJobNoWeights');
  const http=await app.evaluate(()=>globalThis.qaDatasetHttp);assert.equal(http,0);assert.deepEqual(await formalCount(),original);check('datasetDoesNotAffectFormalLedgerCandidatesOrNetwork');
  await app.close();app=null;await launch();const reopened=await summary();assert.equal(reopened.samples.length,1);assert.equal(reopened.versions[0].manifestHash,version.manifestHash);assert.equal(reopened.runs[0].report.modelTrained,false);check('restartPersistsConsentLabelsVersionAndReport');
  const withdrawal=await cmd({op:'withdraw',sampleId:sample.id,reason:'synthetic withdrawal'});assert.equal(withdrawal.localDeleted,true);assert.equal(withdrawal.externalCopies,'unknown');assert.equal((await summary()).samples.length,0);const blocked=await raw('dataset.command',{op:'export',versionId:version.id,sampleIds:null,includeImages:false,purpose:'evaluation',recipient:'local-selftest',confirmed:true});assert.equal(blocked.error.code,'DATASET_WITHDRAWN');check('withdrawalDeletesLocalAndBlocksOldManifestExternalCopyUnknown');
  await page.getByRole('button',{name:'刷新真实状态',exact:true}).click();await shot('dataset-withdrawal');await app.close();app=null;await launch();assert.equal((await summary()).samples.length,0);assert.equal((await summary()).withdrawals.length,1);assert.deepEqual(await formalCount(),original);check('tombstoneSurvivesRestartAndFormalDataUnaffected');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(760,900));await shot('dataset-narrow');
  assert.equal(report.errors.length,0);report.ok=true;
}finally{if(app)await app.close();writeFileSync(path.join(target,'result.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,output:target},null,2));
