import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import WhyNotChatGPTPage from "./pages/WhyNotChatGPTPage";
import { RouteLoading } from "./features/marketing/public/RouteLoading";

const MarketingHomepage = lazy(
  () => import("./features/marketing/study/MarketingHomepage"),
);
const TrustPage = lazy(() => import("./pages/TrustPage"));
const FullApp = lazy(async () => {
  const [appModule, { initAuth }] = await Promise.all([
    import("./App"),
    import("./auth/authStore"),
  ]);

  // Public routes deliberately defer auth hydration so acquisition content can
  // paint quickly. Once a visitor explicitly enters the product, that delay is
  // no longer useful: begin authoritative hydration before rendering FullApp.
  initAuth();
  return appModule;
});

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
    <Suspense fallback={<RouteLoading fullHeight />}>
      <Routes>
        <Route
          path="/"
          element={<MarketingHomepage />}
        />
        <Route
          path="/why-not-chatgpt"
          element={<WhyNotChatGPTPage />}
        />
        <Route
          path="/privacy"
          element={<TrustPage pageKey="privacy" />}
        />
        <Route
          path="/terms"
          element={<TrustPage pageKey="terms" />}
        />
        <Route
          path="/support"
          element={<TrustPage pageKey="support" />}
        />
        <Route path="*" element={<FullApp />} />
      </Routes>
    </Suspense>
  );
}
