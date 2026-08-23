import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  useLocalStorageFlag,
  usePersistedNumber,
  useNarrowViewport,
} from "../../../util/layoutPrefs";

const LS_OUT_H = "ui:lesson:outputH";
const LS_INSTR_W = "ui:lesson:instrW";
const LS_TUTOR_W = "ui:lesson:tutorW";
// Phase 27 bug fix: collapse flags moved from server-persisted
// uiLayout to localStorage. A user collapsing on phone (or A20's
// narrow-viewport auto-collapse firing on phone) was leaking state
// to desktop sessions — a new learner opening their laptop saw a
// hidden tutor panel + hidden instructions, no obvious recovery.
// Device-local flags fix that. Same "ui:lesson:" prefix kept for
// DevTools grep-ability.
const LS_INSTR_COLLAPSED = "ui:lesson:instrCollapsed";
const LS_TUTOR_COLLAPSED = "ui:lesson:tutorCollapsed";

export const LESSON_LAYOUT_DEFAULTS = {
  out: 200,
  instr: 320,
  tutor: 340,
};

export const LESSON_LAYOUT_BOUNDS = {
  out: [80, 500] as const,
  instr: [240, 520] as const,
  tutor: [260, 600] as const,
};

export interface UseLessonLayoutArgs {
  // Once the lesson has loaded, the coach may auto-open after a delay. The
  // hook stays inert until a lesson is present so we don't show the coach
  // over a blank skeleton.
  lessonReady: boolean;
  // Phase A — A2 (device contract): the auto-collapse-tutor heuristic
  // doesn't fit lesson 1 on a narrow screen. Lesson 1's whole job is
  // the scripted tutor walkthrough — collapsing it hides the
  // experience the cinematic just promised. Pass the (course, lesson)
  // tuple so the hook can override: on lesson 1 + narrow, the TUTOR
  // stays open and the INSTRUCTIONS collapse instead. Other lessons
  // keep the existing auto-collapse-tutor behavior.
  courseId?: string | null;
  lessonId?: string | null;
}

