import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type SavedTutorMessage } from "../../../api/client";
import { SavedTutorAccordion } from "../../../components/SavedTutorAccordion";
import { UserMenu } from "../../../components/UserMenu";
import { Wordmark } from "../../../components/Wordmark";
import { loadCourse, loadLessonMeta } from "../content/courseLoader";

function groupKey(message: SavedTutorMessage): string {
  return message.courseId && message.lessonId
    ? `${message.courseId}/${message.lessonId}${message.exerciseId ? `/${message.exerciseId}` : ""}`
    : "editor";
}

function humanizeSlug(value: string): string {
  const words = value.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function SavedTutorNotesPage() {
  const nav = useNavigate();
  const [messages, setMessages] = useState<SavedTutorMessage[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({ editor: "Editor project" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listAllSavedTutorMessages()
      .then(async (result) => {
        const nextLabels: Record<string, string> = { editor: "Editor project" };
        const scoped = result.messages.filter(
          (message): message is SavedTutorMessage & { courseId: string; lessonId: string } =>
            !!message.courseId && !!message.lessonId,
        );
        await Promise.all([...new Map(scoped.map((message) => [groupKey(message), message])).entries()]
          .map(async ([key, message]) => {
            try {
              const [course, lesson] = await Promise.all([
                loadCourse(message.courseId),
                loadLessonMeta(message.courseId, message.lessonId),
              ]);
              nextLabels[key] = `${course.title} · ${lesson.title}${message.exerciseId ? " · Practice" : ""}`;
            } catch {
              nextLabels[key] = `${humanizeSlug(message.courseId)} · ${humanizeSlug(message.lessonId)}${message.exerciseId ? " · Practice" : ""}`;
            }
          }));
        setLabels(nextLabels);
        setMessages(result.messages);
      })
      .catch(() => setError("Saved notes could not be loaded. Try again."))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, SavedTutorMessage[]>();
    for (const message of messages) {
      const key = groupKey(message);
      map.set(key, [...(map.get(key) ?? []), message]);
    }
    return [...map.entries()];
  }, [messages]);

  const remove = (id: string) => {
    void api.deleteSavedTutorMessage(id).then(() => {
      setMessages((current) => current.filter((message) => message.id !== id));
    });
  };

  return (
    <div className="min-h-full bg-bg text-ink">
      <header className="flex min-h-16 items-center gap-3 border-b border-border bg-panel/90 px-4">
        <button type="button" onClick={() => nav(-1)} className="min-h-11 rounded-lg px-3 text-sm text-muted hover:bg-elevated hover:text-ink">← Back</button>
        <Wordmark size="sm" />
        <div className="ml-auto"><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Your study library</p>
        <h1 className="mt-2 font-display text-4xl font-semibold">Saved tutor notes</h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">Explanations you saved across lessons and the editor, kept with their original source context.</p>

        {loading && <div role="status" className="mt-8 text-sm text-muted">Loading saved notes…</div>}
        {error && <div role="alert" className="mt-8 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">{error}</div>}
        {!loading && !error && groups.length === 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-panel p-6">
            <h2 className="text-lg font-semibold">Nothing saved yet</h2>
            <p className="mt-2 text-sm text-muted">Bookmark a useful tutor response and it will appear here.</p>
          </section>
        )}
        <div className="mt-8 space-y-4">
          {groups.map(([key, items]) => (
            <SavedTutorAccordion
              key={key}
              messages={items}
              loading={false}
              label={labels[key] ?? humanizeSlug(key.replaceAll("/", " · "))}
              onRemove={remove}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
