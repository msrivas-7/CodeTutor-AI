export const DISTRIBUTION_ATTRIBUTION_KEY =
  "codetutor.distribution.firstTouch.v1";

export const DISTRIBUTION_QUERY_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "share_ref",
] as const;

export type AcquisitionSource = "direct" | "organic" | "share";
export type AcquisitionMedium =
  | "lesson_page"
  | "category_page"
  | "lesson_share";

export type DistributionAttribution =
  | { source: "direct" }
  | {
      source: "organic";
      medium: "lesson_page" | "category_page";
      campaign: string;
      content?: string;
    }
  | {
      source: "share";
      medium: "lesson_share";
      campaign: string;
      content: string;
      shareRef: string;
    };

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHARE_REF = /^[a-z2-9]{12}$/;

function boundedSlug(value: string | null): string | null {
  if (!value || !SLUG.test(value)) return null;
  return value;
}

/**
 * Parse only acquisition values that CodeTutor itself emits. Arbitrary UTM
 * text and raw referrers are intentionally ignored rather than normalized
 * into a free-text analytics dimension.
 */
export function parseDistributionAttribution(
  search: string | URLSearchParams,
): DistributionAttribution | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const source = params.get("utm_source");
  const medium = params.get("utm_medium");
  const campaign = boundedSlug(params.get("utm_campaign"));
  const content = boundedSlug(params.get("utm_content"));

  if (
    source === "organic" &&
    (medium === "lesson_page" || medium === "category_page") &&
    campaign
  ) {
    return {
      source,
      medium,
      campaign,
      ...(content ? { content } : {}),
    };
  }

  const shareRef = params.get("share_ref");
  if (
    source === "share" &&
    medium === "lesson_share" &&
    campaign &&
    content &&
    shareRef &&
    SHARE_REF.test(shareRef)
  ) {
    return { source, medium, campaign, content, shareRef };
  }

  return null;
}

function parseStoredAttribution(value: unknown): DistributionAttribution | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.source === "direct") {
    return Object.keys(candidate).length === 1 ? { source: "direct" } : null;
  }
  const allowedKeys = new Set([
    "source",
    "medium",
    "campaign",
    "content",
    "shareRef",
  ]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return null;
  const params = new URLSearchParams();
  for (const [key, sourceKey] of [
    ["utm_source", "source"],
    ["utm_medium", "medium"],
    ["utm_campaign", "campaign"],
    ["utm_content", "content"],
    ["share_ref", "shareRef"],
  ] as const) {
    const item = candidate[sourceKey];
    if (typeof item === "string") params.set(key, item);
  }
  return parseDistributionAttribution(params);
}

export function readDistributionAttribution(
  storage: Pick<Storage, "getItem"> | null =
    typeof window === "undefined" ? null : window.sessionStorage,
): DistributionAttribution {
  if (!storage) return { source: "direct" };
  try {
    const raw = storage.getItem(DISTRIBUTION_ATTRIBUTION_KEY);
    if (!raw) return { source: "direct" };
    const parsed: unknown = JSON.parse(raw);
    return parseStoredAttribution(parsed) ?? { source: "direct" };
  } catch {
    return { source: "direct" };
  }
}

/**
 * Capture immutable first-touch attribution for the current browser session,
 * then remove only our bounded acquisition keys from the address bar. The
 * rest of the URL (including dev-only flags and invite tokens) is preserved.
 */
export function captureDistributionAttribution(
  location: Pick<Location, "search" | "pathname" | "hash"> = window.location,
  history: Pick<History, "replaceState"> = window.history,
  storage: Pick<Storage, "getItem" | "setItem"> = window.sessionStorage,
): DistributionAttribution {
  const parsed = parseDistributionAttribution(location.search);
  let current = readDistributionAttribution(storage);
  let hasStoredTouch = true;
  try {
    hasStoredTouch = storage.getItem(DISTRIBUTION_ATTRIBUTION_KEY) !== null;
  } catch {
    // Treat inaccessible storage as already claimed so a later tagged route
    // cannot rewrite the in-memory direct fallback.
  }

  if (!hasStoredTouch) {
    const firstTouch: DistributionAttribution = parsed ?? { source: "direct" };
    try {
      storage.setItem(DISTRIBUTION_ATTRIBUTION_KEY, JSON.stringify(firstTouch));
      current = firstTouch;
    } catch {
      // Storage-restricted browsers still get a working product. The first
      // event will be classified direct rather than breaking the journey.
    }
  }

  const params = new URLSearchParams(location.search);
  const carriedAttribution = DISTRIBUTION_QUERY_KEYS.some((key) =>
    params.has(key),
  );
  if (carriedAttribution) {
    for (const key of DISTRIBUTION_QUERY_KEYS) params.delete(key);
    const next = `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`;
    try {
      history.replaceState({}, "", next);
    } catch {
      // Rewriting is privacy hygiene, never a navigation prerequisite.
    }
  }

  return current;
}
