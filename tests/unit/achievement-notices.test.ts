import {describe,it,expect} from 'vitest';
import {noticeCards,VisibleCountdown} from '../../src/renderer/lib/achievement-notices';
import {ACHIEVEMENTS,type AchievementList} from '../../src/shared/achievements';
import {ForegroundClock} from '../../src/main/services/foreground-clock';
const list=(n:number,kind:'unlock'|'history_summary'='unlock'):AchievementList=>({ledgerId:'ledger',dataEpoch:'epoch',ruleVersion:1,progress:{entries:0,aiEntries:0,activityDays:0,currentStreak:0,longestStreak:0,backups:0,backupDays:0},
 items:ACHIEVEMENTS.map(d=>({...d,conditionVersion:1,progress:d.target,unlocked:true,unlockedAt:null,origin:'history',evaluatedAt:null,evidence:null})),
 notices:kind==='history_summary'?[{id:'h',kind,status:'pending',createdAt:'',stateAt:'',achievementIds:ACHIEVEMENTS.slice(0,n).map(d=>d.id)}]:ACHIEVEMENTS.slice(0,n).map((d,i)=>({id:String(i),kind,status:'pending',createdAt:'',stateAt:'',achievementIds:[d.id]}))});
describe('notice presentation grouping and effective timer',()=>{
 it.each([1,2,3])('%i normal notices remain sequential',n=>expect(noticeCards(list(n),new Set())).toHaveLength(n));
 it('more than three group atomically; history is always one summary, zero is silent',()=>{
  expect(noticeCards(list(4),new Set())).toMatchObject([{title:'解锁 4 项成就',noticeIds:['0','1','2','3']}]);
  expect(noticeCards(list(2,'history_summary'),new Set())).toMatchObject([{title:'已补领 2 项成就'}]);
  expect(noticeCards(list(0,'history_summary'),new Set())).toEqual([]);
 });
 it('repeat queries and terminal states never duplicate reserved pending items',()=>{
  expect(noticeCards(list(3),new Set(['0','1','2']))).toEqual([]);
  const l=list(3);expect(noticeCards({...l,notices:l.notices.map(n=>({...n,status:'shown'}))},new Set())).toEqual([]);
 });
 it('pauses while background, hovered, focused or blocked; expires after 5 effective seconds',()=>{
  const t=new VisibleCountdown();t.advance(0,false);t.advance(9999,false);expect(t.remaining).toBe(5000);
  t.advance(10000,true);t.advance(12000,false);expect(t.remaining).toBe(3000);
  t.advance(50000,false);expect(t.remaining).toBe(3000);t.advance(51000,true);expect(t.advance(53999,true)).toBe(false);expect(t.advance(54000,true)).toBe(true);
 });
 it('native foreground clock excludes the whole minimized/background interval independently of renderer delays',()=>{
  let now=0;const clock=new ForegroundClock(()=>now);expect(clock.sample(true)).toBe(0);now=800;expect(clock.sample(false)).toBe(800);
  now=50000;expect(clock.sample(false)).toBe(800);now=60000;expect(clock.sample(true)).toBe(800);now=60500;expect(clock.sample(true)).toBe(1300);
 });
});
