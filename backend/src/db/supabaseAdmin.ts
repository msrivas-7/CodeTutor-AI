import { config } from "../config.js";

// Phase 20-P0 #9: thin wrapper around Supabase's admin auth REST endpoints.
// We deliberately don't pull @supabase/supabase-js into the backend — the
// only admin action we need is deleteUser, and the REST call is two lines
// of fetch. Adding a whole SDK for that would bloat the container.
//
// The service-role key is optional: when unset (e.g. after Phase 20-P1
// drops it from the VM), `isAdminAvailable()` returns false and the
// delete-account route responds with 501. That lets us turn off
// self-service deletion without taking the backend down.

export function isAdminAvailable(): boolean {
  return (
    !!config.supabase.url &&
    !!config.supabase.serviceRoleKey &&
    config.supabase.serviceRoleKey.trim() !== ""
  );
}

function adminHeaders(): Record<string, string> {
  const key = config.supabase.serviceRoleKey;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

// Phase 26 (audit H-1 / SRE F3.2): force-signout via Supabase admin REST.
// Invalidates ALL refresh tokens for the user — they have to sign in
// again on every device. Used after demoting a compromised admin so
// their existing ~1h JWT can't continue carrying app_metadata.role=admin
// claims.
//
// Endpoint: POST /auth/v1/admin/users/{user_id}/logout
// scope: 'global' revokes every refresh token; 'local' would only kill
// the current session — `global` is what we want for incident response.
export async function adminForceSignOut(userId: string): Promise<void> {
  const base = config.supabase.url;
  if (!base) throw new Error("SUPABASE_URL not configured");
  const res = await fetch(
    `${base.replace(/\/$/, "")}/auth/v1/admin/users/${encodeURIComponent(userId)}/logout`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ scope: "global" }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `supabase admin force-signout failed: ${res.status} ${text}`,
    );
  }
}

// DELETE /auth/v1/admin/users/{user_id}. On success the row is removed from
// auth.users and every public.* table referencing it via ON DELETE CASCADE
// drops with it — so we don't need to enumerate tables here.
export async function adminDeleteUser(userId: string): Promise<void> {
  const base = config.supabase.url;
  if (!base) throw new Error("SUPABASE_URL not configured");
  const res = await fetch(
    `${base.replace(/\/$/, "")}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: adminHeaders() },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `supabase admin deleteUser failed: ${res.status} ${text}`,
    );
  }
}

// Phase 20-P5: list users for the admin dashboard. GET /auth/v1/admin/users
// is paginated server-side (`page` 1-indexed, `per_page` ≤ 1000); we expose
// the slice the route layer needs and let it handle filtering / joining.
//
// Search: GoTrue's admin endpoint doesn't support a free-text search query,
// so we filter client-side here. Acceptable while DAU is small; revisit
// when the table can't fit in one page.

export interface AdminAuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
}

export interface ListAuthUsersOpts {
  page?: number;       // 1-indexed; defaults to 1
  perPage?: number;    // defaults to 50, max 1000
  search?: string;     // case-insensitive substring match on email
}

export interface ListAuthUsersResult {
  users: AdminAuthUser[];
  page: number;
  perPage: number;
  hasMore: boolean;
}

export async function listAuthUsersPaginated(
  opts: ListAuthUsersOpts = {},
): Promise<ListAuthUsersResult> {
  const base = config.supabase.url;
  if (!base) throw new Error("SUPABASE_URL not configured");
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(1000, Math.max(1, opts.perPage ?? 50));
  const url = new URL(
    `${base.replace(/\/$/, "")}/auth/v1/admin/users`,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  const res = await fetch(url.toString(), { headers: adminHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`supabase admin listUsers failed: ${res.status} ${text}`);
  }
  const body = (await res.json()) as {
    users?: Array<{
      id: string;
      email?: string | null;
      created_at?: string;
      last_sign_in_at?: string | null;
      user_metadata?: Record<string, unknown> | null;
    }>;
    total?: number;
  };
  const rawUsers = Array.isArray(body.users) ? body.users : [];
  const search = opts.search?.trim().toLowerCase() ?? "";
  const filtered = search
    ? rawUsers.filter(
        (u) => (u.email ?? "").toLowerCase().includes(search),
      )
    : rawUsers;
  const users: AdminAuthUser[] = filtered.map((u) => {
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const first = typeof meta.first_name === "string" ? meta.first_name : "";
    const last = typeof meta.last_name === "string" ? meta.last_name : "";
    const display = [first, last].filter(Boolean).join(" ").trim();
    const fallback =
      typeof meta.full_name === "string"
        ? meta.full_name
        : typeof meta.name === "string"
          ? meta.name
          : null;
    return {
      id: u.id,
      email: u.email ?? null,
      displayName: display || fallback,
      createdAt: u.created_at ?? "",
      lastSignInAt: u.last_sign_in_at ?? null,
    };
  });
  return {
    users,
    page,
    perPage,
    hasMore: rawUsers.length === perPage,
  };
}

// Single-user lookup. Same admin REST endpoint, by id.
export async function getAuthUser(userId: string): Promise<AdminAuthUser | null> {
  const base = config.supabase.url;
  if (!base) throw new Error("SUPABASE_URL not configured");
  const res = await fetch(
    `${base.replace(/\/$/, "")}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { headers: adminHeaders() },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`supabase admin getUser failed: ${res.status} ${text}`);
  }
  const u = (await res.json()) as {
    id: string;
    email?: string | null;
    created_at?: string;
    last_sign_in_at?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const first = typeof meta.first_name === "string" ? meta.first_name : "";
  const last = typeof meta.last_name === "string" ? meta.last_name : "";
  const display = [first, last].filter(Boolean).join(" ").trim();
  const fallback =
    typeof meta.full_name === "string"
      ? meta.full_name
      : typeof meta.name === "string"
        ? meta.name
        : null;
  return {
    id: u.id,
    email: u.email ?? null,
    displayName: display || fallback,
    createdAt: u.created_at ?? "",
    lastSignInAt: u.last_sign_in_at ?? null,
  };
}
