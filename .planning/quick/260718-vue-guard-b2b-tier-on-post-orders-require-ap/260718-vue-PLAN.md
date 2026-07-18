---
phase: quick
plan: 260718-vue
type: execute
wave: 1
depends_on: []
files_modified:
  - api/src/routes/orders.ts
  - api/tests/order-b2b-tier-gate.test.ts
autonomous: true
requirements: [INV-02, CUST-02]

must_haves:
  truths:
    - "POST /orders with tier=b2b and a guest customer body is rejected 403 not_b2b_approved."
    - "POST /orders with tier=b2b and a MemberCustomer whose b2b_status is not 'approved' is rejected 403 not_b2b_approved."
    - "POST /orders with tier=b2b and an approved-B2B MemberCustomer still succeeds 201 at wholesale prices."
    - "No wholesale price row is ever read for an unapproved caller — the guard runs before both price-resolution loops."
    - "tier=b2c behaviour (guest and member, single lines and box lines) is completely unchanged."
  artifacts:
    - api/src/routes/orders.ts
    - api/tests/order-b2b-tier-gate.test.ts
  key_links:
    - "orders.ts imports wholesaleVisible from ../services/b2b — the SAME single rule catalog.ts:148 and b2b.ts:187/:388 use. No second copy of the approval check exists."
---

<objective>
Close BLOCKER-01 from `.planning/v1.0-MILESTONE-AUDIT.md`: the B2B wholesale price tier is
gated on every READ surface and on no WRITE surface. `api/src/routes/orders.ts:219` takes
`body.tier` verbatim and resolves wholesale prices from it at `:259` (single lines) and
`:329` (box components), so any unauthenticated caller — including a public web-store guest
who cannot even SEE wholesale prices — can transact at them by POSTing `{"tier":"b2b"}`.

Purpose: a live authorization defect on a money path, already merged to origin/develop.
Output: one guard at the top of the POST /orders handler that reuses the existing
`wholesaleVisible()` rule, plus a regression test pinning the invariant.

This is NOT a regression of D-08 / T-03-21. Those decisions are scoped to price
VISIBILITY (T-03-21 = "Info disclosure | B2B price ก่อนอนุมัติ"). The order WRITE path was
never inside that scope. Do not treat existing D-08 work as broken — extend the same
single rule to the write path.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@api/src/services/b2b.ts
@api/src/routes/orders.ts
@api/src/routes/catalog.ts
@api/tests/catalog.test.ts
</context>

<design_decisions>
Settled before execution — do NOT re-litigate these during implementation.

**1. Identity source = the request body, NOT a bearer session.**
`POST /orders` is deliberately an OPEN endpoint (no `requireRole`, D-03) serving guest
checkout, and its handler destructures only `{ body, set }` — there is no session derive
on this route at all. Member orders are ALREADY identified purely by
`body.customer.customerId` (see the `MemberCustomer` comment at `orders.ts:105-108`).
Checking `wholesaleVisible(db, body.customer.customerId)` therefore EXTENDS the endpoint's
existing trust model rather than inventing a new one. Do NOT add a `.derive()` session
block: it would make the b2b branch the only thing on this open endpoint requiring a
token, inconsistent with the member b2c order sitting right next to it.

**2. Do NOT gate the whole route.** Gate only the `tier === "b2b"` branch. Guest b2c
checkout must keep working exactly as today.

**3. Guest + tier=b2b → reject.** A `GuestCustomer` body carries no `customerId`, so there
is no identity to check. Reject rather than silently downgrading to b2c — a silent
downgrade would charge a different price than the caller asked for.

**4. Rejection shape = `403` + `{ error: "not_b2b_approved" }`.** This mirrors verbatim how
`b2b.ts:187` and `b2b.ts:388` reject an unapproved wholesale reader. The codebase has NO
Thai error-message convention on the API surface — every error is an English snake_case
code (`invalid_line`, `variety_not_found`, `no_price`); follow that. Use the SAME code for
both the guest and the unapproved-member case so the response does not disclose whether a
given customerId exists or what its b2b_status is.

