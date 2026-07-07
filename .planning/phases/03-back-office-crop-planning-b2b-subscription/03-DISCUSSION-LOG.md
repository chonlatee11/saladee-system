# Phase 3: Back-office, Crop Planning & B2B/Subscription - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 3-Back-office, Crop Planning & B2B/Subscription
**Areas discussed:** Crop forecast → auto sellable qty, B2B (quota/standing/credit), Subscription, Back-office (UI/RBAC/packing/chatbot), Reports/Settings, Packing/Substitution/Dashboard

---

## Crop forecast → auto sellable qty

| Option | Description | Selected |
|--------|-------------|----------|
| Per-variety haircut | Each variety has its own buffer % (hardy 15% / fragile 25%) | ✓ |
| One flat rate (e.g. 80%) | Single buffer in settings for all varieties | |
| No haircut | Open sale = full projected yield | |

| Option | Description | Selected |
|--------|-------------|----------|
| Admin publish gate always | Forecast is a draft; admin reviews then publishes | ✓ |
| Auto-open + editable | Publishes automatically, override afterwards | |

| Option | Description | Selected |
|--------|-------------|----------|
| Record + show delta, admin tunes | MVP: log actual, show forecast-vs-actual, manual param edit | ✓ |
| Auto-tune params | System adjusts params from actuals (drift risk) | |

| Option | Description | Selected |
|--------|-------------|----------|
| 1 batch = 1 lot, auto best-before | Lot ties to planting batch; BBF = harvest + shelf-life | ✓ |
| Manual lot per harvest | Admin enters lot + best-before each harvest | |

| Option | Description | Selected |
|--------|-------------|----------|
| Template one-click → auto-create batches | Saved recipe spawns the week's batches | ✓ |
| Manually create each batch | No template; enter every batch each round | |

| Option | Description | Selected |
|--------|-------------|----------|
| Match by projected harvest date → round.harvestDate | Auto-join batches to the round they harvest into | ✓ |
| Manual batch → round assignment | Admin picks the round per batch at publish | |

**User's choice:** All recommended (per-variety haircut · admin publish gate · record+show delta · lot=batch auto-BBF · template one-click · auto-match by harvest date).
**Notes:** Owner wants automation to assist, not auto-commit — safety-first.

---

## B2B — quota, standing orders, credit

| Option | Description | Selected |
|--------|-------------|----------|
| Admin sets/approves B2B flag | Admin marks the customer as B2B | |
| Self-signup → pending → approval | Customer requests B2B in LIFF, admin approves | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Standing order reserves quota at round creation | Sum standing orders → reserve before B2C | ✓ |
| Admin sets a % ceiling per round for B2B | Flat share cap rather than per-standing-order | |

| Option | Description | Selected |
|--------|-------------|----------|
| Reserve FCFS + flag admin | First-come reserved; overflow flagged, admin decides | ✓ |
| Hard block | Later standing orders that don't fit are rejected | |

| Option | Description | Selected |
|--------|-------------|----------|
| Record terms + unpaid/paid status | Invoice-later, no credit-limit block | ✓ |
| Credit limit + block when exceeded | Full credit line enforcement | |
| No credit — B2B pays like B2C | Prepay only | |

**User's choice:** Self-signup→approval · standing order reserves quota at round creation · FCFS + flag · record terms + pay status.
**Notes:** B2B onboarding chosen as self-service (differs from admin-set recommendation).

---

## Subscription

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-defined package, system fills per round | Pick S/M/L by value; system picks varieties | ✓ |
| Fixed variety recipe every round | Customer sets fixed varieties/qty | |
| Choose fresh each round before cut-off | Re-select every round | |

| Option | Description | Selected |
|--------|-------------|----------|
| Generate + reserve at round-open (before walk-in) | Subscriptions get priority quota | ✓ |
| Generate + reserve from same B2C pool | No priority; may sell out | |

| Option | Description | Selected |
|--------|-------------|----------|
| Editable until the round's cut-off | pause/skip/cancel until cut-off | ✓ |
| Must notify X days ahead | Advance-notice window | |

