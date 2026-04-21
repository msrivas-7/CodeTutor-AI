import type { ReactNode } from "react";

// Shared layout for /login, /signup, /reset-password, /auth/callback. Keeps
// the header branding + card chrome consistent across auth routes so the
// user sees the same visual frame regardless of which entry point they land
// on (direct link, redirect from RequireAuth, etc.).
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
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-violet text-sm font-bold text-bg shadow-glow">
              AI
            </div>
            <h1 className="text-lg font-bold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="text-center text-xs text-muted">{subtitle}</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-panel p-5 shadow-sm">
            {children}
          </div>
          {footer && (
            <div className="mt-4 text-center text-[11px] text-muted">
              {footer}
            </div>
          )}
        </div>
      </div>
      <footer className="border-t border-border bg-panel/60 px-4 py-2 text-center text-[10px] text-faint">
        CodeTutor AI © 2026 Mehul Srivastava — All rights reserved
      </footer>
    </div>
  );
}
