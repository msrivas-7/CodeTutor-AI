import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { MeshGradient } from "@paper-design/shaders-react";
import { AmbientGlyphField } from "../components/AmbientGlyphField";
import { CinematicLighting } from "../components/cinema/CinematicLighting";
import { FilmGrain } from "../components/cinema/FilmGrain";
import { Wordmark } from "../components/Wordmark";

// Shared layout for /login, /signup, /reset-password, /auth/callback. Keeps
// the header branding + card chrome consistent across auth routes so the
// user sees the same visual frame regardless of which entry point they land
// on (direct link, redirect from RequireAuth, etc.).
//
// Phase B: pulled into the same visual language as the rest of the
// product. Previous version looked like a generic SaaS auth card —
// after the 14s cinematic, a returning user signing back in tomorrow
// hit chrome that read like a different product. Now the auth shell
// has AmbientGlyphField + scene-tier FilmGrain underfoot, the
// Wordmark is sized hero, and the form fades up on mount.
//
// Phase 22C: bridge to the marketing page. The MarketingPage backdrop
// is a WebGL mesh gradient; without it here, a visitor crossing from
// /  → /signup hits a visible color jump. We render the SAME mesh at
// reduced opacity so the auth pages feel from the same world. The
// auth chrome (form card + key-light) sits on top, so the form still
// reads as the focus.
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
  const reduce = useReducedMotion();
  return (
    // No `bg-bg` — the WebGL mesh + lighting stack is the background.
    // A solid color layer here would paint over the mesh.
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden text-ink">
      {/* Atmospheric backdrop — same palette as MarketingPage at 50%
          opacity. The dimming turns the mesh into "shared world"
          texture without competing with the form for attention. */}
      {!reduce ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-30 opacity-50"
        >
          <MeshGradient
            colors={[
              "#0a0e22",
              "#1d1758",
              "#5b2cb0",
              "#1d5b9e",
            ]}
            distortion={0.7}
            swirl={0.6}
            speed={0.18}
            scale={1.3}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-30 bg-gradient-to-br from-[#0a0e22] via-[#1d1758] to-[#1d5b9e] opacity-60"
        />
      )}
      {/* On narrow auth screens isolated edge glyphs read like clipped form
          content. Keep the atmospheric detail where there is enough negative
          space for it to register as a deliberate background layer. */}
      <div className="hidden sm:block">
        <AmbientGlyphField occludeCenter />
      </div>
      {/* Soft key light + vignette — `key-only` + `soft` intensity
          gives the auth surface a subtle warm accent glow with the
          vignette pulling the eye toward the form, without going to
          the full three-point cinematic rig (which stays scoped to
          the cinematic itself). */}
      <CinematicLighting variant="key-only" intensity="soft" />
      <FilmGrain intensity="hero" />
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-10">
        <motion.div
          className="w-full max-w-sm"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-6 flex flex-col items-center gap-3">
            <Wordmark size="hero" />
            <h2 className="font-display text-[20px] font-medium tracking-tight text-ink">
              {title}
            </h2>
            {subtitle && (
              <p className="text-center text-[13px] leading-relaxed text-muted">{subtitle}</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-panel/80 p-5 shadow-sm backdrop-blur">
            {children}
          </div>
          {footer && (
            <div className="mt-4 text-center text-sm text-muted [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:rounded-lg [&_a]:px-2 [&_a]:focus-visible:outline-none [&_a]:focus-visible:ring-2 [&_a]:focus-visible:ring-accent [&_button]:inline-flex [&_button]:min-h-11 [&_button]:items-center [&_button]:rounded-lg [&_button]:px-2 [&_button]:focus-visible:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-accent">
              {footer}
            </div>
          )}
        </motion.div>
      </div>
      <footer className="relative z-10 flex flex-wrap items-center justify-center gap-x-4 border-t border-border-soft/60 bg-panel/40 px-4 py-2 text-center text-[10px] text-faint backdrop-blur-sm">
        <span>© {new Date().getFullYear()} Mehul Srivastava</span>
        <Link to="/privacy" className="inline-flex min-h-11 items-center hover:text-muted">Privacy</Link>
        <Link to="/terms" className="inline-flex min-h-11 items-center hover:text-muted">Terms</Link>
        <Link to="/support" className="inline-flex min-h-11 items-center hover:text-muted">Support</Link>
      </footer>
    </div>
  );
}
