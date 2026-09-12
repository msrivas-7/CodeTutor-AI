import { Component, createContext, lazy, Suspense, useCallback, useContext,
  useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { ParticleScene } from "../study/ParticleField";
import "./world.css";

const ParticleField = lazy(() => import("../study/ParticleField"));
type Status = "loading" | "ready" | "unavailable";
const World = createContext<{
  register: (scene: ParticleScene) => () => void;
  status: Status; reduced: boolean; loadFailed: boolean; retry: () => void;
}>({ register: () => () => {}, status: "loading", reduced: false, loadFailed: false, retry: () => {} });

class GraphicsBoundary extends Component<{
  children: ReactNode; onFailure: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Only presentation lives here. Page components retain their own form state,
 * guards, focus and cleanup; this host survives public route Suspense boundaries. */
export function PublicMotionWorld({ children }: { children: ReactNode }) {
  const { key } = useLocation();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [scene, setScene] = useState<ParticleScene | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isPublic, setPublic] = useState(() => document.documentElement.hasAttribute("data-public-theme"));
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useLayoutEffect(() => {
    setPublic(document.documentElement.hasAttribute("data-public-theme"));
  }, [key]);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setStatus("loading"); setReduced(query.matches); };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const register = useCallback((next: ParticleScene) => {
    setScene(next);
    // An outgoing page cannot unregister a more recently mounted destination.
    return () => setScene(current => current === next ? null : current);
  }, []);
  const retry = useCallback(() => { setStatus("loading"); setAttempt(n => n + 1); }, []);
  const failed = useCallback(() => { setLoadFailed(true); setStatus("unavailable"); }, []);
  const value = useMemo(() => ({register, status, reduced, loadFailed, retry}), [register, status, reduced, loadFailed, retry]);
  return <World.Provider value={value}>
    <div ref={setRoot} className="public-motion-world">
      {root && isPublic && !reduced && <GraphicsBoundary key={attempt} onFailure={failed}>
        <Suspense fallback={null}>
          <ParticleField root={root} scene={scene} light={false} count={420} onStatus={setStatus} />
        </Suspense>
      </GraphicsBoundary>}
      {children}
    </div>
  </World.Provider>;
}

export function usePublicMotionScene(root: HTMLElement | null, composition: ParticleScene["composition"]) {
  const world = useContext(World);
  const { register } = world;
  useLayoutEffect(() => root ? register({root, composition}) : undefined, [root, composition, register]);
  return world;
}