**5. Fail CLOSED on a DB error.** Do NOT copy `catalog.ts:147-151`'s `try/catch → false`.
That fails OPEN deliberately (IN-03: a DB hiccup must not 500 the catalog, which stays
open per D-03). This is a money-WRITE path with the opposite requirement: let
`wholesaleVisible` throw, surface a 500, and create no order. Add no try/catch.

**6. Known residual, NOT in scope.** Knowing an approved customer's UUID lets a caller
order "as" them at wholesale. That is the pre-existing member-linkage trust model shared
with the b2c path (any UUID-knower can already attribute a b2c order to a member). It is a
separate, larger task — record it, do not expand this fix to cover it.
</design_decisions>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Gate the b2b tier branch of POST /orders on wholesaleVisible()</name>
  <files>api/src/routes/orders.ts</files>
  <behavior>
    - tier="b2c" + guest body → unchanged (still reaches price resolution, 201)
    - tier="b2c" + member body → unchanged (201)
    - tier="b2b" + guest body (no customerId) → 403 not_b2b_approved
    - tier="b2b" + member body, customer b2b_status="pending" → 403 not_b2b_approved
    - tier="b2b" + member body, customer b2b_status="rejected" → 403 not_b2b_approved
    - tier="b2b" + member body, customer b2b_status="approved" → proceeds to price resolution
  </behavior>
  <action>
Import `wholesaleVisible` from `../services/b2b` into `api/src/routes/orders.ts`. Do NOT
write a second copy of the approval check and do NOT query `customers.b2bStatus` directly
here — reusing the one rule is the entire point (D-08 / T-03-21 / 03-13): `catalog.ts`,
`/b2b/:id/prices`, `/me/b2b/prices` and now `POST /orders` can never disagree.

In the `POST /orders` handler, immediately after `const tier = body.tier as Tier;` (line
219) and BEFORE the `today` assignment and both resolve loops, add the b2b guard. It must
sit above the single-line loop (which resolves the tier price at :259) and above the
box-line loop (:329) so that no wholesale price is ever computed for an unapproved caller.

Guard logic, only when `tier === "b2b"`:
1. Narrow the customer union. `body.customer` is `MemberCustomer | GuestCustomer`; use a
   `"customerId" in body.customer` check so TypeScript narrows to the member shape. If the
   property is absent, the caller is a guest with no resolvable identity → set status 403
   and return `{ error: "not_b2b_approved" }`.
2. Otherwise `await wholesaleVisible(database, body.customer.customerId)`. If it returns
   false → set status 403 and return `{ error: "not_b2b_approved" }`.
3. No try/catch — a DB failure must throw and fail closed (see design decision 5).

Add a short comment above the guard recording: the audit ID (BLOCKER-01), that it extends
the D-08 visibility rule from the READ surfaces to this WRITE surface, that it deliberately
gates only the b2b branch because the route is OPEN for guest checkout (D-03), and that it
fails closed unlike the catalog's fail-open gate.

Do not change the `CreateOrderBody` schema — `t.Literal("b2b")` stays accepted at :117 and
is rejected by the handler, so the failure is a clean 403 rather than a 422 shape error.
Change nothing else in the handler.
  </action>
  <verify>
    <automated>cd api &amp;&amp; bunx tsc --noEmit &amp;&amp; grep -c 'wholesaleVisible' src/routes/orders.ts</automated>
  </verify>
  <done>`orders.ts` imports and calls `wholesaleVisible`; the call sits above both price-resolution loops; typecheck is clean; no direct `customers.b2bStatus` query was added to orders.ts.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Regression test pinning the b2b write-path invariant</name>
  <files>api/tests/order-b2b-tier-gate.test.ts</files>
  <behavior>
    - guest body + tier=b2b → 403, body.error === "not_b2b_approved"
    - member body with a pending-b2b customer + tier=b2b → 403 not_b2b_approved
    - member body with an approved-b2b customer + tier=b2b → 201, order created at the b2b price
    - control: the same cart with tier=b2c and a guest body → 201 (gate did not widen)
  </behavior>
  <action>
