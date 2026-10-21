import type { HTMLAttributes, ReactNode } from 'react';

function classes(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  role?: string;
  children: ReactNode;
}

/** Shared content bounds; the app retains ownership of its main landmark. */
export function PageShell({ children, className, ...props }: PageShellProps) {
  return <div className={classes('pulse-page-shell', className)} {...props}>{children}</div>;
}

export interface PageHeadProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  firstLine: ReactNode;
  secondLine?: ReactNode;
  switcher?: ReactNode;
  actions?: ReactNode;
}

export function PageHead({ firstLine, secondLine, switcher, actions, className, ...props }: PageHeadProps) {
  return (
    <div className={classes('pulse-page-head', className)} {...props}>
      <div className="pulse-page-head-copy">
        <h1 className="pulse-page-title">
          <span className="pulse-page-title-light">{firstLine}</span>
          {secondLine != null && <span className="pulse-page-title-heavy">{secondLine}</span>}
        </h1>
        {switcher}
      </div>
      {actions != null && <div className="pulse-page-head-actions">{actions}</div>}
    </div>
  );
}

export interface PageGridProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  sidebar: ReactNode;
  children: ReactNode;
  sidebarLabel?: string;
  sidebarClassName?: string;
  contentClassName?: string;
}

/** The supporting column stays on the left, and leads the mobile reading order. */
export function PageGrid({ sidebar, children, sidebarLabel, className, sidebarClassName, contentClassName, ...props }: PageGridProps) {
  return (
    <div className={classes('pulse-page-grid', className)} {...props}>
      <aside className={classes('pulse-page-sidebar', sidebarClassName)} aria-label={sidebarLabel}>{sidebar}</aside>
      <div className={classes('pulse-page-main', contentClassName)}>{children}</div>
    </div>
  );
}
