---
phase: 02-line-storefront-payments-delivery
reviewed: 2026-07-04T00:00:00Z
depth: standard
files_reviewed: 36
files_reviewed_list:
  - api/src/db/schema.ts
  - api/src/env.ts
  - api/src/index.ts
  - api/src/routes/orders.ts
  - api/src/routes/auth.ts
  - api/src/routes/delivery.ts
  - api/src/routes/varieties.ts
  - api/src/routes/catalog.ts
  - api/src/routes/payments.ts
  - api/src/routes/webhook.ts
  - api/src/routes/me-orders.ts
  - api/src/services/order-transition.ts
  - api/src/services/order-status.ts
  - api/src/services/delivery.ts
  - api/src/services/promptpay.ts
  - api/src/services/consent.ts
  - api/src/services/notify.ts
  - api/src/services/reservation.ts
  - api/src/services/pricing.ts
  - api/src/services/slip-verify/types.ts
  - api/src/services/slip-verify/slipok.adapter.ts
  - api/src/services/slip-verify/index.ts
  - api/src/config/delivery.ts
  - api/src/jobs/boss.ts
  - api/scripts/provision-rich-menu.ts
  - web/src/liff.ts
  - web/src/api.ts
  - web/src/router.ts
  - web/src/stores/cart.ts
  - web/src/lib/checkout.ts
  - web/src/lib/order-status.ts
  - web/src/lib/reorder.ts
  - web/src/views/CheckoutWizard.vue
  - web/src/views/PayView.vue
  - web/src/views/OrderHistoryView.vue
  - web/src/views/OrderDetailView.vue
  - web/src/components/SlipUploader.vue
  - web/src/components/ConsentCheckboxes.vue
  - web/src/components/DeliveryMethodTiles.vue
  - web/src/components/QtyStepper.vue
findings:
  critical: 2
  warning: 7
  info: 3
  total: 12
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-07-04
**Depth:** standard
**Files Reviewed:** 36 (phase-2 payments/storefront/delivery surface)
**Status:** issues_found

## Summary

โค้ดเฟสนี้ทำได้ดีมากในแกนหลักที่อ่อนไหวที่สุด: การจอง stock แบบ atomic (guarded conditional UPDATE, ไม่มี SELECT-then-check), การ lock ordering กัน deadlock, การ re-resolve ราคา/ค่าส่งฝั่ง server (ไม่เชื่อ money จาก client เลย), CRC-16 ที่ผลิตโดยไลบรารีล้วน, การตรวจ `x-line-signature` บน raw bytes ก่อน parse, และ dedup สลิปด้วย partial UNIQUE index ระดับทั้งระบบ การเปรียบเทียบยอดสลิปทำเป็น satang ตลอดทาง และ PDPA consent ถูก log ภายใน order transaction เดียวกัน

อย่างไรก็ตาม พบช่องโหว่ระดับ **BLOCKER 2 รายการ** ที่กระทบ NFR-02 (ความถูกต้องของ stock) และความถูกต้องของการชำระเงินโดยตรง:

1. **TOCTOU ระหว่างการยืนยันสลิปกับ hold-expiry** — ลูกค้าที่จ่ายเงินจริงและสลิปผ่าน แต่ถ้า sweep ยกเลิกออเดอร์ระหว่างรอ verifier ตอบ ตัว payment row จะถูก rollback ทิ้ง = จ่ายเงินแล้วแต่ไม่มีบันทึก + คืน stock
2. **ออเดอร์สถานะ `created` แบบไม่ต้องยืนยันตัวตน จองสต็อกโดยไม่มี hold/ไม่มีการ sweep** — ทำ stock-exhaustion ได้ด้วยข้อมูลสาธารณะล้วน

รวมทั้ง WARNING ที่กระทบการใช้งานจริง (ปุ่มยกเลิกออเดอร์ฝั่งลูกค้าเรียก endpoint ของ staff, CORS ไม่อนุญาต PATCH/PUT/DELETE) และ typecheck ที่ล้มจริง 2 จุดตามที่แจ้งไว้ (ไม่พังตอน runtime แต่ทำ CI แดง)

## Critical Issues

### CR-01: สลิปที่ผ่านการตรวจถูกทิ้งเมื่อ hold หมดอายุระหว่างการ verify (จ่ายเงินแล้วแต่ไม่มีบันทึก)

**File:** `api/src/routes/payments.ts:146-215`
**Issue:**
ใน `POST /orders/:id/slip` ลำดับคือ (1) อ่านสถานะออเดอร์ *นอก* transaction → (2) `putSlip` เก็บรูปลง R2 → (3) `verifier.verify` (network call กินเวลาหลายวินาที) → (4) เปิด transaction แล้ว `applyTransition(tx, orderId, "paid")`

