import {
  type RefObject,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  animate,
} from "framer-motion";
import { HOUSE_EASE } from "../../components/cinema/easing";

// Director's-lens curve for the iris reveal — a deliberate
// ease-in-out. HOUSE_EASE (fast-out, slow-settle) is right for
// arrival animations, but an iris OPENING is the opposite kinetic:
// the operator turns the aperture wheel slowly at first
// (anticipation), the iris accelerates as it grows (page coming
// into view), then decelerates as it reaches its maximum (settle).
// `[0.65, 0, 0.35, 1]` is a pronounced cubic-ease-in-out that
// reads as a mechanical iris turning — slower than HOUSE_EASE
// throughout, especially at the start.
const IRIS_EASE = [0.65, 0, 0.35, 1] as const;

// Cinema Kit Continuity Pass — the match-cut iris reveal.
//
// Bridges the cinematic→lesson route boundary so the eye reads ONE
// continuous outward motion instead of TWO scenes glued together.
//
// Mechanics:
//   1. Capture the Run button's center on mount. If the ref isn't
//      populated yet (Monaco lazy-loads, layout hasn't settled),
//      hold a solid bg-bg overlay over the chrome and retry on
//      requestAnimationFrame until the rect lands.
//   2. Once we have the center, animate a `radius` motion value
//      from 0 to ~viewport-diagonal over 800 ms with HOUSE_EASE.
//   3. The overlay's background is a radial-gradient masked by
//      that radius — transparent inside the circle, opaque
//      bg-bg outside. As the radius grows, the page is uncovered.
//   4. A separate visible ring traces the perimeter of the
//      circle (border-accent/70, expanding with the same radius)
//      so the user sees the cinematic's expanding-ring geometry
//      continued at this Run-button anchor.
//   5. After the animation completes, both fade to opacity 0
//      over 120 ms then unmount.
//
// Reduced-motion path: skip the radial-gradient entirely. Just
// render an opaque overlay that fades to 0 over 240 ms — still
// a brief reveal, drops the radial expansion that can trigger
// vestibular sensitivity.

// Iris reveal duration. Tuned with the Hollywood-director lens.
// 0.8s read as a "pop", 1.7s a deliberate turn, 2.0s a genuinely
// opening aperture, 2.6s an operator taking their time, 3.2s the
// camera breathing it in. 3.5s lands at "the auditorium is being
// uncovered" — slow enough that the user has a full beat to settle
// into the lesson chrome as it's gradually exposed, while still
// feeling purposeful rather than stalled. Total felt-experience
// window ~3.65s including the trailing fade.
const REVEAL_DURATION_S = 3.5;
const FADE_OUT_DURATION_S = 0.15;

interface Props {
  runBtnRef: RefObject<HTMLElement | null>;
  /** Optional callback fired once the reveal has fully completed
   *  (used by tests; consumers can skip and rely on internal
   *  unmount). */
  onComplete?: () => void;
}

interface Center {
  x: number;
  y: number;
}

