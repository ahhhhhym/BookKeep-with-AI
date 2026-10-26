import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { NAV_ITEMS } from '../navigation';
import type { NavId } from '../../shared/nav';
import { AppIcon } from '../lib/icon-registry';

export interface NavShellProps {
  readonly current: NavId;
  readonly onNavigate: (id: NavId) => void;
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * 主导航：≥1200 展开、900～1199 收为图标栏、<900 变为抽屉。
 * 抽屉关闭通过 Esc 或点击遮罩触发，焦点由 App 归还菜单按钮。
 */
export function NavShell({ current, onNavigate, open, onClose }: NavShellProps): JSX.Element {
  const itemsRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 40 });
  const [width, setWidth] = useState(() => {
    try { const value = Number(localStorage.getItem('bookkeep.sidebarWidth')); return Number.isFinite(value) && value >= 160 && value <= 280 ? value : 176; }
    catch { return 176; }
  });
  const [resizing, setResizing] = useState(false);
  const resize = (value: number): void => setWidth(Math.max(160, Math.min(280, Math.round(value))));
  useEffect(() => {
    document.documentElement.style.setProperty('--nav-width', `${width}px`);
    try { localStorage.setItem('bookkeep.sidebarWidth', String(width)); } catch { /* Session-only resize when storage is unavailable. */ }
  }, [width]);
  useLayoutEffect(() => {
    const items = itemsRef.current;
    const update = (): void => {
      const selected = items?.querySelector<HTMLButtonElement>('[aria-current="page"]');
      if (selected) setIndicator({ top: selected.offsetTop, height: selected.offsetHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    if (items) observer.observe(items);
    return () => observer.disconnect();
  }, [current, open]);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 899px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 899px)');
    const update = (): void => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return (
    <>
      <div className="backdrop" data-open={open} onClick={onClose} aria-hidden="true" />
      <nav className="nav" id="main-nav" aria-label="主导航" data-open={open} data-resizing={resizing} inert={narrow && !open}>
        <div className="nav-items" ref={itemsRef}>
        <div className="nav-indicator" aria-hidden="true" style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }} />
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            data-nav-item={item.id}
            aria-current={current === item.id ? 'page' : undefined}
            aria-label={item.label}
            title={item.label}
            onClick={() => onNavigate(item.id)}
          >
            <AppIcon iconKey={item.iconKey} size={20} />
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
        </div>
        <div className="nav-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={160} aria-valuemax={280} aria-valuenow={width} tabIndex={0}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX - (event.currentTarget.closest('nav')?.getBoundingClientRect().left ?? 0)); }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }}
          onLostPointerCapture={() => setResizing(false)}
          onDoubleClick={() => resize(176)}
          onKeyDown={event => { const next = event.key === 'ArrowLeft' ? width - 8 : event.key === 'ArrowRight' ? width + 8 : event.key === 'Home' ? 160 : event.key === 'End' ? 280 : null; if (next !== null) { event.preventDefault(); resize(next); } }}
        />
      </nav>
    </>
  );
}
