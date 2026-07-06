# Phase 2: LINE Storefront, Payments & Delivery - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-04
**Phase:** 2-LINE Storefront, Payments & Delivery
**Areas discussed:** Payments (slip+PromptPay), Hold-expiry, Delivery, LIFF+Rich Menu+PDPA, Product content, Payment confirmation, Reorder, Notifications, Slip storage

---

## Payments — slip verify + PromptPay

| Question | Selected |
|----------|----------|
| Slip-verify provider | ✓ Let Claude pick cheapest at research (adapter over EasySlip/SlipOK/Slip2Go) |
| Verify scope | ✓ Match payee + amount |
| API-down fallback | ✓ Admin manual-confirm always available |
| Amount tolerance | ✓ Exact (to the satang) |

**Notes:** Self-OCR stays out per REQUIREMENTS out-of-scope. → D-01..D-04, D-07.

---

## Hold-expiry (QR hold → release)

| Question | Selected |
|----------|----------|
| Hold window | ✓ Configurable (default 30 min, kept in config) |
| On expiry | ✓ Cancel order + release stock (reuse Phase-1 D-08) |
| Timer start | ✓ At order creation |
| Re-show QR | ✓ Idempotent, does not extend hold |

**Notes:** → D-08..D-11.

---

## Delivery — zones, fees, restrictions

| Question | Selected |
|----------|----------|
| Zone model | ✓ Named zones in config + rate per (zone × method) |
| Freshness rule | ✓ delivery-class field per variety |
| Delivery date | ✓ Derived from round's deliveryDate |
| Free shipping >500฿ | ✓ Self-delivery + general carrier only (not Grab/Lalamove) |

**Notes:** → D-12..D-15.

---

## LIFF + Rich Menu + PDPA (batch 1)

| Question | Selected |
|----------|----------|
| Checkout UX | ✓ Multi-step wizard |
| Login | ✓ LINE Login default + guest allowed |
| Rich Menu scope | ✓ Core full + points button deferred to Phase 4 |
| PDPA consent timing | ✓ At checkout before collecting personal data |

**Notes:** → D-16..D-18, D-25.

---

## Notifications + marketing consent + data rights (batch 2)

| Question | Selected |
|----------|----------|
| Notify triggers | ✓ Key milestones only (conserve push quota) |
| Marketing consent | ✓ Separate checkbox, default unchecked + logged |
| PDPA data rights | ✓ Admin manual handling for MVP |

**Notes:** → D-21, D-26, D-27.

---

## Product content & Rich Menu extras (user-raised)

| Question | Selected |
|----------|----------|
| Care content depth | ✓ Short nullable fields per variety, shown in LIFF detail |
| Rich Menu content button | ✓ Add a "ความรู้เรื่องผัก/วิธีเก็บรักษา" button linking to a content page |
| Other LINE gimmicks | ✓ Enough for Phase 2 — rest deferred |

**Notes:** User wants the LINE experience to teach as it sells (storage/washing tips,
variety list). Variety list/description/photo already in Phase-1 catalog. Full
content hub deferred to Phase 4. → D-24, D-18.

---

## Payment confirmation + reorder (follow-up A)

| Question | Selected |
|----------|----------|
| Clean-verify → auto paid? | ✓ Auto-mark paid on clean verify; admin only handles exceptions |
| Reorder behavior | ✓ Pre-fill cart + re-price at current round |
| Guest history/reorder | ✓ Member-only (LINE Login) |

**Notes:** → D-05, D-19, D-20.

---

## Notification format + slip storage + duplicate scope (follow-up B)

| Question | Selected |
|----------|----------|
| Notification format | ✓ Flex message cards (user preference — accepts extra template work) |
| Slip storage | ✓ Compress + private bucket + signed URL (reuse Phase-0 storage) |
| Duplicate scope | ✓ System-wide by transaction ref (unique constraint) |

**Notes:** → D-22, D-28, D-06.

---

## Claude's Discretion

- Concrete slip-verify vendor (behind adapter), PromptPay QR library, exact TypeBox schemas.
- Flex card layout/copy, exact milestone→message mapping.
- Table/column layout + reversible migrations (up + hand-written down).
- Config surface for hold window, zones×methods, payee ID.
- Reorder edge-case UX beyond the agreed shape.

## Deferred Ideas

- Loyalty/points Rich Menu button + program → Phase 4 (CUST-03).
- Full vegetable content/education hub → Phase 4 marketing.
- Conversational/NLU chatbot + segmented broadcast → Phase 4.
- Self-serve PDPA export/deletion in LIFF → deferred (admin-manual for MVP).
- Province/postal-code zones + carrier tracking API → Phase 4 (DEL-05).
- Invoice PDF generation → when needed, off Phase-1 data.
- B2B/subscriptions/packing/dashboards/reports/crop auto-feed → Phase 3.
