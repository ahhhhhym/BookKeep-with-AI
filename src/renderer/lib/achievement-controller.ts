import { useSyncExternalStore } from 'react';
import type { AchievementList } from '../../shared/achievements';
import type { AchievementPreferences } from '../../shared/achievement-presentation';
import { call } from './bridge';
import { describeError } from './messages';
import { noticeCards, VisibleCountdown, NOTICE_MOTION, type NoticeCard, type NoticePhase } from './achievement-notices';
import { todayInShanghai } from '../../shared/date';

interface ActiveCard {
  card: NoticeCard; timer: VisibleCountdown; confirmed: boolean; phase: NoticePhase;
  confirming: boolean; retryAt: number; exitDone: boolean; closed: boolean; closeFailed: boolean; opened: boolean;
}
interface Snapshot {
  data: AchievementList | null; error: string | null; loading: boolean;
  preferences: AchievementPreferences | null; saving: boolean;
  active: NoticeCard | null; remaining: number; visible: boolean; phase: NoticePhase | null; interactive: boolean; noticeError: string | null;
}
type ContentSnapshot = Pick<Snapshot,'data'|'error'|'loading'|'preferences'|'saving'>;

/** One application-wide scheduler. React remounts/subscribers never consume or requeue a notice. */
export class AchievementController {
  private state: Snapshot = {data:null,error:null,loading:true,preferences:null,saving:false,active:null,remaining:5000,visible:false,phase:null,interactive:false,noticeError:null};
  private content: ContentSnapshot = {data:null,error:null,loading:true,preferences:null,saving:false};
  private listeners = new Set<() => void>();
  private version = 0;
  private preferenceVersion = 0;
  private key = '';
  private signature = '';
  private reserved = new Set<string>();
  private queue: NoticeCard[] = [];
  private active: ActiveCard | null = null;
  private eligible = false;
  private foreground = false;
  private hovered = false;
  private focused = false;
  private nativeBlocked = false;
  private foregroundMs = 0;
  private clockSerial = 0;
  private resumeSerial = 0;
  private wasRunning = false;
  private pendingRead = false;
  private pendingPoll = false;
  private reducedMotion = false;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private forceRead = true;
  private poll: ReturnType<typeof setInterval> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  getSnapshot = (): Snapshot => this.state;
  getContentSnapshot = (): ContentSnapshot => this.content;
  private publish(patch: Partial<Snapshot> = {}): void {
    this.state = {...this.state,...patch};
    if (this.content.data !== this.state.data || this.content.error !== this.state.error || this.content.loading !== this.state.loading
      || this.content.preferences !== this.state.preferences || this.content.saving !== this.state.saving) {
      const {data,error,loading,preferences,saving} = this.state;
      this.content = {data,error,loading,preferences,saving};
    }
    for (const listener of this.listeners) listener();
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.poll) {
      void this.refresh();
      this.poll = setInterval(() => void this.refresh(), 500);
      this.tick = setInterval(() => this.advance(), 100);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        if (this.poll) clearInterval(this.poll);
        if (this.tick) clearInterval(this.tick);
        this.poll = this.tick = null;
        this.setEligible(false);
      }
    };
  };
  reset = (): void => {
    this.cancelExit();
    this.version++; this.key = ''; this.signature = ''; this.forceRead = true;
    this.queue = []; this.reserved.clear(); this.active = null; this.foreground = false;
    this.hovered = this.focused = false;
    this.publish({data:null,error:null,loading:true,saving:false,active:null,visible:false,phase:null,interactive:false,noticeError:null});
    void this.refresh();
  };
  retry = (): void => { this.forceRead = true; void this.refresh(); };
  private async refresh(): Promise<void> {
    if (this.pendingPoll) return;
    this.pendingPoll = true;
    const version = this.version;
    const preferenceVersion = this.preferenceVersion;
    try {
      const view = await call(api => api.achievement.presentation());
      if (version !== this.version || preferenceVersion !== this.preferenceVersion) return;
      const key = `${view.ledgerId}/${view.dataEpoch}`;
      if (this.key && this.key !== key) { this.reset(); return; }
      this.key = key;
      if (!view.foreground && this.foreground) this.active?.timer.freeze();
      this.foreground = view.foreground;
      this.foregroundMs = view.foregroundMs;
      this.clockSerial++;
      if (this.state.preferences?.enabled !== view.preferences.enabled || this.state.preferences.position !== view.preferences.position) this.publish({preferences:view.preferences});
      if (!view.preferences.enabled && !this.active?.card.demo) this.clearTasks();
      const signature = `${key}/${view.revision}/${todayInShanghai()}`;
      if ((this.forceRead || signature !== this.signature) && !this.pendingRead) {
        this.pendingRead = true;
        this.forceRead = false;
        try {
          const data = await call(api => api.achievement.watch());
          if (version !== this.version || preferenceVersion !== this.preferenceVersion) return;
          if (`${data.ledgerId}/${data.dataEpoch}` !== key) { this.reset(); return; }
          this.signature = signature;
          this.publish({data,error:null,loading:false});
        } catch (error) {
          if (version === this.version) this.publish({data:null,error:describeError(error),loading:false});
        } finally { this.pendingRead = false; }
      }
    } catch (error) {
      if (version === this.version) { this.foreground = false; this.publish({data:null,error:describeError(error),loading:false}); }
    } finally { this.pendingPoll = false; this.advance(); }
  }
  private clearTasks(): void {
    // Turning notifications off drains business work, but the explicit preview remains available.
    this.queue = this.queue.filter(card => card.demo);
    if (this.active?.card.demo) return;
    this.cancelExit();
    this.active = null; this.hovered = this.focused = false;
    this.publish({active:null,visible:false,phase:null,interactive:false,noticeError:null});
  }
  setReducedMotion = (value: boolean): void => { this.reducedMotion = value; };
  private cancelExit(): void { if (this.exitTimer) clearTimeout(this.exitTimer); this.exitTimer = null; }
  private newActive(card: NoticeCard): ActiveCard {
    return {card,timer:new VisibleCountdown(),confirmed:false,phase:'entering',confirming:false,retryAt:0,exitDone:false,closed:false,closeFailed:false,opened:false};
  }
  setEligible = (value: boolean): void => {
    if (!value && this.eligible) this.active?.timer.freeze();
    this.eligible = value;
    if (!value) this.hovered = this.focused = false;
    this.advance();
  };
  pause = (kind: 'hover' | 'focus', value: boolean): void => {
    if (kind === 'hover') this.hovered = value; else this.focused = value;
    this.advance();
  };
  nativeDialog = (blocked: boolean): void => { this.nativeBlocked = blocked; this.advance(); };
  private canShow(): boolean {
    return this.eligible && this.foreground && !this.nativeBlocked && !this.state.saving && !!this.state.preferences && (this.state.preferences.enabled || !!this.active?.card.demo || (!this.active && !!this.queue[0]?.demo));
  }
  private advance(): void {
    // Form a batch only when it can actually be displayed, so deferred items stay durable and coalesce.
    if (!this.active && !this.queue.length && this.canShow() && this.state.data) {
      const cards = noticeCards(this.state.data,this.reserved);
      for (const card of cards) for (const id of card.noticeIds) this.reserved.add(id);
      this.queue.push(...cards);
    }
    if (!this.active && this.canShow() && this.queue.length) {
      this.active = this.newActive(this.queue.shift()!);
      this.hovered = this.focused = false;
    }
    const active = this.active;
    const visible = !!active && this.canShow();
    if (active) {
      const running = visible && active.confirmed && active.phase === 'visible' && !active.closeFailed && !this.hovered && !this.focused;
      if (running && !this.wasRunning) {
        // Resume from a fresh native clock sample; never charge time spent paused between two polls.
        this.resumeSerial = this.clockSerial + 1;
        active.timer.advance(this.foregroundMs,false);
        void this.refresh();
      }
      this.wasRunning = running;
      if (active.timer.advance(this.foregroundMs, running && this.clockSerial >= this.resumeSerial) && running) { this.dismiss(); return; }
      this.publish({active:active.card,visible,phase:active.phase,interactive:visible && active.phase === 'visible' && active.confirmed,remaining:active.timer.remaining});
    } else {
      this.wasRunning = false;
      if (this.state.active || this.state.visible) this.publish({active:null,visible:false,phase:null,interactive:false});
    }
  }
  /** Renderer confirms completed entry, actual opacity, viewport geometry and eligibility. */
  visible = async (key: string): Promise<void> => {
    const active = this.active;
    if (!active || active.card.key !== key || !this.canShow() || active.phase === 'exiting' || active.confirmed || active.confirming || performance.now() < active.retryAt) return;
    active.phase = 'visible';
    if (active.card.demo) { active.confirmed = true; this.advance(); return; }
    const version = this.version, epoch = active.card.dataEpoch;
    if (!epoch) return;
    active.confirming = true;
    try {
      const ok = await call(api => api.achievement.present({noticeIds:active.card.noticeIds},{dataEpoch:epoch}));
      if (version !== this.version || this.active !== active) return;
      if (ok) { active.confirmed = true; this.publish({noticeError:null}); }
      else { this.active = null; this.forceRead = true; for (const id of active.card.noticeIds) this.reserved.delete(id); }
    } catch {
      if (version === this.version && this.active === active) {
        active.retryAt = performance.now() + 1000;
        this.publish({noticeError:'提示状态保存失败，正在重试。成就已解锁。'});
      }
    } finally { active.confirming = false; this.advance(); }
  };
  /** Accept one business action; the same card remains until both exit and durable close finish. */
  dismiss = (onOpen?: () => void): boolean => {
    const active = this.active;
    if (!active || active.phase !== 'visible' || !active.confirmed || !this.canShow()) return false;
    active.phase = 'exiting';active.closeFailed = false;active.timer.freeze();this.wasRunning = false;
    this.publish({phase:'exiting',interactive:false,noticeError:null});
    // This clock deliberately continues during blur/occlusion and never depends on animationend.
    this.exitTimer = setTimeout(() => { this.exitTimer = null; active.exitDone = true; this.finishExit(active); },this.reducedMotion ? NOTICE_MOTION.reduced : NOTICE_MOTION.exit);
    if (active.card.demo) { active.closed = true; } else void this.closeDurably(active);
    if (onOpen && !active.opened) { active.opened = true; onOpen(); }
    return true;
  };
  private finishExit(active: ActiveCard): void {
    if (this.active !== active || !active.exitDone) return;
    if (active.closed) {
      this.active = null;this.hovered = this.focused = false;
      this.publish({active:null,visible:false,phase:null,interactive:false,noticeError:null});this.advance();
    } else if (active.closeFailed) {
      active.phase = 'visible';active.exitDone = false;this.advance();
    }
  }
  private async closeDurably(active: ActiveCard): Promise<void> {
    // A close after visible rendering also needs durable consumption; queued unseen items stay pending.
    const epoch = active.card.dataEpoch;
    if (!epoch) return;
    const version = this.version;
    try {
      await Promise.all(active.card.noticeIds.map(noticeId => call(api => api.achievement.consume({noticeId,state:'closed'},{dataEpoch:epoch}))));
      if (version !== this.version || this.active !== active) return;
      active.closed = true;
    } catch {
      if (version === this.version && this.active === active) {
        active.closeFailed = true;this.publish({noticeError:'关闭状态保存失败，请重试关闭。成就不会重复解锁。'});
      }
    } finally {
      this.finishExit(active);
    }
  }
  applyPreferences = async (value: AchievementPreferences): Promise<void> => {
    const version = this.version;
    const preferenceVersion = ++this.preferenceVersion;
    this.publish({saving:true}); this.advance();
    try {
      const preferences = await call(api => api.achievement.applyPreferences(value));
      if (version !== this.version || preferenceVersion !== this.preferenceVersion) return;
      this.publish({preferences});
      if (!preferences.enabled) this.clearTasks();
      this.forceRead = true;
    } finally { if (version === this.version && preferenceVersion === this.preferenceVersion) { this.publish({saving:false}); void this.refresh(); } }
  };
  preview = (): void => {
    // A separate demo never enters the durable notification queue or calls business APIs.
    const card: NoticeCard = {key:`demo-${performance.now()}`,noticeIds:[],title:'成就提示预览',detail:'这是一张演示卡片，不会解锁或记录成就。',demo:true,dataEpoch:null};
    this.queue = [...this.queue.filter(c => !c.demo),card];this.advance();
  };
}
export const achievementController = new AchievementController();
export function useAchievements(): Snapshot {
  return useSyncExternalStore(achievementController.subscribe, achievementController.getSnapshot);
}
/** Page/settings subscribers do not rerender on every countdown tick. */
export function useAchievementContent(): ContentSnapshot {
  return useSyncExternalStore(achievementController.subscribe, achievementController.getContentSnapshot);
}
