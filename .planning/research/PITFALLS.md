# Pitfalls Research

**Domain:** Thai fresh-produce salad e-commerce — LINE-OA-first (Rich Menu + LIFF + Messaging API), perishable harvest-cycle inventory, PromptPay QR + bank-slip payments, crop planning/yield forecast, B2C/B2B/subscription, own-fleet + cold-chain delivery, lowest-cost stack, PDPA
**Researched:** 2026-06-28
**Confidence:** HIGH on LINE platform limits, PromptPay payload, slip-verification ecosystem, and PDPA (verified against official LINE docs, EMVCo/BOT-aligned libraries, and Thai legal sources). MEDIUM on harvest-forecast and cold-chain operational specifics (domain-reasoned, fewer authoritative web sources). Phase mapping uses the SRS Phase 1/2/3 split (SRS §8).

---

## Critical Pitfalls

### Pitfall 1: Oversell under live-selling traffic spikes (stock-reservation race condition)

**What goes wrong:**
Two or more buyers reserve the last units of a variety simultaneously during a TikTok/Facebook live or a broadcast push. The app reads "available = 3", both checkouts pass the check, both create orders, and you have committed 6 units against 3 real heads of lettuce. With perishable goods you cannot back-order — someone gets cancelled after paying, or you harvest immature plants to cover.

**Why it happens:**
The naive pattern is read-modify-write in application code (`SELECT available; if available >= qty: INSERT order; UPDATE stock`). Under concurrency the SELECT is stale by the time the UPDATE runs. SRS NFR-02 explicitly demands atomic locking but the MVP "manual quantity per round" (FR-04 partial) makes it tempting to treat stock as a plain integer field edited by hand.

**How to avoid:**
- Do the decrement **atomically in the database**, never in app code. Use a conditional update: `UPDATE round_variety SET reserved = reserved + :qty WHERE id = :id AND (quota - reserved) >= :qty RETURNING *;` — zero rows returned = sold out, reject. This is a single round-trip and is safe under any concurrency without explicit locks.
- Model stock as `quota` (sellable for the round) and `reserved` (sum of holds), never a single mutable `available` integer that admins also edit by hand.
- Reserve at **order creation / QR generation**, not at payment confirmation. Pair with a hold-expiry job (FR-19) that releases `reserved` if unpaid past the QR timeout.
- Make reservation **idempotent** keyed on order ID so webhook retries or double-taps on a slow LIFF button cannot double-decrement.
- For the mixed-salad box, the decrement must touch **every component variety in one transaction** (see Pitfall 5).

**Warning signs:**
Sum of order line quantities for a round exceeds the round quota; "available" goes negative; customer complaints of post-payment cancellations clustered right after a broadcast/live; admin manually "fixing" stock numbers.

**Phase to address:** Phase 1 (this is the core value proposition — "ไม่ oversell"; must be correct from the first sellable order).

---

### Pitfall 2: PromptPay QR payload incorrectness (wrong CRC16, amount tag, or merchant ID format)

**What goes wrong:**
You hand-build the EMVCo TLV string and the customer's banking app rejects the QR ("invalid QR"), or — worse — it scans but shows the **wrong amount** or no amount (a free-amount QR), so customers underpay/overpay and reconciliation breaks. Generating QR server-side (the chosen cost-saving path, SRS §11) means you own correctness end-to-end; there is no gateway to validate it.

**Why it happens:**
EMVCo QR is a strict TLV format: each field is `[2-digit tag][2-digit length][value]`, the merchant block is tag **30** (PromptPay bill-payment) with nested sub-tags (AID `A000000677010112`, biller/proxy ID, ref1/ref2), currency tag **53** = `764` (THB), amount tag **54**, country tag **58** = `TH`, and a trailing CRC tag **63** computed with **CRC16/CCITT-FALSE (polynomial 0x1021, init 0xFFFF)** over the entire string *including* the literal `6304`. Common bugs: computing CRC over the wrong byte range, mis-counting nested lengths, formatting the amount without two decimals, switching tag 29↔30, or using the phone proxy when an amount is required.

