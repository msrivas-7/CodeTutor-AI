import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WelcomeOverlay } from "../components/WelcomeOverlay";
import { UserMenu } from "../components/UserMenu";
import { FeedbackButton } from "../components/FeedbackButton";
import { usePreferencesStore } from "../state/preferencesStore";

export default function StartPage() {
  const nav = useNavigate();
  const [showWelcome, setShowWelcome] = useState(false);
  const welcomeDone = usePreferencesStore((s) => s.welcomeDone);

  useEffect(() => {
    if (!welcomeDone) {
      const t = setTimeout(() => setShowWelcome(true), 300);
      return () => clearTimeout(t);
    }
  }, [welcomeDone]);
  const headerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLButtonElement>(null);
  const guidedRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative flex h-full flex-col bg-bg text-ink">
      <div className="absolute right-4 top-3 z-10 flex items-center gap-2">
        <FeedbackButton />
        <UserMenu />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div ref={headerRef} className="mb-10 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-violet text-lg font-bold text-bg shadow-glow">
            AI
          </div>
          <h1 className="text-2xl font-bold tracking-tight">CodeTutor AI</h1>
          <p className="max-w-md text-center text-sm text-muted">
            Write code, run it in a sandbox, and learn with an AI tutor —
            all in the browser.
          </p>
        </div>

        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          <button
            ref={editorRef}
            onClick={() => nav("/editor")}
            className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-panel p-6 text-left shadow-sm transition hover:border-accent/50 hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent transition group-hover:bg-accent/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Open Editor</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Free-form coding workspace with 9 languages, sandboxed
                execution, and AI-powered help.
              </p>
            </div>
            <span className="mt-auto text-[11px] font-medium text-accent opacity-0 transition group-hover:opacity-100">
              Launch editor →
            </span>
          </button>

          <button
            ref={guidedRef}
            onClick={() => nav("/learn")}
            className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-panel p-6 text-left shadow-sm transition hover:border-violet/50 hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet/10 text-violet transition group-hover:bg-violet/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Guided Course</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Structured Python and JavaScript lessons for beginners. Track
                your progress and get lesson-aware AI guidance.
              </p>
            </div>
            <span className="mt-auto text-[11px] font-medium text-violet opacity-0 transition group-hover:opacity-100">
              Start learning →
            </span>
          </button>
        </div>
      </div>

      <footer className="border-t border-border bg-panel/60 px-4 py-2 text-center text-[10px] text-faint">
        CodeTutor AI © 2026 Mehul Srivastava — All rights reserved
      </footer>

      {showWelcome && (
        <WelcomeOverlay
          refs={{ header: headerRef.current, editorCard: editorRef.current, guidedCard: guidedRef.current }}
          onDismiss={() => setShowWelcome(false)}
        />
      )}
    </div>
  );
}
