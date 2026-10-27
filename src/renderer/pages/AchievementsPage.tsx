import { useState, type JSX } from 'react';
import { achievementController, useAchievementContent } from '../lib/achievement-controller';
import { AppIcon } from '../lib/icon-registry';
import type { AchievementView } from '../../shared/achievements';

function unlockLabel(item: AchievementView): string {
  if (item.origin === 'history' || !item.unlockedAt) return '历史补领';
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(item.unlockedAt)) + '（北京时间）';
}
export function AchievementsPage(): JSX.Element {
  const {data,error,loading} = useAchievementContent();
  const [filter,setFilter] = useState<'all'|'unlocked'|'locked'>('all');
  const items = data?.items.filter(item => filter === 'all' || (filter === 'unlocked' ? item.unlocked : !item.unlocked)) ?? [];
  return <section className="page achievements-page" aria-labelledby="achievements-heading" data-achievements-stage="complete">
    <div className="page-header"><h1 id="achievements-heading">成就</h1><p className="muted">每一次认真记录，都值得留念。</p></div>
    {loading ? <p role="status">正在读取成就…</p> : error ? <div className="notice" data-tone="danger" role="alert"><p>成就读取失败：{error}</p><button type="button" className="button" onClick={achievementController.retry}>重新读取成就</button></div> : data ? <>
      <div className="achievement-summary" aria-label="成就概况">
        <div><strong>已解锁 {data.items.filter(i=>i.unlocked).length} / {data.items.length}</strong><span>成就</span></div>
        <div><strong>{data.progress.currentStreak} 天</strong><span>当前连续记账</span></div>
        <div><strong>{data.progress.longestStreak} 天</strong><span>历史最长连续</span></div>
      </div>
      <div className="segmented achievement-filters" role="group" aria-label="成就筛选">
        {([['all','全部'],['unlocked','已解锁'],['locked','未解锁']] as const).map(([id,label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      {!items.length ? <p className="notice" role="status">没有符合筛选的成就。</p> : <div className="achievement-grid">
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