**How to avoid:**
- **Do not hand-roll.** Use a maintained, EMVCo/BOT-aligned library (Go: `Frontware/promptpay` or `kazekim/promptpay-qr-go`; JS: `promptparse`; PHP: `phoomin2012/promptparse-php`). These encode tag 30, currency, amount, and CRC16 correctly.
- Always generate an **amount-specified** QR (tag 54 present) for prepaid orders so the buyer cannot edit the amount — this is what makes slip reconciliation tractable (FR-36 fixed-weight packs exist precisely to keep amounts exact).
- Add a unit test that decodes your own generated payload back to fields and asserts amount, proxy ID, and a known-good CRC against a reference vector.
- Validate by scanning with at least two real Thai banking apps (KBank, SCB) before launch — emulators won't catch issues.

**Warning signs:**
"QR ใช้ไม่ได้" support messages; banking app shows blank/editable amount; CRC fails an online EMVCo validator; payments arriving with cents off.

**Phase to address:** Phase 1 (payment is in the MVP). Verification-vector test belongs in the same phase.

---

### Pitfall 3: Bank-slip reconciliation without OCR — duplicate/forged/recycled-slip fraud

**What goes wrong:**
Admin confirms payment by eyeballing an uploaded slip image. Customers (a) re-upload the **same real slip** for two different orders, (b) upload a **Photoshopped** slip, (c) upload a slip for a **smaller amount** hoping the admin won't check, or (d) upload an old slip from a previous order. At volume, manual review is slow, error-prone, and a known fraud vector in Thai social commerce.

**Why it happens:**
The SRS defers OCR to Phase 3 and starts with manual admin verification (FR-18). Teams assume "manual = safe" but manual review checks *that a slip exists*, not *that the transfer is real, unique, and the right amount*.

**How to avoid:**
- **Skip OCR entirely — read the QR on the slip instead.** Every Thai bank slip carries a QR/barcode payload containing a unique transaction reference. Use a Thai slip-verification API that confirms the transfer against the bank and **flags duplicates automatically**: EasySlip, SlipOK, RDCW, or the banks' own (KBank Slip Verification API, SCB). These return amount, sender, timestamp, and a transaction ref you can store. This is cheaper and far more reliable than OCR and is feasible inside the low-cost constraint (free/low-cost tiers exist; KBank/RDCW offer free quotas). The unified `slipverify` SDK abstracts multiple providers.
- Enforce **uniqueness on the bank transaction reference** (DB unique constraint) so the same slip can never confirm two orders.
- **Cross-check the amount** from the verification API against the order total; only auto-confirm on exact match, otherwise route to manual review.
- If a verification API is genuinely out of budget at launch, at minimum: store a perceptual/file hash of every uploaded slip and block exact-duplicate images, require the slip timestamp to be after order creation, and never confirm an amount lower than the order total.

**Warning signs:**
Same slip image/ref appearing on multiple orders; confirmed orders whose paid amount < order total; slips with timestamps predating the order; rising chargeback/"I paid but you cancelled" disputes.

**Phase to address:** Phase 1 — slip verification API integration should be pulled **forward from Phase 3** because the fraud exists from order #1. Even if full OCR is deferred, duplicate-ref blocking is a Phase 1 must.

---

### Pitfall 4: LINE push-message quota/cost blowout and broadcast economics

**What goes wrong:**
You build status notifications (FR-16) and promo broadcasts (FR-31) on `push`/`broadcast` and silently exceed the free message tier. In Thailand the free tier is small (~200–500 targeted messages/month); paid plans run ~1,200–1,500 THB/month for 15,000–35,000 messages, then ~0.04–0.08 THB per extra message. A growing customer base + per-status-change notifications (paid → packing → shipped → delivered = 4 pushes/order) multiplies fast and quietly breaks the "lowest-cost" constraint (NFR-08).

**Why it happens:**
Push counts **per recipient**, not per API call, and developers forget that every order-status update is a billable message at scale. Broadcasts to the whole friend list are especially expensive.

**How to avoid:**
- Prefer **reply messages** (free, within the webhook reply-token window) over push wherever the user just interacted — e.g., confirm an order in the same LIFF/chat turn rather than pushing it.
- **Batch status notifications**: combine "packing + shipping" into fewer pushes; let customers pull status via the Rich Menu "ติดตามออเดอร์" + LIFF instead of pushing every transition.
- Treat broadcast as a paid marketing lever with an explicit budget; segment (FR-31) instead of blasting all friends.
- Instrument a **monthly message counter** and dashboard it (tie into FR-33) so you see quota burn before the bill.
- Model the per-plan break-even early; the jump from free to Basic plan is a real fixed cost the budget owner must approve.

