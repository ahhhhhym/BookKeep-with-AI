import {afterEach,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {LedgerStore} from '../../../src/main/services/ledger-store';
import {createTestLayout,cleanupLayout,storeOptions,openReadOnly} from './helpers';
const stores:LedgerStore[]=[],layouts:ReturnType<typeof createTestLayout>[]=[];
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const l of layouts.splice(0))cleanupLayout(l);});
describe('E backup completion Shanghai midnight integration',()=>{
 it.each(['backup-before-register','backup-before-publish'])('successful operation crossing midnight at %s uses its successful completion day',step=>{
  let now=Date.parse('2026-10-27T15:59:59.000Z'),armed=false;
  const layout=createTestLayout();layouts.push(layout);
  const s=LedgerStore.open(storeOptions(layout,()=>now,{appVersion:'0.1.4',fault:p=>{if(armed&&p===step)now=Date.parse('2026-10-27T16:00:00.000Z');}}));stores.push(s);armed=true;
  const b=s.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},randomUUID());
  const actual=openReadOnly(s.diagnostics().databasePath,db=>db.prepare<{day:string;succeeded_at:string}>("SELECT day,succeeded_at FROM achievement_fact WHERE kind='manual_backup'").get());
  const output=process.env.BOOKKEEP_E_MIDNIGHT_OUTPUT;if(output){mkdirSync(output,{recursive:true});writeFileSync(path.join(output,step+'.json'),JSON.stringify({step,expected:{day:'2026-10-28'},actual,returnedAt:new Date(now).toISOString(),backup:b.record,ok:actual?.day==='2026-10-28'},null,2));}
  expect(actual?.day).toBe('2026-10-28');
 });
});
