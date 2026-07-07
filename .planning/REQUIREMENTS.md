# Requirements: Saladee — ระบบร้านค้าออนไลน์ขายผักสลัด + วางแผนการปลูก

**Defined:** 2026-07-01
**Core Value:** ลูกค้าสั่งผักสลัดผ่าน LINE แล้วจ่ายเงินจบในที่เดียว และจำนวนที่เปิดขายตรงกับผลผลิตจริงเสมอ (ไม่ oversell, ไม่เหลือทิ้ง)

> ที่มา: SRS v0.6 (`salad-shop-requirements.md`, FR-01..FR-51 / NFR-01..08) + งานวิจัย `.planning/research/`
> ปรับจาก research: slip-verification + price-snapshot เลื่อนขึ้น v1 (Phase 1), เพิ่ม Foundation phase, PDPA/security เป็น v1

---

## v1 Requirements

### PLAT — แพลตฟอร์ม & Compliance (พื้นฐาน + cross-cutting)

- [ ] **PLAT-01**: ระบบมีแกนตัดสต็อกแบบ atomic (guarded decrement) กัน oversell ได้แม้มีออเดอร์เข้าพร้อมกัน (NFR-02)
- [x] **PLAT-02**: ระบบเก็บข้อมูลบน PostgreSQL เดียว + object storage สำหรับสลิป/รูป บนต้นทุนต่ำสุด (NFR-08)
- [ ] **PLAT-03**: รหัสผ่านถูกเข้ารหัส, จำกัดสิทธิ์ตามบทบาท, สลิป/ข้อมูลลูกค้าเข้าถึงได้เฉพาะผู้มีสิทธิ์ (private bucket + signed URL) (NFR-03)
- [x] **PLAT-04**: ระบบขอความยินยอม PDPA, มีนโยบายความเป็นส่วนตัว, รองรับสิทธิ์ขอ/ลบข้อมูล, เก็บ log การยินยอม แยก consent การตลาด (NFR-04)
- [x] **PLAT-05**: ทุกหน้าใช้งานบนมือถือได้ดี (mobile-first เริ่มจาก LIFF) และรองรับทราฟฟิกพุ่งช่วงไลฟ์/โปรโมชัน (NFR-07, NFR-01)

### INV — สินค้า ราคา และสต็อก

- [ ] **INV-01**: แอดมินจัดการสินค้าได้ (ชื่อ, รูป, หมวดหมู่, คำอธิบาย, หน่วยขาย) (FR-01)
- [ ] **INV-02**: สินค้ารองรับราคาหลายระดับ — ราคาปลีก (B2C) และราคาส่ง (B2B) (FR-02)
- [ ] **INV-03**: รองรับหน่วยขายแบบแพ็ก/ถุงน้ำหนักคงที่ (เช่น 250 ก., 500 ก.) (FR-36)
- [ ] **INV-04**: แอดมินตั้งราคาต่อ กก. รายวัน/รายรอบแยกตามชนิดผัก, ระบบคำนวณราคาแพ็กอัตโนมัติ, เก็บประวัติราคาต่อรอบ (FR-38)
- [ ] **INV-05**: แอดมินจัดการรอบขาย (Selling Round) — วันปิดรับ (cut-off), วันเก็บ, วันส่ง, จำนวนเปิดขายต่อรอบ (FR-03)
- [ ] **INV-06**: ระบบตัดสต็อกกัน oversell ต่อรอบเมื่อมีออเดอร์เข้า — Phase 1 กรอกจำนวนเปิดขายด้วยมือ (FR-04, ต่อเนื่องกับ CROP-04)
- [ ] **INV-07**: กล่องสลัดผสม (Mixed Salad Box / Bundle) — จำนวนที่ขายได้ = จำกัดตามชนิดที่มีน้อยสุด, ตัดสต็อกทุกส่วนประกอบใน transaction เดียว (FR-51)
- [ ] **INV-08**: สินค้าที่หมดตั้งสถานะ "หมดรอบนี้" และลูกค้ากดขอแจ้งเตือนเมื่อมีของได้ (FR-06)
- [ ] **INV-09**: กำหนดนโยบายสินค้าทดแทน (substitution) ต่อออเดอร์ (อนุญาต/ไม่อนุญาต) (FR-07)
- [ ] **INV-10**: บันทึกล็อต/วันเก็บเกี่ยว/best-before เพื่อ traceability (FR-05)

