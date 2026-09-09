import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AuthFieldStill } from "./AuthFieldStill";

const ParticleField = lazy(() => import("../study/ParticleField"));

// The authored document is not hydrated or owned by React. A failed download
// or renderer can only remove decoration, never lesson content or navigation.
class DecorationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

function DiscoveryMotion() {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (reduced) document.body.dataset.motion = "static";
  }, [reduced]);
  return <>
    <AuthFieldStill root={document.body} reading />
    {!reduced && (
    <DecorationBoundary>
      <Suspense fallback={null}>
        <ParticleField root={document.body} light={false} count={420} composition="ambient"
          onStatus={(status) => { document.body.dataset.motion = status; }} />
      </Suspense>
    </DecorationBoundary>
    )}
  </>;
}

const mount = document.getElementById("discovery-motion");
if (mount) createRoot(mount).render(<DiscoveryMotion />);
