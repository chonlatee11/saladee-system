<!-- GSD:project-start source:PROJECT.md -->
## Project

**Saladee — ระบบร้านค้าออนไลน์ขายผักสลัด + วางแผนการปลูก**

ระบบร้านค้าออนไลน์สำหรับขาย **ผักสลัด (สินค้าสด)** พร้อมระบบจัดการสินค้า/สต็อกที่ผูกกับ **รอบเก็บเกี่ยว** และโมดูล **วางแผนการปลูก–พยากรณ์ผลผลิต** เพื่อให้จำนวนที่เปิดขายตรงกับของจริง กันการ oversell ขายผ่าน **LINE OA เป็นช่องทางหลักช่วงแรก** (Rich Menu + LIFF + Messaging API) แล้วขยายเป็นเว็บสโตร์ รองรับการขายทั้ง B2C, B2B และสมาชิกรายรอบ (Subscription) บนหลังบ้านเดียว (Omnichannel) — สำหรับเจ้าของฟาร์ม/ร้านผักสลัดรายเล็กที่ต้องการเริ่มต้นด้วยต้นทุนต่ำ

**Core Value:** **ลูกค้าสั่งผักสลัดผ่าน LINE แล้วจ่ายเงินได้จบในที่เดียว และจำนวนที่เปิดขายตรงกับผลผลิตจริงเสมอ (ไม่ oversell, ไม่เหลือทิ้ง)** — ความถูกต้องของสต็อกที่ผูกกับรอบเก็บเกี่ยวคือหัวใจที่ทำให้สินค้าสดส่งได้แม่นยำ

### Constraints

