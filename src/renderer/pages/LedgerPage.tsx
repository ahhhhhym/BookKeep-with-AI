import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { CategoryView, TransactionFilter, TransactionListResult, TransactionView } from '../../shared/entities';
import { isTransactionDate, todayInShanghai } from '../../shared/date';
import { EmptyState, PageHeader, Spinner } from '../components/ui';
import { Modal } from '../components/Modal';
import { ExpenseEditor, type LeaveGuard } from '../components/ExpenseEditor';
import { ChevronDown } from 'lucide-react';
import { AppIcon } from '../lib/icon-registry';
import { call, errorCodeOf, getBridge } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { dateGroupLabel, EMPTY_FILTER, LedgerReader, MutationAttempt, shiftDate, untilShanghaiMidnight, displayFen } from '../lib/ledger';

export function LedgerPage({ registerGuard, newRequest = 0, onNewRequestHandled, initialFilter }: {
  initialFilter?: TransactionFilter;
  registerGuard: (guard: LeaveGuard) => void; newRequest?: number; onNewRequestHandled: () => void;
}): JSX.Element {
  const [result, setResult] = useState<TransactionListResult | null>(null);
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [filter, setFilter] = useState<TransactionFilter>(initialFilter ?? EMPTY_FILTER);
  const [start, setStart] = useState(initialFilter?.dateStart ?? ''); const [end, setEnd] = useState(initialFilter?.dateEnd ? shiftDate(initialFilter.dateEnd, -1) : '');
  const [query, setQuery] = useState(initialFilter?.nameQuery ?? ''); const [selected, setSelected] = useState<string[]>(initialFilter?.categoryIds ?? []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [exporting,setExporting]=useState(false);
  const [notice, setNotice] = useState<{ text: string; undo?: { id: string; version: number; epoch: string; name: string; mutationId: string } } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [today, setToday] = useState(todayInShanghai);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [epoch, setEpoch] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ original: TransactionView | null; epoch: string } | null>(null);
  const [action, setAction] = useState<{ transaction: TransactionView; restore: boolean; epoch: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false); const [actionError, setActionError] = useState<string | null>(null);
  const actionPending = useRef(false); const actionAttempt = useRef(new MutationAttempt());
  const reader = useRef<LedgerReader | null>(null); const search = useRef<HTMLInputElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const loadSequence = useRef(0); const focusAfterLoad = useRef<string | null>(null);
  if (!reader.current) {
    const api = getBridge();
    if (api) reader.current = new LedgerReader(api, (value, cats, _reset, dataEpoch) => {
      setResult(value); setCategories(cats); setEpoch(dataEpoch);
      setNotice((current) => current?.text === '正在同步最新记录…' ? { text: '列表已同步。' } : current);
    }, () => setNotice({ text: '正在同步最新记录…' }));
  }
  useEffect(() => {
    if (!notice || notice.undo) return undefined;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const load = useCallback(async (append = false): Promise<void> => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(null);
    try { await reader.current?.read(filter, append); }
    catch (failure) {
      if (sequence === loadSequence.current) {
        setError(describeError(failure));
        setNotice((current) => current?.text === '正在同步最新记录…' ? null : current);
      }
    }
    finally {
      if (sequence === loadSequence.current) {
        setLoading(false);
        if (focusAfterLoad.current) {
          const target = focusAfterLoad.current; focusAfterLoad.current = null;
          requestAnimationFrame(() => {
            const neighbor = document.querySelector<HTMLElement>(`[data-transaction-id="${target}"] .expense-name`);
            (neighbor ?? document.querySelector<HTMLElement>('.ledger-summary'))?.focus();
          });
        }
      }
    }
  }, [filter]);
  useEffect(() => { void load(); return () => { reader.current?.cancel(); loadSequence.current++; }; }, [load]);
  useEffect(() => {
    const update = (): void => setOffline(!navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = (): void => {
      setToday(todayInShanghai()); void load();
      clearTimeout(timer); timer = setTimeout(update, untilShanghaiMidnight());
    };
    const visible = (): void => { if (document.visibilityState === 'visible') update(); };
    timer = setTimeout(update, untilShanghaiMidnight());
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', visible); };
  }, [load]);
  useEffect(() => {
    if (newRequest > 0 && epoch) { setEditor({ original: null, epoch }); onNewRequestHandled(); }
  }, [newRequest, onNewRequestHandled, epoch]);
  useEffect(() => {
    if (action) registerGuard(() => undefined);
    else if (!editor) registerGuard(null);
    return () => { if (!editor) registerGuard(null); };
  }, [action, editor, registerGuard]);
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.isComposing || !event.ctrlKey || document.querySelector('dialog[open]')) return;
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); setFiltersOpen(true); requestAnimationFrame(() => search.current?.focus()); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);

  function applyFilters(): void {
    if ((start && !isTransactionDate(start)) || (end && !isTransactionDate(end)) || (start && end && start > end)) {
      setError('请选择有效日期，开始日期不能晚于结束日期。'); return;
    }
    setFilter({ dateStart: start || null, dateEnd: end ? shiftDate(end, 1) : null, nameQuery: query.trim() || null, categoryIds: selected, deleted: filter.deleted });
  }
  function clear(): void {
    setStart(''); setEnd(''); setQuery(''); setSelected([]); setFilter({ ...EMPTY_FILTER, deleted: filter.deleted });
  }
  function beginAction(transaction: TransactionView, restore: boolean): void {
    if (!epoch || actionPending.current) return;
    actionAttempt.current.reset(); setActionError(null); setAction({ transaction, restore, epoch });
  }
  async function submitAction(): Promise<void> {
    if (!action || actionPending.current) return;
    actionPending.current = true; setActionBusy(true); setActionError(null);
    const payload = { id: action.transaction.id, expectedVersion: action.transaction.version };
    const mutationId = actionAttempt.current.forPayload(payload);
    try {
      const mutation = await call((api) => action.restore ? api.transaction.restore(payload, { mutationId, dataEpoch: action.epoch }) : api.transaction.softDelete(payload, { mutationId, dataEpoch: action.epoch }));
      setNotice(action.restore
        ? { text: `已恢复“${action.transaction.name}”。` }
        : { text: `已删除“${action.transaction.name}”。`, undo: { id: mutation.transaction.id, version: mutation.transaction.version, epoch: action.epoch, name: action.transaction.name, mutationId: crypto.randomUUID() } });
      const index = result?.items.findIndex((item) => item.id === action.transaction.id) ?? -1;
      focusAfterLoad.current = result?.items[index + 1]?.id ?? result?.items[index - 1]?.id ?? 'summary';
      setAction(null); await load();
    } catch (failure) {
      setActionError(describeError(failure));
      if (['STALE_EPOCH', 'VERSION_CONFLICT', 'SNAPSHOT_STALE'].includes(errorCodeOf(failure))) {
        setAction(null); setNotice({ text: '账本已更新，请核对最新记录后重新操作。' }); await load();
      }
    } finally { actionPending.current = false; setActionBusy(false); }
  }
  async function undoDelete(target: { id: string; version: number; epoch: string; name: string; mutationId: string }): Promise<void> {
    if (actionPending.current) return;
    actionPending.current = true;
    setUndoBusy(true);
    try {
      await call((api) => api.transaction.restore({ id: target.id, expectedVersion: target.version }, { mutationId: target.mutationId, dataEpoch: target.epoch }));
      setNotice({ text: `已撤销删除，恢复“${target.name}”。` });
      await load();
    } catch (failure) {
      setError(describeError(failure));
      if (['STALE_EPOCH', 'VERSION_CONFLICT', 'SNAPSHOT_STALE'].includes(errorCodeOf(failure))) {
        setNotice(null);
        await load();
      }
    } finally { actionPending.current = false; setUndoBusy(false); }
  }
  const filtered = !!(filter.dateStart || filter.dateEnd || filter.nameQuery || filter.categoryIds.length);
  const hasDraftFilter = !!(start || end || query.trim() || selected.length);
  const deleted = filter.deleted === 'deleted';
  const categoryMap = new Map(categories.map((category) => [category.id, category]));

  const exportFiltered=async()=>{if(!result||filter.deleted!=='active')return;setExporting(true);try{const a=await call(api=>api.maintenance.exportCsv({filter:result.filterEcho,snapshotRevision:result.snapshotRevision}));const r=await call(api=>api.maintenance.save({artifactId:a.artifactId}));setNotice({text:r.saved?`已导出当前筛选 ${a.recordCount} 笔支出。`:'已取消保存。'});}catch(e){setError(describeError(e));}finally{setExporting(false);}};
  return <div className="page ledger-page">
    <PageHeader title="记账" actions={<button ref={newButton} className="button button-primary" title="记一笔（Ctrl+N）" onClick={() => epoch && setEditor({ original: null, epoch })}>记一笔</button>} />
    {offline ? <p role="status" className="notice">当前离线，手工记账与本地查询不受影响。</p> : null}
    <section className="filter-disclosure" aria-label="支出筛选">
    <div className="filter-bar-row">
      <button type="button" className="filter-toggle" title="筛选支出（Ctrl+F）" aria-expanded={filtersOpen} aria-controls="ledger-filter-content" onClick={() => setFiltersOpen(open => !open)}><ChevronDown size={16} aria-hidden="true"/>筛选支出{filtered ? ` · 已应用${Number(!!filter.dateStart || !!filter.dateEnd) + Number(!!filter.nameQuery) + Number(filter.categoryIds.length > 0)}项条件` : ''}</button>
      {filtered ? <button type="button" className="button button-small ledger-filter-clear" onClick={clear}>清除筛选</button> : null}
    </div>
    <div id="ledger-filter-content" className="filter-collapse" data-open={filtersOpen} inert={!filtersOpen} aria-hidden={!filtersOpen}><div className="filter-collapse-inner"><form className="ledger-filters" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
      <label className="field">开始日期（含）<input type="date" min="1900-01-01" max="9998-12-31" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label className="field">结束日期（含）<input type="date" min="1900-01-01" max="9998-12-31" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <label className="field ledger-search">名称搜索<input ref={search} type="search" value={query} placeholder="输入购买物或服务名称" onChange={(event) => setQuery(event.target.value)} /></label>
      <details className="category-filter"><summary>分类筛选{selected.length ? `（已选${selected.length}类）` : '（全部）'}</summary><div className="filter-categories">{categories.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, item.id] : value.filter((id) => id !== item.id))} />{item.name}{item.enabled ? '' : '（已停用）'}</label>)}</div></details>
      <div className="expense-actions"><button className="button button-primary" type="submit">应用筛选</button><button className="button ledger-filter-clear" type="button" disabled={!filtered && !hasDraftFilter} onClick={clear}>清空筛选</button>{!deleted ? <button className="button" type="button" disabled={exporting||loading} onClick={()=>void exportFiltered()}>导出当前筛选CSV</button> : null}</div>
    </form></div></div></section>
    <div className="ledger-summary" tabIndex={-1}><p role="status" aria-live="polite" data-ledger-total={loading || error ? undefined : result?.filteredTotalFen}>{loading ? <span className="status-inline"><Spinner />正在读取本地账本…</span> : error ? '列表尚未读取成功' : result ? `支出明细 ${result.totalCount} 笔 · ¥${displayFen(result.filteredTotalFen)}` : '—'}</p><button className="button" aria-pressed={deleted} disabled={loading} onClick={() => setFilter((value) => ({ ...value, deleted: deleted ? 'active' : 'deleted' }))}>{deleted ? '返回正式支出' : '已删除记录'}</button></div>
    {notice ? <div className="notice notice-toast"><span role="status">{notice.text}</span><div className="notice-toast-actions">{notice.undo ? <button type="button" className="button button-small button-primary" disabled={undoBusy} onClick={() => void undoDelete(notice.undo!)}>{undoBusy ? '正在撤销…' : '撤销'}</button> : null}<button type="button" className="notice-dismiss" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div></div> : null}
    {error ? <div role="alert" className="error-line">{error} <button className="button" onClick={() => void load()}>重新读取</button></div> : null}
    {!loading && !error && result?.items.length === 0 ? <div className={!filtered ? deleted ? 'ledger-empty-deleted' : 'ledger-empty-book' : undefined}>{!filtered ? <p>{deleted ? '暂无已删除记录' : <strong>还没有支出，记下第一笔吧</strong>}</p> : <EmptyState title="没有符合条件的记录。" action={<button type="button" className="button" onClick={clear}>清空筛选</button>} />}</div> : null}
    <div className="ledger-groups" aria-busy={loading}>
      {!error && result?.dateGroups.map((group) => {
        const rows = result.items.filter((item) => item.occurredDate === group.date);
        const closed = collapsed.has(group.date);
        return <section className="date-group" key={group.date} data-date-group={group.date}>
          <h2><button className="date-group-heading" aria-expanded={!closed} aria-controls={`group-${group.date}`} onClick={() => setCollapsed((value) => { const next = new Set(value); if (next.has(group.date)) next.delete(group.date); else next.add(group.date); return next; })}>
            <span className="date-title"><ChevronDown size={18} className="date-chevron" aria-hidden="true" />{dateGroupLabel(group.date, today)}</span><span className="amount">{deleted ? '已删除金额' : filtered ? '筛选小计' : '支出'} ¥{displayFen(group.totalFen)} <small>（{group.count}笔）</small></span>
          </button></h2>
          <div id={`group-${group.date}`} className="group-collapse" data-open={!closed} inert={closed} aria-hidden={closed}><div className="group-collapse-inner"><ul className="expense-list">{rows.map((item) => {
            const category = categoryMap.get(item.categoryId);
            return <li className="expense-row" key={item.id} data-transaction-id={item.id}>
              <span className="category-icon"><AppIcon iconKey={category?.iconKey ?? 'lucide:ellipsis'} size={22} /></span>
              <div className="expense-meta">{deleted || !epoch ? <span className="expense-name" tabIndex={-1}>{item.name}</span> : <button type="button" className="expense-name expense-name-editable" title="点击编辑" onClick={() => setEditor({ original: item, epoch })}>{item.name}</button>}<span className="tiny">{category?.name ?? '分类读取中'}{category && !category.enabled ? '（已停用）' : ''}{item.occurredTime ? ` · ${item.occurredTime}` : ''}</span></div>
              <span className="amount expense-amount">-{displayFen(item.amountFen)}</span>
              <div className="expense-row-actions">{deleted ? <button className="button button-small" onClick={() => beginAction(item, true)} aria-label={`恢复 ${item.name}`}>恢复</button> : <><button className="button button-small" onClick={() => epoch && setEditor({ original: item, epoch })} aria-label={`编辑 ${item.name}`}>编辑</button><button className="button button-small button-danger-ghost" onClick={() => beginAction(item, false)} aria-label={`删除 ${item.name}`}>删除</button></>}</div>
            </li>;
          })}</ul></div></div>
        </section>;
      })}
    </div>
    {result?.nextCursor && !error ? <button className="button" disabled={loading} onClick={() => void load(true)}>{loading ? <><Spinner />正在读取…</> : '加载更多'}</button> : null}
    {editor ? <ExpenseEditor original={editor.original} dataEpoch={editor.epoch} categories={categories} registerGuard={registerGuard} onClose={() => { setEditor(null); void load(); }} onRefresh={load} onSaved={() => { setEditor(null); setNotice({ text: '已保存 1 笔支出。' }); void load(); }} /> : null}
    {action ? <Modal title={action.restore ? `恢复“${action.transaction.name}”？` : `删除“${action.transaction.name}”？`} busy={actionBusy} onClose={() => { if (!actionPending.current) setAction(null); }}>
      <p>{action.restore ? '恢复后将重新计入正式账本与统计。' : '删除后会移入“已删除记录”，可随时撤销或恢复。'}</p>{actionError ? <p role="alert" className="error-line">{actionError} 重试将复用原提交标识。</p> : null}
      <div className="expense-actions"><button className="button" disabled={actionBusy} onClick={() => setAction(null)}>{action.restore ? '取消' : '保留'}</button><button className={`button ${action.restore ? 'button-primary' : 'button-danger'}`} disabled={actionBusy} onClick={() => void submitAction()}>{actionBusy ? <><Spinner />正在处理…</> : actionError ? '重试' : action.restore ? '恢复' : '确认删除'}</button></div>
    </Modal> : null}
  </div>;
}
