---
phase: quick-vr5-line-member-order-linkage
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - api/src/routes/orders.ts
  - api/tests/member-checkout-linkage.test.ts
  - web/src/liff.ts
  - web/src/lib/checkout.ts
  - web/src/views/CheckoutWizard.vue
autonomous: true
requirements: [LINE-02, CUST-04]   # D-04 (customers.line_user_id), D-19 (member-only history/detail/push)
must_haves:
  truths:
    - A logged-in LINE customer's LINE checkout creates an order whose customer_id is their member customer id (line_user_id-bearing), so order history/detail populate and status push has a recipient.
    - A member checkout records recipient_name / recipient_phone / recipient_address on the order row (from the same form fields the guest path collects).
    - Guest checkout behaviour is byte-identical: no customerId stored/sent, guest body unchanged, guest order still creates an anonymous customer + recipient columns exactly as before.
    - Atomic stock reservation (NFR-02), server-side price/fee re-computation, and PDPA usage-consent gating are all unchanged — the client still sends no money.
  artifacts:
    - api/tests/member-checkout-linkage.test.ts
  key_links:
    - loginWithLine() persists customerId (localStorage saladee_customer) -> CheckoutWizard reads getCustomerId() -> POST /orders member branch writes customer_id + recipient columns.
    - MemberCustomer TypeBox schema optional recipient fields <-> orders.ts member branch assigns those columns.
---

<objective>
Wire LINE member order linkage so a logged-in customer's LINE checkout binds the order to their member customer id (which carries line_user_id) AND records the delivery recipient — closing Phase-2 UAT test 4 (empty order history/detail + no status push).

Root cause (already diagnosed, re-confirmed against the code):
- `web/src/liff.ts` `loginWithLine()` returns `{ customerId, lineUserId }` but the caller discards `customerId`; it is never stored client-side.
- `web/src/views/CheckoutWizard.vue` always builds a GUEST order body (via `buildOrderBody`), so a logged-in member checks out as an anonymous guest → the order's `customer_id` points at a throwaway guest customer with no `line_user_id` → history/detail are empty and there is no LINE user to push to.
- `api/src/routes/orders.ts` `MemberCustomer` is `t.Object({ customerId })` with NO recipient fields, and the handler's member branch (lines 476-492) writes ONLY `customerId`, leaving `recipient_name/phone/address` NULL. So even if the web sent a member body, a member could not supply a delivery recipient.

CONFIRMED FACT (recipient columns on the member path): the member path does NOT currently write recipient columns. In the order transaction, `if ("customerId" in cust) { customerId = cust.customerId; }` sets only the id; `recipientName/recipientPhone/recipientAddress` stay `null`. Only the guest `else` branch populates them. This plan adds that write behind optional schema fields.

Purpose: Make member LINE checkout actually link to the LINE identity + recipient, with the smallest contract change and byte-identical guest behaviour.
Output: One atomic commit on the current branch: API contract+handler change, a new API linkage test, and the web wiring (persist customerId, send member body).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@api/src/routes/orders.ts
@api/src/db/schema.ts
@api/tests/reorder.test.ts
@api/tests/seed.ts
@web/src/liff.ts
@web/src/lib/checkout.ts
@web/src/views/CheckoutWizard.vue
@web/src/main.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend MemberCustomer with optional recipient fields and write them on the member order path</name>
  <files>api/src/routes/orders.ts</files>
  <behavior>
    - A member body `{ customerId, recipientName, recipientPhone, recipientAddress }` (+ delivery + consent) creates an order whose `customer_id === customerId` AND whose `recipient_name/phone/address` equal the supplied values.
    - A member body with ONLY `{ customerId }` (no recipient fields) still creates an order (recipient columns stay NULL) — existing `reorder.test.ts` original-order placement stays green.
    - Guest body path (`name`+`phone`+recipient) is unchanged: still inserts an anonymous customer and writes the recipient columns exactly as today.
    - Union discrimination is preserved: member bodies match `MemberCustomer` (they carry `customerId`, never `name`/`phone`); guest bodies match `GuestCustomer`.
  </behavior>
  <action>
Make the recipient fields carriable on the member path, WITHOUT weakening any money/stock/consent logic.

1. Update the `MemberCustomer` TypeBox schema (currently `t.Object({ customerId: t.String({ format: "uuid" }) })`). Add three OPTIONAL string fields with `minLength: 1`: `recipientName`, `recipientPhone`, `recipientAddress`, each wrapped in `t.Optional(...)`. They MUST be optional (not required) so an existing member body of just `{ customerId }` still validates — several tests post exactly that and expect 201. Keep `customerId` as the required uuid.

