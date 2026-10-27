import {afterEach,describe,it,expect} from 'vitest';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LedgerStore} from '../../../src/main/services/ledger-store';
import {createTestLayout,cleanupLayout,storeOptions,transactionInput} from './helpers';
import {readAchievementPreferences} from '../../../src/main/services/achievement-preferences';
import type {StorageLayout} from '../../../src/main/paths';
const layouts: StorageLayout[] = [], stores: LedgerStore[] = [];
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const l of layouts.splice(0))cleanupLayout(l);});
function setup(){const layout=createTestLayout();layouts.push(layout);const options=storeOptions(layout,()=>Date.parse('2026-10-27T04:00:00Z'));const s=LedgerStore.open(options);stores.push(s);return {layout,s,options};}
describe('local notice preferences and durable presentation',()=>{
 it('defaults, strict values, damaged fallback and explicit repair do not block ledger opening',()=>{
  const {s,layout,options}=setup();expect(s.achievementPreferences()).toEqual({enabled:true,position:'center'});
  for(const value of [{enabled:'false',position:'center'},{enabled:false,position:'elsewhere'},{enabled:true,position:'center',ledgerId:'bad'}])expect(()=>s.applyAchievementPreferences(value as never)).toThrow();
  mkdirSync(layout.shell,{recursive:true});writeFileSync(path.join(layout.shell,'achievement-notices.json'),'{bad');
  s.close();const reopened=LedgerStore.open(options);stores.push(reopened);expect(reopened.achievementPreferences()).toEqual({enabled:true,position:'center'});
  reopened.applyAchievementPreferences({enabled:false,position:'bottom-right'});expect(readAchievementPreferences(layout.root)).toEqual({enabled:false,position:'bottom-right'});
 });
 it('disable drains existing pending; disabled unlocking still works and reopening never accumulates',()=>{
  const {s,options}=setup();s.createTransaction(transactionInput(),randomUUID());expect(s.achievementsList().notices[0]?.status).toBe('pending');
  s.applyAchievementPreferences({enabled:false,position:'bottom-right'});
  for(let i=0;i<9;i++)s.createTransaction(transactionInput(),randomUUID());
  expect(s.achievementsList().items.find(i=>i.id==='entry_10')?.unlocked).toBe(true);
  expect(s.achievementsList().notices.every(n=>n.status==='suppressed')).toBe(true);
  s.close();const reopened=LedgerStore.open(options);stores.push(reopened);expect(reopened.achievementPreferences()).toEqual({enabled:false,position:'bottom-right'});
  reopened.applyAchievementPreferences({enabled:true,position:'bottom-right'});expect(reopened.achievementsList().notices.every(n=>n.status==='suppressed')).toBe(true);
 });
 it('batch shown is atomic, query is not consumption, repeat/stale confirmation cannot requeue',()=>{
  const {s}=setup();s.createTransaction(transactionInput(),randomUUID());const list=s.achievementsList(),id=list.notices[0]!.id;
  expect(s.achievementsList().notices[0]?.status).toBe('pending');
  expect(s.presentAchievementNotices([id,randomUUID()],s.currentEpoch)).toBe(false);expect(s.achievementsList().notices[0]?.status).toBe('pending');
  expect(s.presentAchievementNotices([id],s.currentEpoch)).toBe(true);expect(s.presentAchievementNotices([id],s.currentEpoch)).toBe(true);
  expect(()=>s.presentAchievementNotices([id],randomUUID())).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
  s.consumeAchievementNotice({noticeId:id,state:'closed'},s.currentEpoch);expect(s.achievementsList().notices[0]?.status).toBe('closed');
 });
 it('snapshot restore keeps local preferences and suppresses restored notifications',()=>{
  const {s,layout}=setup();s.createTransaction(transactionInput(),randomUUID());const b=s.createBackup({kind:'manual',containsPrivateDataAcknowledged:true},randomUUID());
  s.applyAchievementPreferences({enabled:false,position:'bottom-right'});const file=path.join(layout.shell,'achievement-notices.json'),before=readFileSync(file,'utf8');
  const p=s.restoreBackup({mode:'preview',backupId:b.record.id},null);if(!('restoreToken'in p))throw Error('preview');s.restoreBackup({mode:'commit',restoreToken:p.restoreToken,currentDataWillBeReplaced:true},randomUUID());
  expect(readFileSync(file,'utf8')).toBe(before);expect(s.achievementsList().notices.every(n=>n.status==='suppressed'||n.status==='closed')).toBe(true);
 });
});
