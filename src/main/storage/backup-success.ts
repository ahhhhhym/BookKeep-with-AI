/** Versioned commit witness. No key, temporary path or caller-supplied timestamp crosses IPC. */
import {createHash,createPublicKey,generateKeyPairSync,sign,verify,type KeyObject} from 'node:crypto';
import {AppError} from '../../shared/errors';
import {isUuidV4} from '../../shared/validation';

export const SUCCESS_VERSION='bk-success.v1';
const MAGIC=Buffer.from('\nBK-SUCCESS.v1\n','ascii');
export interface BackupSuccess {
 readonly version:typeof SUCCESS_VERSION; readonly backupId:string; readonly ledgerId:string;
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
 const trailer=bytes.subarray(-MAGIC.length).equals(MAGIC);
 if(m.successVersion===undefined){if(trailer||m.verificationKey!==undefined)throw new AppError('BACKUP_INVALID');return null;}
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
 if(!bytes.subarray(-MAGIC.length).equals(MAGIC))return bytes.length;
 const end=bytes.length-MAGIC.length-4;return end-bytes.readUInt32BE(end);
}
