import type { ChannelSpec } from './ipc';
import type { TransactionFilter, BackupArtifactView } from './entities';
import { isPlainRecord, isUuidV4 } from './validation';
export interface CsvInput { filter: TransactionFilter; snapshotRevision: number | null }
export type ActivityInput = { jobId:string; event:'focus'|'interaction'|'blur'|'cancel' };
export type RestoreStatus =
  | { status: 'committed'; result: import('./entities').BackupRestoreResult }
  | { status: 'previously_committed' | 'failed' | 'interrupted' | 'unknown'; result: null };
export interface MaintenanceApi {
  exportCsv(input:CsvInput):Promise<import('./api').ApiResult<BackupArtifactView>>;
  backupArtifact(input:{backupId:string}):Promise<import('./api').ApiResult<BackupArtifactView>>;
  save(input:{artifactId:string}):Promise<import('./api').ApiResult<{saved:boolean}>>;
  selectBackup():Promise<import('./api').ApiResult<{selectionToken:string|null}>>;
  importBackup(input:{selectionToken:string;containsPrivateDataAcknowledged:true}):Promise<import('./api').ApiResult<{backupId:string}>>;
  restoreStatus(input:{restoreId:string}):Promise<import('./api').ApiResult<RestoreStatus>>;
  activity(input:ActivityInput):Promise<import('./api').ApiResult<{recorded:true}>>;
  reviewMetrics(input:{jobId:string|null}):Promise<import('./api').ApiResult<Record<string,unknown>>>;
}
export const MAINTENANCE_CHANNELS={maintenanceCsv:'transaction.exportCsv',maintenanceBackupArtifact:'backup.artifact',maintenanceSave:'artifact.save',maintenanceSelect:'backup.select',maintenanceImport:'backup.import',maintenanceStatus:'backup.restoreStatus',maintenanceActivity:'review.activity',maintenanceMetrics:'review.metrics'} as const;
const entries=Object.entries(MAINTENANCE_CHANNELS);
const required=[['filter','snapshotRevision'],['backupId'],['artifactId'],[],['selectionToken','containsPrivateDataAcknowledged'],['restoreId'],['jobId','event'],['jobId']];
function valid(i:number,v:Record<string,unknown>):boolean {
  if(i===0){
    const f=v.filter;
    return (v.snapshotRevision===null||Number.isSafeInteger(v.snapshotRevision)&&Number(v.snapshotRevision)>=0) && isPlainRecord(f) && Object.keys(f).every(k=>['dateStart','dateEnd','nameQuery','categoryIds','deleted'].includes(k)) && ['dateStart','dateEnd','nameQuery'].every(k=>f[k]===null||typeof f[k]==='string'&&String(f[k]).length<=100) && f.deleted==='active' && Array.isArray(f.categoryIds)&&f.categoryIds.length<=500&&f.categoryIds.every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x));
  }
  if(i===1)return isUuidV4(v.backupId);
  if(i===2)return isUuidV4(v.artifactId);
  if(i===3)return true;
  if(i===4)return isUuidV4(v.selectionToken)&&v.containsPrivateDataAcknowledged===true;
  if(i===5)return isUuidV4(v.restoreId);
  if(i===6)return isUuidV4(v.jobId)&&['focus','interaction','blur','cancel'].includes(String(v.event));
  return v.jobId===null||isUuidV4(v.jobId);
}
export const MAINTENANCE_SPECS=Object.fromEntries(entries.map(([k,channel],i)=>[k,{channel,permission:[5,7].includes(i)?'R':i===6?'W':'F',skeletonOnly:false,request:{required:required[i]!,optional:[],allowNullEpoch:false,requireMutationId:[0,2,4].includes(i),validatePayload:(v:Record<string,unknown>)=>valid(i,v)?[]:[{path:'payload',code:'INVALID_MAINTENANCE_INPUT'}],cast:(v:Record<string,unknown>)=>v}}])) as unknown as Record<keyof typeof MAINTENANCE_CHANNELS,ChannelSpec<Record<string,unknown>>>;