2. Update the narrowed `cust` TypeScript type union in the handler (the `body.customer as ...` cast just before the member-validation block). Add the three optional recipient fields (`recipientName?: string; recipientPhone?: string; recipientAddress?: string`) to the member arm of the union so the branch below can read them under `strict`/vue-tsc-equivalent typechecking.

3. In the transaction's member branch (`if ("customerId" in cust) { customerId = cust.customerId; }`), after assigning `customerId`, also assign the recipient locals from the optional fields, coalescing missing ones to null: set `recipientName`, `recipientPhone`, `recipientAddress` from `cust.recipientName ?? null` etc. Leave the guest `else` branch exactly as-is. Do NOT move or alter the reservation, price resolution, fee computation, consent gating, or the `orders` insert values wiring — those already read the `recipientName/phone/address` locals, so persistence flows automatically once the locals are set.

Rationale: optional-on-schema + null-coalesce is the minimal backward-compatible contract change. It lets a member supply a recipient (UAT-4) while leaving every legacy caller and the guest path untouched. The order insert already snapshots the recipient locals (D-21), so no insert change is needed.
  </action>
  <verify>
    <automated>cd api &amp;&amp; bunx tsc --noEmit</automated>
  </verify>
  <done>MemberCustomer accepts optional recipientName/recipientPhone/recipientAddress; the member branch assigns those to the recipient locals (null when absent); guest branch untouched; `bunx tsc --noEmit` passes in api/.</done>
</task>

<task type="auto">
  <name>Task 2: Add API test proving member checkout links customer_id AND records recipient</name>
  <files>api/tests/member-checkout-linkage.test.ts</files>
  <action>
Create a new test file modelled on `api/tests/reorder.test.ts` (same DI harness: real PG container at :55432, `makeOrdersRoutes(db, noopScheduler)`, `.handle(new Request(...))`, the `seed*` helpers, and the migrate up/down `beforeAll`/`afterAll` blocks — copy that setup verbatim).

Add a local `seedCustomer(lineUserId)` helper (same as reorder.test.ts: inserts a customer with `isMember: lineUserId !== null` and the given `lineUserId`).

Test A — member checkout links identity + records recipient:
  - Seed one open round + one sellable variety with stock and a b2c price (mirror the reorder.test.ts arrange block, single variety is enough).
  - `const memberId = await seedCustomer(`U_${crypto.randomUUID()}`)`.
  - POST `/orders` with body: `tier: "b2c"`, `customer: { customerId: memberId, recipientName: "คุณสมาชิก", recipientPhone: "0812345678", recipientAddress: "123 ถนนทดสอบ" }`, one `lines` entry, `deliveryMethod: "self"`, `deliveryZone: "samut_prakan"`, and a valid `consent: { usage: true, marketing: false, policyVersion: "1.0" }` (so it exercises the real LINE-checkout path, status awaiting_payment).
  - Expect 201. Read the created order row from the db by id and assert: `customerId === memberId`, `recipientName === "คุณสมาชิก"`, `recipientPhone === "0812345678"`, `recipientAddress === "123 ถนนทดสอบ"`.

Test B — bare member body backward-compat (no recipient):
  - POST `/orders` with `customer: { customerId: memberId }` and one line (no delivery/consent — legacy `created` path). Expect 201 and assert the order's `customerId === memberId` and recipient columns are null. This locks in that the new optional fields did not break the `{ customerId }`-only contract.

Pick delivery method/zone that `deliveryConfig` actually offers for the seeded variety's freshness class — reuse whatever pairing the existing 02-04 checkout tests use (grep `delivery.test.ts` / `order-snapshot.test.ts` for a known-good `deliveryMethod`/`deliveryZone` + variety deliveryClass combo) so the freshness gate returns the method as allowed.
  </action>
  <verify>
    <automated>cd api &amp;&amp; bun test tests/member-checkout-linkage.test.ts</automated>
  </verify>
  <done>New test passes: member checkout order has customer_id === member id and the three recipient columns set; bare `{ customerId }` order still 201 with null recipients.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Persist customerId client-side and send a member order body from checkout</name>
  <files>web/src/liff.ts, web/src/lib/checkout.ts, web/src/views/CheckoutWizard.vue</files>
  <behavior>
    - After `loginWithLine()` succeeds, `getCustomerId()` returns the customer id; clearing the session token (`setSessionToken(null)`) also clears the stored customer id.
    - When `getCustomerId()` is set, `buildOrderBody` emits `customer: { customerId, recipientName, recipientPhone, recipientAddress }` (recipient from the form fields).
    - When `getCustomerId()` is null, `buildOrderBody` emits the exact guest body it does today (byte-identical) — the existing checkout-wizard.test.ts guest assertion stays green.
  </behavior>
  <action>
