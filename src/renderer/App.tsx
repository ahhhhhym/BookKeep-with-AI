import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { NavShell } from './components/NavShell';
import { StatusBar } from './components/StatusBar';
import { NAV_ITEMS } from './navigation';
import { CategoriesPage } from './pages/CategoriesPage';
import { DataPage } from './pages/DataPage';
import { ImportPage } from './pages/ImportPage';
import { LedgerPage } from './pages/LedgerPage';
import { QueuePage } from './pages/QueuePage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatisticsPage } from './pages/StatisticsPage';
import { bridgeAvailable, call } from './lib/bridge';
import { BRIDGE_UNAVAILABLE_TEXT, describeError } from './lib/messages';
import type { NavId } from '../shared/nav';
import type { AiSettingsView, ProviderCapabilitiesView, SecretStatusView } from '../shared/dto';
import type { LeaveGuard } from './components/ExpenseEditor';
import type { StatisticsInput } from '../shared/statistics';
import type { TransactionFilter } from '../shared/entities';
import { todayInShanghai } from '../shared/date';

export function App(): JSX.Element {
  const [statisticsInput, setStatisticsInput] = useState<StatisticsInput>(() => ({ period: 'month', anchorDate: todayInShanghai(), categoryIds: [], snapshotRevision: null }));
  const [detailFilter, setDetailFilter] = useState<TransactionFilter | undefined>();
  const [navId, setNavId] = useState<NavId>('ledger');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ai, setAi] = useState<AiSettingsView | null>(null);
  const [secret, setSecret] = useState<SecretStatusView | null>(null);
  const [capabilities, setCapabilities] = useState<ProviderCapabilitiesView[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [bridgeMissing] = useState(() => !bridgeAvailable());
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const leaveGuard = useRef<LeaveGuard>(null);
  const [newRequest, setNewRequest] = useState(0);
  const consumeNewRequest = useCallback(() => setNewRequest(0), []);
  const registerGuard = useCallback((guard: LeaveGuard): void => { leaveGuard.current = guard; }, []);
  const resetRestoredViews = useCallback(() => {
    setDetailFilter(undefined);
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

  const navigate = useCallback((id: NavId) => {
    const leave = (): void => { setNavId(id); setDrawerOpen(false); };
    if (leaveGuard.current) leaveGuard.current(leave);
    else leave();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.isComposing || !event.ctrlKey || event.key.toLowerCase() !== 'n') return;
      if (document.querySelector('dialog[open]') || (event.target instanceof HTMLInputElement && event.target.type === 'password')) return;
      event.preventDefault();
      navigate('ledger'); setNewRequest((value) => value + 1);
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

  const current = NAV_ITEMS.find((item) => item.id === navId) ?? NAV_ITEMS[0];

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
        <strong>{current?.label}</strong>
        <span className="tiny">BookKeepAI</span>
      </header>

      <NavShell current={navId} onNavigate={navigate} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <main id="main-content" className="main" tabIndex={-1}>
        {navId === 'ledger' ? <LedgerPage initialFilter={detailFilter} onManageCategories={() => navigate('categories')} registerGuard={registerGuard} newRequest={newRequest} onNewRequestHandled={consumeNewRequest} /> : null}
        {navId === 'statistics' ? <StatisticsPage input={statisticsInput} onInput={setStatisticsInput} onDetails={(filter) => { setDetailFilter(filter); navigate('ledger'); }} /> : null}
        {navId === 'import' ? <ImportPage onError={setLastError} /> : null}
        {navId === 'queue' ? <QueuePage /> : null}
        {navId === 'review' ? <ReviewPage registerGuard={registerGuard} /> : null}
        {navId === 'categories' ? <CategoriesPage /> : null}
        {navId === 'data' ? <DataPage onDataRestored={resetRestoredViews} /> : null}
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
      </main>

      <StatusBar ai={ai} secret={secret} lastError={lastError} />
    </div>
  );
}