### SALE — รูปแบบการขาย

- [ ] **SALE-01**: ลูกค้าสั่งแบบพรีออเดอร์ตามรอบ — ระบบรวมยอดตามรอบส่ง (FR-08)
- [ ] **SALE-02**: ลูกค้าซื้อแบบของพร้อมส่ง — ตัดจากสต็อกที่มีทันที (FR-09)
- [ ] **SALE-03**: ลูกค้าสมัครสมาชิกรายรอบ (Subscription Box) — เลือกแพ็กเกจ/ความถี่, สร้างออเดอร์อัตโนมัติ, ต่ออายุ/หยุดชั่วคราว/ยกเลิก (FR-10)
- [ ] **SALE-04**: ลูกค้าเลือกรูปแบบซื้อได้ในหน้าสินค้าเดียวกัน (ถ้าสินค้ารองรับหลายแบบ) (FR-11)

### ORD — จัดการออเดอร์ (Omnichannel)

- [x] **ORD-01**: ระบบรับออเดอร์จาก LINE (LIFF/แชทบอท) เข้าหลังบ้านเดียวกัน (FR-13)
- [ ] **ORD-02**: หน้าจัดการออเดอร์รวมทุกช่องทาง พร้อม pipeline สถานะ (รอชำระ → ชำระแล้ว → กำลังแพ็ก → จัดส่ง → สำเร็จ/ยกเลิก) (FR-14)
- [x] **ORD-03**: พนักงานเห็นคิวงานแพ็กจัดกลุ่มตามรอบส่ง/เส้นทาง และพิมพ์ใบแพ็ก/ใบปะหน้าได้ (FR-15)
- [x] **ORD-04**: ระบบแจ้งเตือนลูกค้าอัตโนมัติเมื่อสถานะเปลี่ยน ผ่าน LINE (FR-16)
- [ ] **ORD-05**: ลูกค้าสั่งซื้อผ่านเว็บได้ (ตะกร้า → checkout) (FR-12)

### PAY — ชำระเงิน

- [x] **PAY-01**: ระบบสร้าง PromptPay QR ตามยอดออเดอร์ (ระบุจำนวน) ฝั่ง backend เอง (FR-17)
- [x] **PAY-02**: ลูกค้าโอน + อัปโหลดสลิป, ระบบตรวจสลิปด้วย slip-verification API + ป้องกันสลิปซ้ำ/ปลอม, แอดมินยืนยันได้ (FR-18)
- [x] **PAY-03**: สถานะการชำระผูกกับออเดอร์ + QR มีเวลา hold/หมดอายุ ปล่อยสต็อกที่จองคืนหากไม่ชำระ (FR-19)
- [ ] **PAY-04**: ลูกค้าขอใบกำกับภาษี/ใบเสร็จได้ตอน checkout, กรอกข้อมูลผู้รับ, ออก PDF, เก็บประวัติตาม PDPA — เก็บ price-at-order-time ตั้งแต่ Phase 1 (FR-37)

### DEL — จัดส่ง

- [x] **DEL-01**: รองรับ 4 รูปแบบจัดส่ง — ส่งเอง(สมุทรปราการ)/ขนส่งเย็น/Grab-Lalamove/ขนส่งทั่วไป (FR-20)
- [x] **DEL-02**: คำนวณค่าส่งตามรูปแบบ/โซน + เงื่อนไขส่งฟรีเมื่อครบ 500 บาท (FR-21)
- [x] **DEL-03**: จำกัดรูปแบบจัดส่งตามประเภทสินค้า (สินค้าสดมากบังคับส่งเอง/ขนส่งเย็น) (FR-22)
- [x] **DEL-04**: ลูกค้าเลือกวัน/รอบจัดส่งตอน checkout ให้สอดคล้องกับรอบเก็บเกี่ยว (FR-23)
- [ ] **DEL-05**: บันทึกเลขพัสดุ/สถานะจัดส่ง (เชื่อม API ขนส่งในเฟสท้าย) (FR-24)

