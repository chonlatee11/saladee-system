// Vite config for the Saladee LIFF SPA. Builds to static assets (web/dist) for
// Cloudflare Pages (deploy-web.yml). Vue SFC + Tailwind v4 (CSS-first) plugins.
// The api base URL is supplied at build time via VITE_API_URL (read in main.ts).
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: "dist",
    // Fail the build if assets are missing; keep the Phase-0 bundle small.
    emptyOutDir: true,
  },
});
