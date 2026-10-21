import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Proposal } from '../../../src/shared/candidate';
import type { ApprovalItem, ApprovalResult, ReviewCandidate } from '../../../src/shared/review';
import { makeProposal } from '../fixtures';
import { LedgerStore } from '../../../src/main/services/ledger-store';
import { ImageService } from '../../../src/main/services/image-service';
import { RecognitionService } from '../../../src/main/services/recognition-service';
import { ReviewService } from '../../../src/main/services/review-service';
import { SecretStore } from '../../../src/main/services/settings/ai-settings';
import { AppError } from '../../../src/shared/errors';
import { IMPORT_PROMPT, NOTICE_VERSION, type Job } from '../../../src/shared/imports';
export const page={limit:100,cursor:null};
export const clock=()=>Date.parse('2026-10-21T04:00:00Z');
export function proposal(overrides:Partial<Proposal>={}):Proposal {
  const p=makeProposal({amountFen:9900,name:'待审隔离测试',occurredDate:'2026-09-09',amountBasis:'line_payment',groupKey:randomUUID(),...overrides});
  p.evidence=(['amountFen','occurredDate','name','categoryId','transactionKind','amountBasis'] as const).filter(f=>p[f]!==null).map(field=>({field,text:String(p[field]),source:'image' as const,region:null}));return p;
}
export const confirmed=(c:ReviewCandidate):ApprovalItem=>({id:c.id,expectedVersion:c.version,confirmation:{amount:true,date:true,name:true,category:true,confirmedVersion:c.version,reviewDigest:c.reviewDigest}});
export const approve=(review:ReviewService,id:string,mutationId=randomUUID())=>review.approve({mode:'single',...confirmed(review.get(id))},mutationId) as ApprovalResult;
export async function source(store:LedgerStore,proposals:Proposal[],fail=false) {
  const images=new ImageService(store,()=>1),secrets=new SecretStore(path.join(store.diagnostics().root,'secrets'),{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''});
  const name=path.join(store.diagnostics().root,randomUUID()+'.png');
  writeFileSync(name,await sharp({create:{width:100,height:100,channels:3,background:'#'+randomUUID().replaceAll('-','').slice(0,6)}}).png().toBuffer());
  const selected=images.select([name],'selection');const a=(await images.import({selectionTokens:selected.tokens,retention:'keep_original'},randomUUID())).results[0]!.asset!;
  const prepared=await images.prepare({imageAssetId:a.id,expectedVersion:a.version,crop:null,masks:[],retainOriginal:true},randomUUID());
  const queue=new RecognitionService(store,images,secrets,{clock,execute:async()=>{if(fail)throw new AppError('OUTPUT_SCHEMA_INVALID');return {schemaVersion:'bk-candidate.v1',candidates:proposals,warnings:[]};}});
  const job=queue.start({images:[{imageAssetId:prepared.id,preparedHash:prepared.preparedHash!}],provider:'mock',promptVersion:IMPORT_PROMPT,uploadConsent:[{preparedHash:prepared.preparedHash!,confirmed:true,noticeVersion:NOTICE_VERSION}],forceNew:false,reason:null},randomUUID()).jobs[0]!;
  const end=Date.now()+5000;while(['queued','processing'].includes((queue.status({jobId:job.id,statusFilter:[],page}) as Job).status)){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,5));}
  const candidates=queue.candidates({jobId:job.id,page}).items;queue.shutdown();return {images,job,candidates,review:new ReviewService(store,images,()=>1,clock)};
}