**Warning signs:**
Approaching the monthly quota mid-month; sudden push failures (quota exhausted); marketing wanting "broadcast to everyone" without a budget line.

**Phase to address:** Phase 1 (notifications, FR-16) for the architecture decision (reply-vs-push, pull-vs-push); Phase 2/3 for broadcast budgeting (FR-31, FR-49).

---

### Pitfall 5: Mixed-salad-box bundle inventory math (limited by scarcest variety)

**What goes wrong:**
The box sells as one SKU but consumes N varieties. If availability is computed from the box's own integer instead of `min()` across components, you oversell boxes you can't assemble — or you under-sell because you forgot a component is plentiful. Worse, when a box order is placed you must decrement **all** component varieties atomically; partial decrement under concurrency corrupts both the box's and the individual varieties' counts (a variety can be sold both standalone and inside boxes — FR-51 + FR-10).

**Why it happens:**
Bundles look like a normal product. Developers store a `stock` number on the box row. The harvest model (200 plants/round split across 6 varieties → ~30–35 each) means each variety is genuinely scarce, so the "scarcest component" constraint bites constantly. FR-51 states the rule ("จำกัดตามชนิดที่มีน้อยสุด") but it's easy to implement as an afterthought.

**How to avoid:**
- **Never store a stock number on the bundle.** Compute sellable boxes on the fly: `floor(min over components of (component_quota - component_reserved) / qty_per_box)`.
- On box checkout, decrement every component in **one transaction** using the same conditional-update pattern as Pitfall 1; if any component fails the guard, roll the whole order back.
- Account for the **shared pool**: a variety's `reserved` must include both standalone sales and box consumption. The box's recipe (fixed vs "คละตามของรอบนี้") changes the math — for "mixed by round" boxes, define the substitution rule up front (FR-07) so a missing component degrades gracefully instead of blocking the sale.
- Display the live "scarcest component" to the buyer so a box silently goes "หมดรอบนี้" the moment any component runs out.

**Warning signs:**
Box orders that can't be packed because one variety ran out; component variety counts going negative; box "in stock" while a component is sold out standalone.

**Phase to address:** Phase 1 (mixed-salad box is FR-51, in the MVP). The atomic multi-component decrement must ship with the box feature, not be retrofitted.

---

### Pitfall 6: B2B quota reservation starving B2C (or vice-versa)

**What goes wrong:**
B2B standing orders (FR-39) reserve produce from the forecast "before B2C." If the reservation logic is sloppy, either (a) B2B holds soak up the entire round and B2C live-sells nothing (killing the high-margin impulse channel), or (b) B2B holds aren't actually enforced and a B2C rush leaves a restaurant without its standing order — breaking the B2B trust that the whole "กันโควตา" promise is built on.

**Why it happens:**
Two reservation systems (recurring B2B holds vs real-time B2C checkout) compete for the same scarce, forecast-derived pool. Without an explicit allocation policy they race or double-count. The small per-variety supply (~30–35 plants) makes contention severe.

**How to avoid:**
- Model an explicit **allocation layer per round per variety**: `b2b_reserved`, `b2c_quota = forecast_grade_yield − b2b_reserved`. B2C checkout can only draw against `b2c_quota`; B2B standing orders draw against their reserved block.
- Make B2B reservation happen **at round-open** (when the harvest forecast feeds the round, FR-43), before B2C selling opens, so the split is deterministic.
- Add an admin override/cap so a single B2B account can't reserve 100% of a variety; surface remaining B2C headroom on the dashboard (FR-33).
- Handle the **shortfall path**: when actual harvest (FR-44) comes in below forecast, define who gets cut first (policy decision — typically B2C impulse before contracted B2B) and notify automatically.

**Warning signs:**
B2C "sold out" while large unsold B2B holds sit idle; restaurants reporting missing standing-order items; allocation numbers that don't reconcile to forecast.

**Phase to address:** Phase 2 (Standing Order + B2B quota is FR-39, Phase 2). But Phase 1's stock model must be designed so a B2B allocation layer can be added without re-architecting (reserve `quota`/`reserved` split, not a single integer).

