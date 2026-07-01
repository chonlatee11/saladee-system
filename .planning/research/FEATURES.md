# Feature Research

**Domain:** Thai perishable-produce (salad greens) e-commerce via LINE OA (Rich Menu + LIFF) + farm crop-planning, B2C/B2B/Subscription
**Researched:** 2026-06-28
**Confidence:** MEDIUM-HIGH (FR list is authoritative from SRS v0.6; industry-norm categorization verified for PromptPay, slip verification, CSA/farm-box, and subscription-pause patterns)

> This file categorizes the SRS FR-01..FR-51 into **table stakes / differentiators / anti-features**, notes complexity and dependencies, and validates the SRS's 3-phase plan against industry norms. FR IDs in parentheses cross-reference `salad-shop-requirements.md`.

---

## Feature Landscape

### Table Stakes (Users Expect These — missing = customers leave or distrust)

These are not where you win; they are where you lose if absent. For a Thai LINE produce shop, the bar is set by what buyers already experience on other LINE shops and food pages.

| Feature | Why Expected | Complexity | FR | Notes |
|---------|--------------|------------|----|-------|
| Product catalog with photos, category, sell-unit | Baseline storefront; produce sells on freshness imagery | LOW | FR-01 | Photos do heavy lifting for fresh produce trust |
| Fixed-weight packs (250g/500g) as sell unit | Prepayment requires an exact amount; loose-weight breaks PromptPay-amount QR | LOW | FR-36 | Foundational for the whole prepay model |
| Daily/per-round price per variety, pack price auto-computed, price history kept | Produce prices float daily; buyers expect "today's price"; history needed for receipts/tax | MEDIUM | FR-38 | Price history is load-bearing for FR-37 invoices & FR-32 reports |
| Selling round with cut-off (close/harvest/deliver dates) | Pre-order produce is inherently round-based; "order by Tue 20:00" is the model | MEDIUM | FR-03 | The scheduling backbone everything hangs off |
| Sellable-qty per round + oversell prevention (atomic stock lock) | Selling perishables that don't exist destroys trust and wastes a harvest; #1 stated Core Value | HIGH | FR-04, NFR-02 | Atomic decrement + reservation on order create; QR-expiry releases stock (FR-19). MVP = manual qty entry |
| LINE Rich Menu + LIFF ordering, merged to one back office | This *is* the storefront in phase 1; Thai buyers expect to finish in LINE | HIGH | FR-46, FR-47, FR-13 | LIFF form > free-text bot for ordering reliability |
| PromptPay QR with specified amount | Default Thai payment; zero gateway fee when self-generated | LOW | FR-17 | Verified: mature self-host libraries exist (promptparse/promptpay-qr), no gateway needed |
| Bank transfer + slip upload + verification | Older/B2B buyers transfer manually; slip is the proof | MEDIUM | FR-18, FR-19 | See "slip verification" finding below — pure manual check is a fraud risk |
| Order status pipeline + auto LINE notifications | Buyers expect "paid → packing → shipped" pings, especially for perishables they planned meals around | MEDIUM | FR-14, FR-16 | Push via Messaging API on each state change |
| Guest checkout + LINE Login | Friction kills first orders; LINE Login gives identity for repeat | MEDIUM | FR-25 | Guest must still capture name/phone/address per order |
| Order history + one-tap reorder | Produce is high-frequency repeat purchase; re-typing each week loses customers | LOW-MEDIUM | FR-28 | High ROI for a "buy every week" product |
| Delivery method choice + fee by zone + free-ship threshold + round-aware delivery date | Cold/perishable goods constrain how and when you can ship | MEDIUM | FR-20 (partial), FR-21, FR-23 | MVP = own-fleet (Samut Prakan) + general courier only |
| "Sold out this round" + restock/notify-me | Scarcity is normal here; a dead "out of stock" with no recourse loses the lead | LOW | FR-06 | Notify-me also feeds demand signal for planting mix |
| Packing queue grouped by round/route, printable pack slip | Operationally mandatory once >a handful of orders ship same day | MEDIUM | FR-15 | Becomes table stakes the moment volume exists |
| Admin dashboard: today/this-round totals, unpaid, near-expiry, next harvest | Owner cannot run perishable ops blind | MEDIUM | FR-33 | Drives "harvest exactly enough, waste nothing" |
| Role-based access + system settings | Multiple actors (owner/admin/grower/packer) touch the system | MEDIUM | FR-34, FR-35 | |
| PDPA consent, privacy policy, data-access/delete, slip access control | Legal table stakes in Thailand; you store ID-adjacent data and payment slips | MEDIUM | NFR-03, NFR-04 | Non-optional; bake in from phase 1 |