ระหว่างขั้น (1)–(4) ตัว `sweepExpiredHolds`/`expireHold` (boss.ts รันทุก 2 นาที) หรือ hold-expiry job สามารถยกเลิกออเดอร์ได้ เมื่อถึงขั้น (4) `applyTransition` จะ lock แถวแล้วอ่านสถานะจริง = `cancelled` → `canTransition("cancelled","paid")` = false → โยน `OrderError("illegal_transition", 400)` ซึ่งทำให้ **ทั้ง transaction rollback รวมถึง `INSERT payments` ที่เพิ่ง insert ในบล็อกเดียวกัน** ผลลัพธ์: ลูกค้าโอนเงินจริง, SlipOK ยืนยันแล้ว, แต่ไม่มี payments row เลย (transRef หาย, ไม่มีการ dedup), stock ถูกคืน, รูปสลิปค้างเป็น orphan ใน R2, ลูกค้าเห็นเพียง error 400 ทั่วไป — เงินหายจากมุมระบบ กู้คืนได้แค่แมนนวลถ้าลูกค้าร้องเรียน

นี่คือ Pitfall 1 (late timer) แต่ในทิศทางกลับ: การชำระเงินที่ถูกต้องมาชนกับ expiry แล้วแพ้

**Fix:**
ภายใน transaction ของเคส `clean` ให้ตรวจสถานะใต้ row lock ด้วยตัวเอง และถ้าไม่ใช่ `awaiting_payment` ให้ **persist สลิปที่ผ่านการตรวจเป็น `awaiting_review` (พร้อม transRef/amount/slipKey)** เพื่อให้แอดมินเห็นและ reconcile ได้ แทนที่จะโยนทิ้งทั้งก้อน เช่น:

```ts
await database.transaction(async (tx) => {
  // lock + อ่านสถานะจริงก่อนตัดสินใจ
  const [locked] = await tx
    .select({ status: orders.status })
    .from(orders).where(eq(orders.id, orderId)).for("update").limit(1);
  if (!locked) throw new OrderError("order_not_found", 404);

  // สลิปผ่านแล้วแต่ออเดอร์ไม่อยู่ในสถานะรับชำระ → อย่าทิ้ง เก็บไว้ให้แอดมินยืนยัน
  if (locked.status !== "awaiting_payment") {
    await tx.insert(payments).values({
      orderId, status: "awaiting_review",
      transRef: result.transRef, amountSatang: result.amountSatang,
      slipKey, rawJson: result.raw as object,
    }).catch((e) => { if (!isUniqueViolation(e)) throw e; });
    return; // ตอบ 202 review แทน 400
  }

  try {
    await tx.insert(payments).values({ orderId, status: "clean", transRef: result.transRef, /* … */ });
  } catch (e) { if (isUniqueViolation(e)) throw new OrderError("duplicate_slip", 409); throw e; }
  await applyTransition(tx, orderId, "paid");
});
```

---

### CR-02: ออเดอร์ `created` (ไม่ผ่าน delivery) จองสต็อกโดยไม่ต้องยืนยันตัวตนและไม่มีวันหมดอายุ → stock-exhaustion (NFR-02)

**File:** `api/src/routes/orders.ts:198-668` (โดยเฉพาะ `isCheckout` ที่ 421-422 และการ reserve ที่ 543-546, insert order ที่ 549-572) ประกอบกับ `api/src/jobs/boss.ts:90-103`
**Issue:**
`POST /orders` เป็น endpoint แบบเปิด (ไม่มี `requireRole`, ตั้งใจให้ guest ใช้ตาม D-03) `isCheckout` จะเป็น true ก็ต่อเมื่อส่ง **ทั้ง** `deliveryMethod` และ `deliveryZone` มาด้วย ถ้าไม่ส่ง (หรือส่งมาไม่ครบ) ออเดอร์จะถูกสร้างเป็นสถานะ `created` โดย **จองสต็อกจริง (`reserve`) แต่ `holdExpiresAt = null` และไม่มีการตั้ง hold-expiry timer**

ตัว safety-net sweep (`sweepExpiredHolds`) เลือกเฉพาะ `status = "awaiting_payment"` เท่านั้น ดังนั้นออเดอร์ `created` ที่จองสต็อกไว้ **จะไม่ถูกยกเลิก/คืนสต็อกโดยอัตโนมัติเลย** ไม่ว่ากรณีใด

