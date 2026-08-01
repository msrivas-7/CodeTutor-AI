import { useCallback, useEffect, useRef, useState } from "react";
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

  // A20: below 1024 px three columns starve the editor. Auto-collapse the
  // tutor rail once on mount — instructions + editor stay visible. Users
  // can still expand the tutor manually if they want it.
  //
  // Phase A — A2 device-contract override: lesson 1 (python-fundamentals
  // / hello-world) is the cinematic + scripted-tutor lesson. Collapsing
  // the tutor on narrow would silently hide the very thing the
  // cinematic just promised. On lesson 1 + narrow, flip the auto-
  // collapse: keep the tutor OPEN, collapse INSTRUCTIONS instead (the
  // prose lives in the tutor's first scripted turns anyway). Runs once
  // per mount, same as the legacy heuristic.
  // Three full panes are already cramped on ordinary 1024-1280px laptop
  // windows. At this boundary, opening either help rail closes the other so
  // the editor/output column always remains a real working surface.
  const narrow = useNarrowViewport(1280);
  const autoCollapsedRef = useRef(false);
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
    if (!narrow || autoCollapsedRef.current) return;
    autoCollapsedRef.current = true;
    // Note: these setters propagate to localStorage via
    // useLocalStorageFlag — same persistence shape as the legacy
    // auto-collapse heuristic. A learner who manually re-expands the
    // collapsed panel after the auto-fire keeps that override on
    // subsequent visits within the same screen-class.
    if (isLessonOneNarrow) {
      setTutorCollapsed(false);
      setInstrCollapsed(true);
    } else {
      setTutorCollapsed(true);
    }
  }, [narrow, isLessonOneNarrow, setTutorCollapsed, setInstrCollapsed]);

  const [showSettings, setShowSettings] = useState(false);
  const [resetMenuOpen, setResetMenuOpen] = useState(false);

  const resetMenuRef = useRef<HTMLDivElement>(null);
  const instrRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const runBtnRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const checkBtnRef = useRef<HTMLButtonElement>(null);
  const tutorRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!resetMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (resetMenuRef.current && !resetMenuRef.current.contains(e.target as Node)) {
        setResetMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setResetMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [resetMenuOpen]);

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
    resetMenuRef,
    instrRef,
    editorRef,
    runBtnRef,
    outputRef,
    checkBtnRef,
    tutorRef,
  };
}
