import { useEffect, useState, type JSX } from 'react';
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
      <nav className="nav" id="main-nav" aria-label="主导航" data-open={open} inert={narrow && !open}>
        <div className="nav-brand">
          <span className="nav-brand-mark" aria-hidden="true">
            ¥
          </span>
          <span className="nav-label">BookKeepAI</span>
        </div>
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
        <div className="nav-spacer" />
        <p className="nav-footnote">
          本地账本
          <br />
          数据落库 · 无需联网
        </p>
      </nav>
    </>
  );
}
