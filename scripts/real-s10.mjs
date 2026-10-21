/** One authorized real synthetic-image S10 end-to-end run. No plaintext key read by harness. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from './lib/paths.mjs';
const modules=process.env.BOOKKEEP_QA_NODE_MODULES;if(!modules)throw new Error('existing Playwright path required');
const {_electron}=createRequire(path.join(modules,'__qa__.cjs'))('playwright');
const source=path.join(process.env.LOCALAPPDATA,'BookKeepAI/secrets/deepseek.secret.json');
const target=path.join(ROOT,'evidence/S10');const report={kind:'real-api S10 implementation self-test, public synthetic fixture only; not G3/independent acceptance',ok:false,requestCount:0,startedAt:new Date().toISOString(),checks:[]};
report.mainSha256=createHash('sha256').update(readFileSync(path.join(ROOT,'dist/main/index.cjs'))).digest('hex');
let app,isolation;
try{
  if(!existsSync(source)){report.notExecuted='No local user-configured encrypted secret; no fallback';process.exitCode=2;}
  else{
    isolation=mkdtempSync(path.join(tmpdir(),'BookKeep S10 Real 中文 '));mkdirSync(path.join(isolation,'BookKeepAI/secrets'),{recursive:true});
    // Same Windows user can decrypt DPAPI blob. Ciphertext remains outside project, never read/printed here.
    copyFileSync(source,path.join(isolation,'BookKeepAI/secrets/deepseek.secret.json'));
    const osState=path.join(process.env.LOCALAPPDATA,'BookKeepAI/shell/Local State');
    if(existsSync(osState)){mkdirSync(path.join(isolation,'BookKeepAI/shell'),{recursive:true});copyFileSync(osState,path.join(isolation,'BookKeepAI/shell/Local State'));}
    app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:isolation}),timeout:30000});
    const page=await app.firstWindow();await page.locator('[data-ledger-total]').waitFor();
    const status=await page.evaluate(()=>window.bookkeep.settings.readStatus());report.secretStatus=status.ok?status.data:{errorCode:status.error.code};assert.equal(status.ok,true);if(!status.data.configured){report.notExecuted='Configured secret unavailable in same-user isolation; no request sent';throw new Error(status.data.lastErrorCode??'SECRET_REQUIRED');}report.secretMode=status.data.mode;
    // Instrument count only. Never capture headers, image URL/base64 or raw output.
    await app.evaluate(()=>{const original=globalThis.fetch;globalThis.s10RealCount=0;globalThis.fetch=(...args)=>{globalThis.s10RealCount++;return original(...args);};});
    await app.evaluate(({dialog},fixture)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});},path.join(ROOT,'assets/probe/s09-receipt-v1.png'));
    const call=async(method,input)=>{const reply=await page.evaluate(async({method,input})=>{const [group,name]=method.split('.');return window.bookkeep[group][name](input);},{method,input});if(!reply.ok)throw new Error(reply.error.code);return reply.data;};
    const selection=await call('image.select');const imported=await call('image.import',{selectionTokens:selection.tokens,retention:'keep_original'});const a=imported.results[0].asset;assert.ok(a);
    const p=await call('image.prepare',{imageAssetId:a.id,expectedVersion:a.version,crop:null,masks:[],retainOriginal:true});report.originalHash=p.originalHash;report.preparedHash=p.preparedHash;report.preparedBytes=p.byteSize;
    const input={images:[{imageAssetId:p.id,preparedHash:p.preparedHash}],provider:'deepseek',promptVersion:'bk-receipt.s10.v1',uploadConsent:[{preparedHash:p.preparedHash,confirmed:true,noticeVersion:'recognition.v1'}],forceNew:false,reason:null};
    const result=await call('recognition.start',input);const id=result.jobs[0].id;report.jobId=id;
    let job;const end=Date.now()+100000;
    while(Date.now()<end){job=await call('recognition.status',{jobId:id,statusFilter:[],page:{limit:100,cursor:null}});if(['completed','failed','cancelled'].includes(job.status))break;await new Promise(r=>setTimeout(r,100));}
    report.job=job;report.requestCount=await app.evaluate(()=>globalThis.s10RealCount);
    assert.equal(job.status,'completed');assert.equal(job.provider,'deepseek');assert.equal(job.candidateCount,1);
    const drafts=await call('candidate.list',{jobId:id,page:{limit:100,cursor:null}});const c=drafts.items[0];
    report.matches={amount:c?.current.amountFen===3742,date:c?.current.occurredDate==='2026-08-19',name:c?.current.name==='燕麦饼干'};
    // Only whitelisted matches to fixed public fixture are written to evidence.
    report.fields={amountFen:report.matches.amount?3742:null,occurredDate:report.matches.date?'2026-08-19':null,name:report.matches.name?'燕麦饼干':null};report.candidateId=c.id;report.reviewState=c.reviewState;report.sourceLinked=c.jobId===job.id&&c.imageAssetId===p.id&&c.preparedHash===p.preparedHash;
    assert.ok(Object.values(report.matches).every(Boolean));assert.equal(c.reviewState,'pending_review');assert.equal(report.sourceLinked,true);
    const formal=await call('transaction.list',{filter:{dateStart:null,dateEnd:null,categoryIds:[],nameQuery:null,deleted:'active'},page:{limit:100,cursor:null}});assert.equal(formal.totalCount,0);assert.equal(formal.filteredTotalFen,'0');report.formal={count:formal.totalCount,totalFen:formal.filteredTotalFen};
    const reused=await call('recognition.start',input);assert.equal(reused.reusedIds[0],id);assert.equal(await app.evaluate(()=>globalThis.s10RealCount),report.requestCount);
    report.sql=await app.evaluate(({app})=>{const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),Db=require('better-sqlite3');const root=path.join(process.env.LOCALAPPDATA,'BookKeepAI');const pointer=JSON.parse(fs.readFileSync(path.join(root,'data/active.json'),'utf8'));const db=new Db(path.join(root,'data/generations',pointer.generationId,'ledger.db'),{readonly:true});try{return {usage:JSON.parse(db.prepare('SELECT usage_json FROM import_job ORDER BY created_at DESC LIMIT 1').get().usage_json),jobs:db.prepare('SELECT status,attempt,candidate_count FROM import_job').all(),candidateCount:db.prepare('SELECT count(*) count FROM candidate WHERE review_state=\'pending_review\'').get().count,quick:db.pragma('quick_check'),fk:db.pragma('foreign_key_check')};}finally{db.close();}});
    await app.close();app=null;
    app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:isolation}),timeout:30000});const restarted=await app.firstWindow();await restarted.locator('[data-ledger-total]').waitFor();
    const persisted=await restarted.evaluate(()=>window.bookkeep.candidate.list({jobId:null,page:{limit:100,cursor:null}}));assert.equal(persisted.ok,true);assert.equal(persisted.data.totalCount,1);assert.equal(persisted.data.items[0].current.amountFen,3742);report.restartPersisted=true;
    report.ok=true;report.checks=['real prepared PNG sent to official endpoint','strict schema+visible amount/date/name matched','pending candidate source/FK persisted','official ledger zero','same hash no second HTTP','real process restart retains pending draft'];
  }
}catch(error){report.failure=String(error.message??error);process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});if(isolation){for(const ref of ['BookKeepAI/secrets/deepseek.secret.json','BookKeepAI/shell/Local State']){try{const file=path.join(isolation,ref);if(existsSync(file))unlinkSync(file);}catch{/* test ciphertext outside repository, never included in evidence */}}}report.finishedAt=new Date().toISOString();mkdirSync(target,{recursive:true});writeFileSync(path.join(target,'real-api.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,requestCount:report.requestCount,failure:report.failure,notExecuted:report.notExecuted}));}
