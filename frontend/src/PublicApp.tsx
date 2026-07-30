import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import CompactMarketingPage from "./pages/CompactMarketingPage";
import WhyNotChatGPTPage from "./pages/WhyNotChatGPTPage";

const MarketingPage = lazy(() => import("./pages/MarketingPage"));
const TrustPage = lazy(() => import("./pages/TrustPage"));
const FullApp = lazy(() => import("./App"));

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-muted">
      <span className="skeleton h-4 w-32 rounded" />
    </div>
  );
}

function PublicSurface({ children }: { children: ReactNode }) {
  return <div className="public-surface contents">{children}</div>;
}

function MarketingEntry() {
  const [compact, setCompact] = useState(() =>
    window.matchMedia("(max-width: 640px)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return compact ? <CompactMarketingPage /> : <MarketingPage />;
}

/**
 * Lightweight route shell for acquisition and trust surfaces.
 *
 * Public visitors should not download the authenticated workspace, admin
 * console, Supabase client, or learner-state stores before the first screen
 * can paint. Navigating into any product/auth route promotes the session to
 * the full application without a document reload.
 */
export default function PublicApp() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<PublicSurface><MarketingEntry /></PublicSurface>} />
        <Route path="/why-not-chatgpt" element={<PublicSurface><WhyNotChatGPTPage /></PublicSurface>} />
        <Route path="/privacy" element={<PublicSurface><TrustPage /></PublicSurface>} />
        <Route path="/terms" element={<PublicSurface><TrustPage /></PublicSurface>} />
        <Route path="/support" element={<PublicSurface><TrustPage /></PublicSurface>} />
        <Route path="*" element={<FullApp />} />
      </Routes>
    </Suspense>
  );
}
