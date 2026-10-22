import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {harness,label,proposal,LEDGER,waitRun} from '../fixtures/s13';
import {DATASET_NOTICE,type Run} from '../../src/shared/dataset';
import {DatasetService,type DatasetEnvironment} from '../../src/main/services/dataset/store';
import type {EvaluationProvider} from '../../src/main/services/dataset/provider';
const roots:string[]=[];
const setup=(override:Partial<DatasetEnvironment>={})=>{const root=mkdtempSync(path.join(tmpdir(),'BookKeep S13 invariants '));roots.push(root);return harness(root,override);};
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
const runCmd=(versionId:string)=>({op:'evaluate' as const,versionId,scope:'framework' as const,provider:'mock' as const,split:'train' as const,intent:'development' as const,seed:13,promptVersion:'bk-eval.s13.v1',possibleChargeAccepted:false,fixture:null});
it('ordinary item named constructor is scored without reading object prototype as synonyms',async()=>{const h=setup(),s=h.sample([label(0,{name:'constructor'})]),v=h.version([s.id]);h.responses.set(s.id,[proposal({name:'constructor'})]);const {runId}=h.command(runCmd(v));await waitRun(h.service,runId as string);const report=h.command({op:'align',runId:runId as string,alignment:[{sampleId:s.id,predictionOrdinal:0,labelId:'label-0',reason:'source row'}],reviewer:'human',blindConfirmed:true,duplicatePredictions:[]}).report as {metrics:{key:string;scene:string;value:number|null}[]};expect(report.metrics.find(m=>m.key==='item_acceptable'&&m.scene==='all')?.value).toBe(1);});
it('same-person second review cannot silently change the once-reviewed labels',()=>{const h=setup(),im=h.addImage(),id=h.register(im,h.grant(im));const saved=[label()];h.command({op:'label',id,expectedVersion:1,labels:saved,annotator:'same',reviewer:null,reviewMode:null,reason:'first',correctionOfLockedTest:false});expect(()=>h.command({op:'label',id,expectedVersion:2,labels:[label(0,{amountFen:1234})],annotator:'same',reviewer:'same',reviewMode:'same_person',reason:'review',correctionOfLockedTest:false})).toThrow('DATASET_INVALID');});
it('same-store same-amount second real transaction stays separate, detector yields an honest hard-negative FP',async()=>{
  const h=setup(),a=h.sample([label()],'a',['near-variant']),b=h.sample([label()],'b',['near-variant']),v=h.version([a.id,b.id]);h.responses.set(a.id,[proposal()]);h.responses.set(b.id,[proposal()]);const {runId}=h.command(runCmd(v));await waitRun(h.service,runId as string);
  const blind=h.service.read({kind:'blinded',id:runId as string}) as {pairPool:Record<string,unknown>[];results:{predictions:Record<string,unknown>[]}[]};expect(blind.pairPool[0]).not.toHaveProperty('positive');expect(blind.results[0].predictions[0]).not.toHaveProperty('amountFen');
  const alignment=[a,b].map(s=>({sampleId:s.id,predictionOrdinal:0,labelId:'label-0',reason:'source row'}));
  expect(()=>h.command({op:'align',runId:runId as string,alignment,reviewer:'human',blindConfirmed:true,duplicatePredictions:['invented-oracle-hint']})).toThrow('DATASET_INVALID');
  const report=h.command({op:'align',runId:runId as string,alignment,reviewer:'human',blindConfirmed:true,duplicatePredictions:[]}).report as {metrics:{key:string;scene:string;numerator:number;denominator:number}[]};
  expect(report.metrics.find(m=>m.key==='duplicate_precision'&&m.scene==='all')).toMatchObject({numerator:0,denominator:1});expect(h.summary().samples).toHaveLength(2);
});
it('duplicate positive with missing candidate remains FN in the frozen pair pool',async()=>{
  const h=setup(),tx=randomUUID(),a=h.sample([label(0,{},tx)]),b=h.sample([label(0,{},tx)]),v=h.version([a.id,b.id]);h.responses.set(a.id,[proposal()]);h.responses.set(b.id,[]);const {runId}=h.command(runCmd(v));await waitRun(h.service,runId as string);
  const report=h.command({op:'align',runId:runId as string,alignment:[{sampleId:a.id,predictionOrdinal:0,labelId:'label-0',reason:'source row'}],reviewer:'human',blindConfirmed:true,duplicatePredictions:[]}).report as {metrics:{key:string;scene:string;numerator:number;denominator:number}[]};expect(report.metrics.find(m=>m.key==='duplicate_recall'&&m.scene==='all')).toMatchObject({numerator:0,denominator:1});
});
it('unknown true date guessed by prediction is a fill error, not a date accuracy success',async()=>{
  const h=setup(),s=h.sample([label(0,{occurredDate:null,timePrecision:'unknown'})]),v=h.version([s.id]);h.responses.set(s.id,[proposal()]);const {runId}=h.command(runCmd(v));await waitRun(h.service,runId as string);const report=h.command({op:'align',runId:runId as string,alignment:[{sampleId:s.id,predictionOrdinal:0,labelId:'label-0',reason:'source row'}],reviewer:'human',blindConfirmed:true,duplicatePredictions:[]}).report as {metrics:{key:string;scene:string;numerator:number;denominator:number;value:number|null}[]};expect(report.metrics.find(m=>m.key==='date_exact'&&m.scene==='all')).toMatchObject({denominator:0,value:null});expect(report.metrics.find(m=>m.key==='unknown_fill_rate_occurredDate'&&m.scene==='all')).toMatchObject({numerator:1,denominator:1});expect(report.metrics.find(m=>m.key==='missing_recall_occurredDate'&&m.scene==='all')).toMatchObject({numerator:0,denominator:1});
});
it('expiration immediately blocks and persists cleanup on next access',()=>{let now=Date.parse('2026-10-22T00:00:00Z');const h=setup({clock:()=>now});h.sample();now=Date.parse('2100-01-01T00:00:00Z');expect(h.summary().samples).toHaveLength(0);expect(readFileSync(path.join(h.env.root,'datasets',LEDGER,'state.json'),'utf8')).not.toContain('午餐');expect(h.summary().withdrawals[0].localDeleted).toBe(true);});
it('persisted version content tampering is rejected before export or evaluation',()=>{const h=setup(),s=h.sample(),v=h.version([s.id]);h.service.shutdown();const file=path.join(h.env.root,'datasets',LEDGER,'state.json'),state=JSON.parse(readFileSync(file,'utf8'));state.versions[0].samples[0].labels[0].value.amountFen=123;writeFileSync(file,JSON.stringify(state));const restored=new DatasetService(h.env);expect(()=>restored.command({op:'validate',versionId:v},randomUUID())).toThrow('HASH_MISMATCH');restored.shutdown();});
it('withdraw recognition in-flight cancels networking while retaining separately authorized dataset labels',async()=>{
  let finish!:(v:Awaited<ReturnType<EvaluationProvider['recognize']>>)=>void;let started=false;
  const provider:EvaluationProvider={id:'deepseek',adapterVersion:'synthetic-delayed-transport',recognize:()=>{started=true;return new Promise(r=>{finish=r;});}};
  const h=setup({provider:()=>provider}),s=h.sample(),v=h.version([s.id]),manifestHash=h.summary().versions[0].manifestHash;
  const consent=h.command({op:'consent',...s.image,purpose:'recognition',decision:'grant',supersedesId:null,noticeVersion:DATASET_NOTICE,rights:null,runManifestHash:manifestHash});
  const {runId}=h.command({...runCmd(v),scope:'quality',provider:'deepseek',possibleChargeAccepted:true});while(!started)await new Promise(r=>setTimeout(r,2));
  h.command({op:'consent',...s.image,purpose:'recognition',decision:'withdraw',supersedesId:consent.consentId as string,noticeVersion:DATASET_NOTICE,rights:null,runManifestHash:null});
  finish({output:{schemaVersion:'bk-candidate.v1',candidates:[proposal()],warnings:[]},metadata:{httpStatus:200,actualModel:'synthetic',usage:null}});await new Promise(r=>setTimeout(r,5));const run=h.service.read({kind:'run',id:runId as string}) as Run;expect(run.status).toBe('cancelled');expect(run.report).toBeNull();expect(run.results[0].predictions).toEqual([]);expect(h.summary().samples).toHaveLength(1);
});
