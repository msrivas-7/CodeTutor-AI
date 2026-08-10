import { NavLink } from "react-router-dom";
import { AdminIcon, type AdminIconName } from "./AdminPrimitives";

// Persistent navigation for the admin workspaces. Grouping keeps live
// operations distinct from policy and governance without hiding a route.

interface AdminNavEntry {
  to: string;
  label: string;
  hint: string;
  icon: AdminIconName;
  group: "Operate" | "Govern";
}

const ENTRIES: AdminNavEntry[] = [
  { to: "/admin/overview", label: "Overview", hint: "Live system pulse", icon: "overview", group: "Operate" },
  { to: "/admin/sessions", label: "Sessions", hint: "Active runners", icon: "sessions", group: "Operate" },
  { to: "/admin/users", label: "Users", hint: "Limits and access", icon: "users", group: "Operate" },
  { to: "/admin/project", label: "Project", hint: "Runtime policy", icon: "project", group: "Govern" },
  { to: "/admin/email", label: "Email log", hint: "Outbound delivery", icon: "email", group: "Govern" },
  { to: "/admin/audit", label: "Audit log", hint: "Change history", icon: "audit", group: "Govern" },
  // Phase 27-v2.2 Fix 7b — anon trial path observability tab.
  { to: "/admin/anon", label: "Trial path", hint: "Acquisition health", icon: "trial", group: "Govern" },
  { to: "/admin/eval-quality", label: "Eval quality", hint: "Review workflow", icon: "quality", group: "Govern" },
];

export function AdminSidebar() {
  return (
    <nav aria-label="Admin sections" className="admin-sidebar">
      <div className="admin-sidebar-intro">
        <p>Control room</p>
        <span>Operate, observe, recover.</span>
      </div>
      {(["Operate", "Govern"] as const).map((group) => (
        <div key={group} className="admin-nav-group">
          <p className="admin-nav-group-label">{group}</p>
          <div className="admin-nav-items">
            {ENTRIES.filter((entry) => entry.group === group).map((entry) => (
              <NavLink
                key={entry.to}
                to={entry.to}
                className={({ isActive }) => `admin-nav-link ${isActive ? "admin-nav-link-active" : ""}`}
              >
                <span className="admin-nav-icon"><AdminIcon name={entry.icon} /></span>
                <span className="min-w-0">
                  <span className="admin-nav-label">{entry.label}</span>
                  <span className="admin-nav-hint">{entry.hint}</span>
                </span>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
