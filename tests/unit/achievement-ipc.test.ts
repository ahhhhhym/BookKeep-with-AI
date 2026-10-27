import {describe,it,expect} from 'vitest';
import {CHANNEL_SPECS,isKnownChannel} from '../../src/shared/ipc';
import {validateIpcRequest} from '../../src/main/ipc/validate-request';
import {CONTRACT_VERSION} from '../../src/shared/constants';
import {randomUUID} from 'node:crypto';
const epoch=randomUUID();
const req=(payload:unknown)=>({contractVersion:CONTRACT_VERSION,requestId:randomUUID(),mutationId:randomUUID(),dataEpoch:epoch,payload});
describe('achievement IPC whitelist',()=>{
 it('only exposes read and bounded notice state, never grants or caller-specified progress',()=>{
  expect(isKnownChannel('achievement.list')).toBe(true);expect(isKnownChannel('achievement.unlock')).toBe(false);
  const specs=CHANNEL_SPECS;
  expect(validateIpcRequest(specs.achievementList,req({}),{expectedEpoch:epoch}).payload).toEqual({});
  for(const payload of [{count:100},{ledgerId:randomUUID()},{unlockedAt:new Date().toISOString()},{sql:'SELECT 1'},{demo:true}])expect(()=>validateIpcRequest(specs.achievementList,req(payload),{expectedEpoch:epoch})).toThrow();
  for(const state of ['shown','closed','suppressed'])expect(validateIpcRequest(specs.achievementConsume,req({noticeId:randomUUID(),state}),{expectedEpoch:epoch}).payload).toMatchObject({state});
  for(const payload of [{noticeId:randomUUID(),state:['shown']},{noticeId:randomUUID(),state:'pending'},{noticeId:'bad',state:'shown'},{noticeId:randomUUID(),state:'shown',ledgerId:randomUUID()},{noticeId:randomUUID(),state:'unlock'}])expect(()=>validateIpcRequest(specs.achievementConsume,req(payload),{expectedEpoch:epoch})).toThrow();
  expect(()=>validateIpcRequest(specs.achievementConsume,req({noticeId:randomUUID(),state:'shown'}),{expectedEpoch:randomUUID()})).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
 });
 it('validates local preference enums and bounded atomic presentation without new award controls',()=>{
  const s=CHANNEL_SPECS;
  expect(validateIpcRequest(s.achievementPreferencesApply,req({enabled:false,position:'bottom-right'}),{expectedEpoch:epoch}).payload).toEqual({enabled:false,position:'bottom-right'});
  for(const payload of [{enabled:0,position:'center'},{enabled:true,position:['center']},{enabled:false,position:'outside'},{enabled:true,position:'center',path:'outside'}])expect(()=>validateIpcRequest(s.achievementPreferencesApply,req(payload),{expectedEpoch:epoch})).toThrow();
  const id=randomUUID();expect(validateIpcRequest(s.achievementPresent,req({noticeIds:[id]}),{expectedEpoch:epoch}).payload).toEqual({noticeIds:[id]});
  for(const payload of [{noticeIds:[]},{noticeIds:[id,id]},{noticeIds:['bad']},{noticeIds:Array.from({length:11},()=>randomUUID())},{noticeIds:[id],unlocked:true}])expect(()=>validateIpcRequest(s.achievementPresent,req(payload),{expectedEpoch:epoch})).toThrow();
  expect(()=>validateIpcRequest(s.achievementPresent,req({noticeIds:[id]}),{expectedEpoch:randomUUID()})).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
 });
});
