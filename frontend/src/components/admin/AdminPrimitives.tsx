import type { ReactNode } from "react";

export type AdminIconName =
  | "overview"
  | "sessions"
  | "users"
  | "project"
  | "email"
  | "audit"
  | "trial"
  | "quality"
  | "empty";

export function AdminIcon({ name, className = "h-5 w-5" }: { name: AdminIconName; className?: string }) {
  const path = {
    overview: <><path d="M4 13h4l2.2-6 3.5 10L16 11h4" /><path d="M4 5v14h16" /></>,
    sessions: <><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5" /></>,
    users: <><path d="M16 20v-1.7A4.3 4.3 0 0 0 11.7 14H7.3A4.3 4.3 0 0 0 3 18.3V20" /><circle cx="9.5" cy="7" r="3" /><path d="M17 11a3 3 0 1 0-2.4-4.8M18 14.5a4 4 0 0 1 3 3.8V20" /></>,
    project: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /><path d="M4 12h4M12 12h8" /><circle cx="10" cy="12" r="2" /></>,
    email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    audit: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /><path d="M7 3.8 5.5 2.5M17 3.8l1.5-1.3" /></>,
    trial: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="m12 12 4-4" /><path d="M7 17h10" /><circle cx="12" cy="12" r="1" /></>,
    quality: <><path d="M12 3 5 6v5c0 4.5 2.7 8.2 7 10 4.3-1.8 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></>,
    empty: <><path d="M5 7.5 12 4l7 3.5v9L12 20l-7-3.5v-9Z" /><path d="m5 7.5 7 3.5 7-3.5M12 11v9" /></>,
  }[name];

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}

export function AdminPageHeader({
  id,
  eyebrow,
  title,
  description,
  actions,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <div className="min-w-0">
        <p className="admin-eyebrow">{eyebrow}</p>
        <h1 id={id} className="admin-page-title">{title}</h1>
        <div className="admin-page-description">{description}</div>
      </div>
      {actions && <div className="admin-page-actions">{actions}</div>}
    </header>
  );
}

export function AdminEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="admin-empty-state">
      <span className="admin-empty-icon"><AdminIcon name="empty" /></span>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
