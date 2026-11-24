import { useState, type JSX } from 'react';
import { achievementController, useAchievementContent } from '../lib/achievement-controller';
import { AppIcon } from '../lib/icon-registry';
import { PageHeader, Spinner } from '../components/ui';
import { SlidingSegments } from '../components/SlidingSegments';
import type { AchievementView } from '../../shared/achievements';

const ACHIEVEMENT_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'unlocked', label: '已解锁' },
  { value: 'locked', label: '未解锁' },
] as const;

function unlockLabel(item: AchievementView): string {
  if (item.origin === 'history' || !item.unlockedAt) return '历史补领';
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(item.unlockedAt)) + '（北京时间）';
}
export function AchievementsPage(): JSX.Element {
  const {data,error,loading} = useAchievementContent();
  const [filter,setFilter] = useState<'all'|'unlocked'|'locked'>('all');
  const items = data?.items.filter(item => filter === 'all' || (filter === 'unlocked' ? item.unlocked : !item.unlocked)) ?? [];
  return <section className="page achievements-page" aria-label="成就" data-achievements-stage="complete">
    <PageHeader title="成就" subtitle="每一次认真记录，都值得留念。" />
    {loading ? <p role="status" className="status-inline"><Spinner />正在读取成就…</p> : error ? <div className="notice" data-tone="danger" role="alert"><p>成就读取失败：{error}</p><button type="button" className="button" onClick={achievementController.retry}>重新读取成就</button></div> : data ? <>
      <div className="achievement-summary" aria-label="成就概况">
        <div><strong>已解锁 {data.items.filter(i=>i.unlocked).length} / {data.items.length}</strong><span>成就</span></div>
        <div><strong>{data.progress.currentStreak} 天</strong><span>当前连续记账</span></div>
        <div><strong>{data.progress.longestStreak} 天</strong><span>历史最长连续</span></div>
      </div>
      <SlidingSegments className="achievement-filters" value={filter} items={ACHIEVEMENT_FILTERS} label="成就筛选" onChange={setFilter} />
      {!items.length ? <p className="notice snapshot-fade" key={`empty-${filter}`} role="status">{filter === 'unlocked' ? '还没有解锁的成就，记下几笔支出试试吧。' : '全部成就都已解锁！'}</p> : <div className="achievement-grid snapshot-fade" key={filter}>
        {items.map(item => <article className="achievement-card" key={item.id} data-achievement={item.id} data-unlocked={item.unlocked}>
          <div className="achievement-badge"><AppIcon iconKey="lucide:party-popper" size={26}/><span aria-hidden="true">{item.unlocked ? '✓' : '○'}</span></div>
          <h2>{item.name}</h2><p className="muted">{item.condition}</p>
          <progress value={item.progress} max={item.target} aria-label={`${item.name}进度`}/>
          <div className="achievement-progress"><span>{item.progress} / {item.target}</span><strong>{item.unlocked ? '已完成' : '未解锁'}</strong></div>
          {item.unlocked ? <p className="tiny" data-unlock-date>{unlockLabel(item)}</p> : <p className="tiny">继续记录，慢慢积累。</p>}
        </article>)}
      </div>}
    </> : null}
  </section>;
}
