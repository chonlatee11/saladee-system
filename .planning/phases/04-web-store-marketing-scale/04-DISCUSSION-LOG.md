# Phase 4: Web Store, Marketing & Scale - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 4-Web Store, Marketing & Scale
**Areas discussed:** Web storefront, Promotions/loyalty, Broadcast/chatbot, Delivery tracking/demand planting, PDPA versioning, Responsive, Guest↔member merge, SEO, Product images

---

## Area selection (which groups to discuss)

| Option | Description | Selected |
|--------|-------------|----------|
| เว็บสโตร์ (ORD-05) | stack + checkout scope + guest | ✓ |
| โปรโมชัน+แต้ม (MKT-01/CUST-03) | coupons + loyalty | ✓ |
| Broadcast+แชทบอต (MKT-03/LINE-04) | segments + bot NLU | ✓ |
| ขนส่ง+ปลูกดีมานด์ (DEL-05/CROP-07) | tracking + planting recommendation | ✓ |

**User's choice:** all 4 groups.

---

## Web storefront — Stack

| Option | Description | Selected |
|--------|-------------|----------|
| Nuxt SSR ใหม่ | Vue SSR, reuse web/ components, SEO, per CLAUDE.md | ✓ |
| ต่อยอด Vue SPA เดิม | reuse LIFF SPA, CSR, weak SEO | |
| Vite SPA แยกใหม่ | new SPA, CSR, weak SEO | |

**User's choice:** asked for a Next.js-vs-Nuxt comparison first, then chose **Nuxt SSR**.
**Notes:** Comparison delivered — decisive factor is the 100%-Vue codebase (web/, web-admin/) + Eden Treaty; Next would force a React rewrite and dual-framework maintenance for a solo dev.

## Web storefront — Checkout scope

| Option | Description | Selected |
|--------|-------------|----------|
| จบครบบนเว็บ | own cart→checkout→PromptPay→slip (reuse P2) | ✓ |
| จบที่ LINE | browse+cart on web, deep-link to LINE to pay | |

**User's choice:** จบครบบนเว็บ (full parity).

## Web storefront — Guest

| Option | Description | Selected |
|--------|-------------|----------|
| Guest ได้ | no login required, reuse P2 guest path | ✓ |
| ต้อง login | LINE/email before ordering | |

**User's choice:** Guest ได้.

## Web storefront — Availability model

| Option | Description | Selected |
|--------|-------------|----------|
| เหมือน LINE | same round-based pre-order + delivery-round pick | ✓ |
| พร้อมส่งเท่านั้น | web = ready-to-ship only | |

**User's choice:** เหมือน LINE.

## Web storefront — Responsive

| Option | Description | Selected |
|--------|-------------|----------|
| Mobile-first สเกล | mobile-first stretched up via breakpoints | |
| Desktop แยก | genuine distinct desktop layout (hero/wide) | ✓ |

**User's choice:** Desktop แยก.

## Web storefront — SEO

| Option | Description | Selected |
|--------|-------------|----------|
| เต็ม | SSR + sitemap + meta/OG + JSON-LD product | ✓ |
| พื้นฐาน | SSR + basic meta only | |

**User's choice:** เต็ม.

---

## Promotions/loyalty — Coupon stacking

| Option | Description | Selected |
|--------|-------------|----------|
| 1 คูปอง/ออเดอร์ | simple, margin-safe | ✓ |
| ซ้อนได้ | flexible, margin/bug risk | |

**User's choice:** 1 คูปอง/ออเดอร์.

## Promotions/loyalty — Usage limit

| Option | Description | Selected |
|--------|-------------|----------|
| global + ต่อคน | e.g. 100 total AND 1/customer | ✓ |
| global รวม | total only | |
| ต่อคนรวม | per-customer only | |

**User's choice:** global + ต่อคน.

## Promotions/loyalty — Redemption

| Option | Description | Selected |
|--------|-------------|----------|
| ส่วนลดบาท | points → baht discount | ✓ |
| แลกของแถม | freebie/reward catalog | |
| ทั้งสอง | both | |

**User's choice:** ส่วนลดบาท.

## Promotions/loyalty — Tiers

| Option | Description | Selected |
|--------|-------------|----------|
| Flat MVP | single earn rate, no tiers | ✓ |
| มีระดับ | bronze/silver/gold | |

**User's choice:** Flat MVP.

## Promotions/loyalty — Applicability scope

| Option | Description | Selected |
|--------|-------------|----------|
| B2C รีเทล | retail only, exclude B2B/subscription | |
| config ต่อโปร | per-promotion channel/segment config | ✓ |
| ทุกช่องทาง | apply to B2C/B2B/subscription | |

**User's choice:** config ต่อโปร.

## Promotions/loyalty — Coupon entry UX

| Option | Description | Selected |
|--------|-------------|----------|
| ช่อง checkout+auto | checkout field (web+LIFF) + segment auto-apply | ✓ |
| กรอกเอง | manual field, no auto-apply | |

**User's choice:** ช่อง checkout+auto.

---

## Broadcast/chatbot — Segment definition

| Option | Description | Selected |
|--------|-------------|----------|
| สำเร็จรูป | B2C/B2B/subscriber/inactive (reuse P3 types) | |
| แท็กเอง | admin-applied tags | |
| ทั้งสอง | predefined + tags | ✓ |