ผลกระทบด้านความปลอดภัย/ความถูกต้อง: ผู้โจมตีที่ไม่ต้องล็อกอิน ใช้ UUID ของ round/variety/saleUnit ที่เป็นข้อมูล **สาธารณะ** (จาก `GET /catalog`) ยิง `POST /orders` โดยไม่ใส่ delivery ซ้ำ ๆ เพื่อจองสต็อกทั้งหมดค้างไว้ถาวร → ลูกค้าจริงเห็น "หมดรอบนี้" ทั้งที่ไม่มีการขายจริง เป็นการปฏิเสธการทำงานของหัวใจธุรกิจ (กัน oversell ถูกใช้เป็นอาวุธ) นอกจากนี้แม้ในการใช้งานปกติ ออเดอร์ `created` ที่ staff สร้างแล้วถูกทิ้งก็ strand สต็อกถาวรเช่นกัน

**Fix:**
เลือกอย่างใดอย่างหนึ่ง (หรือทั้งคู่):
- ปิด path `created` แบบเปิด: บังคับให้ทุกออเดอร์ที่ผ่าน `POST /orders` สาธารณะต้องเป็น checkout (บังคับ `deliveryMethod`+`deliveryZone`) และย้าย legacy `created` ไปไว้หลัง `requireRole("owner","admin")`
- ให้ทุกออเดอร์ที่ reserve สต็อกมี `holdExpiresAt` และให้ sweep ครอบคลุมทั้ง `created` และ `awaiting_payment`:

```ts
// boss.ts — ให้ sweep รับทั้งสอง hold state ที่ onlyIfHold รองรับอยู่แล้ว
.where(and(inArray(orders.status, ["created", "awaiting_payment"]), lt(orders.holdExpiresAt, now)))
// orders.ts — ตั้ง holdExpiresAt เสมอเมื่อมีการ reserve แม้ไม่ใช่ checkout
```

## Warnings

### WR-01: ปุ่ม "ยกเลิกคำสั่งซื้อ" ฝั่งลูกค้าเรียก endpoint ที่เป็น staff-only และไม่แนบ token → ยกเลิกไม่สำเร็จเสมอ

**File:** `web/src/views/PayView.vue:49-56, 117-125`
**Issue:**
`cancelOrder` เรียก `PATCH /orders/:id/status { status: "cancelled" }` แต่ route นี้มี `beforeHandle: requireRole("owner","admin")` (`api/src/routes/orders.ts:700`) และ PayView ไม่แนบ Authorization header ใด ๆ ลูกค้าใน LIFF จึงได้ 401/403 เสมอ โค้ดตีความ `!r.error` เป็นสำเร็จ แต่เมื่อ error เป็น true ก็แค่ปิด modal โดยไม่เกิดอะไร — ฟีเจอร์ยกเลิกฝั่งลูกค้าพังเงียบ ๆ ทุกครั้ง
**Fix:** เพิ่ม endpoint ยกเลิกสำหรับลูกค้าที่ผูกกับ session ของตนเอง (เช่น `POST /me/orders/:id/cancel` ผ่าน `memberGuard` ที่ scope ด้วย `customerId` และเรียก `applyTransition(tx, id, "cancelled", { onlyIfHold: true })`) แล้วให้ PayView เรียก endpoint นั้นพร้อม Bearer token แทนการ PATCH staff route

### WR-02: CORS allowlist ไม่รวม PATCH/PUT/DELETE → การแก้ไขข้าม origin ทั้งหมดถูก preflight บล็อก

**File:** `api/src/index.ts:35-41`
**Issue:**
`methods: ["GET", "POST", "OPTIONS"]` แต่ API มี `PATCH /orders/:id/status`, `PUT /varieties/:id`, `DELETE /varieties/:id` เมื่อ UI (เช่น Cloudflare Pages origin ที่อยู่ใน allowlist) เรียกข้าม origin เบราว์เซอร์จะ fail preflight ทุก PATCH/PUT/DELETE — คอนโซล staff (และปุ่มยกเลิกใน WR-01) ใช้ไม่ได้ข้าม origin
**Fix:** เพิ่ม `"PATCH", "PUT", "DELETE"` เข้าไปใน `methods` ของ `cors({...})`

### WR-03: `POST /orders/:id/slip` เปิดสาธารณะและไม่มี rate limit → เปลือง quota SlipOK และ storage R2 (NFR-08)