---

### Pitfall 7: Subscription billing/scheduling edge cases (pause/skip/cut-off collisions)

**What goes wrong:**
A subscriber pauses, skips, or cancels **after** the round cut-off (Tuesday 20:00) but before delivery — and the system either still charges/harvests for them (waste + refund) or fails to generate an order it should have. Other classics: pause that silently swallows a cycle the customer expected, skip that doesn't release the reserved stock back to the pool, payment failure mid-subscription with no retry, and timezone bugs around the cut-off boundary.

**Why it happens:**
Subscriptions add a recurring scheduler on top of an already cut-off-driven perishable cycle. The interaction of "customer action time" vs "round cut-off time" vs "harvest commit time" creates a window where state changes are unsafe. Prepaid produce can't be un-harvested.

**How to avoid:**
- Define a hard **subscription cut-off = round cut-off** and make pause/skip/cancel **no-ops for the current round once cut-off passes** (apply to the next round), shown clearly in UI: "หยุดมีผลรอบถัดไป."
- Generate the next cycle's order at round-open, **reserve stock then**, and **release reservation immediately on a valid skip** (before cut-off) so the pool recovers.
- Store subscription state transitions with effective-round, not just timestamps, to avoid timezone ambiguity (all logic in Asia/Bangkok).
- Build a **dunning/retry** path for failed payment (the QR-hold-expiry mechanism from FR-19 can be reused) before auto-cancelling.
- Idempotent cycle generation keyed on (subscription_id, round_id) so a re-run never creates duplicate orders.

**Warning signs:**
Subscribers charged after pausing; harvested boxes with no recipient; skipped cycles still reserving stock; duplicate subscription orders for one round; complaints about "หยุดแล้วทำไมยังตัดเงิน."

**Phase to address:** Phase 3 (Subscription Box is FR-10, Phase 3). But the round cut-off + reservation-release semantics designed in Phase 1 must be subscription-compatible.

---

### Pitfall 8: Harvest-forecast inaccuracy cascading into oversell or waste

**What goes wrong:**
Phase 2 auto-feeds "sellable per round" from the harvest calendar (FR-43) using `plants × survival_rate × avg_weight`. If the forecast is optimistic (weather, pests, disease drop the survival rate below the default 80%), you sell produce that never matures → mass cancellations on prepaid orders. If pessimistic, you under-open the round → waste + lost revenue on a 2–3-day-shelf-life product.

**Why it happens:**
Default parameters (80% survival, generic days-to-harvest) are placeholders (SRS §7 table is unfilled). Real yields vary per variety, season, and weather. Treating a *forecast* as a *commitment* couples a noisy estimate directly to irreversible prepaid sales.

