/** Real OS process termination at restore commit boundaries. Synthetic isolated data only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ROOT } from '../../scripts/lib/paths.mjs';
const runtime=path.join(ROOT,'.tmp/s15-recovery-runtime.cjs');
if(process.argv[2]!=='--child'){
  mkdirSync(path.dirname(runtime),{recursive:true});
  await build({stdin:{contents:`export {LedgerStore} from './src/main/services/ledger-store'; export {source,proposal} from './tests/unit/db/review-fixture'; export {createTestLayout,transactionInput,storeOptions} from './tests/unit/db/helpers';`,resolveDir:ROOT},outfile:runtime,bundle:true,platform:'node',format:'cjs',external:['better-sqlite3','sharp'],logLevel:'silent'});
}
const require=createRequire(import.meta.url),{LedgerStore,source,proposal,createTestLayout,transactionInput,storeOptions}=require(runtime);
if(process.argv[2]==='--child'){
  const [layoutFile,backupId,step,marker]=process.argv.slice(3),layout=JSON.parse(readFileSync(layoutFile,'utf8'));
  const store=LedgerStore.open(storeOptions(layout,Date.now,{fault:s=>{if(s===step){writeFileSync(marker,JSON.stringify({step,status:'blocked-at-boundary'}));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}}}));
  store.restoreBackup({mode:'commit',restoreToken:store.previewRestore(backupId).restoreToken,currentDataWillBeReplaced:true},crypto.randomUUID());
  process.exit(2);
}else{
  const output=path.resolve(process.env.BOOKKEEP_QA_OUTPUT??path.join(ROOT,'.tmp/s15-crash'));mkdirSync(output,{recursive:true});
  const report={ok:false,synthetic:true,externalHttp:0,cases:[]};
  try{
    for(const step of ['before-stage-open','before-publish','after-publish']){
      const layout=createTestLayout(),layoutFile=path.join(layout.root,'qa-layout.json'),marker=path.join(layout.root,'marker.json');writeFileSync(layoutFile,JSON.stringify(layout));
      let store=LedgerStore.open(storeOptions(layout,Date.now));const src=await source(store,[proposal()]);
      const expectedImage=src.images.readPrepared(src.candidates[0].imageAssetId,src.candidates[0].preparedHash);
      const backup=store.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},crypto.randomUUID());store.createTransaction(transactionInput({name:'恢复前必须保留'}),crypto.randomUUID());
      const before=store.snapshot(),pointer=readFileSync(path.join(layout.data,'active.json'),'utf8');store.close();
      const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',layoutFile,backup.record.id,step,marker],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b.toString());const exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));
      const deadline=Date.now()+20000;while(!existsSync(marker)){if(Date.now()>deadline){child.kill('SIGKILL');throw Error('restore child timeout '+stderr);}await new Promise(r=>setTimeout(r,30));}
      child.kill('SIGKILL');const termination=await exited;
      store=LedgerStore.open(storeOptions(layout,Date.now));const after=store.snapshot();assert.equal(after.recoveryRequired,false);assert.equal(after.transactionCount,step==='after-publish'?0:1);assert.equal(after.dataEpoch===before.dataEpoch,step!=='after-publish');
      const imageFile=store.withImports(false,c=>path.join(c.directory,c.db.prepare('SELECT prepared_ref FROM image_asset WHERE id=?').get(src.candidates[0].imageAssetId).prepared_ref));assert.deepEqual(readFileSync(imageFile),expectedImage);assert.equal(store.withImports(false,c=>c.db.pragma('quick_check',{simple:true})),'ok');assert.deepEqual(store.withImports(false,c=>c.db.pragma('foreign_key_check')),[]);
      if(step!=='after-publish')assert.equal(readFileSync(path.join(layout.data,'active.json'),'utf8'),pointer);
      else{const p=JSON.parse(readFileSync(path.join(layout.data,'active.json'),'utf8'));assert.equal(store.backupStatus(p.restoreId).status,'committed');}
      assert(store.listBackups().records.some(r=>r.kind==='pre_restore'));store.close();
      report.cases.push({step,root:layout.root,termination,beforeTransactions:before.transactionCount,afterTransactions:after.transactionCount,oldEpochKept:after.dataEpoch===before.dataEpoch,attachmentsMatch:true,integrity:'ok'});
    }
    report.ok=true;
  }finally{writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report,null,2));
}
