import type { AchievementList, AchievementNotice } from '../../shared/achievements';

/** Shared visual deadline contract; controller owns the lifecycle, CSS only presents it. */
export type NoticePhase = 'entering' | 'visible' | 'exiting';
export const NOTICE_MOTION = {enter:260,exit:180,reduced:120} as const;

export interface NoticeCard {
  readonly key: string; readonly noticeIds: readonly string[]; readonly title: string;
  readonly detail: string; readonly demo: boolean; readonly dataEpoch: string | null;
}
/** Presentation only. Thresholds and unlock decisions always come from the main process. */
export function noticeCards(list: AchievementList, reserved: ReadonlySet<string>): NoticeCard[] {
  const pending = list.notices.filter(n => n.status === 'pending' && n.achievementIds.length && !reserved.has(n.id));
  const make = (notices: readonly AchievementNotice[], history = false): NoticeCard => {
    const ids = new Set(notices.flatMap(n => n.achievementIds));
    const names = list.items.filter(i => ids.has(i.id)).map(i => i.name);
    return {key:notices.map(n => n.id).join(':'), noticeIds:notices.map(n => n.id), demo:false,dataEpoch:list.dataEpoch,
      title:history ? `已补领 ${ids.size} 项成就` : ids.size > 1 ? `解锁 ${ids.size} 项成就` : `成就解锁：${names[0] ?? '新的成就'}`,
      detail:names.join('、') + ' · 查看成就'};
  };
  const live = pending.filter(n => n.kind === 'unlock');
  return [...pending.filter(n => n.kind === 'history_summary').map(n => make([n],true)),
    ...(live.length > 3 ? [make(live)] : live.map(n => make([n])))];
}

/** Effective time is independent of background waiting and wall-clock changes. */
export class VisibleCountdown {
  remaining = 5000;
  private last: number | null = null;
  /** Discard an unobserved interval at a native/visibility fence. */
  freeze(): void { this.last = null; }
  advance(now: number, running: boolean): boolean {
    if (this.last !== null) this.remaining = Math.max(0, this.remaining - Math.max(0, now - this.last));
    this.last = running ? now : null;
    return this.remaining === 0;
  }
}
