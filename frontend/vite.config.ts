import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { courseRegistryPlugin } from "./scripts/vitePluginCourseRegistry";
import { discoveryBuildPlugin, discoverySitePlugin } from "./scripts/vitePluginDiscovery";

export default defineConfig({
  plugins: [
    react(),
    courseRegistryPlugin(),
    discoverySitePlugin(),
    discoveryBuildPlugin(),
  ],
  server: {
    port: 5173,
    // Phase 21C (post-audit): backend fetches the canonical course
    // catalog from this Vite dev server (server-side title lookup
    // for share creation). Inside docker compose the backend reaches
    // it via `http://frontend:5173/courses/...`, which Vite would
    // otherwise reject as an unknown Host header. Allowlist the
    // service hostname explicitly. `localhost` stays the default for
    // non-docker dev. Production serves /courses/* statically from
    // the SWA host — no Vite involved.
    allowedHosts: ["localhost", "frontend", "127.0.0.1"],
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    modulePreload: {
      // Rollup's explicit Monaco vendor chunk is needed only by the editor
      // routes. Vite otherwise injects that dynamic chunk (and its 129 kB CSS)
      // into index.html as an eager preload, making every marketing/auth visit
      // pay the editor's render-blocking cost before it can paint.
      resolveDependencies: (_filename, dependencies, { hostType }) =>
        hostType === "html"
          ? dependencies.filter((dependency) => !dependency.includes("monaco"))
          : dependencies,
    },
    rollupOptions: {
      output: {
        // Monaco stays behind MonacoPane's dynamic import. Forcing it into a
        // manual vendor chunk caused Vite to emit the editor's 129 kB CSS as a
        // render-blocking link in index.html on every public route. Let Rollup
        // keep that dynamic boundary intact. `react-router-dom` lives in the
        // SPA shell, so it retains a stable shared chunk.
        manualChunks: {
          router: ["react-router-dom"],
        },
      },
    },
  },
});
