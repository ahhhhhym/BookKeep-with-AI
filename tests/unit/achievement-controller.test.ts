import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {AchievementList} from '../../src/shared/achievements';
import {AchievementController} from '../../src/renderer/lib/achievement-controller';
import {ACHIEVEMENTS} from '../../src/shared/achievements';
const transport=vi.hoisted(()=>({api:null as unknown}));
vi.mock('../../src/renderer/lib/bridge',()=>({call:(fn:(api:unknown)=>unknown)=>fn(transport.api)}));
let list:AchievementList,foreground:boolean,revision:number,readCount:number,present:ReturnType<typeof vi.fn>,consume:ReturnType<typeof vi.fn>,controller:AchievementController,stop:()=>void;
beforeEach(()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','performance']});
 list={ruleVersion:1,ledgerId:'l',dataEpoch:'a',progress:{entries:1,aiEntries:0,activityDays:1,currentStreak:1,longestStreak:1,backups:0,backupDays:0},items:ACHIEVEMENTS.map(d=>({...d,conditionVersion:1,progress:0,unlocked:false,unlockedAt:null,origin:null,evaluatedAt:null,evidence:null})),notices:[{id:'one',kind:'unlock',achievementIds:['entry_first'],status:'pending',createdAt:'',stateAt:''}]};
 foreground=true;revision=0;readCount=0;present=vi.fn(async()=>true);consume=vi.fn(async()=>({}));
 transport.api={achievement:{presentation:async()=>({ledgerId:list.ledgerId,dataEpoch:list.dataEpoch,revision,foreground,foregroundMs:performance.now(),preferences:{enabled:true,position:'center'}}),watch:async()=>{readCount++;return list;},present,consume}};
 controller=new AchievementController();stop=()=>{};
});
afterEach(()=>{stop();vi.useRealTimers();});
const flush=()=>vi.advanceTimersByTimeAsync(1);
const start=()=>{stop=controller.subscribe(()=>{});controller.setEligible(true);};
describe('single scheduler lifetime fences',()=>{
 it('query, repeated subscribers, remount and repeated visible callback confirm one time only',async()=>{
  start();await flush();expect(readCount).toBe(1);expect(present).not.toHaveBeenCalled();
  const stop2=controller.subscribe(()=>{});stop2();stop();stop=controller.subscribe(()=>{});controller.setEligible(true);await flush();
  const key=controller.getSnapshot().active!.key;await Promise.all([controller.visible(key),controller.visible(key)]);expect(present).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1500);await controller.visible(key);expect(present).toHaveBeenCalledTimes(1);expect(readCount).toBe(1);
 });
 it('deferred foreground has no card or consumption; loss of eligibility freezes timer and hidden task',async()=>{
  foreground=false;start();await flush();await vi.advanceTimersByTimeAsync(6000);expect(controller.getSnapshot().active).toBeNull();expect(present).not.toHaveBeenCalled();
  foreground=true;await vi.advanceTimersByTimeAsync(500);const key=controller.getSnapshot().active!.key;await controller.visible(key);
  await vi.advanceTimersByTimeAsync(1000);controller.setEligible(false);const remaining=controller.getSnapshot().remaining;
  await vi.advanceTimersByTimeAsync(6000);expect(controller.getSnapshot().remaining).toBe(remaining);expect(consume).not.toHaveBeenCalled();
  controller.setEligible(true);await vi.advanceTimersByTimeAsync(remaining+600);expect(consume).toHaveBeenCalledTimes(1);
 });
 it('old list/confirmation after restore cannot refill current tasks',async()=>{
  start();await flush();let release!:(ok:boolean)=>void;present.mockImplementationOnce(()=>new Promise(r=>release=r));
  const pending=controller.visible(controller.getSnapshot().active!.key);controller.reset();list={...list,dataEpoch:'b',notices:[]};revision++;
  release(true);await pending;await vi.advanceTimersByTimeAsync(600);expect(controller.getSnapshot().data?.dataEpoch).toBe('b');expect(controller.getSnapshot().active).toBeNull();expect(consume).not.toHaveBeenCalled();
 });
 it('presentation errors retain the same card for retry; failed close does not silently drop it',async()=>{
  start();await flush();present.mockRejectedValueOnce(Error('synthetic'));const key=controller.getSnapshot().active!.key;await controller.visible(key);
  expect(controller.getSnapshot().noticeError).toBeTruthy();await vi.advanceTimersByTimeAsync(1100);await controller.visible(key);expect(present).toHaveBeenCalledTimes(2);
  consume.mockRejectedValueOnce(Error('synthetic'));controller.dismiss();await flush();expect(controller.getSnapshot().active?.key).toBe(key);expect(controller.getSnapshot().noticeError).toContain('关闭状态保存失败');controller.dismiss();await flush();expect(controller.getSnapshot().active).toBeNull();
 });
 it('demo has no list, presentation confirmation or consumption side effects',async()=>{
  list={...list,notices:[]};start();await flush();const reads=readCount;controller.preview();await controller.visible(controller.getSnapshot().active!.key);controller.dismiss();
  expect(readCount).toBe(reads);expect(present).not.toHaveBeenCalled();expect(consume).not.toHaveBeenCalled();
 });
 it('synchronous native dialog time is excluded even when JS timers cannot execute',async()=>{
  start();await flush();await controller.visible(controller.getSnapshot().active!.key);await vi.advanceTimersByTimeAsync(400);
  controller.nativeDialog(true);const before=controller.getSnapshot().remaining;await vi.advanceTimersByTimeAsync(1400);controller.nativeDialog(false);
  expect(controller.getSnapshot().remaining).toBe(before);await vi.advanceTimersByTimeAsync(before+600);expect(consume).toHaveBeenCalledTimes(1);
 });
 it('a delayed native foreground sample cannot charge hidden time when the card returns',async()=>{
  start();await flush();await controller.visible(controller.getSnapshot().active!.key);
  await vi.advanceTimersByTimeAsync(600);controller.setEligible(false);const remaining=controller.getSnapshot().remaining;
  await vi.advanceTimersByTimeAsync(2000);controller.setEligible(true);
  expect(controller.getSnapshot().remaining).toBe(remaining);
  await flush();expect(controller.getSnapshot().remaining).toBe(remaining);
 });
 it('a native background fence freezes the last visible amount before renderer visibility arrives',async()=>{
  start();await flush();await controller.visible(controller.getSnapshot().active!.key);
  await vi.advanceTimersByTimeAsync(600);const remaining=controller.getSnapshot().remaining;
  foreground=false;await vi.advanceTimersByTimeAsync(500);
  expect(controller.getSnapshot().visible).toBe(false);
  expect(controller.getSnapshot().remaining).toBe(remaining);
 });
});