Create `api/tests/order-b2b-tier-gate.test.ts` following the existing order-test style —
read `api/tests/order-snapshot.test.ts` (or `box-order.test.ts`) for the established
arrange/fire/db-reset harness and `api/tests/catalog.test.ts:212-252` for the naming and
shape of the sibling READ-path gate test ("b2b (wholesale) tier gate — 03-13"). Reuse
whatever `seedCustomer(status)` helper the b2b tests already use rather than inventing one;
`api/tests/b2b-approval.test.ts` has the approved/pending seeding pattern.

Arrange a round with an open sellable variety, a sale unit, and BOTH a b2c and a b2b price
row for that (round, variety) so the approved path can actually resolve a wholesale price
and the 201 assertion is meaningful (not a false pass from `no_price`).

Write the four cases listed in <behavior>. For the approved 201 case, assert the persisted
line price reflects the b2b per-kg rate, not the b2c one — this is what proves the gate
lets the real wholesale path through rather than silently downgrading the tier.

Name the describe block so the invariant is greppable, e.g.
`describe("b2b tier WRITE gate — BLOCKER-01, D-08 / T-03-21 / INV-02")`.
  </action>
  <verify>
    <automated>cd api &amp;&amp; bun test tests/order-b2b-tier-gate.test.ts</automated>
  </verify>
  <done>All four cases pass. Deleting the guard from orders.ts makes the two 403 cases fail (the test genuinely pins the invariant, not just the happy path).</done>
</task>

<task type="auto">
  <name>Task 3: Full API suite regression + audit note</name>
  <files>api/tests/, .planning/v1.0-MILESTONE-AUDIT.md</files>
  <action>
Run the full API test suite and confirm no regression — it was 233 passing as of phase 03
and has grown through phase 04, so the bar is "the pre-change count plus the new cases, zero
failures". If any existing test breaks, it is almost certainly a test that POSTs
`tier: "b2b"` with a guest or unseeded customer; fix the TEST's arrange (seed an approved
customer) rather than weakening the guard.

Then append a one-line resolution note under BLOCKER-01 in
`.planning/v1.0-MILESTONE-AUDIT.md` recording that the write-path gate is closed, which
file/test closes it, and the known residual from design decision 6 (UUID-knower can
attribute a wholesale order to an approved member — pre-existing member-linkage trust,
tracked separately, not part of this fix).
  </action>
  <verify>
    <automated>cd api &amp;&amp; bun test</automated>
  </verify>
  <done>Full suite green with zero failures; BLOCKER-01 carries a resolution note naming the guard, the test file, and the residual.</done>
</task>

</tasks>

<verification>
- `grep -n "wholesaleVisible" api/src/routes/orders.ts` returns a hit (was empty before this fix).
- The `wholesaleVisible` call appears at a lower line number than both `eq(prices.tier, tier)` occurrences in orders.ts — proving the guard precedes every price resolution.
- `grep -n "b2bStatus" api/src/routes/orders.ts` returns NOTHING — the approval rule was reused, not re-implemented.
- `cd api && bun test` is fully green.
</verification>

<success_criteria>
An unauthenticated guest POSTing `{"tier":"b2b", ...}` receives 403 `not_b2b_approved` and
no order row is created; an approved-B2B member still places wholesale orders normally;
every b2c path is byte-for-byte unchanged in behaviour; the wholesale approval rule still
exists in exactly one place (`services/b2b.ts:87`).
</success_criteria>

<output>
Create `.planning/quick/260718-vue-guard-b2b-tier-on-post-orders-require-ap/260718-vue-SUMMARY.md` when done.
</output>