### CUST — ลูกค้า & สมาชิก

- [ ] **CUST-01**: ลูกค้าสมัคร/ล็อกอิน (รวม LINE Login) และสั่งแบบ guest ได้ — guest กรอกข้อมูลต่อครั้ง, สมาชิกบันทึกที่อยู่ไว้ใช้ซ้ำ (FR-25)
- [ ] **CUST-02**: ระบบแยกประเภทลูกค้า B2C/B2B — B2B เห็นราคาส่ง, ตั้งวงเงิน/เครดิตเทอมได้ (FR-26)
- [ ] **CUST-03**: ระบบสมาชิก/สะสมแต้ม — สะสมจากยอดซื้อ, แลกส่วนลด/ของแถม, ระดับสมาชิก (FR-27)
- [x] **CUST-04**: ลูกค้าดูประวัติการสั่งซื้อและกด "สั่งซ้ำ" ได้ (FR-28)
- [ ] **CUST-05**: B2B ตั้งออเดอร์ประจำ (Standing Order) ผูกรอบส่ง และระบบกันโควตาจากผลผลิตคาดการณ์ให้ B2B ก่อน (FR-39)

### MKT — การตลาด

- [ ] **MKT-01**: แอดมินสร้างโปรโมชัน/คูปอง — ส่วนลด %/บาท, ขั้นต่ำ, วันหมดอายุ, จำกัดจำนวนครั้ง, โค้ดเฉพาะกลุ่ม (FR-29)
- [ ] **MKT-02**: แชทบอตตอบ/รับออเดอร์บน LINE/Facebook (ดูเมนู, เช็กของ, เปิดออเดอร์, ส่งลิงก์ชำระ) (FR-30)
- [ ] **MKT-03**: Broadcast แจ้งโปรโมชันผ่าน LINE OA ตามกลุ่มลูกค้า (FR-31)
- [ ] **MKT-04**: รายงาน/วิเคราะห์ยอดขายตามช่วงเวลา/ช่องทาง/สินค้า/รอบ, สินค้าขายดี, ลูกค้าซื้อซ้ำ, AOV (FR-32)

### ADM — หลังบ้าน

- [ ] **ADM-01**: แดชบอร์ดสรุปยอดวันนี้/รอบนี้, ออเดอร์ค้างชำระ, ของใกล้หมดรอบ, ผลผลิตรอบหน้า (FR-33)
- [x] **ADM-02**: จัดการสิทธิ์ผู้ใช้ตามบทบาท (เจ้าของ/แอดมิน/ผู้ดูแลแปลง/พนักงานแพ็ก) (FR-34)
- [ ] **ADM-03**: ตั้งค่าระบบ — ช่องทางชำระเงิน, รูปแบบจัดส่ง, โซน/ค่าส่ง, รอบขาย, ราคาประจำวัน (FR-35)

### CROP — วางแผนการปลูก & พยากรณ์ผลผลิต