**How to avoid:**
- **Sell against a discounted forecast, not the raw one.** Open a round at a conservative fraction (e.g. forecast × confidence haircut) and release more to sell as harvest day approaches and confidence rises. Keep manual override (Phase 1's manual FR-04 stays as the safety valve).
- Insert a **harvest-confirmation gate**: between forecast-open and pack/cut-off, the grower confirms actual countable progress; the sellable number snaps to reality before final commitments.
- Close the loop with **actual-harvest logging (FR-44)** and auto-tune per-variety parameters so the forecast improves over time — but never let an unvalidated forecast drive prepaid sales without the haircut.
- Pair with a **substitution policy (FR-07)** so a small shortfall degrades to a swap rather than a cancellation.

**Warning signs:**
Actual harvest repeatedly below forecast for a variety; cancellation rate rising after the forecast auto-feed goes live; consistent leftover/waste on a variety (forecast too low); survival rate diverging from the 80% default.

**Phase to address:** Phase 2 (crop forecast + auto-feed is FR-40–44). Phase 1 keeps manual entry as the deliberate de-risking step (a Key Decision in PROJECT.md) — do not skip straight to auto-forecast.

---

### Pitfall 9: Cold-chain / perishable delivery timing mismatch

**What goes wrong:**
Salad has a 2–3 day chilled shelf life. Orders get routed to a delivery method or day incompatible with freshness — e.g. a far-province order shipped via standard courier (Flash/Kerry) over a weekend arrives wilted; or a customer picks a delivery date the harvest round can't satisfy; or own-fleet routes for the Thu–Sun window are overloaded because checkout never capped slots per route/day.

**Why it happens:**
Delivery method, zone, sales model, and harvest round are four coupled constraints (SRS §6.2) but checkout often treats shipping as a flat picker. FR-22 (restrict method by product perishability) and FR-23 (delivery date must match round) are easy to under-enforce.

**How to avoid:**
- **Constrain delivery options at checkout based on the round and product**: very-perishable items offer only own-fleet/cold-chain/same-day Grab; standard courier only for hardy varieties + gel pack + near zones (SRS §6.2). Don't show a shipping option the freshness model forbids.
- Bind selectable **delivery dates to the round's ship window** (Thu–Sun) — a customer cannot choose a date the harvest can't fill.
- **Cap own-fleet capacity per zone per day** so the Samut Prakan fleet isn't oversubscribed; group the pack queue by route (FR-15).
- Include cold-packaging cost (gel pack/box 20–40 THB, SRS §6.1) in the shipping calc so margins aren't silently eaten.

**Warning signs:**
Quality complaints concentrated in courier/out-of-zone orders; delivery dates chosen that don't map to a round; own-fleet route overloaded on peak weekend; cold-pack costs not reflected in fees.

**Phase to address:** Phase 1 (basic own-fleet + general courier + freshness-based method restriction, FR-20 partial/21/22/23). Full 4-mode + cold-chain/Grab + courier API in Phase 3.

---

### Pitfall 10: PDPA non-compliance on stored slips and customer data

**What goes wrong:**
Payment slips contain the sender's name, bank, account fragment, and amount — clearly personal data. Storing them in a public-readable object-storage bucket, with no consent record, no retention limit, and no access control, is a PDPA violation (fines up to THB 5M + criminal liability). Same for guest-checkout PII (name/phone/address) and LINE user IDs collected without consent or privacy notice.

**Why it happens:**
The low-cost path (cheap object storage for slips/images, SRS §11) defaults to convenient/public buckets. Consent and retention feel like "later" work, but PDPA has been in full force since June 2022 and applies from the first customer.

**How to avoid:**
- **Slips and PII are private by default**: object storage buckets non-public, served via short-lived signed URLs, access restricted by role (NFR-03). Never embed slip URLs in client-visible LIFF state.
- **Consent at collection**: explicit, freely given, withdrawable consent + a privacy notice at signup/guest checkout (FR-25), with a stored **consent log** (NFR-04) capturing what/when/version.
- **Define retention up front**: keep slips only as long as needed for accounting/dispute (then purge or anonymize); document the retention period (PDPA requires disclosing it).
- Implement **data-subject rights**: delete/export on request (NFR-04). Design schema so a customer's PII can be erased/anonymized without breaking order history (separate PII from order facts).
- Separate **marketing consent** (broadcast/FR-31) from transactional processing — broadcasting to users who didn't opt in is a distinct violation.

**Warning signs:**
Slip image URLs that open without auth; no consent timestamp on customer records; no documented retention period; no delete/export path; marketing pushes to non-consenting users.

**Phase to address:** Phase 1 (PDPA ขั้นต้น is explicitly in MVP scope, NFR-04; private slip storage + consent + notice are launch-blocking). Full data-subject-rights tooling can mature through Phase 2/3 but the foundations (private storage, consent log) are Phase 1.

---

### Pitfall 11: Over-engineering the MVP against the low-cost constraint

**What goes wrong:**
The team builds the full crop-forecast engine, Kubernetes, a message queue, microservices, and a custom OCR pipeline before selling a single box — burning the budget (NFR-08 "ต้นทุนต่ำสุด") and delaying the Phase 1 goal of "ขายผ่าน LINE ได้จริง." Conversely, premature scaling infra adds fixed monthly cost that contradicts the explicit "free/cheap first, scale when revenue grows" constraint.

**Why it happens:**
The SRS is feature-rich (51 FRs) and the harvest-forecast module is intellectually attractive. It's tempting to build the "correct" full system. But Phase 1 deliberately uses **manual stock entry** and defers forecast/OCR/web/subscription — a Key Decision in PROJECT.md.

**How to avoid:**
- **Respect the phase split.** Phase 1 = single backend API + one Postgres + LIFF static site + LINE OA, manual round quantities, manual-or-API slip check, own-fleet + courier. No queue, no microservices, no K8s, no forecast engine.
- Use the **monolith + managed-Postgres-free-tier + serverless/small-VPS** path (SRS §11). One deployable, one DB.
- Defer forecast auto-feed (Phase 2), OCR/web/subscription/broadcast (Phase 3) exactly as the roadmap states — but design the Phase 1 stock model so the forecast layer plugs in without rewrite (see Pitfalls 1, 6, 8).
- Treat every fixed monthly cost as a decision the budget owner signs off (LINE paid plan, managed DB upgrade, slip-API tier).

**Warning signs:**
Sprint spent on infra/forecast before first real LINE order; introducing queues/microservices "for scale" pre-revenue; monthly fixed cost rising before sales justify it; Phase 3 features creeping into Phase 1.

**Phase to address:** Phase 1 (scope discipline) — and reinforced at every phase transition.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Manual round-quantity entry (FR-04) instead of forecast auto-feed | Ships Phase 1 fast; avoids forecast complexity | Human error in stock; doesn't scale across 6 varieties × weekly rounds | **Acceptable in Phase 1** (explicit Key Decision) — must keep manual override even after Phase 2 forecast lands |
| Manual admin slip review without verification API | Zero integration in week 1 | Duplicate/forged-slip fraud; slow at volume | Only as a stopgap; add duplicate-ref blocking ASAP — **not** acceptable past low volume |
| Single mutable `available` integer for stock | Simple CRUD | Race conditions, oversell, can't add B2B allocation | **Never** — use `quota`/`reserved` split from day one |
| Bundle stored as its own stock number | Easy product model | Oversold boxes, corrupt component counts | **Never** — compute box availability from `min()` of components |
| Push-message for every status change | Simple notification code | Quota/cost blowout at scale | Acceptable at tiny volume; move to reply+pull before growth |
| Slips in cheap public bucket | Cheapest storage | PDPA violation, data leak | **Never** — private bucket + signed URLs is not meaningfully more expensive |
| All datetime logic in server-local/UTC without explicit Asia/Bangkok | Less thinking up front | Cut-off boundary bugs in subscriptions/rounds | Never for cut-off/round logic — pin Asia/Bangkok |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LINE Messaging API (webhook) | Assuming exactly-once, in-order delivery; reusing reply token after >1 min | Enable redelivery, **dedupe on `webhookEventId`**, treat as at-least-once and possibly out-of-order (check `timestamp`); reply token valid ~1 min, also on redelivered events (if original unused) |
| LINE push/broadcast | Counting per API call, not per recipient; ignoring quota | Push counts **per recipient**; messages to blocked/invalid users don't count; instrument quota; prefer free reply messages |
| LINE Rich Menu | Exceeding 20 tap areas; wrong aspect ratio; expecting click tracking on LIFF links | Max **20 areas**, width 800–2500px, aspect ratio ≥1.45, up to 1000 menus/account; **LIFF-linked menu taps can't be tracked/tagged** |
| LIFF login | Forcing LINE Login when SRS requires guest checkout (FR-25) | Support both LINE Login and guest; don't gate the cart behind login |
| PromptPay QR | Hand-rolling TLV/CRC; free-amount QR; tag 29 vs 30 mix-up | Use a maintained library; always amount-specified (tag 54); CRC16/CCITT-FALSE (0x1021, init 0xFFFF) over full string incl. `6304`; currency `764`, country `TH` |
| Thai bank slip | Pure-OCR or pure-manual verification | Read the **QR on the slip** via EasySlip/SlipOK/KBank/RDCW API with built-in duplicate detection; enforce unique transaction-ref constraint |
| Object storage (slips) | Public bucket / long-lived URLs | Private bucket, role-restricted, short-lived signed URLs (PDPA) |
| Courier (Flash/Kerry) — Phase 3 | Allowing perishable items on slow courier | Restrict by perishability + zone + gel pack; bind to round ship window |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Read-modify-write stock in app code | Oversell during live/broadcast | Atomic conditional DB update | First concurrent checkout spike (a single live session) |
| Push-per-status-change | LINE bill spikes; quota exhausted mid-month | Reply+pull model; batch notifications | Hundreds of orders/month on free/Basic tier |
| Bundle availability recomputed with N queries per page view | Slow LIFF product list | Compute `min()` in one query / cache per round | Catalog page under live-traffic load |
| Synchronous slip-verification API call in checkout request | Checkout latency/timeouts | Verify async after upload; confirm out-of-band | Verification provider latency under burst |
| No per-round/per-route capacity cap | Own-fleet overbooked weekend | Cap delivery slots per zone/day at checkout | First peak B2C weekend |
| Unindexed reservation/round queries | Slow availability checks | Index on (round_id, variety_id); keep reserved aggregates | As order history grows over months |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Public/guessable slip image URLs | PDPA breach; exposure of customers' bank info | Private storage, signed short-lived URLs, role-gated access |
| Trusting client-supplied price/amount from LIFF | Underpayment; tampered orders | Server recomputes price from daily per-variety price (FR-38) and round; never trust client total |
| No uniqueness on bank transaction ref | Duplicate-slip fraud | DB unique constraint on verified transaction ref |
| Unverified LIFF identity / spoofed user ID | Account/order takeover | Verify LIFF ID token server-side; don't trust client-passed userId |
| Webhook endpoint without LINE signature validation | Forged order/status events | Validate `X-Line-Signature` (HMAC-SHA256 with channel secret) on every webhook |
| Broadcasting to non-consenting users | PDPA marketing violation | Separate marketing consent; suppress non-opted-in recipients |
| Admin slip-confirm without amount cross-check | Confirmed underpaid orders | Auto-compare verified amount to order total; manual review on mismatch |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Pause/skip applied to current round after cut-off | Customer charged/harvested anyway → distrust | "มีผลรอบถัดไป" semantics + clear cut-off messaging |
| Showing delivery dates/methods the round can't fulfill | Wilted produce, cancellations | Constrain options to round ship window + perishability |
| Forcing LINE Login before browsing/cart | Drop-off; violates guest requirement | Guest-first; login optional, used for re-order convenience |
| Silent "sold out" on bundle without explaining scarce component | Confusion, lost trust | Show live scarcest-component status; offer substitution (FR-07) |
| QR with no visible amount / no countdown | Wrong-amount payments; abandoned holds | Amount-specified QR + visible hold/expiry countdown (FR-19) |
| Pushing every status step | Notification fatigue + cost | Batch + Rich Menu "ติดตามออเดอร์" pull view |
| No "สั่งซ้ำ" for repeat staples | Friction on high-frequency produce buys | One-tap reorder from history (FR-28) |

## "Looks Done But Isn't" Checklist

- [ ] **Stock decrement:** Works in a demo of one user — verify it rejects the Nth concurrent buyer (load-test 2+ simultaneous checkouts of the last unit).
- [ ] **PromptPay QR:** Renders an image — verify it scans in two real banking apps **with the correct fixed amount** and passes CRC validation.
- [ ] **Slip verification:** Accepts an upload — verify it **rejects a re-used slip** and a wrong-amount slip, and stores a unique transaction ref.
- [ ] **Webhook handler:** Receives events — verify it **dedupes redelivered events** (`webhookEventId`) and validates `X-Line-Signature`.
- [ ] **Mixed-salad box:** Shows "in stock" — verify it goes sold-out the instant any **component** runs out, and decrements all components atomically.
- [ ] **Hold expiry:** QR generated — verify unpaid holds actually **release reserved stock** back to the pool on timeout.
- [ ] **Subscription pause:** UI toggles — verify a post-cut-off pause does **not** charge/harvest the current round.
- [ ] **PDPA:** Slips stored — verify the URL is **not** publicly accessible and a consent record exists per customer.
- [ ] **Delivery rules:** Checkout completes — verify a perishable item **cannot** select an incompatible courier/zone/date.
- [ ] **Price integrity:** Order total shown — verify server **recomputes** it from daily per-variety price, ignoring any client-supplied total.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Oversell happened | MEDIUM | Reconcile orders vs round quota; honor earliest-paid first; proactively offer substitution (FR-07) or refund + goodwill coupon; fix atomic decrement before next round |
| Wrong PromptPay payload shipped | LOW | Swap to maintained library; regenerate QRs; refund/re-bill mispaid orders from transaction log |
| Duplicate/forged slips accepted | MEDIUM | Back-fill verification API over historical slips; add unique-ref constraint; pursue/blocklist repeat offenders; reconcile against bank statement |
| LINE quota/cost blown | LOW | Switch status notifications to reply+pull; upgrade plan deliberately; segment broadcasts |
| Forecast caused mass cancellation | HIGH | Apply confidence haircut + harvest-confirmation gate; communicate + compensate; tune parameters from actuals (FR-44) |
| PDPA exposure (public slips) | HIGH | Lock buckets immediately; rotate URLs; assess breach-notification duty; back-fill consent log; document retention |
| Subscription mis-charge | MEDIUM | Refund affected cycles; fix effective-round semantics; add idempotent cycle generation + dunning |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Oversell race condition | Phase 1 | Concurrent-checkout load test rejects oversell |
| 2. PromptPay payload incorrect | Phase 1 | Real bank-app scan + CRC vector test |
| 3. Slip fraud / duplicates | Phase 1 (pull forward) | Re-used & wrong-amount slip rejected; unique-ref constraint |
| 4. LINE quota/cost blowout | Phase 1 (notif arch) / 2–3 (broadcast budget) | Reply+pull used; quota counter dashboarded |
| 5. Bundle inventory math | Phase 1 | Box sells out when any component does; atomic multi-decrement |
| 6. B2B quota starves B2C | Phase 2 (model in Phase 1) | Allocation reconciles to forecast; B2C headroom visible |
| 7. Subscription billing edges | Phase 3 (cut-off semantics in Phase 1) | Post-cut-off pause = no charge; idempotent cycles |
| 8. Forecast inaccuracy | Phase 2 (manual safety in Phase 1) | Confidence haircut + harvest-confirmation gate; cancellation rate stable |
| 9. Cold-chain delivery timing | Phase 1 (basic) / 3 (full) | Incompatible method/date blocked at checkout |
| 10. PDPA on slips/data | Phase 1 | Slip URL not public; consent log present; retention documented |
| 11. MVP over-engineering | Phase 1 (all transitions) | First real LINE order shipped on monolith+1 Postgres; no premature infra |

## Sources

- LINE Messaging API pricing & free quota — https://developers.line.biz/en/docs/messaging-api/pricing/ (HIGH)
- LINE Thailand OA plan pricing (Basic/Pro, 15k/35k messages, per-message overage) — https://medium.com/@content_73484/everything-you-need-to-know-about-line-official-account-pricing-in-2025-6c0773eaf02f ; https://www.bangkokpost.com/business/general/1718891 (MEDIUM)
- LINE webhook redelivery / dedupe via webhookEventId / ordering / reply-token window — https://developers.line.biz/en/news/2022/04/19/webhook-redelivery/ ; https://developers.line.biz/en/docs/messaging-api/receiving-messages/ (HIGH)
- LINE Rich Menu limits (20 areas, size, 1000 menus, LIFF link tracking limitation) — https://developers.line.biz/en/docs/messaging-api/using-rich-menus/ ; https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/ (HIGH)
- PromptPay EMVCo TLV / tag 30 / amount tag 54 / currency 53 / CRC16 0x1021 — https://github.com/maythiwat/promptparse ; https://github.com/lee-ratinan/emv-qr ; https://pkg.go.dev/github.com/Frontware/promptpay ; https://github.com/saladpuk/PromptPay (HIGH)
- Thai slip-verification APIs with duplicate detection (EasySlip, SlipOK, KBank, RDCW; unified SDK) — https://document.easyslip.com/ ; https://github.com/maythiwat/slipverify ; https://apiportal.kasikornbank.com/product/public/All/Slip%20Verification/Documentation/Verify (HIGH)
- Thailand PDPA (in force 2022-06-01; consent, retention disclosure, data-subject rights, THB 5M penalty) — https://www.onetrust.com/blog/the-ultimate-guide-to-thai-pdpa-compliance/ ; https://www.dlapiperdataprotection.com/index.html?t=law&c=TH (HIGH)
- Project SRS v0.6 (`salad-shop-requirements.md`) and `.planning/PROJECT.md` — phase split, harvest model, cost constraint, FR/NFR references (HIGH, authoritative for this project)

---
*Pitfalls research for: Thai LINE-OA-first fresh-salad e-commerce with harvest-cycle inventory*
*Researched: 2026-06-28*
