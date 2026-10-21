import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import type { StatisticsPoint } from '../../shared/statistics';
import { displayFen } from '../lib/ledger';

/** SVG仅负责坐标，金额/序列/排序均来自服务。详情在正常流内，不遮挡周期操作。 */
export function StatisticsChart({ points, onSelect, selected, onClose, children }: {
  points: StatisticsPoint[]; onSelect: (index: number) => void; selected: number | null;
  onClose: () => void; children: ReactNode;
}): JSX.Element {
  const [active, setActive] = useState(0); const [pinned, setPinned] = useState(false);
  const chart = useRef<HTMLDivElement>(null);
  const keyboardMode = useRef(false);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    if (!chart.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(160, entry.contentRect.width)); });
    observer.observe(chart.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { setActive(0); setPinned(false); }, [points]);
  useEffect(() => { if (selected !== null) setActive(selected); }, [selected]);
  const maximum = points.reduce((max, point) => BigInt(point.amountFen) > max ? BigInt(point.amountFen) : max, 0n);
  const max = Math.max(1, Number(maximum));
  const plotWidth = width - 64;
  const labelStep = Math.ceil((points.length - 1) / Math.max(1, Math.floor(width / 65) - 1));
  const coords = points.map((point, index) => ({ x: 32 + index * plotWidth / (points.length - 1), y: 215 - Number(point.amountFen) / max * 170 }));
  const choose = (index: number, pin = false): void => { setActive(index); setPinned(pin); onSelect(index); };
  const close = (): void => { setPinned(false); onClose(); };
  return <div className="statistics-chart-area" onMouseLeave={(event) => { if (!pinned && !event.currentTarget.contains(document.activeElement)) onClose(); }}
    onBlur={(event) => { if (!pinned && !event.currentTarget.contains(event.relatedTarget as Node)) onClose(); }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); chart.current?.focus({ preventScroll: true }); onClose(); } }}>
    <div ref={chart} className="statistics-chart" tabIndex={0} role="group" aria-roledescription="交互折线图"
      aria-label={`支出趋势，共${points.length}个点。左右键选择，Home或End到首尾，回车或空格固定，Esc关闭。`}
      onFocus={() => { if (selected === null) onSelect(active); }}
      onBlur={(event) => { if (!pinned && !event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) onClose(); }}
      onKeyDown={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          keyboardMode.current = true;
          event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, active + (event.key === 'ArrowLeft' ? -1 : 1))); choose(next, pinned);
        } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (pinned) close(); else choose(active, true); }
      }}>
      <svg viewBox={`0 0 ${width} 260`} aria-hidden="true">
        {[45, 130, 215].map((y) => <line key={y} x1="32" x2={width - 32} y1={y} y2={y} className="chart-grid" />)}
        <text x="32" y="25" className="chart-label">¥{displayFen(maximum.toString())}</text>
        <polyline points={coords.filter((_, i) => !points[i]?.isFuture).map(({ x, y }) => `${x},${y}`).join(' ')} className="chart-line" />
        {points.some((point) => point.isFuture) ? <polyline points={coords.filter((_, i) => points[i]?.isFuture || points[i + 1]?.isFuture).map(({ x, y }) => `${x},${y}`).join(' ')} className="chart-line chart-future-line" /> : null}
        {points.map((point, index) => { const coordinate = coords[index]!; return <g key={point.pointKey} data-point-key={point.pointKey}
          onMouseEnter={() => { if (!pinned && !keyboardMode.current) choose(index); }}
          onMouseMove={(event) => { if (event.movementX || event.movementY) { keyboardMode.current = false; if (!pinned) choose(index); } }}
          onClick={() => { keyboardMode.current = false; if (pinned && selected === index) close(); else choose(index, true); }}>
          <rect x={coordinate.x - Math.min(18, plotWidth / points.length / 2)} y="32" width={Math.min(36, plotWidth / points.length)} height="195" fill="transparent" className="chart-hit" />
          {selected === index ? <line x1={coordinate.x} x2={coordinate.x} y1="36" y2="220" className="chart-selection" /> : null}
          <circle cx={coordinate.x} cy={coordinate.y} r={selected === index ? 6 : 4} className={point.isFuture ? 'chart-point chart-future' : 'chart-point'} />
          {(index % labelStep === 0 || index === points.length - 1) ? <text x={coordinate.x} y="248" textAnchor="middle" className="chart-label">{point.label}</text> : null}
        </g>; })}
      </svg>
    </div>
    <p className="tiny muted">未来空心点：尚未到来 · 左右键选择 · Enter/空格固定 · Esc关闭{pinned ? ' · 详情已固定' : ''}</p>
    <div aria-live="polite" className="sr-only">{selected !== null && points[selected] ? `${points[selected]!.pointKey}，${points[selected]!.isFuture ? '尚未到来' : `支出${displayFen(points[selected]!.amountFen)}元`}` : ''}</div>
    {selected !== null ? <section className="point-detail" aria-label="统计点详情" data-pinned={pinned}>
      <button className="button detail-close" onClick={() => { close(); chart.current?.focus({ preventScroll: true }); onClose(); }}>关闭详情</button>
      {children}
    </section> : null}
  </div>;
}
