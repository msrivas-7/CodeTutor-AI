import { useEffect, useState } from "react";

interface Props {
  // Action to retrigger — signup confirmation, magic link, or password
  // reset. The component doesn't care which; it only owns cooldown + UX.
  onResend: () => Promise<void>;
  // Customisable copy so the same component can read naturally in three
  // places ("sign-in link", "confirmation email", "reset link").
  label: string;
}

// Phase 20-P1: the "check your email" screens previously offered no path
// forward if the email never arrived — users had to close the tab and
// start over. A 30s-rate-limited resend link covers the typical "spam
// folder + too-fast-click" case without inviting abuse. Supabase has its
// own server-side rate limit (2/hr on the free SMTP tier) so the 30s here
// is a UI courtesy; anything the server rejects bubbles up as an error.
export function ResendEmailButton({ onResend, label }: Props) {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "error">(
    "idle",
  );
  const [err, setErr] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const handle = async () => {
    if (state === "pending" || cooldown > 0) return;
    setErr(null);
    setState("pending");
    try {
      await onResend();
      setState("sent");
      setCooldown(30);
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
      setCooldown(30);
    }
  };

  const disabled = state === "pending" || cooldown > 0;
  const text =
    state === "pending"
      ? "Sending…"
      : cooldown > 0
        ? `Resend in ${cooldown}s`
        : `Resend ${label}`;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={disabled}
        className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:text-faint disabled:no-underline"
      >
        {text}
      </button>
      {state === "sent" && cooldown > 0 && (
        <span className="text-sm text-success">Email sent again.</span>
      )}
      {err && (
        <span role="alert" className="text-sm text-danger">
          {err}
        </span>
      )}
    </div>
  );
}
