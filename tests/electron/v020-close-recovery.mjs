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
 await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),file);await nav('import');await page.getByRole('button',{name:'选择图片',exact:true}).click();await page.getByRole('button',{name:'保存处理（仅本地）',exact:true}).click();await until(()=>page.getByRole('button',{name:/开始识别/}).isEnabled());
 const backup=await api('backup.create',{kind:'manual',containsPrivateDataAcknowledged:true});
 await page.getByRole('button',{name:'添加遮盖',exact:true}).click();
 await check('cancel native fallback rearms normal unsaved guard',async()=>{
  await app.evaluate(({BrowserWindow,dialog})=>{const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc);globalThis.qaFallback=0;let dropped=false;wc.send=(channel,...args)=>{if(channel==='window.closeRequested'&&!dropped){dropped=true;return;}return send(channel,...args);};dialog.showMessageBox=async()=>{globalThis.qaFallback++;return{response:1};};BrowserWindow.getAllWindows()[0].close();});
  const end=Date.now()+14000;while(await app.evaluate(()=>globalThis.qaFallback)===0){if(Date.now()>end)throw Error('fallback timeout');await new Promise(r=>setTimeout(r,100));}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.getByRole('dialog',{name:'有未保存的图片修改'}).waitFor();await page.getByRole('button',{name:'继续编辑',exact:true}).click();
 });
 await check('epoch restore cancels old close request and registered renderer can close again',async()=>{
  const b=await api('backup.restore',{mode:'preview',backupId:backup.record.id});await api('backup.restore',{mode:'commit',restoreToken:b.restoreToken,currentDataWillBeReplaced:true});
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();BrowserWindow.getAllWindows()[0].close();});await page.getByRole('dialog',{name:'有未保存的图片修改'}).waitFor();assert.equal(await page.getByRole('dialog',{name:'有未保存的图片修改'}).count(),1);await screen('close-after-restore');await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
 });
 report.ok=true;
}catch(e){report.fatal=e.stack;}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});save();}process.exit(report.ok?0:1);
