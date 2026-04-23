import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { SettingsModal } from "./SettingsModal";

// Phase 18a: header-mounted user menu. Industry standard for auth'd web apps
// (GitHub, Vercel, Figma, Notion, …) — avatar in the top-right opens a
// dropdown with the signed-in identity, a Settings entry, and Sign out.
// Sign out is duplicated here because it's the single most common action a
// user reaches for and shouldn't require two clicks (menu → Settings tab).

interface UserMeta {
  first_name?: string;
  last_name?: string;
  // Supabase OAuth providers (Google, GitHub) typically populate one of
  // these instead of structured first/last — we fall back to them before
  // giving up on the email local-part.
  full_name?: string;
  name?: string;
}

function displayNameFrom(user: User): string | null {
  const meta = (user.user_metadata ?? {}) as UserMeta;
  const first = meta.first_name?.trim();
  const last = meta.last_name?.trim();
  if (first || last) return [first, last].filter(Boolean).join(" ");
  const full = (meta.full_name ?? meta.name)?.trim();
  return full && full.length > 0 ? full : null;
}

// Prefer explicit first/last (password signup from 18c+), fall back to
// OAuth-provided full_name/name, then email local-part. Two characters
// instead of one so alex@... and alice@... don't collapse to the same
// avatar glyph.
function initialsFrom(user: User): string {
  const meta = (user.user_metadata ?? {}) as UserMeta;
  const first = meta.first_name?.trim();
  const last = meta.last_name?.trim();
  if (first && last) return (first[0]! + last[0]!).toUpperCase();
  const full = (meta.full_name ?? meta.name)?.trim();
  if (full) {
    const parts = full.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    }
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  const email = user.email;
  if (email && email.includes("@")) {
    const local = email.split("@")[0]!;
    const a = local[0] ?? "?";
    const b = local[1] ?? "";
    return (a + b).toUpperCase();
  }
  return user.id.slice(0, 2).toUpperCase() || "??";
}

export function UserMenu({ className }: { className?: string } = {}) {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);

  // Click-outside + Escape to close. Standard dropdown ergonomics.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        // Return focus to the trigger so keyboard users aren't stranded
        // at document-body after the menu closes — required for WAI-ARIA
        // menu pattern compliance.
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move focus into the menu on open so Enter/Space/arrow keys land on the
  // first actionable item instead of the trigger button.
  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  if (!user) return null;

  const email = user.email ?? null;
  const initial = initialsFrom(user);
  const displayName = displayNameFrom(user);

  const handleSignOut = async () => {
    setErr(null);
    setSigningOut(true);
    try {
      await signOut();
      nav("/login", { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setSigningOut(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        id="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu-dropdown"
        aria-label={email ? `User menu for ${email}` : "Open user menu"}
        title={email ?? "Account"}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-elevated text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {initial}
      </button>

      {open && (
        <div
          id="user-menu-dropdown"
          role="menu"
          aria-labelledby="user-menu-trigger"
          className="absolute right-0 top-9 z-50 w-60 rounded-md border border-border bg-panel p-2 shadow-lg"
        >
          <div className="flex flex-col gap-0.5 px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Signed in as
            </span>
            {displayName && (
              <span className="text-xs font-semibold text-ink">{displayName}</span>
            )}
            <span className="break-all text-[11px] text-muted">{email ?? user.id}</span>
          </div>

          <div className="my-1 h-px bg-border" role="separator" />

          {err && (
            <div
              role="alert"
              className="mx-1 mb-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
            >
              {err}
            </div>
          )}

          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setShowSettings(true);
            }}
            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] font-semibold text-ink transition hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Settings
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-busy={signingOut}
            className="mt-0.5 flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] font-semibold text-ink transition hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
      {showSettings && (
        <SettingsModal
          onClose={() => {
            setShowSettings(false);
            // A10: the menu item that opened Settings is no longer in the
            // DOM (dropdown closed on open), so Modal's generic focus-
            // restore has nothing to return to. Park focus back on the
            // trigger explicitly so keyboard users aren't stranded.
            triggerRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
