import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { NavShell } from './components/NavShell';
import { AchievementNotice } from './components/AchievementNotice';
import { achievementController } from './lib/achievement-controller';
import { AchievementsPage } from './pages/AchievementsPage';
import { DataPage } from './pages/DataPage';
import { ImportPage } from './pages/ImportPage';
import { LedgerPage } from './pages/LedgerPage';
import { QueuePage } from './pages/QueuePage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatisticsPage } from './pages/StatisticsPage';
import { bridgeAvailable, call } from './lib/bridge';
import { BRIDGE_UNAVAILABLE_TEXT, describeError } from './lib/messages';
import { primaryNavId, type AiPageId, type NavId } from '../shared/nav';
import type { AiSettingsView, ProviderCapabilitiesView, SecretStatusView } from '../shared/dto';
import type { LeaveGuard } from './components/ExpenseEditor';
import type { StatisticsInput } from '../shared/statistics';
import type { TransactionFilter } from '../shared/entities';
import { todayInShanghai } from '../shared/date';
import { SlidingSegments } from './components/SlidingSegments';
import { useMainTransition } from './lib/use-main-transition';

const AI_SEGMENTS = ([['import', '图片导入'], ['queue', '任务队列'], ['review', '候选审核']] as const).map(([value, label]) => ({ value, label, controls: `ai-${value}` }));

