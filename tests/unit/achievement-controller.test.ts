import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {AchievementList} from '../../src/shared/achievements';
import {AchievementController} from '../../src/renderer/lib/achievement-controller';
import {ACHIEVEMENTS} from '../../src/shared/achievements';
const transport=vi.hoisted(()=>({api:null as unknown}));
vi.mock('../../src/renderer/lib/bridge',()=>({call:(fn:(api:unknown)=>unknown)=>fn(transport.api)}));
let list:AchievementList,foreground:boolean,enabled:boolean,revision:number,readCount:number,present:ReturnType<typeof vi.fn>,consume:ReturnType<typeof vi.fn>,controller:AchievementController,stop:()=>void;
beforeEach(()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','performance']});
 list={ruleVersion:1,ledgerId:'l',dataEpoch:'a',progress:{entries:1,aiEntries:0,activityDays:1,currentStreak:1,longestStreak:1,backups:0,backupDays:0},items:ACHIEVEMENTS.map(d=>({...d,conditionVersion:1,progress:0,unlocked:false,unlockedAt:null,origin:null,evaluatedAt:null,evidence:null})),notices:[{id:'one',kind:'unlock',achievementIds:['entry_first'],status:'pending',createdAt:'',stateAt:''}]};
 foreground=true;enabled=true;revision=0;readCount=0;present=vi.fn(async()=>true);consume=vi.fn(async()=>({}));
 transport.api={achievement:{presentation:async()=>({ledgerId:list.ledgerId,dataEpoch:list.dataEpoch,revision,foreground,foregroundMs:performance.now(),preferences:{enabled,position:'center'}}),watch:async()=>{readCount++;return list;},present,consume}};
 controller=new AchievementController();stop=()=>{};
});
afterEach(()=>{stop();vi.useRealTimers();});
const flush=()=>vi.advanceTimersByTimeAsync(1);
const start=()=>{stop=controller.subscribe(()=>{});controller.setEligible(true);};
describe('single scheduler lifetime fences',()=>{
 it('disabled notices still allow a deferred preview without durable side effects',async()=>{
  enabled=false;start();await flush();controller.setEligible(false);controller.preview();await vi.advanceTimersByTimeAsync(1000);
  controller.setEligible(true);await flush();expect(controller.getSnapshot().active?.demo).toBe(true);await controller.visible(controller.getSnapshot().active!.key);
  await vi.advanceTimersByTimeAsync(1000);expect(controller.getSnapshot().active?.demo).toBe(true);controller.dismiss();await vi.advanceTimersByTimeAsync(180);
  expect(controller.getSnapshot().active).toBeNull();expect(present).not.toHaveBeenCalled();expect(consume).not.toHaveBeenCalled();
 });
 it('entry_does_not_spend_visible_budget',async()=>{
  start();await flush();await vi.advanceTimersByTimeAsync(3000);
  expect(controller.getSnapshot().remaining).toBe(5000);
  expect(controller.getSnapshot()).toMatchObject({phase:'entering'});
  await controller.visible(controller.getSnapshot().active!.key);
  expect(controller.getSnapshot()).toMatchObject({phase:'visible'});
 });
 it('exit_cannot_double_dismiss and next_notice_waits_for_current_exit',async()=>{
  list={...list,notices:[...list.notices,{...list.notices[0]!,id:'two',achievementIds:['entry_10']}]};
  start();await flush();const key=controller.getSnapshot().active!.key;await controller.visible(key);
  expect(controller.dismiss()).toBe(true);expect(controller.dismiss()).toBe(false);await flush();
  expect(consume).toHaveBeenCalledTimes(1);expect(controller.getSnapshot()).toMatchObject({active:{key},phase:'exiting'});
  await vi.advanceTimersByTimeAsync(178);expect(controller.getSnapshot().active?.key).toBe(key);
  await vi.advanceTimersByTimeAsync(2);expect(controller.getSnapshot().active?.key).toBe('two');
 });
 it('blur_during_exit_does_not_replay_notice and preview cannot preempt exit',async()=>{
  start();await flush();const key=controller.getSnapshot().active!.key;await controller.visible(key);controller.dismiss();
  controller.setEligible(false);controller.preview();await vi.advanceTimersByTimeAsync(200);
  expect(controller.getSnapshot().active).toBeNull();controller.setEligible(true);await flush();
  expect(controller.getSnapshot().active?.demo).toBe(true);expect(present).toHaveBeenCalledTimes(1);expect(consume).toHaveBeenCalledTimes(1);
 });
 it('reduced_motion_does_not_need_animationend',async()=>{
  list={...list,notices:[]};start();await flush();controller.setReducedMotion(true);controller.preview();await controller.visible(controller.getSnapshot().active!.key);controller.dismiss();
  expect(controller.getSnapshot()).toMatchObject({phase:'exiting'});await vi.advanceTimersByTimeAsync(120);expect(controller.getSnapshot().active).toBeNull();
 });
 it('delayed durable close blocks the next card even after the visual deadline',async()=>{
  list={...list,notices:[...list.notices,{...list.notices[0]!,id:'two'}]};start();await flush();await controller.visible('one');
  let release!:()=>void;consume.mockImplementationOnce(()=>new Promise<void>(r=>release=r));
  controller.dismiss();await vi.advanceTimersByTimeAsync(500);expect(controller.getSnapshot()).toMatchObject({active:{key:'one'},phase:'exiting',interactive:false});
  release();await flush();expect(controller.getSnapshot().active?.key).toBe('two');
 });
 it('pause/resume never re-enters or resets budget; stale confirmations cannot touch the next card',async()=>{
  start();await flush();await controller.visible('one');await vi.advanceTimersByTimeAsync(1500);controller.pause('hover',true);
  const remaining=controller.getSnapshot().remaining;await vi.advanceTimersByTimeAsync(6000);controller.pause('hover',false);
  expect(controller.getSnapshot()).toMatchObject({remaining,phase:'visible'});controller.setEligible(false);await vi.advanceTimersByTimeAsync(6000);controller.setEligible(true);
  expect(controller.getSnapshot()).toMatchObject({remaining,phase:'visible'});await controller.visible('stale');expect(present).toHaveBeenCalledTimes(1);
 });
 it('timeout failure preserves zero budget and waits for an explicit retry instead of a consume loop',async()=>{
  start();await flush();await controller.visible('one');consume.mockRejectedValueOnce(Error('synthetic'));
  await vi.advanceTimersByTimeAsync(6500);expect(controller.getSnapshot()).toMatchObject({remaining:0,phase:'visible',interactive:true});
  expect(consume).toHaveBeenCalledTimes(1);controller.dismiss();await vi.advanceTimersByTimeAsync(180);expect(controller.getSnapshot().active).toBeNull();
 });
 it('a failed close can be retried without repeating its navigation business event',async()=>{
  start();await flush();await controller.visible('one');const navigate=vi.fn();consume.mockRejectedValueOnce(Error('synthetic'));
  controller.dismiss(navigate);controller.dismiss(navigate);await vi.advanceTimersByTimeAsync(180);
  controller.dismiss(navigate);await vi.advanceTimersByTimeAsync(180);expect(navigate).toHaveBeenCalledTimes(1);expect(controller.getSnapshot().active).toBeNull();
 });
 it('reset cancels an old exit deadline without consuming a new epoch card',async()=>{
  start();await flush();await controller.visible('one');controller.dismiss();list={...list,dataEpoch:'b',notices:[{...list.notices[0]!,id:'new'}]};controller.reset();controller.setEligible(true);
  await vi.advanceTimersByTimeAsync(500);expect(controller.getSnapshot()).toMatchObject({active:{key:'new'},phase:'entering',remaining:5000});expect(consume).toHaveBeenCalledTimes(1);
 });
 it('a transient content-read error cannot strand an already shown card in exit',async()=>{
  start();await flush();await controller.visible('one');
  (transport.api as {achievement:{watch:()=>Promise<AchievementList>}}).achievement.watch=async()=>{throw Error('synthetic content read');};
  controller.retry();await flush();expect(controller.getSnapshot().data).toBeNull();expect(controller.dismiss()).toBe(true);
  await vi.advanceTimersByTimeAsync(180);expect(consume).toHaveBeenCalledWith({noticeId:'one',state:'closed'},{dataEpoch:'a'});expect(controller.getSnapshot().active).toBeNull();
 });
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
  consume.mockRejectedValueOnce(Error('synthetic'));controller.dismiss();await vi.advanceTimersByTimeAsync(180);expect(controller.getSnapshot().active?.key).toBe(key);expect(controller.getSnapshot().noticeError).toContain('关闭状态保存失败');controller.dismiss();await vi.advanceTimersByTimeAsync(180);expect(controller.getSnapshot().active).toBeNull();
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
