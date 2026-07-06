---
phase: 02-line-storefront-payments-delivery
asvs_level: 1
block_on: high
threats_total: 36
threats_closed: 36
threats_open: 0
verdict: SECURED
audited_at: 2026-07-06
---

# Phase 02 — Security Audit (line-storefront-payments-delivery)

Retroactive threat-mitigation verification. Register authored at plan time (36 threats).
ASVS L1 (grep-depth presence in the cited file). `block_on: high` — only open high/critical
threats would block; none are open.

## Verdict: SECURED — 36/36 closed, 0 open

## Threat verification (mitigate)

| ID | Category | Sev | Evidence (file:line) |
|----|----------|-----|----------------------|
| T-02-01 | Tampering | high | `api/src/services/order-transition.ts:79,124-137` — HOLD_STATES={created,awaiting_payment}, `SELECT … FOR UPDATE` + re-read, onlyIfHold no-op |
| T-02-02 | DoS | med | `api/src/jobs/boss.ts:21,32` — `new PgBoss(env.DATABASE_URL_DIRECT)` + worker db on DIRECT endpoint |
| T-02-03 | Repudiation | high | `api/src/db/schema.ts:297-299` — `uniqueIndex("payments_trans_ref_idx")` partial on trans_ref |
| T-02-04 | Info Disclosure | high | `api/src/env.ts:41` env-only SLIPOK_API_KEY; `api/src/lib/logger.ts:2` never-log-secrets discipline; adapters send key in header only |
| T-02-SC | Tampering (supply chain) | high | `api/package.json:24-28` — pg-boss/promptpay-qr/qrcode/sharp pinned exact; no pre/postinstall scripts |
| T-02-05 | Spoofing | high | `api/src/plugins/auth.plugin.ts:65-72` jose ES256 + iss=access.line.me + aud=LINE_LOGIN_CHANNEL_ID; `api/src/routes/auth.ts:85-87` 401 on failure |
| T-02-06 | Elevation | high | `api/src/routes/auth.ts:124` — `issueSession(customerId, "customer")` only |
| T-02-07 | Info Disclosure | high | `api/scripts/provision-rich-menu.ts:50,53` token from `env.LINE_CHANNEL_ACCESS_TOKEN`; console.log emits name/liff only, never the token |
| T-02-08 | Spoofing | med | ACCEPT — see Accepted Risks below |
| T-02-09 | Tampering | high | `api/src/routes/delivery.ts:5-7` quote display-only; `api/src/routes/orders.ts:466-467` checkout recomputes `computeDeliveryFee` + snapshots |
| T-02-10 | Tampering | high | `api/src/routes/orders.ts:460-463` `allowedMethodsForCart(classes).includes(method)` at checkout; also enforced at quote `delivery.ts:70` |
| T-02-11 | Elevation | med | `api/src/routes/varieties.ts:67,107,147,177` — POST/PUT/DELETE behind `requireRole("owner","admin")` |
| T-02-12 | Tampering | high | `api/src/routes/orders.ts:243-260,313-325` price from prices table; `:467` fee recomputed; `:475` QR amount = server total |
| T-02-13 | Tampering | high | `api/src/routes/orders.ts:456-463` freshness intersection re-enforced at checkout → 422 |
| T-02-14 | DoS | med | `api/src/routes/orders.ts:596,669-684` holdExpiresAt snapshotted; schedule failure caught (no rollback); 02-07 sweep self-heals |
| T-02-15 | Repudiation | med | `api/src/services/consent.ts` + `api/src/db/schema.ts:306-315` — consent_type usage/marketing + policy_version + created_at |
| T-02-16 | Tampering | high | `api/src/routes/orders.ts:472,475` totalSatang = subtotal + deliveryFee; QR built on total |
| T-02-17 | Tampering | high | `web/src/stores/cart.ts:17-27` stores roundId/varietyId/saleUnitId/boxId/qty only; `api/src/routes/orders.ts:77-94` body has no price field, re-resolves |
| T-02-18 | Info Disclosure (XSS) | med | No `v-html` on server text anywhere in `web/src/`; text interpolation only (CareView.vue, VarietyDetailView.vue documented) |
| T-02-19 | Spoofing | high | `slip2go.adapter.ts:75-79,144-149` checkReceiver + satang re-check; `slipok.adapter.ts:62-70,105-110` branch-linked payee + satang re-check |
| T-02-20 | Repudiation | high | `api/src/routes/payments.ts:251,261,244` UNIQUE transRef insert → 409 on 23505 |
| T-02-21 | Info Disclosure | high | `api/src/routes/payments.ts:352-371` admin-gated `presignGet` short-TTL (PRESIGN_TTL=300); private bucket, never public |
| T-02-22 | Tampering | high | `api/src/routes/payments.ts:199` server-assigns `slips/${orderId}/${uuid}.jpg`; client never supplies key |
| T-02-23 | DoS | med | `api/src/routes/payments.ts:301-311,322-350` unavailable → awaiting_review + admin `confirm-payment` |
| T-02-24 | Info Disclosure | high | Adapters send key in `Authorization`/`x-authorization` header only, log nothing; `logger.ts:2` never-log-secrets |
| T-02-25 | Tampering | high | `api/src/services/order-transition.ts:79,135` + `jobs/boss.ts:78-79` onlyIfHold gate under row lock |
| T-02-26 | DoS | med | `api/src/jobs/boss.ts:93-106,126-127` `sweepExpiredHolds` scheduled `*/2 * * * *` over holdExpiresAt |
| T-02-27 | Spoofing | high | `api/src/routes/webhook.ts:8,42-46` raw-body `validateSignature`, no body schema attached, 401 on forged/absent |
| T-02-28 | Info Disclosure | med | `api/src/services/notify.ts:131-133` push to `order.lineUserId` only; guest (null) returns false |
| T-02-29 | Info Disclosure | high | Channel secret/token env-only (`env.ts:15-17`); `logger.ts:2` discipline; webhook never logs secret (`webhook.ts:41`) |
| T-02-30 | Tampering | high | `web/src/views/CheckoutWizard.vue:15-17` every amount is a server value; body carries ids+qty+choice+consent only |
| T-02-31 | Tampering | med | `api/src/routes/orders.ts:481-483` server rejects usage!=true → 422 (server authoritative; CTA also client-disabled) |
| T-02-32 | Tampering | med | `api/src/routes/orders.ts:61` `singletonKey: orderId`; `payments.ts:101-144` GET qr idempotent, never mutates hold |
| T-02-33 | Info Disclosure (IDOR) | high | `api/src/routes/me-orders.ts:123` scoped by session customerId; `:157-159` GET :id 404s if not theirs |
| T-02-34 | Elevation | med | `api/src/routes/me-orders.ts:82-84` member guard rejects session without line_user_id (403) |
| T-02-35 | Tampering | high | `api/src/routes/me-orders.ts:366-390` reorder re-prices at current open round; never replays snapshot price |