- **Budget (สำคัญที่สุด):** ต้นทุนต่ำสุด (NFR-08) — เริ่มจากบริการฟรี/ราคาถูก: LINE OA + LIFF (ฟรี), host serverless/VPS เล็ก free tier, PostgreSQL managed ขนาดเล็ก, รัน PromptPay QR ฝั่ง backend เอง (เลี่ยงค่า gateway), object storage ราคาถูกเก็บสลิป/รูป; งบยังไม่กำหนดตายตัว เพิ่มทรัพยากรเมื่อยอดโต
- **Tech (ข้อเสนอเบื้องต้น):** backend API เดี่ยว (Elysia/Bun หรือ Go) + PostgreSQL, หน้า LIFF เป็น static web (Vue/Next), mobile-first (เริ่มจาก LIFF บน LINE)
- **Timeline:** ทำตามลำดับ LINE ก่อน → จัดการออเดอร์+ปลูก → เว็บ/การตลาด
- **Stock correctness (NFR-02):** ต้องกัน oversell ด้วยการล็อกสต็อกตอนสร้างออเดอร์แบบ atomic
- **PDPA (NFR-04):** ขอความยินยอม, นโยบายความเป็นส่วนตัว, สิทธิ์ลบ/ขอข้อมูล, เก็บ log การยินยอม, ป้องกันการเข้าถึงสลิป/ข้อมูลลูกค้า
- **Performance (NFR-01):** รองรับช่วงไลฟ์/โปรโมชันที่ทราฟฟิกพุ่ง
- **Mobile (NFR-07):** ทุกหน้าใช้บนมือถือได้ดี
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## TL;DR — The Lowest-Cost Stack
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Bun** | 1.3.14 | JS/TS runtime + package manager + bundler | Fastest JS server runtime in 2026 (~98% Node compat, used in prod by Figma/NYT/Slack). Native S3 client (talks to R2 with no AWS SDK), native image API, native SQL — fewer dependencies = smaller attack surface and less to maintain for a solo dev. |
| **Elysia** | 1.4.29 | HTTP API framework | Bun-first, fastest JS API framework. Native TypeBox validation + **auto-generated OpenAPI**, and **end-to-end type safety to the LIFF frontend via Eden Treaty** (`@elysiajs/eden`) — the frontend imports the server's types, so an API change is a compile error, not a runtime bug. Huge productivity win for one developer building B2C+B2B+subscription surfaces. |
| **PostgreSQL** | 17.x | Primary database | Relational + ACID transactions are mandatory for atomic stock reservation (NFR-02) and harvest-cycle inventory. `SELECT … FOR UPDATE` / conditional `UPDATE … WHERE qty >= n` give true oversell protection that a document store cannot. PG 17 is current, well-supported everywhere, and self-hostable for ~$0. |
| **Drizzle ORM** | 0.45.2 | Type-safe SQL / migrations | SQL-first and lightweight, with **explicit control over row locking** (`.for('update')`, `SKIP LOCKED`) and transactions — exactly what atomic stock reservation needs. Runs cleanly on Bun/ARM (no native query-engine binary). Migrations via `drizzle-kit` 0.31.10. |
| **postgres (postgres.js)** | 3.4.9 | PostgreSQL driver | Fast, modern driver Drizzle pairs with on Bun. (Bun's native `Bun.sql` also works, but postgres.js + Drizzle is the proven, portable combo.) |
| **Vue** | 3.5.39 | LIFF mini-app UI framework | Lightweight SPA ideal for the LINE in-app browser (mobile-first, fast first paint — NFR-07). Smaller/simpler than a full SSR framework, which a LIFF mini-app does not need. Components are reusable for the Phase-3 web store via Nuxt. |
| **Vite** | 8.1.0 | Frontend build/dev server | Standard for Vue SPAs; instant HMR, tiny optimized production bundles served as static files (free on Cloudflare Pages). |
| **Tailwind CSS** | 4.3.1 | Styling | CSS-first config (v4 engine), tiny shipped CSS, fast to build a clean mobile commerce UI without a heavyweight component library. |
| **Caddy** | 2.x | Reverse proxy + automatic HTTPS | LINE requires HTTPS for both the webhook and the LIFF endpoint. Caddy provisions/renews Let's Encrypt certs automatically with near-zero config — removes a whole class of TLS chores on the VPS. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@line/bot-sdk** | 11.0.2 | LINE Messaging API SDK (Node/Bun) | Webhook **signature validation** (security), reply/push messages, Rich Menu API (FR-46), status notifications (FR-16), broadcast (FR-31, FR-49). Use the v11 API surface for new projects. Phase 1. |
| **@line/liff** | 2.29.0 | LIFF client SDK (frontend) | Initialize LIFF, **LINE Login**, get profile + `idToken`/`accessToken` to send to the API for server-side verification (FR-25, FR-47). Phase 1. |
| **promptpay-qr** | 0.5.0 | PromptPay EMVCo payload generator | Builds the EMVCo merchant-presented payload **with correct CRC-16** for an amount-specified PromptPay QR, fully server-side, **zero gateway fee** (FR-17, NFR-08). Phase 1. |
| **qrcode** | 1.5.4 | Render payload → image | Turns the `promptpay-qr` payload string into PNG/SVG/dataURL to display in the LIFF checkout. Phase 1. |
| **promptparse** | 1.6.0 | All-in-one PromptPay/EMVCo lib (alt) | TypeScript-native; **generates QR and parses slip/QR payloads**. Adopt instead of `promptpay-qr`+`qrcode` if you want one library that also helps with **slip verification** later (FR-18 OCR/verify, Phase 2/3). |
| **pg-boss** | 12.23.0 | PostgreSQL-backed job queue + scheduler | Background/delayed jobs **without extra infrastructure** (reuses your PG). Drives: **QR-hold expiry → release reserved stock** (FR-19), standing-order generation (FR-39), subscription-box generation (FR-10), round cut-off. Uses `SKIP LOCKED` for safe concurrent workers. Phase 1 (hold-expiry) → Phase 2/3. |
| **TypeBox** | (bundled via Elysia / `@sinclair/typebox`) | Request/response schema + validation | Native to Elysia: one schema gives runtime validation **and** OpenAPI docs **and** TS types. Use for every endpoint. Phase 1. |
| **jose** | 6.2.3 | JWT signing/verification | Verify LINE `idToken` server-side and issue your own short-lived session token; supports guest sessions too (FR-25). Phase 1. |
| **sharp** | 0.35.2 | Image processing | Compress/resize uploaded payment slips and product photos before storing on R2. (Or use **`Bun.Image`** native in Bun 1.3 to drop this dependency.) Phase 1. |
| **pdfmake** | 0.3.11 | PDF generation | Tax invoices / receipts (FR-37). **Must embed a Thai font (e.g. Sarabun)** — default PDF fonts do not render Thai. Phase 2. |
| **@elysiajs/eden** | 1.4.9 | End-to-end typed API client | Import server types into the Vue app for compile-time-safe API calls. Phase 1. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| **drizzle-kit** | Schema migrations (generate/push) | Keep migrations in git; run on deploy. Central to evolving the crop-planning + order schema across phases. |
| **Bun test** | Built-in test runner | No extra deps; fast. Cover the stock-reservation transaction and PromptPay payload/CRC with tests. |
| **Biome** | Lint + format (single fast tool) | Replaces ESLint+Prettier; Rust-fast, low config. |
| **Caddy** | Local TLS + prod TLS | Same tool dev→prod. |
| **GitHub Actions** | CI + deploy-by-SSH to the VPS | Free for this scale; build LIFF → push to Cloudflare Pages, and `bun build` + restart API service on the VPS. |
## Installation
# --- API (Bun + Elysia) ---
# Phase 2 (invoices)
# --- LIFF frontend (Vue + Vite), separate package ---
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Elysia on Bun | **Hono** (4.12.27) on Bun/Node | If you later want to deploy the API to **Cloudflare Workers / edge** for portability. Hono is runtime-agnostic and edge-first. Trade-off: Workers handle persistent timers/cron poorly, so you'd still need somewhere for pg-boss jobs. |
| Elysia on Bun | **Go** (Fiber/Echo + sqlc/pgx) | If the team already knows Go, or a future module is CPU-bound. Go is faster/leaner per-instance but costs you end-to-end TS types with the LIFF frontend and is slower to iterate for CRUD-heavy commerce as a solo dev. At this traffic, Go's perf edge is irrelevant. |
| Self-hosted PG on the VPS | **Neon free tier** (managed Postgres) | If you do **not** want to administer a database. Free tier: 0.5 GB, scale-to-zero (resumes ~1 s), **automatic backups + branching**. Pick this for hands-off backups; accept a ~1 s cold-resume latency on the first webhook query after idle. |
| Self-hosted PG on the VPS | **Supabase free tier** | Only if you also want its bundled **Auth/Storage/Realtime** BaaS. Caveat: free projects **pause after ~1 week of inactivity** (tightened Feb 2026) and you're limited to 2 projects. We don't need its auth (LINE provides identity), so it's not the default. |
| Vue 3 + Vite (LIFF SPA) | **React + Vite** or **SvelteKit** | Team preference. All work with Eden Treaty types. |
| Vue 3 SPA | **Nuxt / Next.js (SSR)** | For the **Phase-3 web store** where SEO/SSR matters. Keep the LIFF mini-app a lightweight SPA; build the SSR store separately (Nuxt lets you reuse Vue components). |
| Cloudflare R2 | **Backblaze B2 + Cloudflare CDN** | If stored data grows past R2's free 10 GB: B2 storage is ~2.5× cheaper and egress **to Cloudflare is free**. Best cost at larger volumes. |
| Hetzner CAX11 VPS | **Render free / Railway $5** | Render free only if cold starts are acceptable (they aren't for the webhook). Railway (~$5–7/mo warm) if you want managed deploys and will pay slightly more for convenience. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Prisma ORM** | Heavy query-engine binary, awkward on Bun/ARM, and weaker direct control over `FOR UPDATE`/`SKIP LOCKED` — exactly the locking you need for atomic stock. | Drizzle ORM (SQL-first, explicit locking). |
| **A payment gateway (Stripe/Omise/2C2P) for PromptPay** | Adds per-transaction fees and KYC overhead. You can generate the PromptPay QR yourself for free. | `promptpay-qr` / `promptparse` server-side (FR-17, NFR-08). |
| **Fly.io / Railway free tiers** | Free tiers were removed (Fly 2024, Railway 2023). | Always-on Hetzner VPS, or pay for Railway/Render warm. |
| **Render free web service for the webhook** | Cold-starts after 15 min idle → LINE webhook timeouts / dropped events. | Always-on VPS (no cold start). |
| **Firebase / Firestore / MongoDB** | No SQL transactions for safe oversell-prevention; vendor lock-in; egress/read billing surprises. Commerce + harvest-cycle inventory is relational. | PostgreSQL 17 + Drizzle. |
| **Express / NestJS** | Express = no type safety, legacy DX. NestJS = heavyweight enterprise scaffolding for a solo low-cost project. | Elysia (typed, light, fast). |
| **AWS RDS / managed enterprise DB** | Fixed monthly cost far above NFR-08 budget; overkill at this scale. | Self-hosted PG, or Neon free. |
| **Supabase Storage (as default)** | Free tier is tight (1 GB store / 5 GB egress) and egress is metered. | Cloudflare R2 (10 GB free, zero egress). |
| **AWS S3 SDK on Bun** | Unnecessary dependency. | Bun 1.3 native S3 client → points at R2's S3-compatible endpoint. |
## Stack Patterns by Variant
- Swap self-hosted PG for **Neon free tier**; keep everything else.
- Because Neon gives automatic backups + branching; accept ~1 s cold-resume latency and plan to upgrade when 0.5 GB / 100 CU-hours is exceeded.
- Move the API to a Hetzner **CX/CPX** tier (more vCPU/RAM) — still single-digit dollars — before considering horizontal scaling.
- Because vertical scaling on one box is the cheapest first step; pg-boss + Postgres handle the queue without new infra.
- Rebuild the API on **Hono** so it can run on Cloudflare Workers; keep pg-boss jobs on a small always-on worker.
- Because Hono is runtime-agnostic; Elysia is intentionally Bun-optimized.
- Add a **Nuxt** app reusing Vue components; keep the LIFF SPA as-is.
- Because SSR helps the public store rank; the in-LINE mini-app gains nothing from SSR.
## Atomic Stock Reservation — Implementation Note (NFR-02 / FR-04)
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| bun@1.3.14 | elysia@1.4.29 | Elysia is Bun-first; pin Bun ≥1.3 for native S3/image APIs. |
| drizzle-orm@0.45.2 | postgres@3.4.9, PostgreSQL 17 | Use `drizzle-kit@0.31.10` for migrations; keep ORM and kit minor-aligned. |
| @line/liff@2.29.0 | Any HTTPS-served SPA | LIFF **requires HTTPS** endpoint (Cloudflare Pages provides it). Configure the LIFF endpoint URL in the LINE console. |
| @line/bot-sdk@11.0.2 | Bun/Node | v11 API surface; **always validate the `x-line-signature`** on the webhook. |
| vite@8.1.0 | vue@3.5, tailwindcss@4.3 | Vite 8 needs a current Bun/Node 20+ to build. Tailwind v4 uses the new CSS-first config + `@tailwindcss/vite` plugin. |
| pg-boss@12.23.0 | PostgreSQL 17 | Creates its own schema/tables; point it at the same database. |
| promptpay-qr@0.5.0 | qrcode@1.5.4 | `promptpay-qr` returns the payload string; `qrcode` renders it. `promptparse@1.6.0` can replace both if you also want slip parsing. |
## Sources
- npm registry (`npm view <pkg> version`) on 2026-06-28 — exact current versions for elysia 1.4.29, @elysiajs/eden 1.4.9, drizzle-orm 0.45.2, drizzle-kit 0.31.10, promptpay-qr 0.5.0, promptparse 1.6.0, qrcode 1.5.4, @line/bot-sdk 11.0.2, @line/liff 2.29.0, pg-boss 12.23.0, vue 3.5.39, vite 8.1.0, tailwindcss 4.3.1, hono 4.12.27, zod 4.4.3, jose 6.2.3, sharp 0.35.2, pdfmake 0.3.11, postgres 3.4.9 — **HIGH**
- Bun blog / endoflife.date / InfoQ "Bun v3.1 / 1.3" — Bun 1.3.14 stable (May 2026), native S3 + image APIs, ~98% Node compat — **HIGH**
- github.com/elysiajs/elysia + bun.com docs — Elysia Bun-first, Eden Treaty e2e types, TypeBox/OpenAPI — **HIGH**
- github.com/dtinth/promptpay-qr + github.com/maythiwat/promptparse — EMVCo merchant-presented payload + CRC, amount-specified QR, slip parsing — **HIGH**
- Neon vs Supabase 2026 comparisons (bytebase, simplyblock, sqlflash) — Neon free 0.5 GB + scale-to-zero + auto backups; Supabase free 2 projects/500 MB + pause after ~1 week (Feb 2026) — **MEDIUM-HIGH**
- Fly.io/Railway/Render/Hetzner 2026 pricing roundups (saaspricepulse, render.com, bestusavps, betterstack) — free tiers removed on Fly/Railway; Render free cold-starts; Hetzner CAX11 ARM ~$3.79–4.59/mo, 20 TB transfer — **MEDIUM-HIGH** (pricing volatile; reverify at purchase)
- Cloudflare R2 / Backblaze B2 / Supabase Storage 2026 comparisons (leanops, buildmvpfast, devtoolpicks) — R2 free 10 GB + zero egress; B2 cheaper storage + free egress via Cloudflare — **MEDIUM-HIGH**
- orm.drizzle.team — Drizzle PostgreSQL support, `.for('update')`, transactions, raw SQL escape hatch — **HIGH**
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
