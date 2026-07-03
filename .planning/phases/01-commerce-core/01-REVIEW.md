---
phase: 01-commerce-core
reviewed: 2026-07-02T17:48:03Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - api/src/db/schema.ts
  - api/src/index.ts
  - api/src/routes/auth.ts
  - api/src/routes/boxes.ts
  - api/src/routes/catalog.ts
  - api/src/routes/orders.ts
  - api/src/routes/prices.ts
  - api/src/routes/rounds.ts
  - api/src/routes/stock.ts
  - api/src/routes/varieties.ts
  - api/src/services/order-status.ts
  - api/src/services/pricing.ts
  - api/src/services/reservation.ts
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues-found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-02T17:48:03Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Reviewed the commerce-core API (Bun + Elysia + Drizzle + PG17). The core oversell
guarantee — the guarded conditional `UPDATE` in `reservation.ts` — is sound: the
reserve/release primitives are genuinely atomic and correctly guarded, staff write
routes are RBAC-gated, price/pack snapshots are fully server-resolved (no client
price is trusted), and inputs are TypeBox/UUID validated with parameterized queries
throughout.

However, the phase's headline invariant (NFR-02, no oversell / accurate stock) is
broken on the **cancellation path for orders that span more than one round**. The
create handler explicitly permits multi-round orders and reserves each line against
its own round, but the order persists only a single `round_id` and the cancel path
releases every line against that one round — so reserved plants in the other round(s)
are never released. This is a real stock-correctness defect and is the one BLOCKER.
Five warnings follow (auth timing enumeration, staff-role minting on LINE login,
cross-line deadlock ordering, unbounded quantities, quota-lower crash), plus three
informational items.

## Critical Issues

### CR-01: Multi-round order cancellation releases stock against the wrong round (oversell-safety violation, NFR-02)

**File:** `api/src/routes/orders.ts:355-361, 402-407, 501-531`
**Issue:**
`POST /orders` accepts `lines[]` and `boxLines[]` where **each line carries its own
`roundId`**, and it reserves each line against that line's round
(`reserve(tx, r.roundId, …)` line 378; `reserveBox(tx, b.roundId, …)` line 389). The
handler even iterates a `new Set([...roundIds])` (lines 355-361), proving multi-round
orders are a supported, reachable input — nothing rejects an order whose lines span
two or more distinct rounds.

But the order row stores only **one** round:
`orderRoundId = resolved[0]?.roundId ?? resolvedBoxes[0]?.roundId` (line 402), and
`order_lines` has **no per-line round column** (`schema.ts:207-225`).

On cancel, the release loop uses that single `ord.roundId` for **every** line:
```ts
await release(tx, ord.roundId, c.varietyId, c.plantsPerBox * l.qty); // line 525 (box)
await release(tx, ord.roundId, l.varietyId, l.plants);               // line 528 (variety)
```
So for any order that reserved stock in round B while `ord.roundId` is round A:
- the `release` against round A matches a different `round_stock` row (or none) — its
  `reserved_plants >= plants` guard fails, returns `false`, and the release is
  **silently swallowed** (return value ignored);
- the plants reserved in round B are **never released** → permanent phantom
  reservation → that round reports less stock than exists → the "no oversell / stock
  always matches reality" invariant is violated in the opposite direction (chronic
  under-sell / stranded stock), and repeated occurrences leak the round to a false
  sold-out.

Note the box snapshot already stores the correct round (`box_bom_json.roundId`, line
457) yet the cancel path ignores it and uses `ord.roundId`.

`01-02-SUMMARY.md` documents "single-round-per-order for Phase 1" as an *assumption* —
but the create handler does not *enforce* it, so the assumption is violated by reachable
input and the cancel path corrupts stock.

**Fix (choose one):**

Option A — enforce the documented single-round invariant at create (smallest change):
```ts
const distinctRounds = new Set([
  ...resolved.map((r) => r.roundId),
  ...resolvedBoxes.map((b) => b.roundId),
]);
if (distinctRounds.size > 1) {
  set.status = 400;
  return { error: "multi_round_order_unsupported" };
}
```
Place this before the transaction (alongside the `no_lines` check ~line 300).

Option B — make cancel correct for multi-round: add `roundId uuid not null` to
`order_lines`, persist each line's own round on insert, and release against
`l.roundId` (and use `bom.roundId` for box components). Also assert
`release()` returned `true` (or log) so a failed release is never silently lost.

## Warnings

### WR-01: User-enumeration timing side-channel in `POST /auth/staff`

**File:** `api/src/routes/auth.ts:40-48`
**Issue:** The handler (and `01-03-SUMMARY.md`) claims "no enumeration signal", and the
response body is indeed identical. But the two paths differ sharply in **timing**: an
unknown email returns 401 immediately (line 40-43) **without** running Argon2id, whereas
an existing email runs `auth.verifyPassword` (line 44), an intentionally expensive
(~tens–hundreds of ms) hash verify. An attacker measuring response latency can reliably
distinguish "email exists" from "email unknown", defeating the stated anti-enumeration
goal (T-01-23).
**Fix:** Always perform a verify against a fixed dummy hash on the no-row path so both
branches spend comparable time:
```ts
const DUMMY_HASH = "$argon2id$v=19$m=65536,t=2,p=1$..."; // precomputed once at boot
const hash = row?.passwordHash ?? DUMMY_HASH;
const ok = await auth.verifyPassword(body.password, hash);
if (!row || !ok) { set.status = 401; return { error: "invalid_credentials" }; }
```

### WR-02: LINE login mints a staff-enum role (`packer`) for arbitrary LINE users

