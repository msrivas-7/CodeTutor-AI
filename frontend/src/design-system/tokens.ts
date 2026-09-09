/** Public brand decisions. CSS, first paint and static documents derive from
 * this source; components consume roles, never a second copy of the palette.
 * Workspace dark/light roles remain in index.css until separately migrated. */
const dark = {
  canvas: [5, 7, 9],
  text: [236, 239, 241],
  muted: [160, 168, 177],
  faint: [140, 150, 160],
  line: [37, 42, 48],
  object: [16, 19, 22],
  field: [12, 15, 18],
  elevated: [19, 23, 27],
  border: [49, 56, 64],
  accent: [160, 217, 237],
  code: [16, 25, 31],
  tableHeader: [23, 28, 33],
} as const;

const light = {
  ...dark,
  canvas: [248, 250, 252],
  text: [15, 23, 42],
  muted: [71, 85, 105],
  line: [203, 213, 225],
  object: [255, 255, 255],
  accent: [8, 107, 145],
} as const;

export const publicBrand = {
  dark,
  light,
  headerHeight: "88px",
  targetMin: "44px",
  controlHeight: "48px",
  controlRadius: "10px",
  pillRadius: "24px",
  readingFeather: "12px",
  readingSpread: "8px",
  fontUi: "Inter, system-ui, sans-serif",
  fieldArrival: "800ms",
} as const;

const hex = (rgb: readonly number[]) =>
  `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

export const publicCanvasColor = hex(publicBrand.dark.canvas);

function paletteCss(palette: typeof dark | typeof light) {
  return Object.entries(palette).map(([role, rgb]) =>
    `--brand-${role}-rgb: ${rgb.join(" ")};\n--brand-${role}: ${hex(rgb)};`,
  ).join("\n");
}

/** Inline before first paint: no theme-fetch race or runtime token generator. */
export function designTokenCss() {
  return `:root {
${paletteCss(publicBrand.dark)}
--brand-header-height: ${publicBrand.headerHeight};
--brand-target-min: ${publicBrand.targetMin};
--brand-control-height: ${publicBrand.controlHeight};
--brand-control-radius: ${publicBrand.controlRadius};
--brand-pill-radius: ${publicBrand.pillRadius};
--brand-reading-feather: ${publicBrand.readingFeather};
--brand-reading-spread: ${publicBrand.readingSpread};
--brand-font-ui: ${publicBrand.fontUi};
--brand-field-arrival: ${publicBrand.fieldArrival};
}
.motion-study.study-light { ${paletteCss(publicBrand.light)} }
.motion-study, .public-theme {
--color-bg: var(--brand-canvas-rgb);
--color-ink: var(--brand-text-rgb);
--color-muted: var(--brand-muted-rgb);
--study-bg: var(--brand-canvas);
--study-ink: var(--brand-text);
--study-muted: var(--brand-muted);
--study-line: var(--brand-line);
--study-panel: var(--brand-object);
--study-accent: var(--brand-accent);
--brand-reading-shadow: 0 0 var(--brand-reading-feather) var(--brand-reading-spread) var(--study-bg);
--brand-display-shadow: 0 1px 3px var(--study-bg), 0 0 12px var(--study-bg);
--brand-display-backing: radial-gradient(ellipse at center, var(--study-bg) 45%, transparent 75%);
}
.public-page {
--color-panel: var(--brand-field-rgb);
--color-elevated: var(--brand-elevated-rgb);
--color-border: var(--brand-border-rgb);
--color-border-soft: var(--brand-line-rgb);
--color-faint: var(--brand-faint-rgb);
--color-accent: var(--brand-accent-rgb);
--color-accent-ink: var(--brand-accent-rgb);
--color-success: 52 211 153;
--color-warn: 251 191 36;
--color-warn-ink: 251 191 36;
--color-danger: 248 113 113;
}`;
}

export function renderDesignTokensHtml(html: string) {
  return html
    .replace("<!-- design-system:tokens -->", `<style id="design-system-tokens">${designTokenCss()}</style>`)
    .replaceAll("__PUBLIC_CANVAS_COLOR__", publicCanvasColor);
}