**File:** `api/src/routes/payments.ts:144-243`
**Issue:**
endpoint เปิด (ไม่มี auth) ทุกครั้งที่อัปโหลดจะ (1) เก็บรูปลง R2 *ก่อน* verify (บรรทัด 176-177) และ (2) เรียก `verifier.verify` ซึ่งกิน quota/ค่าใช้จ่าย SlipOK แม้สลิปจะถูก reject ก็ยัง insert payments row + เก็บ object ทิ้งไว้ ผู้ที่รู้ order UUID (ลูกค้าเจ้าของออเดอร์เอง หรือ UUID ที่รั่ว) สามารถยิงรูปขยะซ้ำ ๆ เพื่อสูบ quota SlipOK และพอง storage R2 ได้ไม่จำกัด กระทบตรง ๆ กับข้อจำกัดต้นทุน NFR-08
**Fix:** จำกัดจำนวนครั้งอัปโหลดต่อออเดอร์ (เช่น นับ payments rows ต่อ orderId แล้วปฏิเสธเมื่อเกิน N), ตรวจ content-type/ขนาดไฟล์ก่อน `putSlip`, และพิจารณา verify ก่อนแล้วค่อยเก็บ object เฉพาะเคสที่ต้องเก็บ

### WR-04: typecheck ล้มจริงที่ slipok.adapter — `Uint8Array` ส่งเข้า `BlobPart` (CI แดง, runtime ไม่พัง)

**File:** `api/src/services/slip-verify/slipok.adapter.ts:65`
**Issue:**
`new Blob([input.image], { type: "image/jpeg" })` โดย `input.image: Uint8Array` ทำให้ tsc รายงาน mismatch กับ `BlobPart`/`BufferSource` (ปัญหา generic `Uint8Array<ArrayBufferLike>` ในไทป์ปัจจุบัน) **ยืนยันแล้วว่าไม่พังตอน runtime บน Bun** — Blob รับ `ArrayBufferView` ได้ และ multipart upload ทำงานปกติ แต่มันทำให้ typecheck gate (`tsc --noEmit`) ล้ม จึงเป็นปัญหา CI ไม่ใช่ correctness
**Fix:** แปลงเป็น buffer ที่ไทป์ตรง เช่น `new Blob([new Uint8Array(input.image)], { type: "image/jpeg" })` หรือส่งผ่าน `input.image.buffer as ArrayBuffer` ให้ตรงชนิด `BlobPart`

### WR-05: typecheck ล้มจริงที่ liff.ts — `string | undefined` ถูก assign ให้ `string` (CI แดง, runtime ไม่พัง)

**File:** `web/src/liff.ts:71-74`
**Issue:**
Eden Treaty อนุมานไทป์ผลลัพธ์ของ `POST /auth/line` เป็น union (success `{token,customerId,lineUserId}` หรือ error) การเช็ก `!("token" in data)` narrow เฉพาะ `token` แต่ `data.customerId`/`data.lineUserId` ยังเป็น `string | undefined` เมื่อ return เป็น `{ customerId: string; lineUserId: string }` จึงล้ม typecheck รันไทม์ปกติเพราะ server ส่งครบทั้งสามฟิลด์บน success path
**Fix:** narrow ให้ครบก่อน return เช่น
```ts
if (error || !data || !("token" in data) || !data.customerId || !data.lineUserId) return null;
```

### WR-06: `HOLD_WINDOW_SECONDS`/`PORT` ตรวจแค่เป็น string → ค่าที่ไม่ใช่ตัวเลขกลายเป็น NaN เงียบ ๆ

**File:** `api/src/env.ts:10, 43` และการใช้งาน `api/src/routes/orders.ts:451-452`
**Issue:**
`HOLD_WINDOW_SECONDS`/`PORT` เป็น `t.String` ล้วน ไม่มีการ validate ว่าเป็นตัวเลข ถ้าตั้งเป็นค่าที่ไม่ใช่ตัวเลข `Number(env.HOLD_WINDOW_SECONDS)` = `NaN` → `new Date(Date.now() + NaN*1000)` = Invalid Date ถูก insert ลง `hold_expires_at` ทำให้ hold-expiry เพี้ยน (sweep เทียบ `lt(holdExpiresAt, now)` กับ Invalid Date จะไม่ทำงานตามคาด) โดยไม่ fail-fast ตามเจตนา D-10
**Fix:** ใช้รูปแบบ numeric-string ที่ validate ได้ เช่น `t.String({ pattern: "^[0-9]+$" })` หรือ transform เป็น integer ใน schema แล้ว fail boot เมื่อไม่ผ่าน

### WR-07: `POST /auth/line` find-or-insert ไม่มี UNIQUE(line_user_id) → แข่งกันสร้าง customer ซ้ำ / ประวัติแตก

