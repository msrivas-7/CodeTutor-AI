import type { AIMessage } from "../types";

// Soft caps for summarize-and-continue.
// KEEP_RECENT: we always ship the last N turns verbatim (they're where the
// conversation is actually alive). SUMMARIZE_TRIGGER: once the conversation
// grows past this many turns beyond what we've already summarized, it's worth
// a round-trip to recompress.
export const KEEP_RECENT = 6;
export const SUMMARIZE_TRIGGER = 12;

// Decide what to send to the tutor for this turn, given the full UI history
// and whatever summary we already have cached. Pure function — the caller
// handles the async summarize roundtrip separately and feeds the result back
// into a subsequent call.
//
// Returns:
// - `historyForSend`: the exact AIMessage[] to post to /api/ai/ask/stream.
//   If we have a summary, its head is a synthetic "assistant" turn whose
//   content starts with "[PRIOR CONTEXT SUMMARY] …".
// - `shouldSummarize`: true if the caller should fire a summarize request
//   before (or during) the ask. `summarizeSlice` is the portion of the
//   original history that still needs compressing.
// - `nextSummarizedThrough`: the new `summarizedThrough` value to commit
//   once the summarize round-trip completes.
export interface PlanSendInput {
  history: AIMessage[];
  summary: string | null;
  summarizedThrough: number;
}

export interface PlanSendOutput {
  historyForSend: AIMessage[];
  shouldSummarize: boolean;
  summarizeSlice: AIMessage[];
  nextSummarizedThrough: number;
}

function summaryHead(summary: string): AIMessage {
  return {
    role: "assistant",
    content: `[PRIOR CONTEXT SUMMARY] ${summary}`,
  };
}

export function planSend(input: PlanSendInput): PlanSendOutput {
  const { history, summary, summarizedThrough } = input;
  const total = history.length;

  // Small conversation: nothing to do, just send the whole thing.
  if (total <= SUMMARIZE_TRIGGER) {
    const head: AIMessage[] = summary ? [summaryHead(summary)] : [];
    return {
      historyForSend: [...head, ...history.slice(summarizedThrough)],
      shouldSummarize: false,
      summarizeSlice: [],
      nextSummarizedThrough: summarizedThrough,
    };
  }

  // Long conversation: recompress the older portion, keep the recent tail
  // verbatim. summarizeSlice always ends KEEP_RECENT turns before the tip.
  const cutoff = total - KEEP_RECENT;
  const shouldSummarize = cutoff > summarizedThrough;
  const summarizeSlice = shouldSummarize
    ? history.slice(0, cutoff)
    : [];
  const head: AIMessage[] = summary ? [summaryHead(summary)] : [];
  // If we need to summarize, the historyForSend for the CURRENT turn still
  // falls back to the old (or null) summary + recent tail — the new summary
  // lands on the NEXT turn. This keeps the tutor responsive even if the
  // summarize round-trip is slow or fails.
  return {
    historyForSend: [...head, ...history.slice(summarizedThrough)],
    shouldSummarize,
    summarizeSlice,
    nextSummarizedThrough: shouldSummarize ? cutoff : summarizedThrough,
  };
}
