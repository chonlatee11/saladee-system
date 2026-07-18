---
phase: 04-web-store-marketing-scale
plan: 04
subsystem: product-images
tags: [product-images, catalog, upload, r2, sharp, gallery, admin, ORD-05]
requires:
  - "payments.ts sharp+R2 slip pipeline (02-06/02-08)"
  - "variety_images / box_images tables (migration 0005, 04-01)"
  - "product-images.ts + productImages composition seam (04-02)"
  - "requireRole owner|admin RBAC (00-05)"
provides:
  - "POST/GET/DELETE /product-images admin upload + gallery management"
  - "catalog gallery[] payload (cover-first) on varieties + boxes"
  - "R2_PUBLIC_BASE_URL env for public product-image URLs"
  - "ProductImages.vue admin uploader + useProductImages composable"
affects:
  - "api/src/routes/catalog.ts (additive gallery field)"
  - "web store / LIFF / broadcast Flex (consume gallery[])"
tech-stack:
  added: []
  patterns:
    - "server-assigned public R2 key (mirrors payments.ts slip discipline, public path)"
    - "cover-first gallery = [imageUrl, ...childUrls] (legacy cover backward compatible)"
    - "last-cover delete block (imageUrl null AND last gallery row → 409)"
key-files:
  created:
    - "api/src/routes/product-images.ts"
    - "api/tests/product-images.test.ts"
    - "web-admin/src/composables/useProductImages.ts"
  modified:
    - "api/src/routes/catalog.ts"
    - "api/src/env.ts"
    - "api/tests/catalog.test.ts"
    - "web-admin/src/views/ProductImages.vue"
decisions:
  - "D-26: product photos are PUBLIC marketing assets — stored URL = ${R2_PUBLIC_BASE_URL}/${key}, not the private signed-URL path slips use"
  - "D-27/28: cover (varieties.imageUrl/boxes.imageUrl) kept independent + backward compatible; gallery = [cover, ...uploaded rows]"
  - "Cover = legacy imageUrl OR (if null) the first gallery row; delete blocked only when it is the product's last remaining image"
metrics:
  duration: "~30 min"
  completed: 2026-07-18
status: complete
---

# Phase 4 Plan 04: Product Images Summary

Real product imagery across the store — admin uploads photos through the existing sharp+R2 pipeline (public marketing path), forming a per-product gallery the catalog API returns for the web store, LIFF catalog, and broadcast Flex cards (ORD-05, D-26/27/28).

## What Was Built

### Task 1 — product-images route + catalog gallery (commit 67e4e2d)
- **`api/src/routes/product-images.ts`** — replaced the 501 stub with admin-only (`requireRole owner|admin`) routes reusing the `payments.ts` sharp+R2 pipeline:
  - `POST /product-images` — multipart upload of one image (variety OR box), size-bounded to 5 MiB **before** sharp (T-04-12 DoS bound), sharp-compressed, stored under a **server-assigned** public key `product-images/{varieties|boxes}/<id>/<uuid>.jpg` (T-04-13 — client never names the object), creates a `variety_images`/`box_images` row, returns the stored public URL.
  - `GET /product-images?varietyId|boxId` — the product's gallery (legacy cover + rows ordered by sort).
  - `DELETE /product-images/:id` — refuses (409 `cannot_delete_last_cover`) when the row is the product's only remaining image and no legacy cover exists.
- **`api/src/routes/catalog.ts`** — added a cover-first `gallery` array (`[imageUrl, ...uploaded urls]`) to the variety + box payloads in both `GET /catalog` and `GET /catalog/rounds/:id`; `imageUrl` cover field unchanged (backward compatible); WR-01 private/Vary cache headers intact.
- **`api/src/env.ts`** — added `R2_PUBLIC_BASE_URL` (default `""`) for composing public product-image URLs (D-26).
- **Tests** — `product-images.test.ts` (>5 MiB→413, non-admin→403, missing token→401, server-assigned key persisted, last-cover delete→409, non-last delete→200) + extended `catalog.test.ts` (gallery cover-first by sort, cover-only for no-extras, cache headers intact). 22 green.

### Task 2 — ProductImages admin uploader (commit a9af027)
- **`web-admin/src/composables/useProductImages.ts`** — TanStack Query composables (gallery query, multi-file sequential upload, delete) wrapping the Eden `/product-images` endpoints with the staff Bearer, mirroring `useB2b`.
- **`web-admin/src/views/ProductImages.vue`** — replaced the stub: variety picker + multi-image uploader (reuses the SlipUploader upload idiom), cover-first gallery grid with a per-image remove opening the shared destructive-confirm dialog (`ลบรูปนี้ออกจากสินค้า?` / confirm `ลบรูป`), last-cover removal blocked client-side (mirrors the server 409). Accent reserved for the single primary upload CTA (UI-SPEC).

## Deviations from Plan

None — plan executed as written. (One design choice within Claude's discretion per D-26: `R2_PUBLIC_BASE_URL` env added with an empty default so boot/tests work without a new secret; prod sets the R2 public bucket domain.)

## Verification

- `cd api && bun test tests/product-images.test.ts tests/catalog.test.ts` → 22 pass.
- Full api suite `bun test` → **335 pass / 0 fail** (no regression from the catalog/env change).
- `cd api && tsc` → no errors. `biome check` clean.
- `cd web-admin && bun run build` → built (vue-tsc + vite), ProductImages chunk emitted.

## Threat Mitigations (from plan threat_model)

- **T-04-12 (DoS, upload abuse):** admin-only `requireRole` + 5 MiB bound checked before sharp + sharp compress. ✓
- **T-04-13 (Tampering, client-named key):** server assigns the R2 key; client supplies only variety/box id + file. ✓
- **T-04-14 (Info disclosure, public vs private):** product photos use the public marketing path by design (accepted, D-26); slips stay on the unchanged private signed-URL path. ✓

## Self-Check: PASSED

- api/src/routes/product-images.ts — FOUND
- web-admin/src/views/ProductImages.vue — FOUND
- web-admin/src/composables/useProductImages.ts — FOUND
- .planning/phases/04-web-store-marketing-scale/04-04-SUMMARY.md — FOUND
- commit 67e4e2d — FOUND
- commit a9af027 — FOUND
