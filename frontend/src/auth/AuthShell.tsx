import type { ReactNode } from "react";
import { PublicPage } from "../features/marketing/public/PublicPage";

/** Presentation only: auth handlers, return targets and form state stay in their owners. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <PublicPage
      className="public-auth"
      composition="auth"
      focusOnNavigation={false}
    >
      <div className="public-auth-intro">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="public-auth-form">
        {children}
        {footer && <div className="public-auth-footer">{footer}</div>}
      </div>
    </PublicPage>
  );
}
