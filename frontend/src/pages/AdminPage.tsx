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
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex items-center justify-between border-b border-border bg-panel/40 px-6 py-3">
        <button
          type="button"
          onClick={() => nav("/start")}
          className="flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          aria-label="Back to dashboard"
        >
          <Wordmark className="h-5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
            Admin
          </span>
        </button>
        <UserMenu />
      </header>
      <div className="flex flex-1">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
