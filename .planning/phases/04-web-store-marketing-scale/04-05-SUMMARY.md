---
phase: 04-web-store-marketing-scale
plan: 05
subsystem: delivery-tracking
tags: [DEL-05, carrier, tracking, line-notify, adapter-seam, rbac]
requires:
  - "04-01: migration 0005 (delivery_status enum + carrier/tracking columns)"
  - "04-02: frozen tracking.ts stub + trackingRoutes composition in index.ts"
  - "Phase-2 notify.ts pushOrderUpdate seam (guest guard)"
provides:
  - "carrier adapter seam (makeCarrierAdapter, env CARRIER_PROVIDER)"
  - "admin tracking route: PATCH /tracking/:orderId, GET /tracking, GET /tracking/:orderId"
  - "CarrierTrackingForm admin view"
  - "notify.defaultLinePush reusable push seam"
affects:
  - "api/src/index.ts composition (unchanged — trackingRoutes singleton kept)"
tech-stack:
  added: []
  patterns:
    - "env-selected adapter seam mirroring slip-verify (one-line vendor swap)"
    - "reuse pushOrderUpdate + guest guard for delivery-status notifications"
    - "TypeBox closed Union → 422 for out-of-enum delivery status"
key-files:
  created:
    - api/src/services/carrier/types.ts
    - api/src/services/carrier/manual.adapter.ts
    - api/src/services/carrier/index.ts
    - api/tests/tracking.test.ts
  modified:
    - api/src/services/notify.ts
    - api/src/routes/tracking.ts
    - web-admin/src/views/CarrierTrackingForm.vue
decisions:
  - "Delivery-status → milestone push map: handed_to_carrier/in_transit → shipping, delivered → done; pending (pre-carrier) and failed push nothing (no matching milestone copy; failed handled manually)."
  - "carrierAdapter.recordTracking is the single carrier-value path; ManualCarrierAdapter passes staff values through and re-validates the enum — a real Grab/Lalamove adapter plugs into makeCarrierAdapter with no route rework."
  - "notify.defaultLinePush exported (non-breaking) so the tracking route reuses the env LINE client without building a second one; tests inject a mock LinePush."
metrics:
  duration: 18min
  completed: 2026-07-18
  tasks: 2
  files: 7
status: complete
---

# Phase 04 Plan 05: Multi-carrier Delivery Tracking Summary

Carrier delivery tracking (DEL-05) behind an env-selected carrier-adapter seam: staff record a carrier + tracking number and advance a defined `delivery_status` enum via an owner|admin route, and each forward transition pushes a LINE Flex status update by reusing the Phase-2 notify seam (guests skipped) — manual entry now, a real Grab/Lalamove API plugs in later with no route rework.

## What was built

**Task 1 — carrier seam + tracking route + status push (TDD)**
- `carrier/types.ts` — `CarrierAdapter` interface (`recordTracking` / `normalizeStatus`), `DeliveryStatus` type + `DELIVERY_STATUSES` const, mirroring `slip-verify/types.ts`.
- `carrier/manual.adapter.ts` — `ManualCarrierAdapter`: staff-entered values pass through; `normalizeStatus` throws on any value outside the enum (T-04-16 defence-in-depth).
- `carrier/index.ts` — `makeCarrierAdapter(provider = env.CARRIER_PROVIDER)` switch (`case "manual"` → `ManualCarrierAdapter`; commented grab/lalamove seam; default throws) + env-selected `carrierAdapter` singleton.
- `routes/tracking.ts` — replaced the 501 stub with owner|admin routes: `PATCH /tracking/:orderId` (carrier + tracking_number + enum-validated `delivery_status` + `tracking_updated_at`, then reused `pushOrderUpdate`); `GET /tracking` (orders needing tracking); `GET /tracking/:orderId`. 404 on unknown order, 422 on out-of-enum status, 403/401 via `requireRole`.
- `notify.ts` — exported `defaultLinePush` (the runtime env LINE client as a `LinePush`) so the route reuses it; no new client, no breaking change.
- `tracking.test.ts` — 14 assertions: adapter switch (manual + unknown throws + enum guard), PATCH persists + fires the notifier for a member / skips a guest, GET snapshot, RBAC 403/401, invalid-enum 422, unknown-order 404.

**Task 2 — CarrierTrackingForm admin view**
- Order list needing tracking + a form: carrier pick (Grab / Lalamove / general) via the single approved `ring-2 ring-accent` selected-tile pattern, tracking-number field, delivery-status select. Current status renders as a badge using the UI-SPEC binding palette (neutral/warning/positive/negative). Accent only on the save CTA (`บันทึกเลขพัสดุ`); empty state `ยังไม่มีเลขพัสดุ`.

## Verification

- `bun test tests/tracking.test.ts tests/notify.test.ts` → 14 pass, 0 fail.
- Full api suite → **344 pass, 0 fail** (60 files) — the notify.ts addition broke nothing.
- `api` `tsc --noEmit` → no errors (Eden contract intact).
- `web-admin` `bun run build` → built; `CarrierTrackingForm` bundled.

## Threat mitigations honoured

| Threat | Mitigation in code |
|--------|--------------------|
| T-04-15 EoP (non-admin sets tracking) | `requireRole("owner","admin")` on every tracking route (403/401 tested). |
| T-04-16 Tampering (forged status) | TypeBox closed Union → 422; `ManualCarrierAdapter.normalizeStatus` throws on foreign values. |
| T-04-17 Info disclosure (push to wrong recipient) | Reused `pushOrderUpdate` keyed on the order's own customer `line_user_id`; guest skipped. |

## Deviations from Plan

None — plan executed as written. TDD followed: RED commit (failing test) → GREEN commit (implementation).

## Self-Check: PASSED

- Files exist: carrier/{types,manual.adapter,index}.ts, tracking.ts, tracking.test.ts, CarrierTrackingForm.vue — all present.
- Commits present: 2ce449c (test RED), 65de5bb (feat GREEN), faba4e0 (view).