### Differentiators (Where This Product Competes)

These align directly with the PROJECT.md Core Value ("sellable qty always matches real harvest — no oversell, no waste") and the salad-variety angle. Most generic LINE shops and even MyShop **cannot** do these — that is the justification for building custom rather than using LINE MyShop.

| Feature | Value Proposition | Complexity | FR | Notes |
|---------|-------------------|------------|----|-------|
| **Crop plan → harvest calendar → auto sellable qty** | The moat: open exactly what the farm will actually cut. Closes the perishable oversell/waste gap no off-the-shelf shop solves | HIGH | FR-40,41,42,43,50 | Variety params → planting batch → yield calc → weekly harvest calendar → auto-feeds FR-04. This is the product's reason to exist |
| **Mixed Salad Box limited by scarcest ingredient** | Raises average order value, sells the "variety" benefit, and absorbs odd-lot harvest. Bundle qty = min across components | MEDIUM-HIGH | FR-51 | Scarcity math depends on per-variety sellable qty (FR-04). "Chef's-choice / this round's mix" variant avoids fixed-recipe stockouts |
| **B2B standing order + production-quota reservation** | Locks recurring wholesale revenue and lets restaurants trust supply by reserving forecast qty to B2B before B2C opens | HIGH | FR-39 | Genuinely depends on harvest forecast (FR-43) to reserve against — correctly placed after crop module |
| **Subscription box (pause/skip/cancel)** | Recurring revenue from a high-frequency staple; pause/skip is the proven churn-killer (see finding) | HIGH | FR-10 | Depends on rounds (FR-03) + recurring order gen + mixed box (FR-51). Strong case to pull EARLIER than SRS phase 3 |
| **Actual-harvest logging that tunes forecast params** | Forecast accuracy compounds over time → tighter open quantities → less waste | MEDIUM | FR-44 | Cheap to add alongside FR-43; high long-term payoff |
| **Lot / harvest-date / best-before traceability** | Premium positioning; supports "harvested Thursday, eat by Sunday" messaging | MEDIUM | FR-05 | Differentiator for premium image, not urgent; SRS defers to phase 3 (fine) |
| **Substitution policy per order** | Keeps the round shippable when one variety underperforms; respects customer preference | LOW-MEDIUM | FR-07 | Pairs naturally with mixed box and harvest variance |
| **Loyalty points / redeem** | Reinforces weekly repeat behavior | MEDIUM | FR-27 | Differentiator, not table stakes; defer until repeat base exists |
| **Reverse planting recommendation (demand → plant qty)** | Advanced: tells grower how many seedlings per Monday to match target demand | HIGH | FR-45 | Needs accumulated demand + harvest data; correctly last (phase 3) |
| **Tax invoice / receipt on demand (PDF)** | Unlocks B2B and tax-conscious buyers; relies on price history | MEDIUM | FR-37 | Closer to table stakes for B2B specifically |

### Anti-Features (Do NOT Build for a Low-Cost MVP)

Each of these is plausibly requested but adds cost/fragility disproportionate to MVP value. Alternative given for each.

