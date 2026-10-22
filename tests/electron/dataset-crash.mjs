/** Actual child-process termination of the dataset runner. Synthetic, no HTTP, no ledger. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSharedModule} from '../../scripts/lib/ts-module.mjs';
import {ROOT} from '../../scripts/lib/paths.mjs';
const {harness}=await loadSharedModule('tests/fixtures/s13.ts');
const {deepseekEvaluationProvider}=await loadSharedModule('src/main/services/dataset/provider.ts');
const {DATASET_NOTICE}=await loadSharedModule('src/shared/dataset.ts');
if(process.argv[2]==='--child'){
  const [root,marker,mode]=process.argv.slice(3);
  const waiting=()=>{writeFileSync(marker,JSON.stringify({status:'processing',mockedFetchCalls:mode==='transport'?1:0}));setInterval(()=>{},1000);return new Promise(()=>{});};
  if(mode==='transport')globalThis.fetch=waiting; // No external HTTP: pause the actual transport at its mocked dispatch boundary.
  const h=harness(root,{provider:()=>mode==='transport'?deepseekEvaluationProvider(()=> 'synthetic-crash-test'):({id:'mock',adapterVersion:'synthetic-waiting-provider.v1',recognize:waiting})});
  const s=h.sample(),v=h.version([s.id]);
  if(mode==='transport')h.command({op:'consent',...s.image,purpose:'recognition',decision:'grant',supersedesId:null,noticeVersion:DATASET_NOTICE,rights:null,runManifestHash:h.summary().versions[0].manifestHash});
  h.command({op:'evaluate',versionId:v,scope:mode==='transport'?'quality':'framework',provider:mode==='transport'?'deepseek':'mock',split:'train',intent:'development',seed:13,promptVersion:'bk-eval.s13.v1',possibleChargeAccepted:mode==='transport',fixture:null});
}else{
  const cases=[];
  for(const mode of ['mock','transport']){
  const root=mkdtempSync(path.join(tmpdir(),'BookKeep S13 killed 中文 ')),marker=path.join(root,'processing-marker.json');
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',root,marker,mode],{cwd:ROOT,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let stderr='';child.stderr.on('data',c=>{stderr+=c.toString();});const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const end=Date.now()+15000;while(!existsSync(marker)){if(Date.now()>end){child.kill('SIGKILL');throw Error('child did not enter processing '+stderr);}await new Promise(r=>setTimeout(r,50));}
  const file=path.join(root,'datasets','20000000-0000-4000-8000-000000000002','state.json');const before=JSON.parse(readFileSync(file,'utf8'));assert.equal(before.runs[0].status,'processing');assert.equal(before.runs[0].results[0].attempts,1);assert.equal(before.runs[0].results[0].status,'processing');
  child.kill('SIGKILL');const terminated=await exit;
  const h=harness(root),run=h.service.read({kind:'run',id:before.runs[0].id});assert.equal(run.status,'failed');assert.equal(run.invalidReason,'INTERRUPTED');assert.equal(run.report,null);assert.equal(run.results[0].status,'failed');assert.equal(run.results[0].attempts,1);assert.equal(run.results[0].errorCode,'INTERRUPTED');h.service.shutdown();
  cases.push({mode,root,terminated,beforeStatus:'processing',afterStatus:run.status,errorCode:run.invalidReason,attempts:run.results[0].attempts,resultStatus:run.results[0].status,report:run.report,mockedFetchCalls:mode==='transport'?1:0});
  }
  const output=path.resolve(process.env.BOOKKEEP_QA_OUTPUT??path.join(ROOT,'.tmp','s13-crash'));mkdirSync(output,{recursive:true});
  const report={ok:true,kind:'actual child process kill and restart, implementation selftest only',synthetic:true,networkCalls:0,modelTrained:false,beforeStatus:'processing',afterStatus:'failed',errorCode:'INTERRUPTED',report:null,cases};writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