- [x] **CROP-01**: ทะเบียนชนิดผัก (Variety) พร้อมพารามิเตอร์ — days-to-harvest, น้ำหนักเฉลี่ย/ต้น, อัตรารอด, หน้าต่างเก็บเกี่ยว (FR-40)
- [x] **CROP-02**: บันทึกรุ่นปลูก (Planting Batch) — ชนิดผัก, วันปลูก, จำนวนต้น, แปลง/โต๊ะ/ราง (FR-41)
- [x] **CROP-03**: ระบบคำนวณอัตโนมัติ — วันเก็บคาด, ผลผลิตคาด (ต้น/น้ำหนัก) จากพารามิเตอร์ชนิดผัก (FR-42)
- [ ] **CROP-04**: ปฏิทินเก็บเกี่ยว (Harvest Calendar) รายสัปดาห์ → ป้อนเป็นจำนวนเปิดขายต่อรอบอัตโนมัติ (แทนการกรอกมือ) (FR-43)
- [ ] **CROP-05**: บันทึกผลเก็บเกี่ยวจริง (วันเก็บ/จำนวน/น้ำหนัก/ของเสีย) เทียบค่าคาดเพื่อปรับพารามิเตอร์ (FR-44)
- [x] **CROP-06**: แผนการปลูกผสมต่อรุ่น (Planting Mix) — กำหนดสูตรชนิด/จำนวนต่อรุ่น (~200 ต้น) ระบบสร้างหลาย Batch วันปลูกเดียวกันอัตโนมัติ (FR-50)
- [ ] **CROP-07**: ระบบแนะนำการปลูกย้อนกลับ — จากดีมานด์เฉลี่ยแนะนำจำนวนต้นที่ควรปลูกแต่ละจันทร์ (FR-45)

### LINE — ช่องทาง LINE OA

- [x] **LINE-01**: ตั้งค่า Rich Menu — สั่งผักรอบนี้, ราคาวันนี้, เช็ก/ติดตามออเดอร์, สมาชิก/แต้ม, ติดต่อร้าน (FR-46)
- [x] **LINE-02**: หน้าสั่งซื้อผ่าน LIFF — เลือกผัก/แพ็ก → รอบส่ง → ที่อยู่ → ชำระ PromptPay/แนบสลิป, รองรับ LINE Login/guest (FR-47)
- [x] **LINE-03**: เชื่อม Messaging API webhook — รับอีเวนต์ (ตรวจ signature), ตอบกลับอัตโนมัติ, ส่งแจ้งเตือนสถานะออเดอร์ (FR-48)
- [ ] **LINE-04**: แชทบอตรับออเดอร์แบบสนทนา + Broadcast โปรโมชันตามกลุ่ม (FR-49)

---

## v2 Requirements (milestone ถัดไป — หลัง v1 พิสูจน์ตลาดแล้ว)

### Scale & Integrations

- **INTG-01**: เชื่อม TikTok Shop / Facebook Shop โดยตรง (ช่วงแรกใช้ดึงทราฟฟิกเข้า LINE)
- **INTG-02**: เพิ่มกำลังการผลิต/หลายรุ่นต่อสัปดาห์ เพื่อเพิ่มจำนวนต่อชนิด (ตามข้อสมมุติ SRS หัวข้อ 9)
- **PAY-05**: OCR ตรวจสลิปในตัว (ปัจจุบันใช้ slip-verify API — จงใจไม่สร้าง OCR เอง)

---

## Out of Scope

Explicitly excluded (anti-features จาก research — ป้องกัน scope creep บน MVP ต้นทุนต่ำ):

| Feature | Reason |
|---------|--------|
| OCR/ML ตรวจสลิปเอง | ใช้ Thai slip-verify API ถูกและแม่นกว่า (PAY-02) — สร้างเองเสียเวลา/ต้นทุน |
| แชทบอต NLU ตอบอิสระ (free-text AI) | ใช้ Rich Menu + LIFF + canned reply พอสำหรับ MVP; NLU เสี่ยงตอบผิดออเดอร์ |
| ราคาชั่งจริง–ปรับยอด บนช่องทางจ่ายล่วงหน้า | ยอดเงินไม่ตรงตอน prepaid; ใช้แพ็กน้ำหนักคงที่ (INV-03) — ปรับได้เฉพาะช่อง "ส่งเอง" |
| Real-time multi-channel inventory sync | เกินจำเป็นก่อนมีรายได้; รอบ/หลังบ้านเดียวพอ |
| Payment gateway สำหรับ PromptPay | รัน QR ฝั่ง backend เอง ประหยัดค่าธรรมเนียม (NFR-08) |
| Serverless free tier (Fly/Railway/Render) | cold start ทำ webhook + reservation timer พัง — ใช้ VPS always-on แทน |
| LINE MyShop / off-the-shelf shop | modeling รอบเก็บเกี่ยว/ราคา/กล่องผสม (moat) ไม่ได้ |
| Kubernetes / microservices / message queue แยก | over-engineering ก่อนมีรายได้; modular monolith + pg-boss พอ |