export function App(): JSX.Element {
  const [statisticsInput, setStatisticsInput] = useState<StatisticsInput>(() => ({ period: 'month', anchorDate: todayInShanghai(), categoryIds: [], snapshotRevision: null }));
  const [detailFilter, setDetailFilter] = useState<TransactionFilter | undefined>();
  const [targetNav, setTargetNav] = useState<NavId>('ledger');
  const { shown: navId, phase, ref: transitionRef } = useMainTransition(targetNav);
  const [subMotion, setSubMotion] = useState(false);
  const navigationTarget = useRef<NavId>('ledger');
  const [aiPage, setAiPage] = useState<AiPageId>('import');
  const [importVisited, setImportVisited] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ai, setAi] = useState<AiSettingsView | null>(null);
  const [secret, setSecret] = useState<SecretStatusView | null>(null);
  const [capabilities, setCapabilities] = useState<ProviderCapabilitiesView[]>([]);
  const [, setLastError] = useState<string | null>(null);
  const [bridgeMissing] = useState(() => !bridgeAvailable());
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const leaveGuard = useRef<LeaveGuard>(null);
  const [newRequest, setNewRequest] = useState(0);
  const consumeNewRequest = useCallback(() => setNewRequest(0), []);
  const registerGuard = useCallback((guard: LeaveGuard): void => { leaveGuard.current = guard; }, []);
  const resetRestoredViews = useCallback(() => {
    achievementController.reset();
    setDetailFilter(undefined);
    setImportVisited(false);
    setAiPage('import');
    setStatisticsInput(value => ({ ...value, snapshotRevision: null }));
  }, []);

  useEffect(() => {
    if (bridgeMissing) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [aiView, status] = await Promise.all([
          call((api) => api.settings.readAi()),
          call((api) => api.settings.readStatus()),
        ]);
        if (cancelled) return;
        setAi(aiView);
        setSecret(status);
        const caps = await Promise.all([
          call((api) => api.provider.capabilities({ providerId: 'deepseek' })),
          call((api) => api.provider.capabilities({ providerId: 'mock' })),
        ]);
        if (!cancelled) setCapabilities(caps);
      } catch (error) {
        if (!cancelled) setLastError(describeError(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridgeMissing]);

  const navigate = useCallback((id: NavId, onAccepted?: () => void) => {
    const target = id === 'ai' ? aiPage : id;
    if (target === navigationTarget.current) { setDrawerOpen(false); onAccepted?.(); return; }
    const leave = (): void => {
      setSubMotion(primaryNavId(navigationTarget.current) === 'ai' && primaryNavId(target) === 'ai');
      navigationTarget.current = target;
      setTargetNav(target); setDrawerOpen(false);
      if (target === 'import' || target === 'queue' || target === 'review') {
        setAiPage(target);
        if (target === 'import') setImportVisited(true);
      }
      onAccepted?.();
    };
    // Once the displayed page has approved departure it is inert; a rapid retarget
    // must not ask that same abandoned draft again before it unmounts.
    if (leaveGuard.current && navigationTarget.current === navId) leaveGuard.current(leave);
    else leave();
  }, [aiPage, navId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.isComposing || !event.ctrlKey || event.key.toLowerCase() !== 'n') return;
      if (document.querySelector('dialog[open]') || (event.target instanceof HTMLInputElement && event.target.type === 'password')) return;
      event.preventDefault();
      navigate('ledger', () => setNewRequest((value) => value + 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const firstItem = document.querySelector<HTMLButtonElement>('#main-nav .nav-item');
    firstItem?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setDrawerOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  if (bridgeMissing) {
    return (
      <div className="boundary">
        <div className="boundary-card" data-app-shell="ready" role="alert">
          <h1>界面通道未加载</h1>
          <p className="muted">{BRIDGE_UNAVAILABLE_TEXT}</p>
          <p className="tiny">
            本应用要求通过受限 preload 访问主进程；直接打开 HTML 文件或禁用 preload 均会看到此提示。
          </p>
        </div>
      </div>
    );
  }

  const primaryId = primaryNavId(navId);

  return (
    <div className="app" data-app-shell="ready" data-nav={navId}>
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>

      <header className="topbar">
        <button
          ref={menuButtonRef}
          type="button"
          className="nav-toggle"
          aria-expanded={drawerOpen}
          aria-controls="main-nav"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          菜单
        </button>
        <span className="window-brand"><span className="nav-brand-mark" aria-hidden="true">¥</span>BookKeepAI</span>
      </header>

      <NavShell current={primaryNavId(targetNav)} onNavigate={navigate} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <main id="main-content" className="main" tabIndex={-1}>
        <div ref={transitionRef} className="main-content-transition" data-main-transition data-phase={phase} inert={phase === 'leaving'}>
        {navId === 'ledger' ? <LedgerPage initialFilter={detailFilter} registerGuard={registerGuard} newRequest={newRequest} onNewRequestHandled={consumeNewRequest} /> : null}
        {navId === 'statistics' ? <StatisticsPage input={statisticsInput} onInput={setStatisticsInput} onDetails={(filter) => { setDetailFilter(filter); navigate('ledger'); }} /> : null}
        <div className="page ai-page" hidden={primaryId !== 'ai'}>
          <SlidingSegments className="ai-switcher" value={aiPage} items={AI_SEGMENTS} label="AI记账子页" onChange={navigate} />
          <section id="ai-import" className={subMotion ? 'ai-sub-fade' : undefined} hidden={navId !== 'import'} aria-label="图片导入">{importVisited ? <ImportPage onError={setLastError} /> : null}</section>
          <section id="ai-queue" className={subMotion ? 'ai-sub-fade' : undefined} hidden={navId !== 'queue'} aria-label="任务队列">{navId === 'queue' ? <QueuePage /> : null}</section>
          <section id="ai-review" className={subMotion ? 'ai-sub-fade' : undefined} hidden={navId !== 'review'} aria-label="候选审核">{navId === 'review' ? <ReviewPage registerGuard={registerGuard} /> : null}</section>
        </div>
        {navId === 'data' ? <DataPage onDataRestored={resetRestoredViews} /> : null}
        {navId === 'achievements' ? <AchievementsPage /> : null}
        {navId === 'settings' ? (
          <SettingsPage
            ai={ai}
            secret={secret}
            capabilities={capabilities}
            onNavigate={navigate}
            onError={setLastError}
            onAiChange={setAi}
            onSecretChange={setSecret}
          />
        ) : null}
        </div>
      </main>
      <AchievementNotice onOpen={() => navigate('achievements')} />
    </div>
  );
}
