import tailwindcss from "@tailwindcss/vite";

// Nuxt SSR web-store (04-08, D-01). Public B2C storefront that reuses the EXISTING
// API (Eden Treaty), the shared @theme tokens, and the LINE round model (D-04). No
// new order/payment endpoint — browse only in this plan; Plan 09 adds checkout.
export default defineNuxtConfig({
  compatibilityDate: "2026-07-17",

  // SEO umbrella (D-06): sitemap + OG meta + schema.org (JSON-LD) + robots. Installed
  // only after the blocking package-legitimacy checkpoint (T-04-SC) was approved.
  modules: ["@nuxtjs/seo"],

  // OG tags are emitted as real-imagery meta (useSeoMeta ogImage -> the product's
  // actual photo). The GENERATED-OG-image renderer (nuxt-og-image) is disabled so we
  // don't pull an extra native/wasm renderer dependency (@takumi-rs/wasm) — keeps the
  // install surface minimal (NFR-08) and avoids a new unvetted dep. Sitemap +
  // schema.org (JSON-LD) + robots + meta still cover D-06.
  ogImage: { enabled: false },

  // Tailwind v4 CSS-first via the vite plugin (no tailwind.config.js). The @theme
  // token block lives in assets/style.css, copied verbatim from web/ (one brand).
  css: ["~/assets/style.css"],
  vite: {
    plugins: [tailwindcss()],
  },

  runtimeConfig: {
    public: {
      // The live API base URL — the SAME API the LIFF app calls. Overridden at
      // deploy time by NUXT_PUBLIC_API_URL (Cloudflare Pages env).
      apiUrl: "http://localhost:3000",
    },
  },

  // Host RESOLVED (D-29/D-30) to Cloudflare Pages — nitro cloudflare-pages preset
  // (edge SSR keeps the VPS lean, NFR-08). Plan 09 wires the deploy job.
  nitro: {
    preset: "cloudflare-pages",
  },

  // Edge-cache the public SSR HTML (catalog + product pages) via SWR so the store
  // does not re-fetch the VPS API on every request — neutralizes edge->API SSR
  // latency. Cart/checkout (Plan 09) stay CSR and are never cached here.
  routeRules: {
    "/": { swr: 600 },
    "/p/**": { swr: 600 },
    // Checkout is CSR (04-09): the cart is client sessionStorage state and the page
    // does live order/payment API round-trips — SSR gains nothing and would render an
    // empty cart. ssr:false renders it client-side only (D-29 CSR cart/checkout note).
    "/checkout": { ssr: false },
  },

  // A public site URL is needed for canonical/sitemap absolute URLs. The real
  // production domain (D-06 prereq) is injected at deploy via NUXT_PUBLIC_SITE_URL.
  site: {
    url: "https://store.saladee.example",
    name: "Saladee — ผักสลัดสด",
  },

  app: {
    head: {
      htmlAttrs: { lang: "th" },
    },
  },
});
