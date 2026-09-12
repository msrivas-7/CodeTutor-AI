import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigationType } from "react-router-dom";
import { Wordmark } from "../../../components/Wordmark";
import { AuthFieldStill } from "./AuthFieldStill";
import { usePublicMotionScene } from "./PublicMotionWorld";
import "./public-page.css";

export function PublicPage({
  children,
  className = "",
  composition = "ambient",
  focusOnNavigation = true,
  headerAction,
  footerLinks,
  documentNavigation = false,
}: {
  children: ReactNode;
  className?: string;
  composition?: "ambient" | "auth";
  focusOnNavigation?: boolean;
  headerAction?: ReactNode;
  footerLinks?: ReactNode;
  documentNavigation?: boolean;
}) {
  const main = useRef<HTMLElement>(null);
  const { key, hash } = useLocation();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (focusOnNavigation && navigationType !== "POP" && !hash) {
      main.current?.focus({ preventScroll: true });
    }
  }, [key, hash, navigationType, focusOnNavigation]);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const {status, reduced} = usePublicMotionScene(root, composition);
  // A loading fallback must be escapable even if the full app bundle never
  // arrives. Its navigation uses ordinary documents, not that pending router.
  const publicLink = (href: string, children: ReactNode, props = {}) =>
    documentNavigation ? <a href={href} {...props}>{children}</a> : <Link to={href} {...props}>{children}</Link>;
  return (
    <div
      ref={setRoot}
      className={`public-theme public-page ${className}`}
      data-motion={reduced ? "static" : status}
    >
      {root && composition === "auth" && <AuthFieldStill root={root} />}
      {root && composition === "ambient" && <AuthFieldStill root={root} reading />}
      <a href="#public-content" className="public-skip">
        Skip to content
      </a>
      <header className="brand-header public-header">
        {publicLink("/", <Wordmark size="md" />, { "aria-label": "CodeTutor AI home" })}
        {headerAction ?? (
          publicLink("/", <>
            <span className="brand-header-long">Back to CodeTutor</span>
            <span className="brand-header-short" aria-hidden="true">Back home</span>
            <span aria-hidden="true">↗</span>
          </>, { className: "brand-header-action public-back", "aria-label": "Back to CodeTutor" })
        )}
      </header>
      <main
        ref={main}
        id="public-content"
        tabIndex={-1}
        className="public-content"
      >
        {children}
      </main>
      <footer className="public-footer">
        <span>© {new Date().getFullYear()} Mehul Srivastava</span>
        {footerLinks}
        <nav aria-label="Trust and support">
          {publicLink("/privacy", "Privacy")}
          {publicLink("/terms", "Terms")}
          {publicLink("/support", "Support")}
        </nav>
      </footer>
    </div>
  );
}
