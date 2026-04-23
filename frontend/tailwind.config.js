/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic design tokens backed by CSS variables defined in index.css.
        // The variables switch between dark (default) and light themes via the
        // [data-theme="light"] selector applied by util/theme.ts.
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        elevated: "rgb(var(--color-elevated) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        borderSoft: "rgb(var(--color-border-soft) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        faint: "rgb(var(--color-faint) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        accentMuted: "rgb(var(--color-accent-muted) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        warn: "rgb(var(--color-warn) / <alpha-value>)",
        warnInk: "rgb(var(--color-warn-ink) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        violet: "rgb(var(--color-violet) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(56 189 248 / 0.35), 0 0 20px -4px rgb(56 189 248 / 0.35)",
        soft: "0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 1px 2px 0 rgb(0 0 0 / 0.4)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseDot: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "loader-shimmer": {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(400%)" },
        },
      },
      animation: {
        shimmer: "shimmer 2.2s linear infinite",
        pulseDot: "pulseDot 1.6s ease-in-out infinite",
        fadeInUp: "fadeInUp 180ms ease-out",
        "loader-shimmer": "loader-shimmer 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
