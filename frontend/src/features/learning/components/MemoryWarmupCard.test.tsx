import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemoryWarmupCard } from "./MemoryWarmupCard";
import type { MemoryWarmupPrompt } from "../../../api/client";

const warmup: MemoryWarmupPrompt = {
  episodeId: "00000000-0000-4000-8000-000000000001",
  courseId: "python-fundamentals",
  lessonId: "input-output",
  warmupId: "join-text-and-a-number",
  warmupVersion: 1,
  conceptTags: ["str", "string-concat"],
  prompt: "If `age = 12`, which expression creates `Age: 12`?",
  choices: ["\"Age: \" + str(age)", "\"Age: \" + age"],
  attemptCount: 0,
};

const base = {
  loading: false,
  warmup,
  answer: null,
  submitting: false,
  loadError: null,
  answerError: null,
  onSubmit: vi.fn(async () => {}),
  onRetryAnswer: vi.fn(async () => {}),
  onRetryLoad: vi.fn(),
  onContinue: vi.fn(),
};

describe("MemoryWarmupCard", () => {
  it("frames recall as one course-checked question with accessible choices", () => {
    const html = renderToStaticMarkup(<MemoryWarmupCard {...base} />);

    expect(html).toContain("Quick recall · one question");
    expect(html).toContain("No AI · checked by the course");
    expect(html).toContain('type="radio"');
    expect(html).toContain("Check my recall");
    expect(html).not.toContain("correctIndex");
    expect(html).not.toContain("Convert the integer");
  });

  it("describes feedback-supported recall honestly after a wrong answer", () => {
    const html = renderToStaticMarkup(
      <MemoryWarmupCard
        {...base}
        answer={{
          episodeId: warmup.episodeId,
          isCorrect: false,
          attemptNumber: 1,
          completed: false,
          firstAttemptCorrect: false,
          explanation: "Convert the integer before joining it to text.",
        }}
      />,
    );

    expect(html).toContain("Not quite");
    expect(html).toContain("Feedback-supported recall is recorded separately");
    expect(html).toContain("Convert the integer");
  });

  it("distinguishes independent success from success after feedback", () => {
    const independent = renderToStaticMarkup(
      <MemoryWarmupCard
        {...base}
        answer={{
          episodeId: warmup.episodeId,
          isCorrect: true,
          attemptNumber: 1,
          completed: true,
          firstAttemptCorrect: true,
          explanation: "Correct.",
        }}
      />,
    );
    const supported = renderToStaticMarkup(
      <MemoryWarmupCard
        {...base}
        answer={{
          episodeId: warmup.episodeId,
          isCorrect: true,
          attemptNumber: 2,
          completed: true,
          firstAttemptCorrect: false,
          explanation: "Correct.",
        }}
      />,
    );

    expect(independent).toContain("recalled it independently");
    expect(supported).toContain("with feedback");
    expect(independent).toContain("Continue to lesson");
  });

  it("fails open with retry and continue actions when loading fails", () => {
    const html = renderToStaticMarkup(
      <MemoryWarmupCard
        {...base}
        warmup={null}
        loadError="Memory service unavailable."
      />,
    );

    expect(html).toContain("Memory check unavailable");
    expect(html).toContain("Try again");
    expect(html).toContain("Continue to lesson");
  });
});
