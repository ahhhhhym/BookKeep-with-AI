/** Synthetic fault fixture for real DataPage recovery; never uses user data. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LedgerStore} from '../../src/main/services/ledger-store';
import {APP_VERSION} from '../../src/shared/app-version';
import {sha256File} from '../../src/main/storage/backup-archive';
import {AppError} from '../../src/shared/errors';
const [base,scenario]=process.argv.slice(2);
if(!base||!scenario||!path.isAbsolute(base)||!base.includes('bk-v016-rework-'))throw Error('Synthetic absolute root required');
const root=path.join(base,'BookKeepAI'),layout={root,data:path.join(root,'data'),secrets:path.join(root,'secrets'),backups:path.join(root,'backups'),logs:path.join(root,'logs'),temp:path.join(root,'temp'),shell:path.join(root,'shell')};
let armed=false;
const store=LedgerStore.open({layout,appVersion:APP_VERSION,clock:()=>Date.parse('2026-10-27T15:59:59.000Z'),tokenSecret:Buffer.from('0123456789abcdef0123456789abcdef'),fault:step=>{if(armed&&scenario!=='completed'&&step==='backup-before-completion-log')throw Error('synthetic completion persistence unavailable');}});
const transaction=store.createTransaction({amountFen:321,occurredDate:'2026-10-27',occurredTime:null,timePrecision:'date',name:'备份核心合成业务',categoryId:'cat_food',merchant:null,note:null},randomUUID());
armed=true;
try{store.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},randomUUID());}catch(error){if(scenario==='completed'||!(error instanceof AppError)||error.code!=='BACKUP_FAILED'||error.details.step!=='completion-unverified')throw error;}
const record=store.listBackups({limit:50,cursor:null}).records.find(r=>r.kind==='manual'&&r.archiveHash!==null);if(!record?.archiveHash)throw Error('Fixture core not published');
const file=store.diagnostics().backupPathOf(record.id),hash=sha256File(file);store.close();
if(scenario==='torn-log')fs.writeFileSync(file+'.completion.json','{"fact":');
if(scenario==='bad-log')fs.writeFileSync(file+'.completion.json',JSON.stringify({version:'bk-completion.v2',signature:'synthetic-invalid'}));
if(scenario==='missing-core')fs.unlinkSync(file);
if(scenario==='corrupt-core')fs.appendFileSync(file,'synthetic corruption');
if(scenario==='hash-conflict'){const catalog=JSON.parse(fs.readFileSync(path.join(layout.backups,'catalog.json'),'utf8'));catalog.entries.find((r:{id:string})=>r.id===record.id).archiveHash='0'.repeat(64);fs.writeFileSync(path.join(layout.backups,'catalog.json'),JSON.stringify(catalog));}
process.stdout.write(JSON.stringify({scenario,appVersion:APP_VERSION,root,record,coreHash:hash,transaction:transaction.transaction,completionLogExists:fs.existsSync(file+'.completion.json'),generationMethod:'Current source LedgerStore, transaction 321 fen; exception after core publication at backup-before-completion-log, then optional synthetic log/core corruption before restart'}));
