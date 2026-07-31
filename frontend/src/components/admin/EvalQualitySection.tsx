import { useEffect, useState } from "react";
import {
  api,
  type AdminEvalSample,
  type AdminEvalSynthesisQueueItem,
} from "../../api/client";

type Verdict = "pass" | "fail" | "ambiguous" | "reject_privacy";
type Disposition = "pending_review" | "review_complete" | "synthesis_queued" | "rejected";
type IssueCode =
  | "factual_error"
  | "unhelpful"
  | "too_much_answer"
  | "poor_grounding"
  | "unsafe_content"
  | "redaction_concern"
  | "ambiguous_rubric";

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "Pass",
  fail: "Fail",
  ambiguous: "Ambiguous",
  reject_privacy: "Reject: privacy",
};

const ISSUE_LABEL: Record<Exclude<IssueCode, "redaction_concern">, string> = {
  factual_error: "Factual error",
  unhelpful: "Unhelpful",
  too_much_answer: "Gives away too much",
  poor_grounding: "Poor grounding",
  unsafe_content: "Unsafe content",
  ambiguous_rubric: "Rubric is ambiguous",
};

export function EvalQualitySection() {
  const [disposition, setDisposition] = useState<Disposition>("pending_review");
  const [samples, setSamples] = useState<AdminEvalSample[]>([]);
  const [queue, setQueue] = useState<AdminEvalSynthesisQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (nextDisposition = disposition) => {
    setLoading(true);
    setError(null);
    try {
      const [sampleResult, queueResult] = await Promise.all([
        api.adminListEvalSamples(nextDisposition),
        api.adminListEvalSynthesisQueue(),
      ]);
      setSamples(sampleResult.samples);
      setQueue(queueResult.items);
    } catch {
      setError("Eval review data is unavailable. Nothing was changed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(disposition);
  }, [disposition]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="mx-auto max-w-6xl space-y-8" aria-labelledby="eval-quality-title">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
          Governed quality loop
        </p>
        <h1 id="eval-quality-title" className="font-display text-3xl font-semibold text-ink">
          Eval quality
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Review only pre-insert-redacted anonymous samples. Two distinct reviewers must
          disagree before the weekly job creates a synthesis item. Never copy sampled text
          into the golden holdout; author a new synthetic case from the pattern.
        </p>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-panel p-4">
        <label className="space-y-1 text-xs font-semibold text-ink">
          Sample lane
          <select
            value={disposition}
            onChange={(event) => setDisposition(event.target.value as Disposition)}
            className="block min-h-11 min-w-52 cursor-pointer rounded-md border border-border bg-elevated px-3 text-sm font-normal text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="pending_review">Pending review</option>
            <option value="review_complete">Review complete</option>
            <option value="synthesis_queued">Queued for synthesis</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-11 cursor-pointer rounded-md border border-border bg-elevated px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-accent/60 hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-4" aria-busy={loading}>
        {!loading && samples.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
            No unexpired samples in this lane.
          </div>
        )}
        {samples.map((sample) => (
          <EvalSampleCard key={sample.id} sample={sample} onSaved={() => load()} />
        ))}
      </div>

      <section className="space-y-4" aria-labelledby="synthesis-title">
        <div>
          <h2 id="synthesis-title" className="font-display text-2xl font-semibold text-ink">
            Weekly synthesis queue
          </h2>
          <p className="mt-1 text-sm text-muted">
            Only two-reviewer disagreements appear here. Resolve an item after its independent
            synthetic case is committed, or reject it with a reason.
          </p>
        </div>
        {loading ? (
          <div role="status" className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">
            Loading synthesis queue…
          </div>
        ) : queue.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">
            No disagreement patterns are waiting for synthesis.
          </div>
        ) : (
          <div className="grid gap-3">
            {queue.map((item) => <SynthesisQueueCard key={item.id} item={item} onSaved={() => load()} />)}
          </div>
        )}
      </section>
    </section>
  );
}

