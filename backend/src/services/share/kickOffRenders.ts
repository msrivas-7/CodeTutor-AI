// Phase A — A3: extracted from `routes/shares.ts` so both the authed
// (`POST /api/shares`) and the anon (`POST /api/anon/shares`) creation
// paths can fire renders through the same gating + error-isolation
// shape. Behavior pre-extraction:
//   - Two parallel pipelines (OG + Story); each catches its own error
//     so a Satori failure in one doesn't block the other.
//   - The render goes through `withRenderSlot` so it competes against
//     the global parallel-render cap (Phase 21C P0 #2).
//
// Imports must NOT pull from `routes/*` — keep this a leaf service so
// the route modules can both depend on it without a cycle.

import {
  setShareOgImagePath,
  setShareOgStoryImagePath,
} from "../../db/sharedCompletions.js";
import {
  renderOgPng,
  renderOgStoryPng,
} from "./ogRenderer.js";
import { withRenderSlot } from "./renderQueue.js";
import { uploadOgPng, uploadStoryPng } from "./storage.js";

export interface ShareArtifactProps {
  lessonTitle: string;
  lessonOrder: number;
  courseTitle: string;
  courseTotalLessons: number;
  mastery: "strong" | "okay" | "shaky";
  timeSpentMs: number;
  attemptCount: number;
  codeSnippet: string;
  displayName: string | null;
  shareToken: string;
}

export function kickOffRenders(props: ShareArtifactProps): void {
  void (async () => {
    try {
      await withRenderSlot(async () => {
        const png = await renderOgPng(props);
        const objectPath = await uploadOgPng(props.shareToken, png);
        await setShareOgImagePath(props.shareToken, objectPath);
      });
    } catch (e) {
      console.error(
        JSON.stringify({
          level: "error",
          t: new Date().toISOString(),
          evt: "share_og_render_failed",
          shareToken: props.shareToken,
          msg: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  })();
  void (async () => {
    try {
      await withRenderSlot(async () => {
        const png = await renderOgStoryPng(props);
        const objectPath = await uploadStoryPng(props.shareToken, png);
        await setShareOgStoryImagePath(props.shareToken, objectPath);
      });
    } catch (e) {
      console.error(
        JSON.stringify({
          level: "error",
          t: new Date().toISOString(),
          evt: "share_story_render_failed",
          shareToken: props.shareToken,
          msg: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  })();
}