| Feature | Why Requested | Why Problematic for MVP | Alternative |
|---------|---------------|--------------------------|-------------|
| **In-house OCR / ML slip auto-verification** | "Auto-confirm payments" | Building OCR/anti-fraud yourself is expensive and brittle; fake slips evolve | Use a cheap third-party slip-verify API (EasySlip/Slip2Go class) that checks the slip QR's txn reference against the bank network; manual review as fallback. SRS already defers OCR (good) — but do NOT build it in-house later either |
| **Conversational/NLU chatbot that takes orders by free text** | "Customers just chat to order" | NLU is costly, error-prone, and mis-parses qty/variety/address → wrong perishable orders | Rich Menu + LIFF structured forms (FR-46/47). Keep FR-30/49 as canned auto-replies + status pushes only; drop free-text order parsing |
| **Variable weigh-at-pack pricing across all channels** | "Charge real weight" | Breaks prepay (amount set before weighing), reconciliation nightmare, refund/top-up flows | Fixed-weight packs (FR-36) everywhere prepaid. Allow weigh-adjust ONLY for own-fleet cash/COD later (FR-38 optional), never for prepaid QR |
| **Own web storefront before LINE is validated** | "We need a website" | Doubles surface area before proving demand; LINE is the cheaper close | Defer FR-12 to phase 3 exactly as SRS does. TikTok/FB drive traffic INTO LINE |
| **Real carrier API integration (Flash/Kerry/Grab) at MVP** | "Auto tracking + auto-dispatch" | Per-carrier API work, credentials, edge cases; low volume doesn't justify it | Manual tracking-number entry + manual Grab/Lalamove booking (FR-24 deferred). Add APIs when volume warrants |
| **Full B2B credit terms / credit limits** | "Restaurants pay monthly" | AR/credit risk + dunning logic is real fintech scope | Cash/prepay B2B first with standing orders + quota (FR-39). Defer credit (FR-26 credit portion) |
| **Direct TikTok Shop / Facebook Shop channel integration** | "Sell everywhere" | Each channel = inventory sync + reconciliation against a perishable, round-based stock model | Use TikTok/FB as top-of-funnel only; close in LINE. Defer true omnichannel sync |
| **Card payments / payment gateway** | "Accept cards" | Gateway fees + PCI scope contradict the zero-cost mandate (NFR-08); Thai buyers default to PromptPay | PromptPay QR (self-generated, no fee) + slip. Revisit only if data shows card demand |
| **Tiered membership levels** | "VIP tiers" | Extra rules engine before a loyal base even exists | Start with flat points (FR-27) or skip; add tiers post-PMF |
| **Real-time multi-channel inventory sync** | "Live stock everywhere" | Over-engineering for a single-channel, once-weekly-harvest model | Per-round atomic qty in one back office is sufficient at MVP scale |
| **Building on LINE MyShop instead of custom LIFF** | "It's free and built-in" | MyShop cannot model harvest-cycle qty, daily per-variety pricing, scarcest-ingredient bundles, crop planning, or quota reservation — i.e. every differentiator | Custom LIFF storefront is justified *because* the differentiators are the whole point. (MyShop only viable if you abandoned the farm-planning moat) |

---

## Feature Dependencies

```
ATOMIC STOCK LOCK (NFR-02)
    └──enables──> SELLABLE-QTY / OVERSELL PREVENTION (FR-04)
                      ├──requires for AUTO mode──> HARVEST CALENDAR (FR-43)
                      │        └──requires──> YIELD CALC (FR-42)
                      │                 └──requires──> PLANTING BATCH (FR-41)
                      │                          └──requires──> VARIETY PARAMS (FR-40)
                      │                          └──generated by──> PLANTING MIX PLAN (FR-50)
                      │        └──tuned by──> ACTUAL HARVEST LOG (FR-44)
                      ├──enables──> MIXED SALAD BOX scarcity = min(components) (FR-51)
                      └──enables──> B2B QUOTA RESERVATION (FR-39)
                                        └──also requires──> B2B PRICING (FR-02) + STANDING ORDER engine

SELLING ROUND + CUT-OFF (FR-03)
    └──required by──> FR-04, FR-08 pre-order, FR-15 pack queue, FR-23 delivery date, FR-10 subscription, FR-39 standing order

ORDER + PAYMENT (FR-13/14/17/18/19)
    ├──QR expiry releases reserved stock──> back into FR-04
    ├──slip record──> SLIP VERIFICATION (manual now / API later)
    └──price-at-time + price history (FR-38)──> TAX INVOICE (FR-37) + REPORTS (FR-32)

ACCOUNTS / LINE LOGIN (FR-25)
    └──enables──> ORDER HISTORY + REORDER (FR-28) ──enables──> SUBSCRIPTION (FR-10), LOYALTY (FR-27)

MIXED BOX (FR-51) ──enhances──> SUBSCRIPTION BOX (FR-10)   (the recurring "box" content)
HARVEST FORECAST (FR-43) ──enhances──> ADMIN DASHBOARD next-harvest (FR-33) + REVERSE PLANTING (FR-45)
DEMAND DATA (FR-32) ──enables──> REVERSE PLANTING (FR-45)
```

