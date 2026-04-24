import type { User } from "@supabase/supabase-js";

// Supabase OAuth providers deposit the learner's name in different
// corners of user_metadata. Our password signup writes first_name +
// last_name explicitly; Google populates given_name / family_name;
// GitHub returns a single name field. Pick the first one that has a
// non-empty string and fall back to "there" so the greeting still
// reads naturally ("Hi there.") when metadata is missing entirely.
//
// Intentionally small + pure so tests don't need a Supabase shell.
export function resolveFirstName(user: User | null): string {
  const m = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const candidates: Array<unknown> = [
    m.first_name, // our own signup form
    m.given_name, // Google OAuth
    typeof m.name === "string" ? m.name.split(/\s+/)[0] : null, // GitHub OAuth
    typeof m.full_name === "string" ? m.full_name.split(/\s+/)[0] : null,
  ];
  const first = candidates.find(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return first ? first.trim() : "there";
}