**File:** `api/src/routes/auth.ts:100-120` และ `api/src/db/schema.ts:161-168`
**Issue:**
โค้ดยอมรับใน comment ว่ายังไม่มี UNIQUE index บน `customers.line_user_id` (deferred) หากมี 2 request login พร้อมกันของ user เดียวกัน (เช่นเปิดสองแท็บ) จะ insert customer สองแถวสำหรับ `lineUserId` เดียว ทำให้ประวัติออเดอร์ (`/me/orders`) แตกเป็นสองบัญชี และ session ผูกกับ customerId ที่ต่างกัน แม้โอกาสต่ำ แต่กระทบ CUST-04/ความถูกต้องของ identity
**Fix:** เพิ่ม `uniqueIndex("customers_line_user_id_idx").on(t.lineUserId).where(sql\`${t.lineUserId} IS NOT NULL\`)` แล้วเปลี่ยน insert เป็น upsert (`onConflictDoUpdate`) เพื่อให้ DB เป็น arbiter

## Info

### IN-01: `boxes.fixedPriceSatang` ไม่ได้บังคับให้เป็นจำนวนบาทเต็ม → มีโอกาส float rounding ในยอด QR/สลิป

**File:** `api/src/db/schema.ts:187`, `api/src/services/promptpay.ts:21-23`, `api/src/routes/orders.ts:338-339, 455`
**Issue:**
คอมเมนต์ใน promptpay.ts อ้างว่ายอดเป็นบาทเต็ม X.00 เสมอเพราะราคา pack เป็น ceil-to-baht และค่าส่งเป็นบาทเต็ม แต่ box ที่ใช้ `fixedPriceSatang` เป็น integer satang อิสระ (ไม่มี constraint หาร 100 ลงตัว) หากแอดมินตั้งเป็นค่าที่ไม่ลงตัวบาท `totalSatang / 100` อาจได้ทศนิยมที่มี float error เล็กน้อยเมื่อไลบรารี format 2 ตำแหน่ง เทียบกับการ `Math.round(n*100)` ในฝั่ง slip-verify การเปรียบเทียบเป็น satang ช่วยได้มาก แต่ยังมีขอบเขตเสี่ยง ควรบังคับ `fixedPriceSatang % 100 === 0` หรือรับรองการ format ยอดอย่างชัดเจน
**Fix:** เพิ่ม CHECK constraint `fixed_price_satang % 100 = 0` หรือ document/บังคับ whole-baht สำหรับ box fixed price

### IN-02: `notify.ts`/`provision-rich-menu.ts` อ่าน `process.env` ตรง ๆ ขัดแนวทาง env.ts

**File:** `api/src/services/notify.ts:22`, `api/scripts/provision-rich-menu.ts:23`
**Issue:**
env.ts ระบุว่า "nothing reads process.env by key elsewhere" แต่ทั้งสองไฟล์อ่าน `process.env.LIFF_ID`/`VITE_LIFF_ID` ตรง (คอมเมนต์รับทราบว่าเป็น deferred) ทำให้ `LIFF_ID` ที่ไม่ถูกตั้งกลายเป็น `""` เงียบ ๆ และ deep link ใน Flex/rich menu จะเสีย (`https://liff.line.me//orders/...`) โดยไม่มีการเตือนตอน boot
**Fix:** ย้าย `LIFF_ID` เข้า `EnvSchema` (มี default `""` ได้) เพื่อรวมศูนย์ config และเปิดทางเตือนเมื่อไม่ตั้งค่าก่อน go-live

### IN-03: `POST /orders/:id/confirm-payment` ไม่ตรวจว่ามี payment row `awaiting_review` อยู่จริง

**File:** `api/src/routes/payments.ts:253-276`
**Issue:**
เป็น override ของแอดมิน (มี `requireRole`) แต่ยอมยืนยันเป็น `paid` ให้ออเดอร์ `awaiting_payment` ใด ๆ แม้ยังไม่มีสลิป/payment row ใด ๆ เลย และการ `UPDATE payments SET status='clean' WHERE status='awaiting_review'` เป็น best-effort (0 แถวก็ผ่าน) — ยอมรับได้ในฐานะ manual override แต่ควรบันทึก audit ว่าเป็นการยืนยันด้วยมือ (ไม่มี transRef) เพื่อให้แยกจากการชำระที่ verify อัตโนมัติได้
**Fix:** (ทางเลือก) insert payment row `status:"clean"` ที่ระบุ `rejectReason:null`/source ว่าเป็น manual-confirm เมื่อไม่มีแถว awaiting_review ให้ update เพื่อคงร่องรอยการตรวจสอบ

---

_Reviewed: 2026-07-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