export function FirstRunHandoffReveal({ runBtnRef, onComplete }: Props) {
  const reduce = useReducedMotion();
  const [center, setCenter] = useState<Center | null>(null);
  const [phase, setPhase] = useState<"masking" | "fading" | "done">("masking");
  const radius = useMotionValue(0);
  const overlayOpacity = useMotionValue(1);

  // Memoise viewport diagonal once on mount. Resize during the
  // 800 ms reveal would be a bizarre edge; not worth hooking
  // resize listeners.
  const viewportDiag = useMemo(
    () => Math.hypot(window.innerWidth, window.innerHeight) * 1.1,
    [],
  );

  // Step 1+2: capture run-button center, then start radius animation.
  // Loop on rAF until the ref's rect is populated. The Run button
  // is rendered late in LessonPage's tree; on a typical mount it
  // lands within 1-2 frames.
  //
  // Bounded retry: if Monaco fails to mount or the lesson chrome
  // never lays out (slow network, API failure, etc.), we don't want
  // to spin rAF forever. After ~1.5 s of frames (~90 at 60 Hz) we
  // bail by either falling back to viewport center (so the iris at
  // least centers somewhere reasonable) or, under reduced-motion,
  // just dissolving the solid overlay. Either way the consumer
  // unmounts cleanly.
  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let retries = 0;
    const MAX_RETRIES = 90;

    const tryStart = () => {
      if (cancelled) return;
      const el = runBtnRef.current;
      const rect = el?.getBoundingClientRect();
      // Skip until both the element exists AND has a real size
      // (a 0×0 rect means the button is in the layout tree but
      // hasn't laid out yet — happens during Suspense boundaries
      // around Monaco).
      const elementReady =
        el && rect && rect.width > 0 && rect.height > 0;
      if (!elementReady) {
        retries += 1;
        if (retries < MAX_RETRIES) {
          rafId = window.requestAnimationFrame(tryStart);
          return;
        }
        // Exceeded retry budget — fall back to viewport center so
        // the iris still has a reasonable anchor instead of
        // spinning. Better felt-experience than a hung overlay.
        setCenter({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      } else {
        setCenter({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }
      // Reduced-motion: skip the radial expansion. The masking
      // overlay just drops opacity quickly. Center isn't used in
      // this path but we set it anyway so the conditional render
      // below is consistent.
      if (reduce) {
        animate(overlayOpacity, 0, {
          duration: 0.24,
          ease: HOUSE_EASE,
          onComplete: () => {
            if (cancelled) return;
            setPhase("done");
            if (cancelled) return;
            onComplete?.();
          },
        });
        return;
      }
      animate(radius, viewportDiag, {
        duration: REVEAL_DURATION_S,
        ease: IRIS_EASE,
        onComplete: () => {
          if (cancelled) return;
          setPhase("fading");
          animate(overlayOpacity, 0, {
            duration: FADE_OUT_DURATION_S,
            ease: HOUSE_EASE,
            onComplete: () => {
              if (cancelled) return;
              setPhase("done");
              if (cancelled) return;
              onComplete?.();
            },
          });
        },
      });
    };

    rafId = window.requestAnimationFrame(tryStart);
    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      // Stop any in-flight animations cleanly so they don't
      // continue mutating the unmounted motion values.
      radius.stop();
      overlayOpacity.stop();
    };
    // runBtnRef is a stable ref object; reduce, viewportDiag are
    // captured once. onComplete intentionally excluded — including
    // it would re-run the whole capture loop if a parent recreates
    // the callback on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute the gradient + ring transforms unconditionally so React
  // sees a stable hook order across renders.
  // The overlay is `transparent` inside `radius`, opaque bg-bg
  // outside. We write the radial-gradient as a CSS string that
  // updates every frame via useTransform.
  const cx = center?.x ?? 0;
  const cy = center?.y ?? 0;
  // The opaque region of the overlay is shaped like the cinematic
  // backdrop. Every stop OUTSIDE the iris uses fully-opaque RGB —
  // no alpha — so the lesson page is completely covered and reveals
  // ONLY through the transparent iris disc. Stops:
  //   • bg-bg at the iris edge (smooth match into the lesson page
  //     as the iris reaches each pixel)
  //   • a deep opaque mid-tone at 30% (darker than bg-bg, gives the
  //     theatrical vignette weight)
  //   • pure opaque black at the corners (the deepest part of the
  //     reveal, like a darkened theatre)
  // 1 px gap between transparent and bg prevents a hairline of
  // gradient bleed at the edge of the iris.
  const overlayBackground = useTransform(
    radius,
    (r) =>
      `radial-gradient(circle at ${cx}px ${cy}px, transparent ${r}px, rgb(var(--color-bg)) ${r + 1}px, rgb(5 7 14) 30%, rgb(0 0 0) 100%)`,
  );
  const ringX = useTransform(radius, (r) => cx - r);
  const ringY = useTransform(radius, (r) => cy - r);
  const ringSize = useTransform(radius, (r) => 2 * r);
  const ringOpacity = useTransform(radius, (r) => {
    // Smooth ramp instead of binary on/off — feels less mechanical.
    // Ring is invisible at very small (no perimeter), ramps in
    // through 16 → 40 px, holds at peak through most of the
    // expansion, then ramps out as it leaves the viewport so it
    // doesn't clip visibly into corners.
    if (r < 12) return 0;
    if (r < 36) return ((r - 12) / 24) * 0.85;
    const fadeOutStart = viewportDiag * 0.55;
    const fadeOutEnd = viewportDiag * 0.85;
    if (r > fadeOutEnd) return 0;
    if (r > fadeOutStart) return 0.85 * (1 - (r - fadeOutStart) / (fadeOutEnd - fadeOutStart));
    return 0.85;
  });

  // Don't render anything once we've completed.
  if (phase === "done") return null;

  // Pre-capture phase: ref not yet populated. Render a cinematic-
  // style backdrop with the SAME opaque stops as the iris overlay
  // (without the cut) so the moment of ref-capture doesn't create
  // a brightness jump. Fully-opaque RGB throughout — no alpha —
  // so the lesson chrome is completely covered before the iris
  // begins to reveal it.
  const cinematicBackdrop =
    "radial-gradient(circle at center, rgb(var(--color-bg)) 0%, rgb(5 7 14) 30%, rgb(0 0 0) 100%)";

  if (!center) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[55]"
        style={{ background: cinematicBackdrop }}
      />
    );
  }

  // Reduced-motion path: just the fading overlay, no gradient mask
  // or visible ring. Still uses the cinematic backdrop so the
  // dissolve feels of-a-piece with the cinematic's own exit fade.
  if (reduce) {
    return (
      <motion.div
        aria-hidden="true"
        style={{ opacity: overlayOpacity, background: cinematicBackdrop }}
        className="pointer-events-none fixed inset-0 z-[55]"
      />
    );
  }

  return (
    <>
      {/* The masking overlay. Its background is a radial-gradient
          whose transparent radius grows; outside the radius is
          opaque bg-bg. As radius reaches viewport-diagonal, the
          whole page is exposed. */}
      <motion.div
        aria-hidden="true"
        style={{
          background: overlayBackground,
          opacity: overlayOpacity,
        }}
        className="pointer-events-none fixed inset-0 z-[55]"
      />
      {/* The visible ring tracing the perimeter. Same accent
          color the cinematic's exit ring used; the eye reads
          this as a continuation of that geometry. */}
      <motion.div
        aria-hidden="true"
        style={{
          left: ringX,
          top: ringY,
          width: ringSize,
          height: ringSize,
          opacity: ringOpacity,
        }}
        className="pointer-events-none fixed rounded-full border-2 border-accent/70 z-[56]"
      />
    </>
  );
}

export type { Props as FirstRunHandoffRevealProps };