### Dependency Notes

- **FR-04 auto-mode requires the entire crop module (FR-40→43, 50).** This is why SRS phase 1 ships FR-04 as *manual entry* and defers auto-feed to phase 2 — sound, because forecast accuracy also needs accumulated FR-44 data before it can be trusted.
- **FR-51 (mixed box) requires per-variety FR-04.** In phase 1 with manual qty, scarcity must be tracked manually per component — workable but a known operational cost; flag for tooling in phase 2.
- **FR-39 (B2B quota) genuinely depends on FR-43 forecast** to reserve against. Correctly placed *after* the crop module. Reserving against a manually-typed number in phase 1 would be fragile.
- **FR-10 (subscription) depends on FR-03 rounds + recurring order generation + FR-51 box content.** Its prerequisites mostly land in phase 1, so it is *technically* pullable into phase 2 (see phasing reconsideration).
- **QR hold/expiry (FR-19) is part of the oversell story**, not just payment — expired QR must atomically release reserved qty back to the round.
- **Price history (FR-38) is a hidden dependency** for both tax invoices (FR-37) and historical reports (FR-32). Capture price-at-order-time from day one even though invoices come later.

---

## MVP Definition

### Launch With (Phase 1 — LINE Commerce MVP)

Matches SRS phase 1, with two recommended adjustments flagged below.

- [ ] Product catalog + retail/wholesale price + fixed-weight packs (FR-01, 02, 36) — storefront baseline
- [ ] Daily per-variety price → auto pack price + **price history** (FR-38) — produce pricing core; history is load-bearing later
- [ ] Selling round (cut-off/harvest/deliver) + **manual** sellable qty with atomic oversell lock (FR-03, FR-04 partial, NFR-02) — the integrity guarantee
- [ ] Mixed Salad Box, scarcity-limited (FR-51) — early AOV/variety differentiator
- [ ] "Sold out this round" + notify-me + substitution policy (FR-06, FR-07)
- [ ] LINE Rich Menu + LIFF ordering + Messaging API webhook (FR-46, 47, 48, 13) — the channel
- [ ] PromptPay QR + slip upload + QR hold/expiry releases stock (FR-17, 18, 19)
- [ ] **[Recommended add]** Third-party slip-verify API hook (low-cost) rather than manual-only — fake-slip fraud is prevalent (see finding)
- [ ] Order status + LINE status notifications (FR-14, 16)
- [ ] Guest + LINE Login + order history + reorder (FR-25, 28)
- [ ] Delivery: own-fleet (Samut Prakan) + general courier, zone fees, free-ship ≥500, round-aware date (FR-20 partial, 21, 23)
- [ ] PDPA consent + slip access control (NFR-03, 04, 08)

### Add After Validation (Phase 2 — Back-office + Crop Planning)

Matches SRS phase 2.

- [ ] Full order management + packing queue by route (FR-14, 15) — trigger: order volume makes manual packing painful
- [ ] Crop module: variety params, planting batch, yield calc, harvest calendar, actual-harvest log, planting mix plan (FR-40–44, 50) — the moat
- [ ] **Auto** sellable-qty fed from harvest calendar (FR-04 auto) — trigger: ≥a few harvest cycles logged so forecast is trustworthy
- [ ] Tax invoice / receipt PDF (FR-37) — trigger: B2B or tax-buyer demand
- [ ] B2B standing order + production-quota reservation (FR-39) — depends on harvest forecast above
- [ ] Status notifications + canned auto-replies (FR-16) — **but NOT free-text NLU order bot** (FR-49 reduced to broadcast + canned replies)
- [ ] Sales analytics/reports (FR-32)
- [ ] **[Recommended pull-in candidate]** Subscription box (FR-10) — its prereqs exist by end of phase 1; capturing recurring revenue earlier may beat waiting for phase 3

