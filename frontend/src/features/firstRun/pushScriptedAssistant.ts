import { useAIStore } from "../../state/aiStore";

// Stream a canned tutor turn into the existing pending/history pipeline
// so the scripted narration renders with the same chrome as real
// tutor replies (ThinkingSkeleton → TutorResponseView crossfade,
// typewriter caret on the tail, etc). The content is sliced
// character-by-character and fed through `updateStream` at ~30 ms/char
// so the visual cadence matches real SSE output.
//
// Returns a cancellable promise-like object. Caller's step runner
// awaits `done` to know when to advance; calling `cancel()` halts the
// stream mid-typing + commits whatever landed up to that point (so a
// user clicking skip mid-greeting still sees a coherent-looking turn
// in history).
//
// Scripted turns are surfaced in the `summary` section — a
// conversational, non-code-focused channel that renders naturally
// for a first-turn greeting. Real tutor replies use `explain` /
// `diagnose` / `walkthrough` based on classifier output; we're
// deliberately narrower here so the scripted turns read as
// "warm hello" not "tutorial."

export interface ScriptedAssistantHandle {
  done: Promise<void>;
  cancel: () => void;
}

interface Options {
  /** Characters per ms. Default 30 matches observed SSE cadence. */
  charIntervalMs?: number;
  /** When true, set `asking: true` on the aiStore while typing so the
   *  existing AssistantPanel thinking→streaming swap fires as if real
   *  inference were in flight. Defaults to true. */
  flipAsking?: boolean;
}

export function pushScriptedAssistant(
  content: string,
  options: Options = {},
): ScriptedAssistantHandle {
  // 50 ms/char default cadence — slower than 30 ms so each character
  // is visibly distinct as it lands, similar to the hard-mode
  // typewriter on the /welcome cinematic. Matches the deliberate
  // "a person is typing to you" feel.
  const { charIntervalMs = 50, flipAsking = true } = options;
  const store = useAIStore.getState();

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentLength = 0;

  if (flipAsking) store.setAsking(true);
  // startScriptedStream seeds pending AND flags pendingScripted=true,
  // so the AssistantPanel renderer knows this turn wants the
  // cinematic-voice presentation (Fraunces, larger, typewriter feel).
  store.startScriptedStream();
  // Seed pending immediately with empty content so the
  // <ThinkingSkeleton /> state briefly renders and then transitions to
  // <TutorResponseView /> on the first char — matches the shape of a
  // real SSE first-token transition.
  store.updateStream("", { summary: "" });

  const done = new Promise<void>((resolve) => {
    const tick = () => {
      if (cancelled) {
        commitFinal();
        resolve();
        return;
      }
      currentLength += 1;
      const partial = content.slice(0, currentLength);
      store.updateStream(partial, { summary: partial });
      if (currentLength >= content.length) {
        commitFinal();
        resolve();
        return;
      }
      timer = setTimeout(tick, charIntervalMs);
    };

    const commitFinal = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const final = content.slice(0, currentLength);
      // pushAssistant appends the turn to history with no usage delta
      // — scripted turns don't hit the API and shouldn't count
      // against the learner's free-tier quota. The `scripted: true`
      // meta flag travels with the message so renderers can keep
      // cinematic-voice styling even after it's been committed to
      // history (not just during the streaming phase).
      store.pushAssistant(final, { summary: final }, undefined, {
        scripted: true,
      });
      store.clearStream();
      if (flipAsking) store.setAsking(false);
    };

    timer = setTimeout(tick, charIntervalMs);
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
    },
  };
}
