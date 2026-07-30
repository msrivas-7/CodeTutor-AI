import { useEffect, useState } from "react";
import { useInView } from "framer-motion";
import { motion, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import { HOUSE_EASE } from "../../../components/cinema/easing";

// Phase 22C — Beat ② "Ask." vignette.
//
// 4-second motion when the panel scrolls into view:
//   t=0     tutor chat bubble fades up (italic, accent tone)
//   t=1.0   typing-indicator dot triad appears as the learner reply
//   t=2.0   triad replaces with a typewriter-revealed reply
//   t=3.5   hold on the final state
//
// Reduced-motion: render the FINAL state — tutor bubble + completed
// learner reply — with no transitions. Same meaning, no movement.

const TUTOR_TEXT = "What does str(points) change about the value?";
const LEARNER_TEXT = "It turns the number into a string so + can join them.";

export function AskVignette() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });

  // The vignette has a 3-stage local timeline. We drive it with simple
  // setTimeouts started once the panel scrolls into view; clearing on
  // unmount or re-trigger to be tidy.
  const [stage, setStage] = useState<"hidden" | "tutor" | "typing" | "reply">(
    reduce ? "reply" : "tutor",
  );
  const [replyChars, setReplyChars] = useState(reduce ? LEARNER_TEXT.length : 0);

  useEffect(() => {
    if (reduce || !inView) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => !cancelled && setStage("tutor"), 200),
    );
    timers.push(
      setTimeout(() => !cancelled && setStage("typing"), 1200),
    );
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        setStage("reply");
        let i = 0;
        const tick = () => {
          if (cancelled) return;
          i += 1;
          setReplyChars(i);
          if (i < LEARNER_TEXT.length) {
            timers.push(setTimeout(tick, 28));
          }
        };
        timers.push(setTimeout(tick, 60));
      }, 2200),
    );
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [inView, reduce]);

  return (
    <div ref={ref} className="space-y-3.5">
      {/* Tutor bubble — accent-tinted, italic. Same visual language as
          the lesson page's tutor message, so the panel reads as a real
          tutor exchange. */}
      <motion.div
        initial={reduce ? false : { opacity: 0.65, y: 6 }}
        animate={
          stage === "hidden"
            ? { opacity: 0, y: 6 }
            : { opacity: 1, y: 0 }
        }
        transition={{ duration: 0.42, ease: HOUSE_EASE }}
        className="rounded-xl border border-accent/25 bg-accent/[0.06] px-4 py-3 text-[14px] italic text-accent shadow-inner sm:text-[14.5px]"
      >
        <span className="not-italic select-none pr-2 text-faint">{">"}</span>
        {TUTOR_TEXT}
      </motion.div>

      {/* Learner-reply zone — flips between dot triad (typing) and the
          typewriter reply. The triad is the "you're thinking" beat;
          when it resolves into the reply, the user has formed an
          answer. Inverted visual weight (right-aligned, lighter
          background) mirrors a chat client. */}
      <div className="flex justify-end">
        <div className="min-h-[44px] min-w-[120px] max-w-[80%] rounded-xl border border-border/70 bg-elevated/70 px-4 py-3 text-right text-[14px] leading-snug text-ink/85 sm:text-[14.5px]">
          {stage === "typing" && <DotTriad />}
          {stage === "reply" && (
            <span style={{ whiteSpace: "pre-wrap" }}>
              {LEARNER_TEXT.slice(0, replyChars)}
              {!reduce && replyChars < LEARNER_TEXT.length && (
                <span className="ml-px inline-block animate-pulse align-baseline" style={{
                  width: "0.4em", height: "1em",
                  backgroundColor: "rgb(56 189 248)", opacity: 0.85,
                }} aria-hidden="true" />
              )}
            </span>
          )}
          {(stage === "hidden" || stage === "tutor") && (
            <span className="text-faint">&nbsp;</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DotTriad() {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label="Tutor is thinking">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-muted"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: i * 0.12,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}
