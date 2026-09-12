import type { Plugin } from "vite";
import { renderDesignTokensHtml } from "../src/design-system/tokens";

/** Imported by Vite config, so editing tokens also restarts the dev server. */
export function designTokensPlugin(): Plugin {
  return {
    name: "codetutor-design-tokens",
    transformIndexHtml: { order: "pre", handler: renderDesignTokensHtml },
  };
}
