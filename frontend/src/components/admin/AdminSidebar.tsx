import { NavLink } from "react-router-dom";

// Phase 25: left sidebar for the /admin page. Six destinations matching
// the section components. Sticky so the nav stays visible while a long
// section (e.g. users table) scrolls. Active state styled like the
// Settings panel's tab pills (bg-bg + ring-accent) for visual continuity.

interface AdminNavEntry {
  to: string;
  label: string;
  hint: string;
}

const ENTRIES: AdminNavEntry[] = [
  { to: "/admin/overview", label: "Overview", hint: "Live dashboard" },
  { to: "/admin/sessions", label: "Sessions", hint: "Active runners" },
  { to: "/admin/users", label: "Users", hint: "Caps + freeze" },
  { to: "/admin/project", label: "Project", hint: "System config" },
  { to: "/admin/email", label: "Email log", hint: "Sent mail" },
  { to: "/admin/audit", label: "Audit log", hint: "Admin actions" },
  // Phase 27-v2.2 Fix 7b — anon trial path observability tab.
  { to: "/admin/anon", label: "Trial path", hint: "Anon traffic + funnel" },
  { to: "/admin/eval-quality", label: "Eval quality", hint: "Redacted review queue" },
];

export function AdminSidebar() {
  return (
    <nav
      aria-label="Admin sections"
      className="sticky top-0 z-20 flex w-full shrink-0 gap-1 self-start overflow-x-auto border-b border-border bg-panel/95 p-2 backdrop-blur md:w-[200px] md:flex-col md:overflow-visible md:border-b-0 md:bg-transparent md:p-3"
    >
      <div className="hidden px-2 pb-3 md:block">
        <h1 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Admin
        </h1>
      </div>
      {ENTRIES.map((e) => (
        <NavLink
          key={e.to}
          to={e.to}
          className={({ isActive }) =>
            `flex min-h-11 shrink-0 flex-col justify-center gap-0.5 rounded-md px-3 py-2 text-[12px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              isActive
                ? "bg-bg text-ink shadow-soft ring-1 ring-accent/40"
                : "text-muted hover:bg-bg/50 hover:text-ink"
            }`
          }
        >
          <span className="text-ink">{e.label}</span>
          <span className="text-[10px] text-muted">{e.hint}</span>
        </NavLink>
      ))}
    </nav>
  );
}
