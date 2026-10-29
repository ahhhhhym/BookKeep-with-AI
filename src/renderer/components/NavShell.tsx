import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import { NAV_ITEMS, type NavItem } from '../navigation';
import type { NavId } from '../../shared/nav';
import { AppIcon } from '../lib/icon-registry';
import type { NavMode } from '../lib/nav-preferences';

export interface NavShellProps {
  readonly current: NavId;
  readonly onNavigate: (id: NavId) => void;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly mode: NavMode;
  readonly onModeChange: (mode: NavMode) => void;
  readonly width: number;
  readonly onWidthChange: (width: number) => void;
  readonly narrow: boolean;
}

/** One navigation tree; narrow drawers temporarily show the saved detailed width. */
export function NavShell({ current, onNavigate, open, onClose, mode, onModeChange, width, onWidthChange, narrow }: NavShellProps): JSX.Element {
  const itemsRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ top: .66, height: 42.68 });
  const [resizing, setResizing] = useState(false);
  const effectiveMode = narrow ? 'detailed' : mode;
  const resizable = !narrow && mode === 'detailed';
  const resize = (value: number): void => onWidthChange(Math.max(160, Math.min(280, Math.round(value))));
  useLayoutEffect(() => {
    const items = itemsRef.current;
    const update = (): void => {
      const selected = items?.querySelector<HTMLButtonElement>('[aria-current="page"]');
      if (selected && items) {
        const top = selected.getBoundingClientRect().top - items.getBoundingClientRect().top + (selected.offsetHeight - 42.68) / 2;
        setIndicator(value => Math.abs(value.top - top) < .01 ? value : { top, height: 42.68 });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    if (items) observer.observe(items);
    return () => observer.disconnect();
  }, [current, open]);
  const renderItem = (item: NavItem): JSX.Element => (
    <button key={item.id} type="button" className="nav-item" data-nav-item={item.id}
      aria-current={current === item.id ? 'page' : undefined} aria-label={item.label} title={item.label}
      onClick={() => onNavigate(item.id)}>
      <span className="nav-visual">
        <AppIcon iconKey={item.iconKey} size={23.28} />
        <span className="nav-label">{item.label}</span>
      </span>
    </button>
  );
  const toggleLabel = narrow ? '关闭菜单' : mode === 'detailed' ? '切换为省略菜单' : '切换为详细菜单';
  return (
    <>
      <div className="backdrop" data-open={narrow && open} onClick={onClose} aria-hidden="true" />
      <nav className="nav" id="main-nav" aria-label="主导航" data-open={narrow && open} data-mode={effectiveMode} data-resizing={resizing} inert={narrow && !open}>
        <button type="button" className="nav-mode-toggle" aria-label={toggleLabel} title={toggleLabel} aria-controls="main-nav"
          aria-expanded={narrow ? open : mode === 'detailed'} onClick={() => narrow ? onClose() : onModeChange(mode === 'detailed' ? 'compact' : 'detailed')}>
          <span className="nav-visual"><AppIcon iconKey="lucide:menu" size={23.28} /></span>
        </button>
        <div className="nav-items" ref={itemsRef}>
          <div className="nav-indicator" aria-hidden="true" style={{ transform: `translate(-50%, ${indicator.top}px)`, height: indicator.height }} />
          {NAV_ITEMS.filter(item => item.group === 'main').map(renderItem)}
          <div className="nav-bottom">{NAV_ITEMS.filter(item => item.group === 'bottom').map(renderItem)}</div>
        </div>
        <div className="nav-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={160} aria-valuemax={280} aria-valuenow={width} tabIndex={resizable ? 0 : -1} hidden={!resizable}
          onPointerDown={event => { if (!resizable || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }}
          onPointerMove={event => { if (resizable && event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX - (event.currentTarget.closest('nav')?.getBoundingClientRect().left ?? 0)); }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }}
          onLostPointerCapture={() => setResizing(false)}
          onDoubleClick={() => { if (resizable) resize(176); }}
          onKeyDown={event => { if (!resizable) return; const next = event.key === 'ArrowLeft' ? width - 8 : event.key === 'ArrowRight' ? width + 8 : event.key === 'Home' ? 160 : event.key === 'End' ? 280 : null; if (next !== null) { event.preventDefault(); resize(next); } }}
        />
      </nav>
    </>
  );
}
