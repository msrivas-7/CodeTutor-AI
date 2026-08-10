import { Outlet, useNavigate } from "react-router-dom";
import { AdminSidebar } from "../components/admin/AdminSidebar";
import { UserMenu } from "../components/UserMenu";
import { Wordmark } from "../components/Wordmark";

// Phase 25: dedicated admin console at /admin/*. Layout: top bar with
// brand + user menu (matches StartPage chrome), left sidebar with
// section nav, main pane renders the active section via <Outlet />.
//
// Auth gating: wrapped in <RequireAdmin> at the route level, which is
// itself nested under <RequireAuth> (via AuthedLayout). Non-admins
// never reach this component.

export default function AdminPage() {
  const nav = useNavigate();
  return (
    <div className="admin-shell flex min-h-screen flex-col bg-bg text-ink">
      <a href="#admin-main" className="admin-skip-link">Skip to admin content</a>
      <header className="admin-topbar">
        <button
          type="button"
          onClick={() => nav("/start")}
          className="group flex min-h-11 items-center gap-3 rounded-xl px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Back to dashboard"
        >
          <Wordmark className="h-5" />
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <span className="flex items-center gap-2 text-xs font-semibold text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_rgb(var(--color-success)/0.55)]" aria-hidden="true" />
            Operator console
          </span>
        </button>
        <UserMenu />
      </header>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col md:flex-row">
        <AdminSidebar />
        <main id="admin-main" tabIndex={-1} data-admin-surface className="min-w-0 flex-1 overflow-y-auto">
          <div className="admin-main-content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