---

## Traceability

แต่ละ v1 REQ แมปเข้า **1 phase** (ROADMAP.md, สร้าง 2026-07-01). 5 phases: 0 Foundation, 1 Commerce Core, 2 LINE Storefront/Payments/Delivery, 3 Back-office/Crop/B2B/Subscription, 4 Web/Marketing/Scale.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLAT-01 | Phase 1 | Pending |
| PLAT-02 | Phase 0 | Complete |
| PLAT-03 | Phase 1 | Pending |
| PLAT-04 | Phase 2 | Complete |
| PLAT-05 | Phase 0 | Complete |
| INV-01 | Phase 1 | Pending |
| INV-02 | Phase 1 | Pending |
| INV-03 | Phase 1 | Pending |
| INV-04 | Phase 1 | Pending |
| INV-05 | Phase 1 | Pending |
| INV-06 | Phase 1 | Pending |
| INV-07 | Phase 1 | Pending |
| INV-08 | Phase 1 | Pending |
| INV-09 | Phase 1 | Pending |
| INV-10 | Phase 3 | Pending |
| SALE-01 | Phase 1 | Pending |
| SALE-02 | Phase 1 | Pending |
| SALE-03 | Phase 3 | Pending |
| SALE-04 | Phase 1 | Pending |
| ORD-01 | Phase 2 | Complete |
| ORD-02 | Phase 1 | Pending |
| ORD-03 | Phase 3 | Complete |
| ORD-04 | Phase 2 | Complete |
| ORD-05 | Phase 4 | Pending |
| PAY-01 | Phase 2 | Complete |
| PAY-02 | Phase 2 | Complete |
| PAY-03 | Phase 2 | Complete |
| PAY-04 | Phase 1 | Pending |
| DEL-01 | Phase 2 | Complete |
| DEL-02 | Phase 2 | Complete |
| DEL-03 | Phase 2 | Complete |
| DEL-04 | Phase 2 | Complete |
| DEL-05 | Phase 4 | Pending |
| CUST-01 | Phase 1 | Pending |
| CUST-02 | Phase 3 | Pending |
| CUST-03 | Phase 4 | Pending |
| CUST-04 | Phase 2 | Complete |
| CUST-05 | Phase 3 | Pending |
| MKT-01 | Phase 4 | Pending |
| MKT-02 | Phase 3 | Pending |
| MKT-03 | Phase 4 | Pending |
| MKT-04 | Phase 3 | Pending |
| ADM-01 | Phase 3 | Pending |
| ADM-02 | Phase 3 | Complete |
| ADM-03 | Phase 3 | Pending |
| CROP-01 | Phase 3 | Complete |
| CROP-02 | Phase 3 | Complete |
| CROP-03 | Phase 3 | Complete |
| CROP-04 | Phase 3 | Pending |
| CROP-05 | Phase 3 | Pending |
| CROP-06 | Phase 3 | Complete |
| CROP-07 | Phase 4 | Pending |
| LINE-01 | Phase 2 | Complete |
| LINE-02 | Phase 2 | Complete |
| LINE-03 | Phase 2 | Complete |
| LINE-04 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 56 total (PLAT×5, INV×10, SALE×4, ORD×5, PAY×4, DEL×5, CUST×5, MKT×4, ADM×3, CROP×7, LINE×4). หมายเหตุ: บันทึกเดิมระบุ "45" เป็นการนับพลาด — REQ-ID จริงในเอกสารมี 56 รายการ
- Mapped to phases: 56/56 ✓ (Phase 0: 2, Phase 1: 17, Phase 2: 14, Phase 3: 16, Phase 4: 7)
- Unmapped: 0

---
*Requirements defined: 2026-07-01*
*Last updated: 2026-07-01 after roadmap creation (traceability mapped)*
