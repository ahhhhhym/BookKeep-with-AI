import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { TransactionFilter } from '../../shared/entities';
import { isTransactionDate, todayInShanghai } from '../../shared/date';
import { calendarShift, periodRange, type StatisticsInput, type StatisticsPeriod, type TopTransactionsResult, type TopCategoriesResult } from '../../shared/statistics';
import { PageHeader, Panel } from '../components/ui';
import { StatisticsChart } from '../components/StatisticsChart';
import { getBridge, errorCodeOf } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { displayFen, untilShanghaiMidnight } from '../lib/ledger';
import { readStatistics, sameStatisticsScope, snapshotChanged, unwrapStatistics, type StatisticsBundle } from '../lib/statistics';
import { AppIcon } from '../lib/icon-registry';

const LABEL = { week: '周', month: '月', year: '年' };
interface PointDetail { scopeId: string; key: string; total: string; items: { id: string; name: string; amount: string }[] }
export function StatisticsPage({ input, onInput, onDetails }: {
  input: StatisticsInput; onInput: (value: StatisticsInput) => void; onDetails: (filter: TransactionFilter) => void;
}): JSX.Element {
  const [today, setToday] = useState(todayInShanghai);
  const [anchor, setAnchor] = useState(input.anchorDate);
  const [bundle, setBundle] = useState<StatisticsBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<PointDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0); const loadId = useRef(0); const detailId = useRef(0);
  const reload = useCallback(() => { setToday(todayInShanghai()); setRefresh((value) => value + 1); }, []);
  useEffect(() => { setAnchor(input.anchorDate); }, [input.anchorDate]);
  useEffect(() => {
    const id = ++loadId.current; detailId.current++; setBundle(null); setError(null); setSelected(null); setDetail(null);
    const api = getBridge();
    if (api) void readStatistics(api, input).then((value) => { if (id === loadId.current) { setBundle(value); setToday(value.series.scope.today); } }).catch((failure) => { if (id === loadId.current) setError(describeError(failure)); });
    return () => { loadId.current++; detailId.current++; };
  }, [input, refresh]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = (): void => { reload(); clearTimeout(timer); timer = setTimeout(update, untilShanghaiMidnight()); };
    const visible = (): void => { if (document.visibilityState === 'visible') update(); };
    timer = setTimeout(update, untilShanghaiMidnight()); window.addEventListener('focus', update); document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);
  useEffect(() => {
    const id = ++detailId.current; setDetail(null); setDetailError(null);
    if (!bundle || selected === null) return;
    const point = bundle.series.points[selected]; const api = getBridge();
    if (!point || point.isFuture || !api) return;
    const bound = { ...input, snapshotRevision: bundle.series.scope.revision };
    void (async () => {
      try {
        const reply = input.period === 'year' ? await api.statistics.topCategories({ ...bound, pointMonth: point.pointKey }) : await api.statistics.topTransactions({ ...bound, pointDate: point.pointKey });
        const value = unwrapStatistics<TopTransactionsResult | TopCategoriesResult>(reply);
        if (id !== detailId.current) return;
        if (!sameStatisticsScope(bundle.series.scope, value, reply.dataEpoch)) throw snapshotChanged();
        const total = 'pointTotalFen' in value ? value.pointTotalFen : value.totalFen;
        if (total !== point.amountFen) throw snapshotChanged();
        setDetail({ scopeId: value.scope.scopeId, key: point.pointKey, total, items: 'pointTotalFen' in value ? value.items.map((item) => ({ id: item.transactionId, name: item.name, amount: item.amountFen })) : value.items.map((item) => ({ id: item.categoryId, name: item.name, amount: item.totalFen })) });
      } catch (failure) {
        if (id !== detailId.current) return;
        if (['STALE_EPOCH', 'SNAPSHOT_STALE'].includes(errorCodeOf(failure))) reload(); else setDetailError(describeError(failure));
      }
    })();
  }, [bundle, selected, input, reload]);
  const scope = bundle?.series.scope;
  const point = selected === null ? null : bundle?.series.points[selected];
  let range: { start: string; end: string } | null = null;
  try { range = periodRange(input.period, input.anchorDate); } catch { /* 服务端显示具体范围错误。 */ }
  const chooseAnchor = (date: string): void => {
    if (!isTransactionDate(date) || date > today) { setError('请选择不晚于上海今天的有效日期。'); return; }
    try { periodRange(input.period, date); } catch { setError('该周期超出支持日期范围，请选择其他周期。'); return; }
    onInput({ ...input, anchorDate: date, snapshotRevision: null });
  };
  const close = (): void => { detailId.current++; setSelected(null); setDetail(null); };
  const detailReady = detail?.scopeId === scope?.scopeId && detail?.key === point?.pointKey;
  return <div className="page statistics-page">
    <PageHeader title="统计" subtitle={`默认账本 · 人民币 · 上海今天 ${today}`} actions={<div className="segmented" role="group" aria-label="统计周期">{(['week', 'month', 'year'] as StatisticsPeriod[]).map((period) => <button key={period} aria-pressed={input.period === period} onClick={() => onInput({ ...input, period })}>{LABEL[period]}</button>)}</div>} />
    <form className="statistics-controls" onSubmit={(event) => { event.preventDefault(); chooseAnchor(anchor); }}>
      <button type="button" className="button" disabled={!range || range.start <= '1900-01-01'} onClick={() => range && chooseAnchor(calendarShift(range.start, -1))}>上一{LABEL[input.period]}</button>
      <label className="field">选择周期日期<input type="date" min="1900-01-01" max={today} value={anchor} onChange={(event) => setAnchor(event.target.value)} /></label>
      <button className="button" type="submit">选择周期</button>
      <button type="button" className="button" disabled={!range || range.end > today} title={range && range.end > today ? '已到当前周期' : undefined} onClick={() => range && chooseAnchor(range.end)}>下一{LABEL[input.period]}</button>
      <button className="button" type="button" onClick={() => chooseAnchor(today)}>回到当前</button>
      <button className="button" type="button" onClick={reload}>刷新统计</button>
    </form>
    <p className="statistics-range">{range ? `${range.start} 至 ${calendarShift(range.end, -1)}` : '请选择有效周期'}{scope ? ` · 统计截至 ${calendarShift(scope.effectiveEnd, -1)}` : ''}</p>
    <details className="category-filter"><summary>统计分类筛选（{input.categoryIds.length ? `已选${input.categoryIds.length}类` : '全部'}）</summary><div className="filter-categories">{bundle?.categories.map((category) => <label key={category.id}><input type="checkbox" checked={input.categoryIds.includes(category.id)} onChange={(event) => onInput({ ...input, categoryIds: event.target.checked ? [...input.categoryIds, category.id] : input.categoryIds.filter((id) => id !== category.id) })} />{category.name}{category.enabled ? '' : '（已停用）'}</label>)}</div><button className="button" onClick={() => onInput({ ...input, categoryIds: [] })}>统计全部分类</button></details>
    <p className="tiny muted">仅按周期和所选分类统计正式未删除支出。统计来自本地账本，离线可查看。</p>
    {error ? <p role="alert" className="error-line">统计暂未读取成功：{error} <button className="button" onClick={reload}>重试</button></p> : !bundle ? <p role="status">正在计算本周期统计…</p> : <>
      <div className="metric-row" data-statistics-total={bundle.summary.totalFen}>
        <div className="metric"><div className="metric-label">总支出</div><div className="metric-value">¥{displayFen(bundle.summary.totalFen)}</div><div className="metric-note">{bundle.summary.count} 笔正式支出</div></div>
        <div className="metric"><div className="metric-label">日均支出</div><div className="metric-value" data-daily-average>{`¥${bundle.summary.dailyAverage.displayYuan}`}</div><div className="metric-note">分母 {bundle.summary.dailyAverage.denominatorDays} 个自然日（含无消费日）</div></div>
      </div>
      <Panel title={`${LABEL[input.period]}支出趋势`}>
        <StatisticsChart points={bundle.series.points} selected={selected} onSelect={setSelected} onClose={close}>
          {point ? <><h3>{input.period === 'year' ? `${point.pointKey.slice(0, 4)}年${Number(point.pointKey.slice(5))}月` : point.pointKey}</h3>
            {point.isFuture ? <p>尚未到来</p> : <>
              <p className="point-total">{input.period === 'year' ? '当月总支出' : '当日总支出'} <strong>¥{displayFen(point.amountFen)}</strong></p>
              <h4>{input.period === 'year' ? '前三消费分类' : '最大3笔交易'}</h4>
              {detailError ? <p role="alert">{detailError}</p> : !detailReady ? <p role="status">正在读取点详情…</p> : detail!.items.length ? <ol className="top-items">{detail!.items.map((item) => <li key={item.id}><span>{item.name}</span><strong>¥{displayFen(item.amount)}</strong></li>)}</ol> : <p>暂无支出</p>}
              <p className="tiny muted">仅列前三项，总额含全部支出。</p>
              <button className="button" onClick={() => onDetails({ dateStart: point.start, dateEnd: point.end < scope!.effectiveEnd ? point.end : scope!.effectiveEnd, categoryIds: input.categoryIds, nameQuery: null, deleted: 'active' })}>查看明细</button>
            </>}
          </> : null}
        </StatisticsChart>
        <details className="statistics-table"><summary>查看同值数据表（{bundle.series.points.length}个点）</summary><table><thead><tr><th>日期 / 月份</th><th>总支出</th><th>状态 / 详情</th></tr></thead><tbody>{bundle.series.points.map((value, index) => <tr key={value.pointKey}><td>{value.pointKey}</td><td>¥{displayFen(value.amountFen)}</td><td><button className="button" onClick={() => setSelected(index)}>{value.isFuture ? '尚未到来' : '查看点详情'}</button></td></tr>)}</tbody></table></details>
      </Panel>
      <Panel title="分类排行榜">{bundle.ranking.items.length ? <ol className="category-ranking">{bundle.ranking.items.map((item) => <li key={item.categoryId} data-category-id={item.categoryId}><AppIcon iconKey={item.iconKey} /><span>{item.name}</span><strong>¥{displayFen(item.totalFen)}</strong><span>{item.ratioPercent}%</span><progress max="100" value={Number(item.ratioPercent)} aria-label={`${item.name}占比${item.ratioPercent}%`} /></li>)}</ol> : <p>暂无支出</p>}</Panel>
    </>}
  </div>;
}
