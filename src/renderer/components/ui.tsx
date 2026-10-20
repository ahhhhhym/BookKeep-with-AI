import { Fragment, type JSX, type ReactNode } from 'react';

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps): JSX.Element {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export interface PanelProps {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export function Panel({ title, actions, children }: PanelProps): JSX.Element {
  return (
    <section className="panel" aria-label={title}>
      <div className="panel-title">
        <h2>{title}</h2>
        {actions}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export type NoticeTone = 'info' | 'warn' | 'danger';

export interface NoticeProps {
  readonly tone?: NoticeTone;
  readonly title?: string;
  readonly children?: ReactNode;
}

export function Notice({ tone = 'info', title, children }: NoticeProps): JSX.Element {
  return (
    <div className="notice" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <div>
        {title ? <div className="notice-title">{title}</div> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

export interface BadgeProps {
  readonly tone?: 'default' | 'primary' | 'warn' | 'danger';
  readonly children: ReactNode;
}

export function Badge({ tone = 'default', children }: BadgeProps): JSX.Element {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}

export function EmptyState({ title, children, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <p className="muted">{children}</p> : null}
      {action}
    </div>
  );
}

export interface SkeletonNoticeProps {
  readonly step: string;
  readonly items: readonly string[];
  readonly children?: ReactNode;
}

/** 未实现功能统一提示：不返回假成功，也不做假加载。 */
export function SkeletonNotice({ step, items, children }: SkeletonNoticeProps): JSX.Element {
  return (
    <Notice title="此功能尚未实现">
      <p>
        {children ?? '该入口已按规格预留，实际能力将在后续步骤实现；当前点击不会产生任何写入。'}
      </p>
      <p className="tiny">计划步骤：{step}</p>
      <ul className="tiny">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Notice>
  );
}

export function ErrorLine({ message }: { readonly message: string }): JSX.Element {
  return (
    <div className="notice" data-tone="danger" role="alert">
      {message}
    </div>
  );
}

export interface MetaListProps {
  readonly entries: readonly (readonly [string, ReactNode])[];
}

export function MetaList({ entries }: MetaListProps): JSX.Element {
  return (
    <dl className="kv">
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
