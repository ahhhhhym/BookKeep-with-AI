/** Versioned commit witness. No key, temporary path or caller-supplied timestamp crosses IPC. */
import {createHash,createPublicKey,generateKeyPairSync,sign,verify,type KeyObject} from 'node:crypto';
import {AppError} from '../../shared/errors';
import {isUuidV4} from '../../shared/validation';
import {existsSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import path from 'node:path';
import {regularPath,readBoundedFile} from './safe-file';

export const SUCCESS_VERSION='bk-success.v1';
export const PREPARED_VERSION='bk-prepared.v2';
export const COMPLETION_VERSION='bk-completion.v2';
const PREPARED_MAGIC=Buffer.from('\nBK-PREPARED.v2\n','ascii');
const PORTABLE_MAGIC=Buffer.from('\nBK-PORTABLE.v2\n','ascii');
const MAGIC=Buffer.from('\nBK-SUCCESS.v1\n','ascii');
export interface BackupSuccess {
 readonly version:typeof SUCCESS_VERSION|typeof COMPLETION_VERSION; readonly backupId:string; readonly ledgerId:string;
 readonly kind:'manual'; readonly mutationId:string; readonly succeededAt:string; readonly payloadHash:string;
}
interface Seal {fact:BackupSuccess;signature:string}
export function backupSigningKey():{publicKey:string;privateKey:KeyObject}{
 const pair=generateKeyPairSync('ed25519');return {privateKey:pair.privateKey,publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')};
}
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
/** Build in memory only. Caller must commit verified registration before publishing these bytes. */
export function sealBackup(payload:Buffer,fact:Omit<BackupSuccess,'version'|'payloadHash'>,key:KeyObject):Buffer {
 const full:BackupSuccess={version:SUCCESS_VERSION,backupId:fact.backupId,ledgerId:fact.ledgerId,kind:fact.kind,mutationId:fact.mutationId,succeededAt:fact.succeededAt,payloadHash:hash(payload)};
 const seal:Seal={fact:full,signature:sign(null,Buffer.from(JSON.stringify(full)),key).toString('base64')};
 const json=Buffer.from(JSON.stringify(seal)),size=Buffer.alloc(4);size.writeUInt32BE(json.length);
 return Buffer.concat([payload,json,size,MAGIC]);
}
export interface SuccessManifest {successVersion?:string;backupKind?:string;verificationKey?:string;backupId:string;ledgerId:string;createdAt:string}
/** The manifest and the exact payload bytes are both bound. Absent legacy metadata proves no self success. */
export function verifyBackupSuccess(bytes:Buffer,m:SuccessManifest,allowPrepared=false):BackupSuccess|null {
 if(m.successVersion===PREPARED_VERSION){verifyPreparedBackup(bytes,m,allowPrepared);return null;}
 const trailer=bytes.subarray(-MAGIC.length).equals(MAGIC);
 if(m.successVersion===undefined){if(trailer||bytes.subarray(-PREPARED_MAGIC.length).equals(PREPARED_MAGIC)||m.verificationKey!==undefined)throw new AppError('BACKUP_INVALID');return null;}
 if(m.successVersion!==SUCCESS_VERSION||m.backupKind!=='manual'||typeof m.verificationKey!=='string')throw new AppError('BACKUP_INVALID');
 if(!trailer){if(allowPrepared)return null;throw new AppError('BACKUP_INVALID',{details:{reason:'SUCCESS_WITNESS_MISSING'}});}
 try{
  const end=bytes.length-MAGIC.length-4;if(end<0)throw Error();const len=bytes.readUInt32BE(end),start=end-len;
  if(len<1||len>8192||start<512)throw Error();
  const seal=JSON.parse(bytes.subarray(start,end).toString('utf8')) as Seal,f=seal.fact;
  if(!f||Object.keys(f).sort().join(',')!=='backupId,kind,ledgerId,mutationId,payloadHash,succeededAt,version'||
   f.version!==SUCCESS_VERSION||f.kind!=='manual'||f.backupId!==m.backupId||f.ledgerId!==m.ledgerId||!isUuidV4(f.backupId)||!isUuidV4(f.ledgerId)||!isUuidV4(f.mutationId)||
   typeof f.succeededAt!=='string'||!Number.isFinite(Date.parse(f.succeededAt))||new Date(f.succeededAt).toISOString()!==f.succeededAt||f.succeededAt<m.createdAt||
   f.payloadHash!==hash(bytes.subarray(0,start))||typeof seal.signature!=='string')throw Error();
  const key=createPublicKey({key:Buffer.from(m.verificationKey,'base64'),format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(JSON.stringify(f)),key,Buffer.from(seal.signature,'base64')))throw Error();
  return f;
 }catch{throw new AppError('BACKUP_INVALID',{details:{reason:'SUCCESS_WITNESS_INVALID'}});}
}
export function backupPayloadSize(bytes:Buffer):number {
 if(bytes.subarray(-PREPARED_MAGIC.length).equals(PREPARED_MAGIC)){const end=bytes.length-PREPARED_MAGIC.length-4;return end-bytes.readUInt32BE(end);}
 if(!bytes.subarray(-MAGIC.length).equals(MAGIC))return bytes.length;
 const end=bytes.length-MAGIC.length-4;return end-bytes.readUInt32BE(end);
}

interface Preparation {version:typeof PREPARED_VERSION;backupId:string;ledgerId:string;kind:'manual';mutationId:string;preparedAt:string;payloadHash:string}
function frame(payload:Buffer,value:unknown,magic:Buffer):Buffer {
 const json=Buffer.from(JSON.stringify(value)),size=Buffer.alloc(4);size.writeUInt32BE(json.length);return Buffer.concat([payload,json,size,magic]);
}
function unframe(bytes:Buffer,magic:Buffer):{payload:Buffer;json:Buffer}|null {
 if(!bytes.subarray(-magic.length).equals(magic))return null;
 const end=bytes.length-magic.length-4;if(end<0)throw new AppError('BACKUP_INVALID');const size=bytes.readUInt32BE(end),start=end-size;
 if(size<1||size>8192||start<512)throw new AppError('BACKUP_INVALID');return {payload:bytes.subarray(0,start),json:bytes.subarray(start,end)};
}
function signatureValid(fact:unknown,signature:string,m:SuccessManifest):boolean {
 const key=createPublicKey({key:Buffer.from(m.verificationKey!,'base64'),format:'der',type:'spki'});
 return key.asymmetricKeyType==='ed25519'&&verify(null,Buffer.from(JSON.stringify(fact)),key,Buffer.from(signature,'base64'));
}
function canonicalInstant(value:string):boolean {return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
export function sealPreparedBackup(payload:Buffer,input:Omit<Preparation,'version'|'payloadHash'>,key:KeyObject):Buffer {
 const fact:Preparation={version:PREPARED_VERSION,...input,payloadHash:hash(payload)};
 return frame(payload,{fact,signature:sign(null,Buffer.from(JSON.stringify(fact)),key).toString('base64')},PREPARED_MAGIC);
}
export function verifyPreparedBackup(bytes:Buffer,m:SuccessManifest,allowUnsealed=false):Preparation|null {
 if(m.successVersion!==PREPARED_VERSION||m.backupKind!=='manual'||typeof m.verificationKey!=='string')throw new AppError('BACKUP_INVALID');
 try {
  const part=unframe(bytes,PREPARED_MAGIC);if(!part){if(allowUnsealed)return null;throw Error();}
  const seal=JSON.parse(part.json.toString('utf8')) as {fact:Preparation;signature:string},f=seal.fact;
  if(!f||Object.keys(f).sort().join(',')!=='backupId,kind,ledgerId,mutationId,payloadHash,preparedAt,version'||f.version!==PREPARED_VERSION||f.kind!=='manual'||f.backupId!==m.backupId||f.ledgerId!==m.ledgerId||!isUuidV4(f.backupId)||!isUuidV4(f.ledgerId)||!isUuidV4(f.mutationId)||!canonicalInstant(f.preparedAt)||f.preparedAt<m.createdAt||f.payloadHash!==hash(part.payload)||!signatureValid(f,seal.signature,m))throw Error();
  return f;
 }catch{throw new AppError('BACKUP_INVALID',{details:{reason:'PREPARATION_INVALID'}});}
}
/** Final time is observed by the main process AFTER the immutable data core is published and checked. */
export function completionCertificate(bytes:Buffer,m:SuccessManifest,succeededAt:string,key:KeyObject):Buffer {
 const p=verifyPreparedBackup(bytes,m)!;
 if(!canonicalInstant(succeededAt)||succeededAt<p.preparedAt)throw new AppError('BACKUP_FAILED',{details:{step:'completion-clock-unverified'}});
 const fact:BackupSuccess={version:COMPLETION_VERSION,backupId:p.backupId,ledgerId:p.ledgerId,kind:'manual',mutationId:p.mutationId,succeededAt,payloadHash:hash(bytes)};
 return Buffer.from(JSON.stringify({fact,signature:sign(null,Buffer.from(JSON.stringify(fact)),key).toString('base64')}));
}
export function verifyCompletionCertificate(certificate:Buffer,bytes:Buffer,m:SuccessManifest):BackupSuccess {
 try{
  if(certificate.length>8192)throw Error();const p=verifyPreparedBackup(bytes,m)!,seal=JSON.parse(certificate.toString('utf8')) as Seal,f=seal.fact;
  if(!f||Object.keys(f).sort().join(',')!=='backupId,kind,ledgerId,mutationId,payloadHash,succeededAt,version'||f.version!==COMPLETION_VERSION||f.backupId!==p.backupId||f.ledgerId!==p.ledgerId||f.mutationId!==p.mutationId||f.kind!=='manual'||!canonicalInstant(f.succeededAt)||f.succeededAt<p.preparedAt||f.payloadHash!==hash(bytes)||!signatureValid(f,seal.signature,m))throw Error();
  return f;
 }catch{throw new AppError('BACKUP_INVALID',{details:{reason:'COMPLETION_INVALID'}});}
}
export const completionPath=(file:string)=>file+'.completion.json';
export function readCompletion(file:string):Buffer {
 return readBoundedFile(regularPath(completionPath(file),path.dirname(file)),8192);
}
/** A damaged settlement log cannot make an independently verified data core unrestorable. */
export function readVerifiedCompletion(file:string,bytes:Buffer,m:SuccessManifest):BackupSuccess|null {
 if(!existsSync(completionPath(file)))return null;
 try{return verifyCompletionCertificate(readCompletion(file),bytes,m);}catch{return null;}
}
/** Write-once settlement log, never a replacement for a data-core operation. A torn log stays unverified. */
export function persistCompletion(file:string,certificate:Buffer):void {
 const target=regularPath(completionPath(file),path.dirname(file),false);
 if(certificate.length>8192)throw new AppError('BACKUP_INVALID');
 if(existsSync(target)){if(!readCompletion(file).equals(certificate))throw new AppError('BACKUP_INVALID');return;}
 const fd=openSync(target,'wx');try{writeFileSync(fd,certificate);fsyncSync(fd);}finally{closeSync(fd);}
}
/** Single-file transport only; original data core and log stay byte-for-byte immutable. */
export function portableBackupBytes(bytes:Buffer,certificate:Buffer|null):Buffer {
 if(unframe(bytes,PORTABLE_MAGIC))return bytes;
 return certificate?frame(bytes,JSON.parse(certificate.toString('utf8')),PORTABLE_MAGIC):bytes;
}
export function splitPortableBackup(bytes:Buffer):{bytes:Buffer;certificate:Buffer|null} {
 const part=unframe(bytes,PORTABLE_MAGIC);return part?{bytes:part.payload,certificate:part.json}:{bytes,certificate:null};
}