**File:** `api/src/routes/auth.ts:68`
**Issue:** `POST /auth/line` issues `auth.issueSession(String(payload.sub), "packer")`.
`packer` is a member of the **staff** `roleEnum` (`schema.ts:26`). Today no route gates
on `packer`, so it is inert — but it is a latent privilege-escalation footgun: the moment
any future route allows `packer` (a plausible packing/fulfilment surface), every LINE
customer who exchanges a valid idToken silently gains that staff capability. Reusing a
staff role as a customer placeholder blurs the auth boundary.
**Fix:** Introduce a distinct non-staff role (e.g. add `"customer"` to a separate enum or
mint a session with an explicit `customer` role) and never issue a staff-tier role from
the customer idToken exchange. At minimum, use a value that is not in the staff union.

### WR-03: Inconsistent lock-acquisition order across variety lines and box components → deadlocks

**File:** `api/src/routes/orders.ts:377-400`, `api/src/services/reservation.ts:112-117`
**Issue:** `reserveBox` carefully sorts components by `varietyId` to establish a global
lock order (reservation.ts:113), but the surrounding order handler reserves **variety
lines in request order** (line 377-380) and then boxes (line 385), with no global sort
across the whole order. Two concurrent orders that touch the same varieties in different
request order (e.g. order-1 reserves A then B; order-2 reserves B then A, whether via
variety lines or across separate box lines) can acquire the row locks in opposite order
and deadlock. PostgreSQL will detect it and abort one transaction, surfacing as an
unhandled 500 to a legitimate customer at checkout (worse during a live/promo spike,
NFR-01). Not data corruption, but a real availability defect the box-sort comment claims
to have eliminated.
**Fix:** Collect every (roundId, varietyId, plants) reservation for the whole order,
merge duplicates, sort by (roundId, varietyId), and issue the guarded `reserve()` calls
in that single global order inside the transaction.

### WR-04: No upper bound on `qty` — integer-overflow 500s and unbounded reservations

**File:** `api/src/routes/orders.ts:58, 66`; `api/src/db/schema.ts:202, 221-222`
**Issue:** `qty` is `t.Integer({ minimum: 1 })` with no maximum. `plantsDecremented`
(`plantsPerUnit * qty`) and `subtotalSatang` are stored in PG `integer` columns (int4,
max 2,147,483,647). A client sending a very large `qty` can overflow `subtotal_satang`
or the reservation arithmetic, producing an unhandled PG "integer out of range" → 500
(a cheap DoS), and the reservation math is exposed to values well outside sane ordering.
**Fix:** Add a sane upper bound, e.g. `t.Integer({ minimum: 1, maximum: 10000 })` on both
`OrderLineBody.qty` and `BoxLineBody.qty`, and/or widen the money/plants columns to
`bigint` and map arithmetic overflow to a 400.

### WR-05: Lowering a round's quota below reserved throws an unhandled 500

**File:** `api/src/routes/rounds.ts:100-114`
**Issue:** `POST /rounds/:id/stock` upserts `quotaPlants` via `onConflictDoUpdate`,
setting the new quota unconditionally. If staff lower `quotaPlants` below the current
`reserved_plants`, the `CHECK (reserved_plants <= quota_plants)` constraint (per
`schema.ts:92-94`) rejects the UPDATE and Elysia returns an opaque 500 instead of a clean
domain error. Data stays safe (the CHECK protects it), but the operator gets no
actionable response.
**Fix:** Catch the constraint violation (or pre-check `reserved_plants`) and return a
`409 { error: "quota_below_reserved" }` with the current reserved count.

## Info

### IN-01: Money derivation uses floating-point division (violates the integer-satang convention)

**File:** `api/src/services/pricing.ts:18-19`
**Issue:** CLAUDE.md mandates "Money is ALWAYS integer satang — never numeric/float", but
`deriveUnitPriceSatang` computes `(pricePerKgSatang * gramsPerUnit) / 1000` in
floating-point before `Math.ceil`. Empirically it matches an exact integer
implementation across all realistic inputs (verified over millions of samples up to
200000 satang/kg × 10000 g — 0 mismatches), so there is no current bug, but it depends on
inputs staying in range (see WR-04) and technically breaks the stated invariant.
**Fix:** Use integer ceil-division:
```ts
const d = 100000; // satang-per-kg × grams → whole baht
return Math.floor((pricePerKgSatang * gramsPerUnit + d - 1) / d) * 100;
```

### IN-02: Round cut-off/status re-check is not atomic with reservation

**File:** `api/src/routes/orders.ts:361-380`
**Issue:** Inside the transaction the round status/cutoff is checked (line 361-374) and
then stock is reserved (line 377), but `reserve()` guards only on stock, not round state,
and the status read takes no row lock. A round that closes (or crosses its cutoff) in the
narrow window between the check and the reserve can still have an order slip through. Low
impact (seconds-wide window; stock is still correct), noting for completeness.
**Fix:** If strict cutoff enforcement matters, `SELECT … FOR UPDATE` the round row, or add
the round-open predicate into the reservation UPDATE.

### IN-03: Member order placement does not verify caller owns the `customerId`

**File:** `api/src/routes/orders.ts:315-325`
**Issue:** `POST /orders` is intentionally open (guest checkout, D-03). For the member
branch it only checks the `customerId` **exists** — there is no session tying the caller
to that customer (customer auth is deferred to Phase 2). Because `customerId` is a random
UUID this is not practically enumerable today, but once customer identity exists this
becomes an IDOR (placing/reserving orders under another member's id). Flagging so it is
revisited when customer auth lands.
**Fix:** When customer sessions exist, require the member session `sub` to match
`customerId` rather than mere existence.

---

_Reviewed: 2026-07-02T17:48:03Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
