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
if(process.argv[2]==='--child'){
  const [root,marker]=process.argv.slice(3);
  const h=harness(root,{provider:()=>({id:'mock',adapterVersion:'synthetic-waiting-provider.v1',recognize:()=>{writeFileSync(marker,JSON.stringify({status:'processing'}));setInterval(()=>{},1000);return new Promise(()=>{});}})});
  const s=h.sample(),v=h.version([s.id]);h.command({op:'evaluate',versionId:v,scope:'framework',provider:'mock',split:'train',intent:'development',seed:13,promptVersion:'bk-eval.s13.v1',possibleChargeAccepted:false,fixture:null});
}else{
  const root=mkdtempSync(path.join(tmpdir(),'BookKeep S13 killed 中文 ')),marker=path.join(root,'processing-marker.json');
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',root,marker],{cwd:ROOT,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let stderr='';child.stderr.on('data',c=>{stderr+=c.toString();});const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const end=Date.now()+15000;while(!existsSync(marker)){if(Date.now()>end){child.kill('SIGKILL');throw Error('child did not enter processing '+stderr);}await new Promise(r=>setTimeout(r,50));}
  const file=path.join(root,'datasets','20000000-0000-4000-8000-000000000002','state.json');const before=JSON.parse(readFileSync(file,'utf8'));assert.equal(before.runs[0].status,'processing');
  child.kill('SIGKILL');const terminated=await exit;
  const h=harness(root),run=h.service.read({kind:'run',id:before.runs[0].id});assert.equal(run.status,'failed');assert.equal(run.invalidReason,'INTERRUPTED');assert.equal(run.report,null);assert.equal(run.results[0].status,'unprocessed');h.service.shutdown();
  const output=path.resolve(process.env.BOOKKEEP_QA_OUTPUT??path.join(ROOT,'.tmp','s13-crash'));mkdirSync(output,{recursive:true});
  const report={ok:true,kind:'actual child process kill and restart, implementation selftest only',synthetic:true,networkCalls:0,modelTrained:false,root,terminated,beforeStatus:'processing',afterStatus:run.status,errorCode:run.invalidReason,report:run.report};writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