Three coordinated edits; keep the guest path byte-identical.

1. `web/src/liff.ts`:
   - Add a `CUSTOMER_KEY = "saladee_customer"` constant.
   - Add `getCustomerId(): string | null` (localStorage-guarded, mirrors `getSessionToken`).
   - Add `setCustomerId(id: string | null): void` (mirrors `setSessionToken`: set when truthy, `removeItem` when null).
   - In `setSessionToken`, when clearing (the `token` falsy branch that calls `removeItem(SESSION_KEY)`), ALSO clear the customer id so a session clear never leaves a stale customerId. (Persisting-on-set stays only in loginWithLine per below to avoid coupling token-set to id-set.)
   - In `loginWithLine`, on the success path (right where it calls `setSessionToken(data.token)` and returns the identity), also call `setCustomerId(data.customerId)`.

2. `web/src/lib/checkout.ts`:
   - Widen `OrderBody.customer` to a union of the existing guest shape AND a member shape `{ customerId: string; recipientName: string; recipientPhone: string; recipientAddress: string }`.
   - Add an optional `customerId?: string` to the `buildOrderBody` opts. When `customerId` is provided, build `customer: { customerId, recipientName: customer.name, recipientPhone: customer.phone, recipientAddress: customer.address }`. When it is absent, build the EXACT guest `customer` object as today. Everything else (tier, lines/boxLines dropping, deliveryMethod/zone, consent) is identical for both branches.

3. `web/src/views/CheckoutWizard.vue`:
   - Import `getCustomerId` from `../liff`.
   - In `confirm()`, pass `customerId: getCustomerId() ?? undefined` into the `buildOrderBody({ ... })` call. No other change — the recipient still comes from the existing `customer` reactive form fields.

Do NOT add any money/price/total field to the body. The client still sends ids + qty + delivery choice + consent (+ customerId + recipient) only; POST /orders re-resolves all money.
  </action>
  <verify>
    <automated>cd web &amp;&amp; bunx vue-tsc --noEmit &amp;&amp; bun test</automated>
  </verify>
  <done>getCustomerId/setCustomerId exist and session-clear clears the id; loginWithLine persists customerId; buildOrderBody emits a member body when customerId is set and the identical guest body otherwise; vue-tsc clean and web tests (incl. existing checkout-wizard guest assertion) pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| LIFF client → POST /orders | Untrusted client supplies ids + qty + delivery choice + consent + (now) customerId + recipient. Never money. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-VR5-01 | Spoofing | member `customerId` in POST /orders body | medium | accept | Unchanged from current design: POST /orders is intentionally OPEN (D-03) and the member branch only validates the customerId EXISTS (orders.ts member-validation block). This plan does not add auth to order creation; member-only surfaces (history/detail/reorder) remain session-gated by line_user_id (D-19), so a spoofed customerId cannot read another member's data. No new exposure vs. today. |
| T-VR5-02 | Tampering | price/fee/total via new fields | high | mitigate | New body fields are identity + recipient strings only; no money field added. Server still re-resolves every price, re-computes the fee, and drives the QR (orders.ts unchanged). Verified by keeping the existing money/oversell tests green. |
| T-VR5-03 | Information disclosure | recipient PII persisted for members | low | accept | Recipient columns already exist and are written for guests (D-21); members now write the same columns behind PDPA usage-consent gating that is unchanged. No new storage surface. |
| T-VR5-SC | Tampering | npm/pip/cargo installs | n/a | accept | No package installs in this change. |
</threat_model>

<verification>
Full gate (run from repo root or the noted subdir), all must pass:
- `cd api && bun test` — every existing order/reservation/oversell/consent test stays green AND the new `member-checkout-linkage.test.ts` passes.
- `cd web && bunx vue-tsc --noEmit` — type gate clean (member OrderBody union typechecks).
- `bun run --cwd web build` — LIFF static build succeeds.

Manual reasoning check (no code): confirm the guest path is byte-identical — `buildOrderBody` with no `customerId` produces the same object as before, and orders.ts guest `else` branch is untouched.
</verification>

<success_criteria>
- Member LINE checkout creates an order with `customer_id` = the member's customer id (line_user_id-bearing) → order history/detail populate and status push has a LINE recipient (UAT-4 closed).
- The member order records recipient_name/phone/address from the checkout form.
- Guest checkout is byte-identical; all pre-existing tests remain green.
- Atomic stock reservation, server-side money re-computation, and PDPA consent gating are unchanged.
- Change is one atomic commit on the current branch.
</success_criteria>

<output>
Create `.planning/quick/260706-vr5-wire-line-member-order-linkage-customeri/SUMMARY.md` when done.
</output>