| Option | Description | Selected |
|--------|-------------|----------|
| Pay per round — QR/slip like a normal order | Reuse Phase-2 payment flow | ✓ |
| Prepay N rounds as a package | Bundle billing | |

**User's choice:** All recommended (package fills per round · reserve at round-open before walk-in · editable until cut-off · pay per round).

---

## Back-office — UI, roles, packing, chatbot

| Option | Description | Selected |
|--------|-------------|----------|
| Separate admin app (web-admin/) | New Vue+Vite package, desktop, jose auth | ✓ |
| Add /admin routes in web/ | Extend the LIFF app | |

| Option | Description | Selected |
|--------|-------------|----------|
| Least-privilege by role | grower=crop, packer=pack queue, owner/admin=full | ✓ |
| All staff see everything | Defer fine-grained | |

| Option | Description | Selected |
|--------|-------------|----------|
| HTML print-friendly → browser print | Cheap/fast, no font embed | |
| PDF (pdfmake + Sarabun) | Real PDF, embed Thai font | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Keyword/postback + LIFF deep-link | Canned replies → open LIFF to order | ✓ |
| In-chat step-by-step postback ordering | Conversational flow in chat | |

**User's choice:** Separate web-admin/ · least-privilege · PDF pack slips (Sarabun) · canned chatbot + LIFF deep-link.
**Notes:** PDF chosen over browser print (differs from recommendation).

---

## Reports & Settings

| Option | Description | Selected |
|--------|-------------|----------|
| Tables + basic charts + CSV | Standard MVP reporting | |
| Tables only + CSV | Cheapest | |
| Full analytics dashboard (deep charts/filters) | Rich interactive analytics | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Move frequently-changed to UI, keep risky in config | Rounds/prices/fees/hold/haircut in UI; secrets in config | ✓ |
| Keep most in config; UI only rounds/prices | Minimal UI settings | |

**User's choice:** Full analytics dashboard · move frequently-changed settings to UI (secrets stay in config).
**Notes:** Full analytics chosen over MVP tables (differs from recommendation) — intentional richer scope; noted for planner sizing.

---

## Packing, Substitution & Dashboard

| Option | Description | Selected |
|--------|-------------|----------|
| Group by round → then method/zone | Pack queue grouped by delivery route | ✓ |
| Group by method/zone → then round | Route-first grouping | |

| Option | Description | Selected |
|--------|-------------|----------|
| Fill from available varieties to reach value | Package auto-fills from what's in the round | ✓ |
| Follow per-subscription substitution policy | allow → swap; disallow → reduce/notify | |

| Option | Description | Selected |
|--------|-------------|----------|
| 4 criterion cards only | today/round sales, unpaid, near-sold-out, next yield | |
| + B2B/subscription card | Add standing/subscription + overflow flag | ✓ |

**User's choice:** Group by round→method/zone · auto-fill box from available to reach value **and notify the customer via LINE on substitution** · dashboard 4 cards + B2B/subscription card.
**Notes:** User added the LINE substitution notification requirement (reuses Phase-2 notify).

---

## Claude's Discretion

- Exact new tables/columns + reversible migrations (variety params, batches,
  mix templates, harvest logs/lots, subscriptions, standing orders, credit
  terms/status, report aggregates).
- web-admin/ directory layout, routing, components; TanStack Query/Table versions;
  self-contained low-cost chart library for reports.
- Flex-card copy (chatbot, substitution notice); dashboard card layout; TypeBox
  schemas for all new endpoints.

## Deferred Ideas

- Full B2B credit line/limit with blocking → later phase.
- Demand-driven reverse planting (CROP-07), NLU chatbot + broadcast (LINE-04/MKT-03),
  web storefront (ORD-05), promotions (MKT-01), loyalty (CUST-03),
  multi-carrier tracking (DEL-05) → Phase 4.
- Auto param tuning from harvest history → deferred (manual to avoid drift).
- Recurring/prepaid subscription billing engine → not built (per-round QR reuses Phase 2).

## Late addition (final turn)

- **TanStack Query + TanStack Table for web-admin/** — user requested
  `@tanstack/vue-query` (data fetching/caching) + `@tanstack/vue-table` (headless
  grids) for all back-office pages. Captured as CONTEXT D-18.
