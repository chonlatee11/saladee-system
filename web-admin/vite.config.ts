// Vite config for the Saladee web-admin back-office SPA. Builds to static assets
// (web-admin/dist) served behind Caddy on the VPS. Vue SFC + Tailwind v4
// (CSS-first) plugins, mirroring web/. The api base URL is supplied at build time
// via VITE_API_URL (read in src/api.ts).
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // Pin the admin dev/preview port to 5174 — the DISTINCT admin dev origin already
  // whitelisted in CORS_ORIGINS (api/src/env.ts, 03-01). web/ owns 5173; keeping
  // web-admin on 5174 avoids a port clash when both apps run and guarantees the
  // browser preflight is never blocked (Pitfall 6).
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
