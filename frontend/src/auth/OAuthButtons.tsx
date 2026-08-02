import { useState } from "react";
import { useAuthStore } from "./authStore";

// Social-login buttons. Supabase handles the full OAuth dance — we just
// invoke `signInWithOAuth(provider)` and the browser is redirected to the
// provider, then back to `/auth/callback`. If a provider isn't enabled in
// the Supabase dashboard, the SDK returns an error we surface inline.
export function OAuthButtons({
  disabled,
  returnTo = "/start",
}: {
  disabled?: boolean;
  returnTo?: string;
}) {
  const signInWithOAuth = useAuthStore((s) => s.signInWithOAuth);
  const [pending, setPending] = useState<"google" | "github" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handle = async (provider: "google" | "github") => {
    setErr(null);
    setPending(provider);
    try {
      await signInWithOAuth(provider, returnTo);
      // On success the browser redirects — we usually don't reach the line
      // below. If we do (popup blocked, etc.), clear the pending state.
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => handle("google")}
          disabled={disabled || pending !== null}
          className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-sm font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.5 18.9 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          {pending === "google" ? "Connecting…" : "Google"}
        </button>
        <button
          type="button"
          onClick={() => handle("github")}
          disabled={disabled || pending !== null}
          className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-sm font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2 0-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
          </svg>
          {pending === "github" ? "Connecting…" : "GitHub"}
        </button>
      </div>
      {err && (
        <div
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {err}{" "}
          <span className="text-muted">— or use email instead below.</span>
        </div>
      )}
    </div>
  );
}