export function useLessonLayout({ courseId, lessonId }: UseLessonLayoutArgs) {
  const [outputH, setOutputH] = usePersistedNumber(LS_OUT_H, LESSON_LAYOUT_DEFAULTS.out);
  const [instrW, setInstrW] = usePersistedNumber(LS_INSTR_W, LESSON_LAYOUT_DEFAULTS.instr);
  const [tutorW, setTutorW] = usePersistedNumber(LS_TUTOR_W, LESSON_LAYOUT_DEFAULTS.tutor);
  const [instrCollapsed, setInstrCollapsedRaw] = useLocalStorageFlag(LS_INSTR_COLLAPSED, false);
  const [tutorCollapsed, setTutorCollapsedRaw] = useLocalStorageFlag(LS_TUTOR_COLLAPSED, false);

  const instrRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const runBtnRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const checkBtnRef = useRef<HTMLButtonElement>(null);
  const tutorRef = useRef<HTMLElement>(null);
  const instructionsRestoreRef = useRef<HTMLButtonElement>(null);
  const tutorRestoreRef = useRef<HTMLButtonElement>(null);
  const autoCollapseFocusPendingRef = useRef<"instructions" | "tutor" | null>(null);

  // A20: below the narrow-laptop boundary three columns starve the editor.
  // Keep one help rail collapsed whenever that invariant becomes true —
  // including a live resize from a wide layout where both rails were open.
  // Users can still trade Instructions and Tutor through their visible
  // controls; the setters below close the opposing rail atomically.
  //
  // Phase A — A2 device-contract override: lesson 1 (python-fundamentals
  // / hello-world) is the cinematic + scripted-tutor lesson. Collapsing
  // the tutor on narrow would silently hide the very thing the
  // cinematic just promised. On lesson 1 + narrow, flip the auto-
  // collapse: keep the tutor OPEN, collapse INSTRUCTIONS instead (the
  // prose lives in the tutor's first scripted turns anyway). Runs once
  // per mount, same as the legacy heuristic.
  // Three full panes are already cramped on ordinary 1024-1366px laptop
  // windows, especially after preserving readable type and 44px actions.
  // Through the common 1366px laptop width, opening either help rail closes
  // the other so the editor/output column remains a real working surface.
  // At 1440px and above both rails have enough room to coexist.
  const narrow = useNarrowViewport(1366);
  const isLessonOneNarrow =
    narrow &&
    courseId === "python-fundamentals" &&
    lessonId === "hello-world";

  // At narrow laptop/tablet widths, opening one help rail closes the other.
  // Secondary surfaces may trade places, but they can never squeeze the code
  // editor down to an unusable sliver by remaining open together.
  const setInstrCollapsed = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (next) => {
      const resolved = typeof next === "function" ? next(instrCollapsed) : next;
      if (narrow && !resolved) setTutorCollapsedRaw(true);
      setInstrCollapsedRaw(resolved);
    },
    [instrCollapsed, narrow, setInstrCollapsedRaw, setTutorCollapsedRaw],
  );
  const setTutorCollapsed = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (next) => {
      const resolved = typeof next === "function" ? next(tutorCollapsed) : next;
      if (narrow && !resolved) setInstrCollapsedRaw(true);
      setTutorCollapsedRaw(resolved);
    },
    [narrow, tutorCollapsed, setInstrCollapsedRaw, setTutorCollapsedRaw],
  );
  useEffect(() => {
    if (!narrow || instrCollapsed || tutorCollapsed) return;

    const activeElement = document.activeElement;
    const focusWasInCollapsingRail =
      activeElement instanceof HTMLElement &&
      (isLessonOneNarrow
        ? instrRef.current?.contains(activeElement) === true
        : tutorRef.current?.contains(activeElement) === true);
    if (focusWasInCollapsingRail) {
      autoCollapseFocusPendingRef.current = isLessonOneNarrow
        ? "instructions"
        : "tutor";
    }

    // Crossing from a wide viewport can carry two open rails into a narrow
    // render. The previous one-shot guard could already be consumed by an
    // earlier narrow state, leaving Monaco with only a few pixels. Enforce
    // the geometry invariant from the current state instead of mount history.
    // Lesson 1 keeps Tutor (the promised guided surface); other lessons keep
    // Instructions. Raw setters avoid briefly reopening the opposing rail.
    if (isLessonOneNarrow) setInstrCollapsedRaw(true);
    else setTutorCollapsedRaw(true);
  }, [
    narrow,
    isLessonOneNarrow,
    instrCollapsed,
    tutorCollapsed,
    setInstrCollapsedRaw,
    setTutorCollapsedRaw,
  ]);

  useLayoutEffect(() => {
    const collapsedRail = autoCollapseFocusPendingRef.current;
    if (!collapsedRail) return;

    let frame: number | null = null;
    let attempts = 0;
    const restoreCollapsedRailFocus = () => {
      const target =
        collapsedRail === "instructions"
          ? instructionsRestoreRef.current
          : tutorRestoreRef.current;
      if (target && document.contains(target)) {
        target.focus({ preventScroll: true });
        if (document.activeElement === target) {
          autoCollapseFocusPendingRef.current = null;
          return;
        }
      }

      attempts += 1;
      if (attempts < 4) frame = requestAnimationFrame(restoreCollapsedRailFocus);
    };

    // `inert` removes the collapsed rail from the focus order. Run after the
    // restore control mounts, then retry across the animation boundary so a
    // live resize never strands keyboard focus in hidden content or BODY.
    restoreCollapsedRailFocus();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [instrCollapsed, tutorCollapsed]);

  const [showSettings, setShowSettings] = useState(false);
  const [resetMenuOpen, setResetMenuOpen] = useState(false);

  return {
    outputH,
    setOutputH,
    instrW,
    setInstrW,
    tutorW,
    setTutorW,
    instrCollapsed,
    setInstrCollapsed,
    tutorCollapsed,
    setTutorCollapsed,
    showSettings,
    setShowSettings,
    resetMenuOpen,
    setResetMenuOpen,
    instrRef,
    editorRef,
    runBtnRef,
    outputRef,
    checkBtnRef,
    tutorRef,
    instructionsRestoreRef,
    tutorRestoreRef,
  };
}
