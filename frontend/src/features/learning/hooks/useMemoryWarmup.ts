import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type MemoryWarmupAnswer,
  type MemoryWarmupPrompt,
} from "../../../api/client";

interface PendingAnswer {
  episodeId: string;
  requestId: string;
  choiceIndex: number;
}

export interface MemoryWarmupController {
  blocking: boolean;
  loading: boolean;
  warmup: MemoryWarmupPrompt | null;
  answer: MemoryWarmupAnswer | null;
  submitting: boolean;
  loadError: string | null;
  answerError: string | null;
  submitChoice: (choiceIndex: number) => Promise<void>;
  retryAnswer: () => Promise<void>;
  retryLoad: () => void;
  continueToLesson: () => void;
}

export function useMemoryWarmup({
  enabled,
  courseId,
  lessonId,
}: {
  enabled: boolean;
  courseId: string;
  lessonId: string;
}): MemoryWarmupController {
  const [loading, setLoading] = useState(enabled);
  const [warmup, setWarmup] = useState<MemoryWarmupPrompt | null>(null);
  const [answer, setAnswer] = useState<MemoryWarmupAnswer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(!enabled);
  const generationRef = useRef(0);
  const pendingAnswerRef = useRef<PendingAnswer | null>(null);

  const load = useCallback(() => {
    const generation = ++generationRef.current;
    pendingAnswerRef.current = null;
    setAnswer(null);
    setAnswerError(null);
    setLoadError(null);
    if (!enabled || !courseId || !lessonId) {
      setLoading(false);
      setWarmup(null);
      setDismissed(true);
      return;
    }
    setDismissed(false);
    setLoading(true);
    void api
      .getMemoryWarmup(courseId, lessonId)
      .then(({ warmup: nextWarmup }) => {
        if (generationRef.current !== generation) return;
        setWarmup(nextWarmup);
        setDismissed(nextWarmup === null);
      })
      .catch(() => {
        if (generationRef.current !== generation) return;
        setWarmup(null);
        setLoadError(
          "We couldn't prepare this memory check. Your lesson is still available.",
        );
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false);
      });
  }, [enabled, courseId, lessonId]);

  useEffect(() => {
    load();
    return () => {
      generationRef.current += 1;
    };
  }, [load]);

  const sendAnswer = useCallback(
    async (pending: PendingAnswer) => {
      const generation = generationRef.current;
      setSubmitting(true);
      setAnswerError(null);
      try {
        const response = await api.answerMemoryWarmup(pending.episodeId, {
          requestId: pending.requestId,
          choiceIndex: pending.choiceIndex,
        });
        if (generationRef.current !== generation) return;
        pendingAnswerRef.current = null;
        setAnswer(response);
      } catch {
        if (generationRef.current !== generation) return;
        setAnswerError(
          "We couldn't check that answer. Retry safely, or continue to the lesson.",
        );
      } finally {
        if (generationRef.current === generation) setSubmitting(false);
      }
    },
    [],
  );

  const submitChoice = useCallback(
    async (choiceIndex: number) => {
      if (!warmup || submitting || answer?.completed) return;
      const pending: PendingAnswer = {
        episodeId: warmup.episodeId,
        requestId: crypto.randomUUID(),
        choiceIndex,
      };
      pendingAnswerRef.current = pending;
      await sendAnswer(pending);
    },
    [warmup, submitting, answer?.completed, sendAnswer],
  );

  const retryAnswer = useCallback(async () => {
    const pending = pendingAnswerRef.current;
    if (!pending || submitting) return;
    await sendAnswer(pending);
  }, [sendAnswer, submitting]);

  const continueToLesson = useCallback(() => {
    pendingAnswerRef.current = null;
    setDismissed(true);
  }, []);

  return {
    blocking:
      enabled &&
      !dismissed &&
      (loading || warmup !== null || loadError !== null || answerError !== null),
    loading,
    warmup,
    answer,
    submitting,
    loadError,
    answerError,
    submitChoice,
    retryAnswer,
    retryLoad: load,
    continueToLesson,
  };
}