function EvalSampleCard({ sample, onSaved }: { sample: AdminEvalSample; onSaved: () => Promise<void> }) {
  const [verdict, setVerdict] = useState<Verdict>("pass");
  const [issueCode, setIssueCode] = useState<Exclude<IssueCode, "redaction_concern">>("factual_error");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminReviewEvalSample(sample.id, {
        verdict,
        issueCodes: verdict === "pass"
          ? []
          : verdict === "reject_privacy"
            ? ["redaction_concern"]
            : [issueCode],
        note: note.trim() || null,
      });
      await onSaved();
    } catch {
      setError("Review was not saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="rounded-xl border border-border bg-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span className="rounded-full bg-accent/10 px-2 py-1 font-semibold text-accent">{sample.intent}</span>
        <span>{sample.model}</span>
        <span aria-hidden="true">·</span>
        <span>{sample.reviewCount} review{sample.reviewCount === 1 ? "" : "s"}</span>
        <span aria-hidden="true">·</span>
        <span>expires {new Date(sample.expiresAt).toLocaleDateString()}</span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <TextBlock label="Redacted learner turn" value={sample.questionRedacted} />
        <TextBlock label="Redacted tutor response" value={sample.responseRedacted} />
      </div>
      {sample.disposition === "pending_review" ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,180px)_minmax(0,180px)_minmax(0,1fr)_auto] lg:items-end">
            <label className="space-y-1 text-xs font-semibold text-ink">
              Your independent verdict
              <select
                value={verdict}
                onChange={(event) => setVerdict(event.target.value as Verdict)}
                className="block min-h-11 w-full cursor-pointer rounded-md border border-border bg-elevated px-3 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {(Object.keys(VERDICT_LABEL) as Verdict[]).map((value) => (
                  <option key={value} value={value}>{VERDICT_LABEL[value]}</option>
                ))}
              </select>
            </label>
            {verdict !== "pass" && verdict !== "reject_privacy" ? (
              <label className="space-y-1 text-xs font-semibold text-ink">
                Primary issue
                <select
                  value={issueCode}
                  onChange={(event) => setIssueCode(event.target.value as Exclude<IssueCode, "redaction_concern">)}
                  className="block min-h-11 w-full cursor-pointer rounded-md border border-border bg-elevated px-3 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {(Object.keys(ISSUE_LABEL) as Array<Exclude<IssueCode, "redaction_concern">>).map((value) => (
                    <option key={value} value={value}>{ISSUE_LABEL[value]}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="hidden lg:block" aria-hidden="true" />
            )}
            <label className="space-y-1 text-xs font-semibold text-ink">
              Private reviewer note <span className="font-normal text-muted">(optional)</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                className="block min-h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="min-h-11 cursor-pointer rounded-md bg-accent px-4 text-sm font-semibold text-bg transition-colors duration-200 hover:bg-accentMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save review"}
            </button>
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        </>
      ) : (
        <p className="mt-4 rounded-md bg-elevated px-3 py-2 text-xs text-muted">
          Independent review is closed for this sample.
        </p>
      )}
    </article>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-bg/60 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</h3>
      <p className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink">{value}</p>
    </div>
  );
}

function SynthesisQueueCard({ item, onSaved }: { item: AdminEvalSynthesisQueueItem; onSaved: () => Promise<void> }) {
  const [caseId, setCaseId] = useState(item.syntheticCaseId ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (state: "synthetic_case_authored" | "rejected") => {
    if (reason.trim().length < 4 || (state === "synthetic_case_authored" && caseId.trim().length < 3)) {
      setError("Add a case ID and a short reason before resolving this item.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.adminResolveEvalSynthesisQueue(item.id, {
        state,
        syntheticCaseId: state === "synthetic_case_authored" ? caseId.trim() : null,
        reason: reason.trim(),
      });
      await onSaved();
    } catch {
      setError("Queue resolution was not saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-mono">sample {item.sampleId.slice(0, 8)}</span>
        <span>{item.reviewCount} independent reviews</span>
        <span>{item.distinctVerdictCount} verdicts</span>
        <span>{item.state.replaceAll("_", " ")}</span>
      </div>
      <p className="mt-2 break-all font-mono text-[11px] text-faint">
        source pattern {item.sourceFingerprint}
      </p>
      {item.state === "pending_synthesis" && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs font-semibold text-ink">
            Synthetic golden case ID
            <input value={caseId} onChange={(event) => setCaseId(event.target.value)} className="block min-h-11 w-full rounded-md border border-border bg-elevated px-3 font-mono text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder="b8_pattern_example" />
          </label>
          <label className="space-y-1 text-xs font-semibold text-ink">
            Resolution reason
            <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} className="block min-h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
          </label>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button type="button" disabled={saving} onClick={() => void resolve("synthetic_case_authored")} className="min-h-11 cursor-pointer rounded-md bg-accent px-4 text-sm font-semibold text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60">Mark synthetic case authored</button>
            <button type="button" disabled={saving} onClick={() => void resolve("rejected")} className="min-h-11 cursor-pointer rounded-md border border-danger/40 px-4 text-sm font-semibold text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-wait disabled:opacity-60">Reject pattern</button>
          </div>
          {error && <p role="alert" className="text-sm text-danger md:col-span-2">{error}</p>}
        </div>
      )}
    </article>
  );
}
