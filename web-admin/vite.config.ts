// Vite config for the Saladee web-admin back-office SPA. Builds to static assets
// (web-admin/dist) served behind Caddy on the VPS. Vue SFC + Tailwind v4
// (CSS-first) plugins, mirroring web/. The api base URL is supplied at build time
// via VITE_API_URL (read in src/api.ts).
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
