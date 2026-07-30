import { Link } from "react-router-dom";

import { Wordmark } from "../../../components/Wordmark";
import { useMarketingAuth } from "../useMarketingAuth";

/** Static public nav for reading and compact acquisition surfaces. */
export function SimpleMarketingNav() {
  const { isLoggedIn } = useMarketingAuth();
  return (
    <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-4 sm:px-8">
      <Link to="/" aria-label="CodeTutor AI home">
        <Wordmark size="md" />
      </Link>
      <Link
        to={isLoggedIn ? "/start" : "/login"}
        className="inline-flex min-h-11 items-center rounded-full px-4 text-sm text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {isLoggedIn ? "Dashboard →" : "Sign in"}
      </Link>
    </header>
  );
}
