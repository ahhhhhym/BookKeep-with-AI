/** Real-process fault worker. Every path is supplied by the isolated unit harness. */
import fs from 'node:fs';
import {LedgerStore} from '../../src/main/services/ledger-store';
import {storeOptions} from '../unit/db/helpers';
const [layoutJson,mutationId,step]=process.argv.slice(2),layout=JSON.parse(layoutJson!);
let now=Date.parse('2026-10-27T15:59:59.000Z'),armed=false;
const rawRename=fs.renameSync,rawOpen=fs.openSync,rawWrite=fs.writeFileSync;
const descriptors=new Map<number,string>();
// Cut the process inside the real publication syscall or the final-log write, not an exception unwind.
fs.renameSync=((from:fs.PathLike,to:fs.PathLike)=>{rawRename(from,to);if(armed&&step==='publishing-syscall-crash'&&String(to).endsWith('.bkdb'))process.kill(process.pid,'SIGKILL');}) as typeof fs.renameSync;
fs.openSync=((file:fs.PathLike,flags:fs.OpenMode,mode?:fs.Mode)=>{const fd=rawOpen(file,flags,mode);descriptors.set(fd,String(file));return fd;}) as typeof fs.openSync;
fs.writeFileSync=((file:fs.PathOrFileDescriptor,data:unknown,...args:unknown[])=>{
 if(armed&&step==='completion-log-torn'&&typeof file==='number'&&descriptors.get(file)?.endsWith('.completion.json')){rawWrite(file,Buffer.from(String(data)).subarray(0,24));process.kill(process.pid,'SIGKILL');}
 return (rawWrite as (...args:unknown[])=>void)(file,data,...args);
}) as typeof fs.writeFileSync;
const store=LedgerStore.open(storeOptions(layout,()=>now,{fault:p=>{
 if(!armed)return;
 if(step==='non-shanghai'&&p==='backup-before-publish')now=Date.parse('2026-10-27T16:00:00.000Z');
 if(p===step)process.kill(process.pid,'SIGKILL');
}}));
armed=true;
const result=store.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},mutationId!);
if(step==='response-lost')process.kill(process.pid,'SIGKILL');
process.stdout.write(JSON.stringify({result,hostTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone}));store.close();