### Future Consideration (Phase 3 — Web + Marketing + Scale)

Matches SRS phase 3.

- [ ] Web storefront (FR-12) — defer until LINE channel proven
- [ ] Promotions/coupons (FR-29), loyalty points (FR-27)
- [ ] Subscription box (FR-10) — *if not pulled into phase 2*
- [ ] Full 4-way delivery incl. cold-chain + Grab/Lalamove + carrier APIs + tracking (FR-20 full, 24)
- [ ] LINE broadcast by segment (FR-31)
- [ ] Reverse planting recommendation (FR-45) — needs accumulated demand/harvest data
- [ ] In-bound slip OCR — *use API, do not build* (see anti-features)
- [ ] Facebook / TikTok Shop direct channels (traffic-only until then)
- [ ] Full lot/best-before traceability (FR-05)
- [ ] B2B credit terms / limits (FR-26 credit portion)

---

## Feature Prioritization Matrix

| Feature | User Value | Impl. Cost | Priority |
|---------|------------|-----------|----------|
| Round + cut-off + oversell-safe sellable qty (FR-03/04) | HIGH | HIGH | P1 |
| Daily per-variety pricing + fixed packs + price history (FR-36/38) | HIGH | MEDIUM | P1 |
| LINE Rich Menu + LIFF ordering (FR-46/47/13) | HIGH | HIGH | P1 |
| PromptPay QR + slip + verify (FR-17/18/19) | HIGH | MEDIUM | P1 |
| Order status + LINE notify (FR-14/16) | HIGH | MEDIUM | P1 |
| Guest/LINE login + history + reorder (FR-25/28) | HIGH | MEDIUM | P1 |
| Mixed salad box scarcity (FR-51) | HIGH | MEDIUM-HIGH | P1 |
| Delivery zones + free-ship + round date (FR-20p/21/23) | HIGH | MEDIUM | P1 |
| Crop plan → harvest calendar → auto qty (FR-40–43/50) | HIGH | HIGH | P2 |
| Packing queue (FR-15) | MEDIUM-HIGH | MEDIUM | P2 |
| B2B standing order + quota reservation (FR-39) | HIGH (B2B) | HIGH | P2 |
| Tax invoice PDF (FR-37) | MEDIUM (HIGH for B2B) | MEDIUM | P2 |
| Actual-harvest logging + param tuning (FR-44) | MEDIUM | MEDIUM | P2 |
| Subscription box pause/skip/cancel (FR-10) | HIGH | HIGH | P2/P3 |
| Reports/analytics (FR-32) | MEDIUM | MEDIUM | P2 |
| Web storefront (FR-12) | MEDIUM | HIGH | P3 |
| Promotions/coupons (FR-29) | MEDIUM | MEDIUM | P3 |
| Loyalty points (FR-27) | MEDIUM | MEDIUM | P3 |
| Full cold-chain + carrier APIs (FR-20 full/24) | MEDIUM | HIGH | P3 |
| Reverse planting recommendation (FR-45) | MEDIUM | HIGH | P3 |
| Traceability lot/best-before (FR-05) | LOW-MEDIUM | MEDIUM | P3 |
| Free-text NLU order chatbot (FR-30/49) | LOW | HIGH | DROP (anti) |

---

## Competitor / Industry Pattern Analysis

| Pattern | Generic LINE shop / MyShop | CSA / farm-box software (CSAware, Harvie, Local Line) | Our Approach |
|---------|----------------------------|------------------------------------------------------|--------------|
| Inventory model | Fixed stock number | Harvest/share-based, weekly | Harvest-cycle sellable qty (FR-04+FR-43) — our edge |
| Pre-order cut-off | Rare / manual | Standard ("order by X") | First-class selling round (FR-03) |
| Box bundles | Static bundle | "Customize your box", swaps | Scarcest-ingredient mixed box (FR-51) |
| Subscription pause/skip | None | Table stakes (hold/skip/vacation) | FR-10 with pause/skip/cancel |
| Payment | Card/gateway | Card/ACH | Self-hosted PromptPay QR + slip (Thai-native, zero fee) |
| Channel | Web/app | Web portal | LINE LIFF first (Thai buyer habit) |
| B2B supply assurance | None | Wholesale lists | Quota reservation against forecast (FR-39) — strong edge |

