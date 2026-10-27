import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import type { CsvInput } from '../../shared/maintenance';
import type { BackupArtifactView, TransactionView } from '../../shared/entities';
import { formatFenToYuan } from '../../shared/amount';
import { digest } from '../storage/backup-content';
import { MAX_BACKUP_BYTES, inspectBackupArchive } from '../storage/backup-archive';
import { readBoundedFile, regularPath } from '../storage/safe-file';
import { atomicFile } from './image-service';
import { LATEST_SCHEMA_VERSION } from '../db/migrations';
import { CONTRACT_VERSION } from '../../shared/constants';
import { hashPayload } from './canonical';
import type { LedgerStore } from './ledger-store';

export function csvCell(value:string):string {
  const safe=/^[\s\uFEFF]*[=+\-@]/u.test(value)||/^[\t\r\n]/.test(value)?"'"+value:value;
  return '"'+safe.replaceAll('"','""')+'"';
}
export interface FileDialogs { save(name:string):Promise<string|null>; open():Promise<string|null> }
type Artifact={bytes:Buffer;view:BackupArtifactView;epoch:string;ledgerId:string;owner:number|null;x:number};
export class MaintenanceService {
  private artifacts=new Map<string,Artifact>();
  private selections=new Map<string,Artifact>();
  private receipts=new Map<string,{hash:string;result:unknown}>();
  private receiptEpoch:string|null=null;
  constructor(private readonly store:LedgerStore,private readonly dialogs:FileDialogs,private readonly owner:()=>number|null,private readonly clock=Date.now){}
  private syncGeneration(){const key=this.store.currentLedgerId+'/'+this.store.currentEpoch;if(this.receiptEpoch!==key){this.receipts.clear();this.artifacts.clear();this.selections.clear();this.receiptEpoch=key;}}
  private clean(){this.syncGeneration();for(const map of [this.artifacts,this.selections])for(const [id,a] of map)if(a.x<this.clock()||a.epoch!==this.store.currentEpoch||a.ledgerId!==this.store.currentLedgerId)map.delete(id);if(this.artifacts.size+this.selections.size>=20)throw new AppError('BACKUP_LIMIT');}
  private artifact(bytes:Buffer,name:string,recordCount:number|null):Artifact {
    this.clean(); const id=randomUUID(),view={artifactId:id,displayName:name,byteSize:bytes.length,sha256:digest(bytes),recordCount,createdAt:new Date(this.clock()).toISOString()};
    const a={bytes,view,epoch:this.store.currentEpoch,ledgerId:this.store.currentLedgerId,owner:this.owner(),x:this.clock()+300000};const aggregate=[...this.artifacts.values(),...this.selections.values()].reduce((n,a)=>n+a.bytes.length,bytes.length);if(aggregate>MAX_BACKUP_BYTES)throw new AppError('BACKUP_LIMIT');this.artifacts.set(id,a);return a;
  }
  private check(a:Artifact|undefined):Artifact {if(!a||a.epoch!==this.store.currentEpoch||a.ledgerId!==this.store.currentLedgerId||a.owner!==this.owner()||a.x<this.clock())throw new AppError('TOKEN_EXPIRED');return a;}
  private async once<T>(id:string,payload:unknown,fn:()=>Promise<T>|T):Promise<T>{
    this.syncGeneration();const epoch=this.store.currentEpoch,ledgerId=this.store.currentLedgerId;
    const hash=hashPayload(payload),old=this.receipts.get(id);if(old){if(old.hash!==hash)throw new AppError('IDEMPOTENCY_CONFLICT');return old.result as T;}
    if(this.receipts.size>=1000)throw new AppError('BACKUP_LIMIT');
    const pending=Promise.resolve().then(()=>{if(epoch!==this.store.currentEpoch||ledgerId!==this.store.currentLedgerId)throw new AppError('STALE_EPOCH');return fn();}).then(result=>{if(epoch!==this.store.currentEpoch||ledgerId!==this.store.currentLedgerId)throw new AppError('STALE_EPOCH');return result;});
    const receipt={hash,result:pending};this.receipts.set(id,receipt);
    try{return await pending;}catch(e){if(this.receipts.get(id)===receipt)this.receipts.delete(id);throw e;}
  }
  csv(input:CsvInput,mutationId:string){return this.once(mutationId,input,()=>{
    if(input.filter.deleted!=='active')throw new AppError('FIELD_INVALID');
    if(input.snapshotRevision!==null&&input.snapshotRevision!==this.store.currentRevision)throw new AppError('SNAPSHOT_STALE');
    const revision=this.store.currentRevision,categories=new Map(this.store.listCategories(true).categories.map(c=>[c.id,c.name]));
    const rows:TransactionView[]=[];let cursor:string|null=null;
    do {const page=this.store.listTransactions({filter:input.filter,page:{limit:100,cursor}});rows.push(...page.items);cursor=page.nextCursor;if(rows.length>100000)throw new AppError('BACKUP_LIMIT');}while(cursor);
    if(revision!==this.store.currentRevision)throw new AppError('SNAPSHOT_STALE');
    const lines=[['日期','时间','时间精度','名称','分类','支出金额（元）','币种','商户','备注','来源','交易ID'].map(csvCell).join(',')];
    for(const t of rows)lines.push([t.occurredDate,t.occurredTime??'',t.timePrecision,t.name,categories.get(t.categoryId)??'',formatFenToYuan(t.amountFen),t.currency,t.merchant??'',t.note??'',t.source,t.id].map(csvCell).join(','));
    return this.artifact(Buffer.from('\uFEFF'+lines.join('\r\n')+'\r\n','utf8'),'BookKeepAI-正式交易.csv',rows.length).view;
  });}
  backup(backupId:string){const record=this.store.backupRecord(backupId);if(!record?.archiveHash)throw new AppError('NOT_FOUND');this.store.previewRestore(backupId);const file=regularPath(this.store.diagnostics().backupPathOf(backupId),this.store.diagnostics().root);if(statSync(file).size>MAX_BACKUP_BYTES)throw new AppError('BACKUP_LIMIT');const bytes=readBoundedFile(file,MAX_BACKUP_BYTES);if(digest(bytes)!==record.archiveHash)throw new AppError('HASH_MISMATCH');return this.artifact(bytes,'BookKeepAI-'+backupId+'.bkdb',null).view;}
  save(id:string,mutationId:string){return this.once(mutationId,{id},async()=>{const a=this.check(this.artifacts.get(id)),target=await this.dialogs.save(a.view.displayName);if(!target)return {saved:false};this.check(a);const root=this.store.diagnostics().root,absolute=path.resolve(target);const relative=path.relative(root,absolute);if(relative===''||(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)))throw new AppError('PERMISSION_DENIED');regularPath(absolute,path.parse(absolute).root,false);atomicFile(absolute,a.bytes);return {saved:true};});}
  async select(){this.clean();const epoch=this.store.currentEpoch,ledgerId=this.store.currentLedgerId,file=await this.dialogs.open();if(epoch!==this.store.currentEpoch||ledgerId!==this.store.currentLedgerId)throw new AppError('STALE_EPOCH');if(!file)return {selectionToken:null};regularPath(file,path.parse(file).root);if(statSync(file).size>MAX_BACKUP_BYTES)throw new AppError('BACKUP_LIMIT');const a=this.artifact(readBoundedFile(file,MAX_BACKUP_BYTES),'selected.bkdb',null);this.artifacts.delete(a.view.artifactId);this.selections.set(a.view.artifactId,a);return {selectionToken:a.view.artifactId};}
  import(token:string,mutationId:string){return this.once(mutationId,{token},()=>{
    const a=this.check(this.selections.get(token)),root=this.store.diagnostics().root,temp=path.join(root,'temp',randomUUID()+'.bkdb');
    try{regularPath(temp,root,false);atomicFile(temp,a.bytes);const inspection=inspectBackupArchive(temp,{latestSchemaVersion:LATEST_SCHEMA_VERSION,contractVersion:CONTRACT_VERSION});if(!inspection.ok)throw new AppError(inspection.code);
      const id=inspection.archive.manifest.backupId;if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw new AppError('BACKUP_INVALID');
      const known=this.store.backupRecord(id);if(known&&known.archiveHash!==a.view.sha256)throw new AppError('HASH_MISMATCH');
      const target=regularPath(this.store.diagnostics().backupPathOf(id),root,false);if(existsSync(target)){if(digest(readFileSync(target))!==a.view.sha256)throw new AppError('HASH_MISMATCH');}else atomicFile(target,a.bytes);
      this.store.refreshBackupCatalog();this.store.previewRestore(id);return {backupId:id};
    }finally{if(existsSync(temp))unlinkSync(temp);}
  });}
}
