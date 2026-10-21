import type { ChannelSpec } from './ipc';
import type { ApprovalInput, ReviewUpdate } from './review';
import { isPlainRecord, isUuidV4 } from './validation';
import { checkRequiredText } from './text';
const keys=(v:unknown,required:string[],optional:string[]=[]):v is Record<string,unknown>=>isPlainRecord(v)&&required.every(k=>k in v)&&Object.keys(v).every(k=>[...required,...optional].includes(k));
const version=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<=2147483647;
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const reason=(v:unknown)=>checkRequiredText(v,500).ok;
const cf=(v:unknown)=>keys(v,['amount','date','name','category','confirmedVersion','reviewDigest'])&&['amount','date','name','category'].every(k=>typeof v[k]==='boolean')&&version(v.confirmedVersion)&&hash(v.reviewDigest);
const item=(v:unknown)=>keys(v,['id','expectedVersion','confirmation'])&&isUuidV4(v.id)&&version(v.expectedVersion)&&cf(v.confirmation);
const editFields=['amountFen','occurredDate','occurredTime','timePrecision','name','merchant','categoryId','transactionKind','amountBasis','groupKey'];
function patch(v:unknown):boolean {
  if(!keys(v,[],editFields)||!Object.keys(v).length)return false;
  return Object.entries(v).every(([k,x])=>{
    if(x===null)return k!=='timePrecision';
    if(k==='amountFen')return Number.isSafeInteger(x);
    if(k==='timePrecision')return ['unknown','date','minute'].includes(String(x));
    if(k==='transactionKind')return ['expense','refund','transfer','income','failed','closed'].includes(String(x));
    if(k==='amountBasis')return ['paid_total','line_payment'].includes(String(x));
    if(k==='groupKey')return typeof x==='string'&&/^[\x21-\x7e]{1,64}$/.test(x);
    return typeof x==='string'&&x.length<=100;
  });
}
function spec<T>(channel:ChannelSpec['channel'],required:string[],optional:string[],valid:(v:Record<string,unknown>)=>boolean,mutation:boolean):ChannelSpec<T>{
 return {channel,permission:'W',skeletonOnly:false,request:{required,optional,allowNullEpoch:false,requireMutationId:mutation,validatePayload:v=>valid(v)?[]:[{path:'payload',code:'INVALID_REVIEW_INPUT'}],cast:v=>v as T}};
}
export const REVIEW_CHANNELS={candidateUpdate:'candidate.update',candidateReject:'candidate.reject',candidateApprove:'candidate.approve'} as const;
export const REVIEW_SPECS={
 candidateUpdate:spec<ReviewUpdate>(REVIEW_CHANNELS.candidateUpdate,['id','expectedVersion','action','reason'],['patch','duplicateResolution','reviewDigest','warningCode','field'],v=>{
  if(!isUuidV4(v.id)||!version(v.expectedVersion)||!reason(v.reason))return false;
  const base=['id','expectedVersion','action','reason'];
  if(v.action==='edit')return keys(v,[...base,'patch'])&&patch(v.patch);
  if(v.action==='reopen')return keys(v,base);
  if(v.action==='resolve_duplicate')return keys(v,[...base,'duplicateResolution','reviewDigest'])&&['distinct','duplicate'].includes(String(v.duplicateResolution))&&hash(v.reviewDigest);
  return v.action==='resolve_warning'&&keys(v,[...base,'warningCode','field','reviewDigest'])&&typeof v.warningCode==='string'&&v.warningCode.length<=64&&(v.field===null||typeof v.field==='string'&&v.field.length<=64)&&hash(v.reviewDigest);
 },true),
 candidateReject:spec<{id:string;expectedVersion:number;reason:string}>(REVIEW_CHANNELS.candidateReject,['id','expectedVersion','reason'],[],v=>isUuidV4(v.id)&&version(v.expectedVersion)&&reason(v.reason),true),
 candidateApprove:spec<ApprovalInput>(REVIEW_CHANNELS.candidateApprove,['mode'],['id','expectedVersion','confirmation','items','previewToken'],v=>{
  if(v.mode==='single')return keys(v,['mode','id','expectedVersion','confirmation'])&&item({id:v.id,expectedVersion:v.expectedVersion,confirmation:v.confirmation});
  if(v.mode==='preview')return keys(v,['mode','items'])&&Array.isArray(v.items)&&v.items.length>0&&v.items.length<=100&&v.items.every(item)&&new Set(v.items.map(i=>(i as {id:string}).id)).size===v.items.length;
  return v.mode==='commit'&&keys(v,['mode','previewToken'])&&typeof v.previewToken==='string'&&v.previewToken.length<=200000;
 },false),
};
