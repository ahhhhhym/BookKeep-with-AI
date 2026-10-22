/** Local SYNTHETIC/mock end-to-end demo. No ledger, real user pictures, credentials or network. */
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { loadSharedModule } from './lib/ts-module.mjs';
import { datasetBuildIdentity } from './lib/dataset-build.mjs';
import { ROOT } from './lib/paths.mjs';
const {harness,label,proposal,waitRun}=await loadSharedModule('tests/fixtures/s13.ts');
const output=path.resolve(process.argv[2]??path.join(ROOT,'.tmp','s13-synthetic-demo',randomUUID()));
if(!output.startsWith(ROOT+path.sep)&&!process.argv[2])throw Error('Explicit output directory required');
mkdirSync(output,{recursive:true});
const identity=datasetBuildIdentity();
const h=harness(output,{runnerHash:identity.sourceHash,appCommit:identity.commit});
const tx=randomUUID();
const scenarios=[
  {scene:'multi',labels:[label(0,{},tx),label(1,{amountFen:1000,name:'晚餐',occurredDate:null,timePrecision:'unknown'})],predictions:[proposal({name:'午饭'}),proposal({amountFen:999,name:'晚餐',occurredDate:null,timePrecision:'unknown'}),proposal()]},
  {scene:'request-failed',labels:[label()],predictions:'failed'},
  {scene:'empty-background',labels:[],predictions:[proposal()]},
  {scene:'refund',labels:[label(0,{transactionKind:'refund'})],predictions:[proposal({transactionKind:'refund'})]},
  {scene:'duplicate-view',labels:[label(0,{},tx)],predictions:[proposal()]},
  {scene:'unknown-product',labels:[label(0,{name:null,categoryId:null,occurredDate:null,timePrecision:'unknown'})],predictions:[proposal({name:null,categoryId:null,occurredDate:'2026-09-08'})]},
];
scenarios[0].labels[1].facts.categoryId={status:'assisted',reason:'external synthetic supplement',basisRef:'synthetic-receipt'};
const ids=[];
for(let i=0;i<scenarios.length;i++){
  const s=scenarios[i];
  const lines=['SYNTHETIC ONLY - NO USER DATA',`Fixture ${i}: ${s.scene}`,...s.labels.map(l=>`CNY fen=${l.value.amountFen??'unknown'} | date=${l.value.occurredDate??'unknown'} | item=${l.value.name??'unknown'}`)];
  const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="820" height="420"><rect width="820" height="420" fill="white"/>${lines.map((line,j)=>`<text x="20" y="${50+j*60}" font-family="Microsoft YaHei" font-size="20">${escape(line)}</text>`).join('')}</svg>`;
  const bytes=await sharp(Buffer.from(svg)).png().toBuffer();
  const im=h.addImage(bytes),cid=h.grant(im),id=h.register(im,cid,s.scene,['synthetic-demo-family']);h.annotate(id,s.labels);h.responses.set(id,s.predictions);ids.push(id);
}
const versionId=h.version(ids,'s13-minimum-synthetic.v1',13);
const validate=h.command({op:'validate',versionId});assert.equal(validate.valid,true);
const exported=h.command({op:'export',versionId,sampleIds:null,includeImages:true,purpose:'future_training',recipient:'local-selftest',confirmed:true});
const repeated=h.command({op:'export',versionId,sampleIds:null,includeImages:true,purpose:'future_training',recipient:'local-selftest',confirmed:true});assert.equal(exported.manifestHash,repeated.manifestHash);
const prepared=h.command({op:'prepare',versionId,exportId:exported.artifactId,adapterVersion:'future-training.v1'});
assert.equal(prepared.modelTrained,false);assert.equal(prepared.weights,null);
const preparedValidation=h.command({op:'validatePrepared',versionId,artifactId:prepared.artifactId,manifestHash:exported.manifestHash,schemaVersion:'bk-dataset.v1'});assert.equal(preparedValidation.valid,true);
const runs=[];
for(let repeat=0;repeat<2;repeat++){
  const {runId}=h.command({op:'evaluate',versionId,scope:'framework',provider:'mock',split:'train',intent:'development',seed:13,promptVersion:'bk-eval.s13.v1',possibleChargeAccepted:false,fixture:'s13-hand-calculated.v1'});
  await waitRun(h.service,runId);
  // Predefined synthetic ordinal mapping, never selected by scored field correctness.
  const alignment=scenarios.flatMap((s,i)=>s.predictions==='failed'?[]:s.labels.map((l,j)=>({sampleId:ids[i],predictionOrdinal:j,labelId:l.labelId,reason:'predefined synthetic source-row ordinal'})));
  const blinded=h.service.read({kind:'blinded',id:runId});
  assert(blinded.results.every(r=>r.predictions.every(p=>!('amountFen' in p))));
  const duplicatePredictions=[]; // Hints are generated from predictions by the runner, never supplied from ground truth.
  const result=h.command({op:'align',runId,alignment,reviewer:'synthetic-predefined-map',blindConfirmed:true,duplicatePredictions});runs.push(result.report);
}
assert.deepEqual(runs[0].metrics,runs[1].metrics);
const m=key=>runs[0].metrics.find(m=>m.key===key&&m.scene==='all');
// 5 GT expenses: 4 TP + 1 FN; 6 spend predictions: 4 TP + 2 FP. Amount is 3/5 including failures.
assert.equal(m('transaction_precision').numerator,4);assert.equal(m('transaction_precision').denominator,6);
assert.equal(m('transaction_recall').numerator,4);assert.equal(m('transaction_recall').denominator,5);
assert.equal(m('amount_exact').numerator,3);assert.equal(m('amount_exact').denominator,5);
let unsupported=false;try{h.command({op:'submit',versionId});}catch(e){assert.equal(e.code,'UNSUPPORTED');assert.equal(e.details.reason,'unsupported');assert.equal(e.retryable,false);unsupported=true;}assert(unsupported);
writeFileSync(path.join(output,'report.json'),JSON.stringify(runs[0],null,2));
writeFileSync(path.join(output,'demo-result.json'),JSON.stringify({ok:true,kind:'SYNTHETIC_MOCK_FRAMEWORK_SELFTEST',modelTrained:false,realQualityEvaluated:false,networkCalls:0,samples:ids.length,versionId,manifestHash:exported.manifestHash,preparedValidation,reproducibleMetrics:true,unsupported,identity},null,2));
h.service.shutdown();
console.log(JSON.stringify({ok:true,output,samples:ids.length,framework:'ran',modelTrained:false,quality:'not_evaluated',metricsReproduced:true},null,2));