## Accepted risks log

| ID | Category | Sev | Disposition | Rationale |
|----|----------|-----|-------------|-----------|
| T-02-08 | Spoofing (LIFF endpoint → wrong Login channel) | medium | ACCEPT | Mitigation is a LINE-console configuration outside the codebase. A console-config checkpoint verifies the LIFF endpoint's `aud` matches `LINE_LOGIN_CHANNEL_ID` before UAT. Server-side `verifyLineIdToken` (T-02-05) still enforces the correct `aud` at runtime, so a misconfigured channel yields 401 rather than a silent takeover. Accepted at plan time; below the `high` block threshold. |

## Unregistered flags

None. Phase-02 SUMMARY files use a "Threat mitigations applied" section (mapping to
registered T-IDs), not a "Threat Flags" section — no new unmapped attack surface was
reported by the executor.

## Notes

- ASVS L1 grep-depth verification. Each high-severity threat was additionally traced to
  its actual enforcement call site (row lock / requireRole guard / UNIQUE insert / signature
  check / server recompute), not just a comment reference.
- The single guarded `applyTransition` (`order-transition.ts`) is the shared choke point
  reused by staff PATCH, slip-verify, and hold-expiry — one row-lock + re-read closes
  T-02-01/25 for all three callers.
- No implementation files were modified during this audit.
</content>
</invoke>