**User's choice:** ทั้งสอง.

## Broadcast/chatbot — Delivery method

| Option | Description | Selected |
|--------|-------------|----------|
| multicast ตามกลุ่ม | send to segment userIds, cost-controlled | ✓ |
| broadcast ทุกคน | all followers, quota-heavy, untargeted | |

**User's choice:** multicast ตามกลุ่ม.

## Broadcast/chatbot — Bot NLU depth

| Option | Description | Selected |
|--------|-------------|----------|
| Guided flow | quick-reply/postback, no LLM, extends canned | ✓ |
| NLU ด้วย LLM | Claude Haiku free-text parse | |
| Hybrid | canned + LLM fallback | |

**User's choice:** Guided flow.

## Broadcast/chatbot — Bot close

| Option | Description | Selected |
|--------|-------------|----------|
| ส่งไป LIFF จ่าย | gather intent → deep-link LIFF checkout | ✓ |
| จบในแชท | full order+pay in chat | |

**User's choice:** ส่งไป LIFF จ่าย.

## Broadcast/chatbot — PDPA audience

| Option | Description | Selected |
|--------|-------------|----------|
| เฉพาะคนยินยอม | marketing-consented + opt-out (NFR-04) | ✓ |
| ทุกคนในกลุ่ม | ignore consent | |

**User's choice:** เฉพาะคนยินยอม.

## Broadcast/chatbot — Scheduling + content

| Option | Description | Selected |
|--------|-------------|----------|
| ตั้งเวลา+Flex | send-now or scheduled (pg-boss) + Flex/image | ✓ |
| ส่งทันที | send-now only, text/image | |

**User's choice:** ตั้งเวลา+Flex.

---

## Delivery tracking — method

| Option | Description | Selected |
|--------|-------------|----------|
| กรอกมือ | manual entry only | |
| เชื่อม API จริง | real Grab/Lalamove API | |
| Hybrid | manual now + adapter seam for later API | ✓ |

**User's choice:** Hybrid.

## Delivery tracking — status model

| Option | Description | Selected |
|--------|-------------|----------|
| Enum กำหนด | defined status enum + LINE notify | ✓ |
| Free-text | free-text note | |

**User's choice:** Enum กำหนด.

## CROP-07 — recommendation basis

| Option | Description | Selected |
|--------|-------------|----------|
| เฉลี่ย N รอบ | trailing avg over N rounds → plants | ✓ |
| รอบล่าสุด | last round only | |
| You decide | planner picks from data | |

**User's choice:** เฉลี่ย N รอบ.

## CROP-07 — demand signal

| Option | Description | Selected |
|--------|-------------|----------|
| ขาย+ที่ขาด | sales + back-in-stock (unmet) demand | ✓ |
| ขายจริงอย่างเดียว | paid orders only | |

**User's choice:** ขาย+ที่ขาด.

## CROP-07 — surface

| Option | Description | Selected |
|--------|-------------|----------|
| การ์ดในหน้าวางแผน | card prefilling planting mix + override | ✓ |
| รายงานแยก | separate read-only report | |

**User's choice:** การ์ดในหน้าวางแผน.

---

## PDPA policy versioning (owner-raised)

| Option | Description | Selected |
|--------|-------------|----------|
| Version + re-consent | manage version in settings, re-prompt on bump | ✓ |
| Version เฉยๆ | record version, no re-consent | |

**User's choice:** Version + re-consent.
**Notes:** `consent_logs.policy_version` already exists (P2) but is effectively hardcoded — upgrade to managed, re-consent-aware versioning.

---

## Guest↔member merge (owner-raised)

| Option | Description | Selected |
|--------|-------------|----------|
| Merge ด้วยเบอร์ | on login/register, match+merge guest orders by phone → carry history+points | ✓ |
| ไม่ merge | guest history stays separate | |

**User's choice:** Merge ด้วยเบอร์.

---

## Product images (owner-raised: "อยากให้แสดงรูปผักได้ด้วย")

| Question | Options | Selected |
|----------|---------|----------|
| Source | อัปโหลดรูป (sharp→R2) / วาง URL เอง | อัปโหลดรูป ✓ |
| Where shown | ทุกที่ (เว็บ+LIFF+Flex) / เฉพาะเว็บ | ทุกที่ ✓ |
| Count | รูปเดียว / หลายรูป (gallery) | หลายรูป ✓ |

**Notes:** `varieties.imageUrl`/`boxes.imageUrl` columns already exist; catalog API returns them; sharp+R2 pipeline exists from P2. Gallery needs a new `variety_images` child table with the existing column kept as cover image.

---

## Claude's Discretion

- Default loyalty earn rate / points→baht conversion seed values (owner tunes in settings).
- N-round window for the CROP-07 trailing average (configurable if cheap).
- Exact delivery-status enum labels/ordering.
- Product-image storage visibility (default public R2 — marketing asset, unlike private slips).

## Deferred Ideas

- Real carrier API integration (Grab/Lalamove live tracking) — adapter seam built now, integration later.
- LLM/NLU free-text chatbot — guided flow now, LLM upgrade later.
- Loyalty member tiers + points expiry — flat MVP now.
- Coupon stacking + reward/freebie redemption catalog.
- Real production domain replacing sslip.io — SEO prerequisite, provisioning task.
- B2B credit-limit/blocking, prepaid/recurring subscription billing — remain deferred.
