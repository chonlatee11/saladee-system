---
status: resolved
phase: 00-foundation-platform
source: [00-01-SUMMARY.md, 00-02-SUMMARY.md, 00-03-SUMMARY.md, 00-04-SUMMARY.md, 00-05-SUMMARY.md, 00-06-SUMMARY.md, 00-07-SUMMARY.md]
started: 2026-07-02T10:42:42Z
updated: 2026-07-02T10:52:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: หยุด service ที่รันอยู่ แล้วสตาร์ทแอปใหม่จากศูนย์ (docker compose up -d --build หรือ bun start). Server บูตไม่มี error, one-shot migrate apply 0000_init สำเร็จ, และ /health ตอบกลับทันที
result: pass

### 2. HTTPS /health คืน 200 พร้อม cert ถูกต้อง (Criterion 1)
expected: เปิด https://146.190.100.171.sslip.io/health → ได้ {"status":"ok"} และ TLS cert ใช้ได้ (Let's Encrypt, ไม่มี browser warning)
result: pass

### 3. Readiness probe เช็ค DB จริง (Criterion 2)
expected: เปิด https://146.190.100.171.sslip.io/health/ready → ได้ {"status":"ready"} (แอปต่อ prod Neon ได้จริงจาก container); ถ้า DB ล่มควรได้ 503
result: pass

### 4. Migration apply + rollback สะอาด (Criterion 2)
expected: รัน `bun run db:migrate` (up) แล้ว rollback ด้วย down .sql — ตาราง users + role enum (owner/admin/grower/packer) ถูกสร้างและลบกลับได้สมมาตร ไม่มี error ค้าง
result: pass

### 5. R2 signed-URL upload/download round-trip (Criterion 3)
expected: `bun run smoke:r2` — presigned PUT อัปโหลด → presigned GET ดาวน์โหลด, bytes ตรงกัน (รวม Thai payload); unsigned GET ถูกปฏิเสธ (bucket เป็น private)
result: pass

### 6. LINE webhook echo + forged signature 401 (Criterion 4)
expected: ส่งข้อความไปที่ LINE OA → ได้ข้อความ echo กลับ; ส่ง request ที่ x-line-signature ปลอม/ไม่มี → ได้ 401 (ไม่มี reply)
result: pass

### 7. Auth/RBAC scaffold ทำงาน (Criterion 4 — RBAC wired)
expected: /auth/staff รับ password → verify ด้วย Argon2id → ออก session JWT (jose HS256); requireRole guard คืน 401 เมื่อไม่มี token และ 403 เมื่อ role ผิด; /auth/line verify LINE idToken (ES256)
result: pass

### 8. Web LIFF scaffold live บน Cloudflare Pages
expected: เปิด https://saladee-web.pages.dev → หน้าโหลดได้ และเรียก live API /health ผ่าน Eden Treaty typed client (VITE_API_URL baked in)
result: pass
resolved_by: "00-08 (CORS gap-closure) — เพิ่ม @elysiajs/cors@1.4.2 ต่อก่อน routes ด้วย allowlist จาก env CORS_ORIGINS. ยืนยัน live หลัง CI deploy (run 28587162483): OPTIONS /health → 204 พร้อม access-control-allow-methods + access-control-allow-origin, GET /health → 200 + access-control-allow-origin สำหรับ Pages origin, origin ต้องห้ามไม่ถูก reflect, และหน้า https://saladee-web.pages.dev แสดง 'Saladee API health: ok'."

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "หน้าเว็บ Cloudflare Pages เรียก live API /health แล้วแสดงสถานะ ok"
  status: closed
  resolved_by: "00-08"
  reason: "User reported: ได้ Saladee API health: unreachable: health check failed (status 503) ที่หน้าจอ"
  severity: major
  test: 8
  root_cause: "API ไม่ได้ตั้งค่า CORS. web/ deploy อยู่คนละ origin (https://saladee-web.pages.dev) กับ API (https://146.190.100.171.sslip.io). API ตอบ /health 200 แต่ไม่ส่ง Access-Control-Allow-Origin และ OPTIONS preflight ได้ 404 → browser บล็อก cross-origin fetch. Eden Treaty จับ fetch ที่ล้มเหลวแล้วรายงาน error.status=503 (ค่า fallback). curl + unit test ไม่จับเพราะไม่บังคับ same-origin policy; eden-types.test รันบน bun (ไม่มี browser) จึงผ่านเชิงโครงสร้าง."
  artifacts:
    - path: "api/src/index.ts"
      issue: "ไม่มี CORS plugin ใน composition — ไม่ส่ง Access-Control-* headers และไม่ตอบ OPTIONS preflight"
    - path: "api/package.json"
      issue: "ไม่มี dependency @elysiajs/cors"
    - path: "web/src/main.ts"
      issue: "getHealth() รายงาน status 503 เมื่อ Eden treaty fetch ล้มเหลว (อาการปลายทาง ไม่ใช่ต้นเหตุ)"
  missing:
    - "เพิ่ม @elysiajs/cors (pin เวอร์ชัน) ใน api/package.json"
    - "ต่อ cors plugin ใน api/src/index.ts ก่อน routes โดยอนุญาต origin ของ Pages (https://saladee-web.pages.dev) + localhost สำหรับ dev; ครอบคลุม OPTIONS preflight"
    - "ยืนยัน Access-Control-Allow-Origin ปรากฏบน /health และ OPTIONS /health → 204/200 หลัง deploy"
  debug_session: ""