---

## Phasing Validation vs SRS (downstream cross-reference)

The SRS 3-phase split is **largely aligned with industry norms.** Findings:

1. **Sound: defer auto harvest-qty (FR-04 auto/FR-43) to phase 2.** Shipping FR-04 as manual entry first is the right de-risking move — forecast trust needs accumulated FR-44 data anyway. (HIGH confidence)
2. **Sound: B2B quota (FR-39) in phase 2, after the crop module.** Reserving against a real forecast (FR-43) rather than a typed number is correct sequencing. (HIGH confidence)
3. **Reconsider: Subscription box (FR-10) sits in phase 3, but its prerequisites (rounds FR-03, mixed box FR-51, accounts/history FR-25/28) all land in phase 1.** Since recurring revenue from a high-frequency staple is an explicit business driver, and pause/skip is a proven retention lever, pulling FR-10 into phase 2 is worth evaluating. (MEDIUM confidence — depends on recurring-billing effort)
4. **Reconsider chatbot scope (FR-30/49).** Free-text NLU order-taking is an anti-feature; keep only canned auto-replies + status pushes + broadcast. This narrows phase 2/3 scope at no real loss. (MEDIUM-HIGH confidence)
5. **Add a slip-verification API in phase 1, not just manual review (FR-18).** Fake transfer slips are a well-documented problem in Thai LINE commerce; low-cost slip-verify APIs (verifying the slip QR's txn reference against the bank/PromptPay network) are now an industry norm and are NOT a payment gateway. Manual-only verification is a real fraud exposure even at MVP. (MEDIUM-HIGH confidence) — Note: this is a fraud finding for PITFALLS/requirements, not just a feature.
6. **Keep tax invoice price history from day one** even though invoices (FR-37) come in phase 2 — capture price-at-order-time in phase 1 to avoid a backfill problem.

---

## Sources

- PromptPay self-generated QR (no gateway): promptparse / promptpay-qr / promptparse-go libraries — https://github.com/maythiwat/promptparse , https://github.com/dtinth/promptpay-qr , https://github.com/mrwan2546/promptparse-go (HIGH — confirms FR-17 is feasible fee-free)
- Thai slip verification / fake-slip prevention norms: EasySlip API 2026 — https://easyslip.com/slip-verification-api-easyslip/ ; comparison of Thai slip-verify APIs — https://thunder.in.th/blog/top-thai-bank-slip-verification-apis-in-2026/ ; unified SDK — https://github.com/maythiwat/slipverify (MEDIUM-HIGH)
- CSA / farm-box subscription feature norms (pause/skip/vacation hold, backend pack-list sync): https://www.deliverybizpro.com/blog/best-csa-management-software-farm-operations/ , https://csaware.com/ (MEDIUM)
- Subscription pause-vs-cancel retention & forced-commitment anti-pattern: https://www.chargebee.com/blog/power-of-pause-subscription-retention-strategy/ , https://recurly.com/blog/why-pausing-a-subscription-can-be-a-powerful-retention-tactic/ , https://www.loopwork.co/blog/subscription-flexibility-pause-skip-swap-reduce-shopify-churn (MEDIUM)
- LINE MyShop / LIFF commerce capabilities (build-vs-buy context): https://medium.com/linedevth/introduction-line-myshop-72565af9141b , https://lineforbusiness.com/th/service/myshop (MEDIUM)
- Primary source: `salad-shop-requirements.md` SRS v0.6 (FR-01..FR-51) and `.planning/PROJECT.md` (HIGH — authoritative project scope)

---
*Feature research for: Thai perishable-produce LINE-commerce + crop-planning*
*Researched: 2026-06-28*
