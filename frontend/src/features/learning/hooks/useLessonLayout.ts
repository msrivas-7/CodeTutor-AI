import { useEffect, useRef, useState } from "react";
import { usePreferencesStore } from "../../../state/preferencesStore";
import { usePersistedFlag, usePersistedNumber, useNarrowViewport } from "../../../util/layoutPrefs";
import { COACH_AUTO_OPEN_MS } from "../../../util/timings";

const LS_OUT_H = "ui:lesson:outputH";
const LS_INSTR_W = "ui:lesson:instrW";
const LS_TUTOR_W = "ui:lesson:tutorW";
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
}

export function useLessonLayout({ lessonReady }: UseLessonLayoutArgs) {
  const [outputH, setOutputH] = usePersistedNumber(LS_OUT_H, LESSON_LAYOUT_DEFAULTS.out);
  const [instrW, setInstrW] = usePersistedNumber(LS_INSTR_W, LESSON_LAYOUT_DEFAULTS.instr);
  const [tutorW, setTutorW] = usePersistedNumber(LS_TUTOR_W, LESSON_LAYOUT_DEFAULTS.tutor);
  const [instrCollapsed, setInstrCollapsed] = usePersistedFlag(LS_INSTR_COLLAPSED, false);
  const [tutorCollapsed, setTutorCollapsed] = usePersistedFlag(LS_TUTOR_COLLAPSED, false);

  // A20: below 1024 px three columns starve the editor. Auto-collapse the
  // tutor rail once on mount — instructions + editor stay visible. Users
  // can still expand the tutor manually if they want it.
  const narrow = useNarrowViewport(1024);
  const autoCollapsedRef = useRef(false);
  useEffect(() => {
    if (narrow && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true;
      setTutorCollapsed(true);
    }
  }, [narrow, setTutorCollapsed]);

  const [showSettings, setShowSettings] = useState(false);
  const [resetMenuOpen, setResetMenuOpen] = useState(false);
  const [showCoach, setShowCoach] = useState(false);

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

  const workspaceCoachDone = usePreferencesStore((s) => s.workspaceCoachDone);
  useEffect(() => {
    if (!lessonReady) return;
    if (!workspaceCoachDone) {
      const timer = setTimeout(() => setShowCoach(true), COACH_AUTO_OPEN_MS);
      return () => clearTimeout(timer);
    }
  }, [lessonReady, workspaceCoachDone]);

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
    showCoach,
    setShowCoach,
    resetMenuRef,
    instrRef,
    editorRef,
    runBtnRef,
    outputRef,
    checkBtnRef,
    tutorRef,
  };
}
