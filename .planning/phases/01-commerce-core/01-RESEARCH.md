# Phase 1: Commerce Core - Research

**Researched:** 2026-07-02
**Domain:** Oversell-safe transactional commerce engine (PostgreSQL row-level concurrency, Drizzle ORM, Elysia/TypeBox, Bun)
**Confidence:** HIGH (stack is locked + already installed; core concurrency mechanism verified against PostgreSQL semantics and Drizzle docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** API-only in Phase 1 — REST endpoints (Elysia + TypeBox), tested via Bruno. **No admin UI.**
- **D-02:** A real `POST /orders` endpoint (atomic reservation + frozen snapshot), NOT a test-only harness. Same endpoint Phase 2 LIFF calls. Concurrency verified with a parallel run against this endpoint.
- **D-03:** Auth boundary — catalog/price/round **write** endpoints require staff auth (`jose` session, roles `owner`/`admin`); catalog **reads** may be public; `POST /orders` is **open to guest/member** (no staff auth).
- **D-04:** `customers` table from Phase 1 with guest/member distinction; reserve `line_user_id` column for Phase 2. Every order references a `customer_id`.
- **D-05:** Stock base unit = **plants (ต้น)**, per variety per round. Single canonical counter decremented in plants.
- **D-06:** Multiple sale units per variety (kg / bag / pack / plant), each storing a **conversion factor back to plants**. Conversion defined per variety.
- **D-07:** **quota / reserved split from day one.** `available = quota − reserved`. Creating an order increments `reserved` atomically. **No auto-expiry in Phase 1.**
- **D-08:** Only a `cancelled` transition releases stock (`reserved → available`), done atomically. `done`/`shipping` keep `reserved` consumed. Cancel disallowed once `done`.
- **D-09:** Rounds are **shop-wide** (one cut-off / harvest date / delivery date, many varieties). Each variety has its own sellable qty + price within a round.
- **D-10:** Cut-off auto-blocks ordering by time (`open → closed`), checked at request time — **no cron in Phase 1.**
- **D-11:** Sale modes are a property of the round/timing, not a separate stock structure (same counter + guard for pre-order and ready-to-ship).
- **D-12:** Price set per kg, per variety, per round, per tier; pack/unit prices **auto-derived** (kg price × unit weight).
- **D-13:** Auto-computed unit prices **round UP to whole baht** (no satang).
- **D-14:** Price cadence = round-primary with an **optional daily effective-date override** (override wins for that day).
- **D-15:** Both B2C and B2B tiers stored per variety/round; order records **which tier it used** (snapshot). Tier visibility gating deferred to Phase 3.
- **D-16:** **Full price/pack snapshot on each order line** (variety name, sale unit + plant conversion, kg price, tier, computed unit price, qty). Orders reconstructable without joining live price tables.
- **D-17:** Mixed box = **fixed BOM** (component varieties + plant quantities). Availability = `min` across components; ordering decrements every component **all-or-nothing in one transaction.** Build-your-box deferred.
- **D-18:** Box price = sum of component prices by default, with an **optional fixed box-price override.** Snapshot captures BOM + resolved price.
- **D-19:** Build the **full order status pipeline now** (created → awaiting payment → paid → packing → shipping → done/cancelled) as a validated state machine. Staff-driven transitions in Phase 1.
- **D-20:** Substitution & sold-out/notify are **data-only in Phase 1** (no real sends). Substitution policy field per order; sold-out status "หมดรอบนี้"; back-in-stock requests stored as records. Engine does **not** auto-substitute.
- **D-21:** Line-item snapshot captured (D-16); buyer tax/recipient fields exist on the order but optional in Phase 1. No PDF generation this phase.
- **D-22:** Packs + kg/plant conversion defined **per variety** (each variety stores avg weight/plant + its own pack list). Seam for CROP-01 in Phase 3.

### Claude's Discretion
- Exact row-locking mechanism (`SELECT … FOR UPDATE` vs conditional `UPDATE … WHERE available ≥ n`, `SKIP LOCKED`).
- Table/column layout, migration structure (up + hand-written down), directory layout within `api/src`, precise TypeBox schemas.
- Sale-mode modeling (D-11) and box definition (D-17) within the stated shape.
- Whether the daily price override (D-14) is a separate table or a nullable dated row.

### Deferred Ideas (OUT OF SCOPE)
- Admin UI (Phase 2/3).
- Build-your-box customer-chosen mixed box (later).
- B2B price-tier visibility gating / credit terms (CUST-02, Phase 3).
- Real LINE notifications & auto-substitution execution (ORD-04/LINE-03, Phase 2).
- Hold-expiry auto-release of reserved stock (PAY-03, Phase 2 — pg-boss).
- Invoice PDF generation (Phase 2 — pdfmake + Thai font).
- Formal round-close job (Phase 3).
- CROP auto-feed of sellable quantity (Phase 3).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAT-01 | Atomic guarded decrement, no oversell under concurrency | **Guarded single-statement `UPDATE … SET reserved = reserved + n WHERE quota - reserved >= n RETURNING …`** — see Pattern 1. Provably correct; PostgreSQL row-locks the matched row for the statement's duration. |
| PLAT-03 | Hashed passwords, RBAC, private buckets | Reuse Phase 0 `auth.plugin.ts` (`Bun.password` Argon2id, `requireRole`). Wire staff login to a real `users` lookup (D-07 TODO in `routes/auth.ts`). Private R2 bucket already from Phase 0. |
| INV-01 | Admin manages products (name, image, category, description, sale units) | `varieties` + `sale_units` + `products` tables; staff-guarded CRUD endpoints. |
| INV-02 | B2C + B2B price tiers | `prices` rows keyed by `(round_id, variety_id, tier)`; `tier` pgEnum. |
| INV-03 | Fixed-weight packs (250g / 500g) | Pack modeled as a `sale_unit` with `weight_grams` + resolved `plants_per_unit` (D-22). |
| INV-04 | Per-kg per-round pricing, auto pack price, price history | kg price stored; unit price derived (`ceil`) at read/order time; history = the set of round rows + dated overrides. |
| INV-05 | Selling rounds (cut-off, harvest, delivery, qty/round) | `rounds` + `round_stock(quota_plants)`. |
| INV-06 | Oversell-safe per-round decrement | The `round_stock` counter + guarded UPDATE (Pattern 1). |
| INV-07 | Mixed box limited by scarcest component; all-or-nothing decrement | `boxes` + `box_components`; multi-row guarded UPDATE inside one `db.transaction`, lock-ordered by `variety_id` (Pattern 2). |
| INV-08 | Sold-out "หมดรอบนี้" + back-in-stock request | Derived availability flag in catalog read; `back_in_stock_requests` table (data-only, D-20). |
| INV-09 | Per-order substitution policy | `orders.substitution_policy` pgEnum (`allow`/`disallow`). |
| SALE-01 | Pre-order by round | Round whose `harvest_date` is future (D-11); same counter. |
| SALE-02 | Ready-to-ship | Round already harvested (D-11); same counter. |
| SALE-04 | Multi-mode product on one product surface | Sale mode derived from round timing, not a separate structure (D-11). |
| CUST-01 | Customer identity + guest ordering | `customers` table (guest/member), `line_user_id` reserved (D-04). |
| ORD-02 | Unified order pipeline | `orders.status` pgEnum + validated transition table (D-19, Pattern 3). |
| PAY-04 | Price-at-order-time / invoice-ready | Full snapshot on `order_lines` (D-16); optional tax/recipient fields on `orders` (D-21). |
</phase_requirements>

## Summary

Phase 1 is a **backend-only, single-tier transactional engine**. Everything of value happens in one place: PostgreSQL 17 row-level concurrency control, orchestrated through Drizzle 0.45.2 on postgres.js 3.4.9 under Bun, behind Elysia/TypeBox endpoints. There are **no new external dependencies** — every library needed (drizzle-orm, elysia, postgres, jose, @sinclair/typebox) is already installed and version-pinned from Phase 0. This phase adds *schema, migrations, route handlers, and one carefully-written SQL decrement*.

The single most important decision — the atomic decrement — resolves clearly in favor of a **guarded single-statement conditional UPDATE** (`UPDATE round_stock SET reserved = reserved + $n WHERE quota - reserved >= $n RETURNING id`), not a `SELECT … FOR UPDATE` + application check. The guarded UPDATE is a single atomic statement: PostgreSQL evaluates the `WHERE`, takes a row lock, and applies the change indivisibly; a concurrent transaction attempting the same row blocks until the first commits, then re-evaluates `WHERE` against the *committed* value (`UPDATE`'s read-committed re-check semantics). A zero-row `RETURNING` result means "sold out" — exactly one winner on the last pack, with no application-level race window. For the mixed box (N components), the same guarded UPDATE is issued per component **inside one `db.transaction`, with components sorted by `variety_id` to impose a global lock order and prevent deadlocks**; any component returning zero rows throws, rolling the whole transaction back (all-or-nothing).

Money is handled as **integer satang** (1 baht = 100 satang) throughout — no floating point — with derived unit prices rounded UP to whole baht per D-13 (so their satang value is always a multiple of 100), which stays clean for Phase 2 PromptPay. Order status is a small **explicit transition table** validated in the handler (no state-machine library needed). Oversell-safety is proven with a **Bun test that races N parallel `app.handle` POST /orders against the real PostgreSQL 17 already wired for tests** (`api/tests/docker-compose.pg.yml`, port 55432), asserting exactly one 201 and the rest 409.

**Primary recommendation:** Use the guarded single-statement conditional `UPDATE … WHERE quota - reserved >= n RETURNING` for the atomic decrement (single variety) and the same statement per-component inside one deterministically-ordered `db.transaction` for the mixed box. Store money as integer satang. Prove it with a parallel-`Promise.all` Bun test against real PG17. Do **not** use `SELECT FOR UPDATE` + app-check, and do **not** use Drizzle's `.for("update", { noWait: true })` (emits broken SQL — issue #3554).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Atomic stock decrement | Database (PostgreSQL) | API (orchestration) | Correctness is a property of the SQL statement + isolation level; the app only issues it and interprets the row count. NEVER decide oversell in application memory. |
| Order/reservation transaction | Database (transaction) | API | All-or-nothing across N rows is a DB transaction guarantee, not an app loop. |
| Price derivation & rounding (ceil to baht) | API | — | Pure computation; belongs in the handler/service layer, snapshotted into the row. |
| Snapshot capture | API (write) → Database (store) | — | App resolves live price/pack → writes immutable columns onto `order_lines`. |
| Status transition validation | API | Database (enum constraint) | Transition legality is business logic (handler); the enum only constrains the set of legal values. |
| Auth / RBAC on writes | API (Elysia guard) | — | `requireRole` from Phase 0 `auth.plugin.ts`. |
| Catalog reads (public) | API | Database | No auth; Phase 2 LIFF consumes. |

## Standard Stack

**No new packages are added in Phase 1.** All of the following are already declared in `api/package.json` and were verified on the npm registry during Phase 0 (2026-06-28). This phase uses them; it does not introduce new dependencies.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | 0.45.2 | Type-safe schema, migrations, queries, transactions, explicit row locking | SQL-first; exposes `.for('update')`, `SKIP LOCKED`, `db.transaction`, and a raw `sql` escape hatch — exactly what atomic reservation needs. `[VERIFIED: api/package.json + orm.drizzle.team]` |
| drizzle-kit | 0.31.10 | Migration generate | Emits up SQL from schema; down SQL hand-written per Phase 0 D-12/13. `[VERIFIED: api/package.json]` |
| postgres (postgres.js) | 3.4.9 | PG driver on Bun | Proven Drizzle pairing; `prepare: false` already set for Neon PgBouncer (Phase 0 Pitfall 2). `[VERIFIED: api/src/db/client.ts]` |
| elysia | 1.4.29 | HTTP framework + TypeBox validation | Native TypeBox schemas → runtime validation + OpenAPI + Eden types. `[VERIFIED: api/package.json]` |
| @sinclair/typebox | 0.34.49 | Schemas (`t.*`) | Request/response validation for every endpoint + state-machine input. `[VERIFIED: api/package.json]` |
| jose | 6.2.3 | Session verify for staff writes | Reuse `verifySession` / `requireRole` from `auth.plugin.ts`. `[VERIFIED: api/package.json]` |
| Bun.password | (Bun 1.3.14 native) | Argon2id staff password hash | Already wired in `auth.plugin.ts`; no `argon2`/`bcrypt` dep. `[VERIFIED: api/src/plugins/auth.plugin.ts]` |
| Bun test | (Bun 1.3.14 native) | Concurrency proof + unit tests | Existing harness in `api/tests/`. `[VERIFIED: filesystem]` |

### Supporting (no library — native/computation)
| Concern | Approach | Why not a library |
|---------|----------|-------------------|
| Money | PostgreSQL `integer` storing **satang** | "Store money as smallest integer unit" is the canonical no-float pattern. `[ASSUMED]` (industry standard, not a library choice) |
| Round-up to baht | `Math.ceil(satang / 100) * 100` | Native; D-13 makes derived prices whole baht. |
| Order status machine | Explicit `Record<Status, Status[]>` transition table validated in handler | D-19 is a small fixed graph; xstate/etc. is over-engineering for a solo MVP (matches CLAUDE.md "no over-engineering"). `[ASSUMED]` |

### Alternatives Considered (for the atomic decrement — Claude's Discretion D-07)
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Guarded conditional `UPDATE … WHERE quota-reserved>=n RETURNING` | `SELECT … FOR UPDATE` then app-side check then `UPDATE` | Correct, but **two statements + a round-trip**, holds the lock longer, more code, and the app must not forget the check. The guarded UPDATE collapses read-check-write into one atomic statement with zero app-race window. Prefer guarded UPDATE. |
| Guarded conditional UPDATE | `SERIALIZABLE` isolation + retry loop | Also correct but forces serialization-failure retry handling everywhere; unnecessary when a single-statement guard already prevents the anomaly at READ COMMITTED (PG default). |
| Per-row guarded UPDATE for box | Single `UPDATE … FROM (VALUES …)` multi-row statement | Possible but harder to detect *which* component failed and to guarantee all-or-nothing cleanly; the per-component-in-a-transaction form is clearer and still atomic. |

**Installation:** None. `bun install` already satisfies the stack. Migrations run via existing scripts:
```bash
bun run db:generate      # drizzle-kit generate (emits up SQL)
bun run db:migrate       # apply (uses DATABASE_URL_DIRECT / unpooled — Phase 0 Pitfall 2)
bun run db:down drizzle/NNNN_name.down.sql   # hand-written reverse
```

## Package Legitimacy Audit

> Phase 1 installs **no external packages**. Every dependency is pre-existing (Phase 0), pinned in `api/package.json`, and was registry-verified 2026-06-28. slopcheck is available in this environment but there are no *new* packages to audit.

| Package | Registry | Disposition |
|---------|----------|-------------|
| drizzle-orm 0.45.2 | npm | Pre-installed, pinned — no action |
| drizzle-kit 0.31.10 | npm | Pre-installed, pinned — no action |
| postgres 3.4.9 | npm | Pre-installed, pinned — no action |
| elysia 1.4.29 | npm | Pre-installed, pinned — no action |
| @sinclair/typebox 0.34.49 | npm | Pre-installed, pinned — no action |
| jose 6.2.3 | npm | Pre-installed, pinned — no action |

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages).
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                 staff (owner/admin)                 guest / member
                        │                                  │
        Bearer jose session (requireRole)          no staff auth (D-03)
                        │                                  │
                        ▼                                  ▼
   ┌──────────────────────────────────┐   ┌──────────────────────────────────┐
   │ WRITE endpoints (staff-guarded)  │   │ POST /orders  (open — D-02/D-03)  │
   │  /varieties /units /rounds       │   │  1. validate body (TypeBox)       │
   │  /prices /boxes  (CRUD)          │   │  2. resolve round OPEN & cutoff   │
   │  PATCH /orders/:id/status        │   │     not passed (D-10, req-time)   │
   └───────────────┬──────────────────┘   │  3. resolve live price+pack →     │
                   │                       │     compute snapshot (ceil baht)  │
   READ endpoints  │                       │  4. db.transaction:               │
   (public — D-03) │                       │     ├ sort components by          │
   /catalog /rounds│                       │     │  variety_id (lock order)    │
   /prices  (avail │                       │     ├ per component: guarded      │
   = quota−reserved│                       │     │  UPDATE round_stock          │
   → "หมดรอบนี้")   │                       │     │  SET reserved=reserved+n     │
                   │                       │     │  WHERE quota-reserved>=n      │
                   ▼                       │     │  RETURNING id                │
        ┌────────────────────────────────┐│     ├ 0 rows ⇒ throw ⇒ ROLLBACK   │
        │      PostgreSQL 17 (one DB)     ││     ├ INSERT orders + order_lines │
        │  varieties sale_units products  ││     │  (frozen snapshot D-16)      │
        │  rounds round_stock(quota,      ││     └ COMMIT ⇒ 201                │
        │    reserved) prices boxes       │└──────────────┬───────────────────┘
        │  box_components customers        │              │
        │  orders order_lines              │◄─────────────┘
        │  back_in_stock_requests          │  cancel: guarded UPDATE
        └──────────────────────────────────┘  reserved=reserved-n (D-08)
```

Data flow for the primary use case (guest orders the last pack): request → validate → round-open check → snapshot compute → **one transaction** whose guarded UPDATE either matches (reserve, insert, 201) or returns zero rows (throw → rollback → 409 "sold out"). Two concurrent such requests serialize on the same `round_stock` row: the loser re-evaluates `WHERE` against the winner's committed `reserved` and matches zero rows.

### Recommended Project Structure (within existing `api/src`)
```
api/src/
├── db/
│   ├── schema.ts          # extend: add commerce tables alongside users
│   └── client.ts          # unchanged (prepare:false pool)
├── routes/
│   ├── catalog.ts         # public reads: varieties, units, availability
│   ├── varieties.ts       # staff CRUD (INV-01, D-22)
│   ├── rounds.ts          # staff CRUD + open/close (INV-05, D-09/10)
│   ├── prices.ts          # staff CRUD + daily override (INV-04, D-12/14)
│   ├── boxes.ts           # staff CRUD + BOM (INV-07, D-17/18)
│   ├── orders.ts          # POST /orders (open) + PATCH status (staff)
│   └── stock.ts           # back-in-stock requests (INV-08, D-20)
├── services/              # new: pure logic reused by routes + tests
│   ├── reservation.ts     # the guarded-UPDATE / transaction core (PLAT-01)
│   ├── pricing.ts         # kg→unit derivation, ceil-to-baht (D-12/13)
│   └── order-status.ts    # transition table + validate (D-19)
└── plugins/auth.plugin.ts # unchanged; reuse requireRole
```
Mirrors the existing route/plugin style (each route file exports an `Elysia` instance composed in `index.ts`). Keep the reservation SQL in a `services/reservation.ts` so the concurrency test imports it directly and routes stay thin.

### Pattern 1: Guarded atomic decrement — single variety (PLAT-01 / INV-06)
**What:** One conditional UPDATE that reserves stock only if enough is available, reporting success by returned row count.
**When to use:** Every stock reservation (single-line orders; and per-component in a box).
**Example:**
```typescript
// Source: PostgreSQL READ COMMITTED UPDATE re-check semantics
//   (postgresql.org/docs/17/transaction-iso.html §13.2.1) + Drizzle raw sql
//   (orm.drizzle.team/docs/sql). CONFIDENCE: HIGH.
import { sql } from "drizzle-orm";

// Returns true iff n plants were successfully reserved on this round+variety.
async function reserve(tx: DbOrTx, roundId: string, varietyId: string, plants: number) {
  const rows = await tx.execute(sql`
    UPDATE round_stock
       SET reserved = reserved + ${plants}
     WHERE round_id = ${roundId}
       AND variety_id = ${varietyId}
       AND quota - reserved >= ${plants}
    RETURNING id
  `);
  return rows.length === 1; // 0 rows ⇒ insufficient stock ⇒ caller rejects / rolls back
}
```
Why correct: at READ COMMITTED (PG default), when a concurrent transaction has locked the row, `UPDATE` **re-evaluates its `WHERE` against the latest committed row version** after the lock is released. The loser therefore sees the winner's incremented `reserved` and its `WHERE` no longer holds → zero rows. No `SELECT FOR UPDATE`, no app-side check, no race window. Enforce integrity with table CHECKs: `CHECK (reserved >= 0)` and `CHECK (reserved <= quota)`.

### Pattern 2: All-or-nothing multi-component decrement — mixed box (INV-07 / D-17)
**What:** Reserve every BOM component in one transaction, deterministically ordered to avoid deadlocks; any failure rolls back all.
**When to use:** Ordering a box; also any multi-line order touching multiple `round_stock` rows.
**Example:**
```typescript
// Source: PostgreSQL deadlock avoidance via consistent lock ordering
//   (postgresql.org/docs/17/explicit-locking.html §13.3.3) + Drizzle transactions
//   (orm.drizzle.team/docs/transactions). CONFIDENCE: HIGH.
await db.transaction(async (tx) => {
  // Sort components by a stable key so every concurrent order locks rows in the
  // SAME order → no deadlock. variety_id (uuid) is a stable global ordering.
  const components = box.components
    .map((c) => ({ ...c, plants: c.plantsPerBox * qty }))
    .sort((a, b) => a.variety_id.localeCompare(b.variety_id));

  for (const c of components) {
    const ok = await reserve(tx, roundId, c.variety_id, c.plants);
    if (!ok) tx.rollback(); // throws → whole transaction rolls back (0 decremented)
  }
  // all reserved → insert order + order_lines with frozen snapshot, then COMMIT
});
```
Availability of the box for display = `min(floor((quota-reserved)/plantsPerBox))` across components (INV-07). Compute in the catalog read; the transaction is the authority at order time.

### Pattern 3: Order status state machine (ORD-02 / D-19)
**What:** An explicit transition map validated before any status write.
**Example:**
```typescript
// Source: D-19. CONFIDENCE: HIGH (design decision, not external).
type Status = "created" | "awaiting_payment" | "paid" | "packing"
            | "shipping" | "done" | "cancelled";

const TRANSITIONS: Record<Status, Status[]> = {
  created:          ["awaiting_payment", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid:             ["packing", "cancelled"],
  packing:          ["shipping", "cancelled"],
  shipping:         ["done", "cancelled"], // see Open Question re: cancel-from-shipping
  done:             [],                    // terminal — cancel disallowed (D-08)
  cancelled:        [],                    // terminal; releases stock on entry (D-08)
};

function canTransition(from: Status, to: Status) {
  return TRANSITIONS[from].includes(to);
}
```
The `cancelled` transition MUST perform the stock release (`reserved = reserved - n`) in the **same transaction** as the status write (D-08), guarded so double-cancel can't double-release: `UPDATE … SET reserved = reserved - n WHERE reserved >= n` plus an idempotency guard on `status != 'cancelled'`.

### Anti-Patterns to Avoid
- **SELECT-then-UPDATE reservation** (read available in app, decide, then write): classic lost-update / oversell race. Use the guarded single-statement UPDATE.
- **`.for("update", { noWait: true })` in Drizzle:** emits invalid SQL (`for update no wait`) — Drizzle issue #3554. If you ever need NOWAIT, drop to raw `sql`. `skipLocked: true` is fine.
- **Decrementing stock outside a transaction for a multi-component box:** partial decrements on failure = corrupted stock. Always wrap in `db.transaction`.
- **Float/`numeric` arithmetic in app code for money:** use integer satang end-to-end.
- **Prepared statements on the pooled endpoint:** already handled (`prepare: false`) — do not remove it (Phase 0 Pitfall 2, breaks under NFR-01 spikes on Neon PgBouncer).
- **Auto-substitution logic in Phase 1:** explicitly forbidden (D-20) — it would undermine the oversell proof.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrency-safe reservation | App-level mutex / in-memory lock / optimistic version column loop | PostgreSQL row lock via guarded conditional UPDATE | The DB already gives serializable-per-row correctness for a single UPDATE; app locks don't survive multiple processes/instances. |
| All-or-nothing multi-row change | Manual "undo" compensation on failure | `db.transaction` (ROLLBACK) | Transactions are the correct, tested primitive. |
| Password hashing | argon2/bcrypt npm dep | `Bun.password` (Argon2id) — already wired | Native, no dependency (CLAUDE.md). |
| Session tokens | Custom token format | `jose` HS256 (`auth.plugin.ts`) | Already implemented + tested in Phase 0. |
| Request validation / OpenAPI | Manual `if` checks | Elysia + TypeBox `t.*` schemas | One schema → validation + types + docs. |
| Down migrations | Hope drizzle-kit adds it | Hand-written `NNNN_name.down.sql` + `db:down` runner | Established Phase 0 convention (drizzle-kit has no `down`). |

**Key insight:** In this domain, correctness is a database property. The safest and simplest oversell guard is a **single SQL statement**, not application code — moving the check into the app is where oversell bugs are born.

## Money Handling (D-13 / PAY-04)

- **Store all money as `integer` satang** (1 baht = 100 satang). No float, no `numeric` in app math.
- kg base price (`prices.price_per_kg_satang`): admin input, integer satang.
- Derived unit price = `ceil((price_per_kg_satang * grams_per_unit / 1000) / 100) * 100` → whole-baht satang (multiple of 100), per D-13. Compute in `services/pricing.ts`, snapshot onto `order_lines.unit_price_satang`.
- Order subtotal = sum of `unit_price_satang * qty`, integer.
- Phase 2 PromptPay/pdfmake format from satang → `baht.satang` string; because derived amounts are whole baht, this is clean.
- `[ASSUMED]` that integer-satang is preferred over `numeric(12,2)`; both are valid — flag for planner. Integer avoids all rounding ambiguity and matches the "no float money" rule; `numeric` would be the alternative if fractional-satang inputs ever appear (they don't here).

## Common Pitfalls

### Pitfall 1: Testing concurrency without a real database
**What goes wrong:** Mocking the DB or using SQLite for the concurrency test proves nothing — the guarantee lives in PostgreSQL's MVCC row-locking.
**How to avoid:** Race against the **real PostgreSQL 17** already provisioned for tests (`api/tests/docker-compose.pg.yml`, port 55432). Reuse the exact `postgres()` + `drizzle()` wiring from `tests/migrate.test.ts`.
**Warning signs:** A "concurrency" test that passes without a Docker PG running.

### Pitfall 2: `Promise.all` sharing one connection doesn't race at the DB
**What goes wrong:** postgres.js pipelines on a single connection; if all parallel requests share one pooled connection they may serialize before reaching PG, masking races.
**How to avoid:** Ensure the pool `max` > number of racers (Phase 0 client uses `max: 10`; a dedicated test pool can set `max: N`). Fire N truly parallel `app.handle(new Request(...))` calls via `Promise.allSettled`. The guarded UPDATE is correct regardless, but a real race is what proves it.
**Warning signs:** All requests succeed with N=2 and quota=1 (would be an oversell) — or all-but-one fail *for the wrong reason*.

### Pitfall 3: drizzle-kit emits no down migration
**What goes wrong:** `db:migrate` has no rollback; a bad commerce migration is stuck.
**How to avoid:** For every generated `NNNN_*.sql`, hand-write `NNNN_*.down.sql` dropping objects in reverse dependency order (tables before their pgEnum types; children before parents via FKs). Follow the existing `0000_init.down.sql` pattern exactly. New pgEnums (`tier`, `order_status`, `substitution_policy`, `unit_kind`) must be `DROP TYPE IF EXISTS` in the down.
**Warning signs:** A migration test that only tests `up`.

### Pitfall 4: pgEnum creation ordering in migrations
**What goes wrong:** A table referencing a pgEnum fails if the `CREATE TYPE` isn't emitted first; the down must `DROP TABLE` before `DROP TYPE`.
**How to avoid:** Let drizzle-kit order the up; manually mirror-reverse in the down (as `0000_init` does for `role`).

### Pitfall 5: Cancel double-release
**What goes wrong:** Two cancel requests both subtract `reserved`, releasing stock twice.
**How to avoid:** Guard the release: only release if the order is not already `cancelled` (check `status != 'cancelled'` in the same UPDATE/transaction), and `UPDATE … SET reserved = reserved - n WHERE reserved >= n`. Idempotent.

### Pitfall 6: Round cut-off checked only in app without re-validating in the reservation transaction
**What goes wrong:** A round closes between the app's time check and the decrement.
**How to avoid:** Include the round-open/cutoff predicate in the reservation path (e.g., join `rounds.status = 'open' AND now() < cutoff_at` into the guarded UPDATE, or re-check inside the transaction). Low risk in Phase 1 (no auto-close job) but cheap to make correct.

## Runtime State Inventory

> Greenfield for commerce — all tables are new. This is **not** a rename/refactor phase. Included only to record that no pre-existing runtime state carries commerce data.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — only `users`/`role` exist (Phase 0). All commerce tables are new. | None |
| Live service config | None — no external commerce service. | None |
| OS-registered state | None. | None |
| Secrets/env vars | No new env vars needed; `DATABASE_URL`(+`_DIRECT`), `JWT_SECRET` already validated in `env.ts`. | None |
| Build artifacts | None — no package/rename. | None |

## Code Examples

### Drizzle schema style to follow (extend `schema.ts`)
```typescript
// Source: existing api/src/db/schema.ts (pg-core). CONFIDENCE: HIGH.
import { pgEnum, pgTable, text, integer, boolean, timestamp,
         uuid, date, uniqueIndex, index } from "drizzle-orm/pg-core";

export const tierEnum = pgEnum("tier", ["b2c", "b2b"]);
export const orderStatusEnum = pgEnum("order_status",
  ["created","awaiting_payment","paid","packing","shipping","done","cancelled"]);
export const substitutionEnum = pgEnum("substitution_policy", ["allow","disallow"]);
export const unitKindEnum = pgEnum("unit_kind", ["kg","bag","pack","plant"]);
export const roundStatusEnum = pgEnum("round_status", ["open","closed"]);

export const varieties = pgTable("varieties", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  imageUrl: text("image_url"),
  avgGramsPerPlant: integer("avg_grams_per_plant").notNull(), // D-22, CROP-01 seam
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// The oversell-critical counter (D-07). CHECKs added in the migration SQL:
//   CHECK (reserved >= 0), CHECK (reserved <= quota_plants)
export const roundStock = pgTable("round_stock", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id").notNull().references(() => rounds.id),
  varietyId: uuid("variety_id").notNull().references(() => varieties.id),
  quotaPlants: integer("quota_plants").notNull(),
  reservedPlants: integer("reserved_plants").notNull().default(0),
}, (t) => [uniqueIndex("round_stock_round_variety_idx").on(t.roundId, t.varietyId)]);
```
(Full table set: `varieties`, `sale_units`, `products`, `rounds`, `round_stock`, `prices`, `boxes`, `box_components`, `customers`, `customer_addresses`, `orders`, `order_lines`, `back_in_stock_requests`. `order_lines` carries the D-16 snapshot columns: `variety_name`, `unit_label`, `plants_per_unit`, `price_per_kg_satang`, `tier`, `unit_price_satang`, `qty`, `plants_decremented`, and nullable `box_bom_json` for D-18.)

### Concurrency proof harness (Criterion 2)
```typescript
// Source: existing api/tests/migrate.test.ts wiring + Bun test. CONFIDENCE: HIGH.
import { describe, expect, test } from "bun:test";
import { app } from "../src/index";

test("last pack: exactly one success, rest sold out (no oversell)", async () => {
  // Arrange: a round_stock row with quota=1, reserved=0 for one variety (seed via SQL).
  const N = 8;
  const fire = () => app.handle(new Request("http://x/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ /* customer + one line of 1 plant */ }),
  }));
  const results = await Promise.allSettled(Array.from({ length: N }, fire));
  const statuses = await Promise.all(
    results.map((r) => r.status === "fulfilled" ? r.value.status : 500));
  expect(statuses.filter((s) => s === 201)).toHaveLength(1);
  expect(statuses.filter((s) => s === 409)).toHaveLength(N - 1);
  // And assert DB: reserved === 1 (never > quota).
});
```
Requires the test PG pool `max >= N` to force real parallelism (Pitfall 2).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `SELECT FOR UPDATE` + app check | Single guarded conditional `UPDATE … RETURNING` | Long-standing PG best practice | Fewer round-trips, no app race window, simpler code |
| ORM abstraction hiding locks (Prisma) | SQL-first ORM with explicit locking (Drizzle) | Bun/ARM era | Direct control over the exact statement that guarantees correctness |
| Float/decimal money in app | Integer minor units (satang) | Long-standing | Eliminates rounding bugs |

**Deprecated/outdated for this stack:**
- Drizzle `.for("update", { noWait: true })` — broken (issue #3554); use raw `sql` if NOWAIT ever needed. `skipLocked` works.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (native, Bun 1.3.14) |
| Config file | none — `bun test` discovers `api/tests/*.test.ts` |
| Quick run command | `cd api && bun test tests/reservation.test.ts` |
| Full suite command | `cd api && bun test` |
| Real DB for integration | `api/tests/docker-compose.pg.yml` (PostgreSQL 17, port 55432); bring up before stock/order tests |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAT-01 / INV-06 | Concurrent last-pack → 1 success, rest sold out; `reserved` never > quota | integration (real PG) | `cd api && bun test tests/reservation.test.ts` | ❌ Wave 0 |
| INV-07 | Box limited by scarcest component; all-or-nothing decrement; partial failure decrements nothing | integration | `cd api && bun test tests/box-reservation.test.ts` | ❌ Wave 0 |
| INV-04 / D-13 | kg→unit price derivation rounds UP to whole baht | unit | `cd api && bun test tests/pricing.test.ts` | ❌ Wave 0 |
| D-16 / PAY-04 | Order line stores frozen snapshot; reconstructable without live price join | integration | `cd api && bun test tests/order-snapshot.test.ts` | ❌ Wave 0 |
| ORD-02 / D-19 | Only legal status transitions accepted; illegal rejected | unit | `cd api && bun test tests/order-status.test.ts` | ❌ Wave 0 |
| D-08 | `cancelled` releases stock exactly once (idempotent); cancel disallowed after `done` | integration | `cd api && bun test tests/cancel-release.test.ts` | ❌ Wave 0 |
| INV-05 / D-10 | Order rejected after cut-off / closed round | integration | `cd api && bun test tests/round-cutoff.test.ts` | ❌ Wave 0 |
| PLAT-03 / D-03 | Catalog writes require staff role; `POST /orders` open; reads public | integration | `cd api && bun test tests/auth-boundary.test.ts` | ❌ Wave 0 |
| INV-08 / D-20 | Sold-out flag "หมดรอบนี้"; back-in-stock request stored | integration | `cd api && bun test tests/soldout-notify.test.ts` | ❌ Wave 0 |
| all | Each commerce migration up→down→up clean (no residue) | integration | `cd api && bun test tests/migrate.test.ts` (extend) | ⚠️ exists, extend |

### Sampling Rate
- **Per task commit:** the single relevant `bun test tests/<file>.test.ts` (quick, < a few s).
- **Per wave merge:** `cd api && bun test` (full suite) with the test PG container up.
- **Phase gate:** full suite green + the Criterion 2 concurrency test demonstrably racing real PG17 before `/gsd:verify-work`.

### Nyquist measurement points (concrete, measurable)
1. **Oversell rate under concurrency** — must be exactly 0 (assert `reserved <= quota` after N parallel orders). This is the phase's defining measurement.
2. **All-or-nothing invariant** — after a failed box order, every component's `reserved` is unchanged.
3. **Price-derivation determinism** — unit price is `ceil` to whole baht for a table of kg-price/weight inputs.
4. **Snapshot immutability** — mutate a live price after ordering; the order line's amount is unchanged.
5. **Transition legality** — every illegal status edge is rejected; every legal one accepted.

### Wave 0 Gaps
- [ ] `api/tests/reservation.test.ts` — PLAT-01/INV-06 concurrency proof (the priority).
- [ ] `api/tests/box-reservation.test.ts` — INV-07 all-or-nothing.
- [ ] `api/tests/pricing.test.ts` — INV-04/D-13 ceil-to-baht.
- [ ] `api/tests/order-snapshot.test.ts` — D-16/PAY-04.
- [ ] `api/tests/order-status.test.ts` — ORD-02/D-19 transition table.
- [ ] `api/tests/cancel-release.test.ts` — D-08 idempotent release.
- [ ] `api/tests/round-cutoff.test.ts` — INV-05/D-10.
- [ ] `api/tests/auth-boundary.test.ts` — PLAT-03/D-03.
- [ ] `api/tests/soldout-notify.test.ts` — INV-08/D-20.
- [ ] Extend `api/tests/migrate.test.ts` for the new commerce migration(s).
- [ ] Optional: a seed helper (`tests/seed.ts`) to arrange rounds/varieties/stock for integration tests.
- [ ] Bruno: extend `bruno/Saladee/` with catalog/round/price/order requests + a scripted parallel racer for the manual Criterion-2 demo (D-02). Note: `bru run` is sequential — true parallelism needs a small Bun `Promise.all` script, not a Bruno folder run.

## Security Domain

`security_enforcement` is not disabled in config → included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse Phase 0: `Bun.password` Argon2id for staff (PLAT-03); wire real `users` lookup in `routes/auth.ts`. Guest orders need no auth (D-03). |
| V3 Session Management | yes | jose HS256 2h sessions (`auth.plugin.ts`), Bearer header. |
| V4 Access Control | yes | `requireRole("owner","admin")` on all catalog/price/round/box **write** and `PATCH /orders/:id/status`; reads + `POST /orders` open (D-03). Least-privilege per PLAT-03. |
| V5 Input Validation | yes | TypeBox schemas on every endpoint (quantities `t.Integer({minimum:1})`, tier enum, uuid formats). Reject non-positive qty (prevents negative-reserve exploits). |
| V6 Cryptography | reuse | No new crypto; do not hand-roll. |
| V8 Data Protection | yes | Customer PII in `customers`/`orders` — restrict via role on read endpoints; slips/PII bucket already private (Phase 0). Full PDPA consent is Phase 2 (out of scope here). |

### Known Threat Patterns for {Elysia + PostgreSQL + Drizzle}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Oversell via lost update / TOCTOU | Tampering | Guarded single-statement UPDATE (Pattern 1) + CHECK constraints |
| Negative-quantity order → negative reserve / stock inflation | Tampering | TypeBox `minimum: 1` + `CHECK (reserved >= 0)` |
| SQL injection | Tampering | Drizzle parameterized `sql` template (never string-concat); never interpolate raw input into `sql.raw` |
| Privilege escalation on catalog writes | Elevation | `requireRole` guard on every write route; deny-by-default |
| Double-cancel double-release | Tampering | Idempotent guarded release with `status != 'cancelled'` check (Pitfall 5) |
| Tier-price manipulation (guest requests b2b) | Tampering | Server resolves price from `prices` by requested tier; Phase 1 accepts tier as field (D-15) but MUST snapshot the *server-resolved* price, never a client-supplied amount |
| Customer PII exposure via public reads | Info Disclosure | Keep `customers`/`orders` reads staff-guarded; only catalog/availability is public |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Store money as integer **satang** (vs `numeric(12,2)`) | Money Handling | Low — both valid; integer avoids float entirely and matches D-13 whole-baht outputs. Planner may confirm preference. |
| A2 | `plants_per_unit` is an integer (each pack resolves to a whole plant count) | Standard Stack / schema | Medium — if a sale unit ever maps to a fractional plant count, the base counter (integer plants) can't represent it. D-22 says packs resolve to a plant count; confirm all units are integer-plant. |
| A3 | Order status machine is a hand-rolled transition table (no library) | Standard Stack / Pattern 3 | Low — matches MVP/no-over-engineering; trivially replaceable. |
| A4 | Cancel is permitted from `shipping` (releasing stock) | Pattern 3 / Open Questions | Medium — D-08 says cancel disallowed after `done` and that `shipping` "keeps reserved consumed"; whether a cancel from `shipping` releases stock is ambiguous. See Open Question 1. |
| A5 | Round-open/cutoff re-checked inside the reservation path | Pitfall 6 | Low — cheap correctness; no auto-close job in Phase 1 makes the window tiny. |

## Open Questions

1. **Cancel from `shipping` — does it release stock?**
   - What we know: D-08 says only `cancelled` releases stock, `done`/`shipping` "keep reserved consumed (a real sale)", and cancel is disallowed once `done`.
   - What's unclear: whether `shipping → cancelled` is a legal edge, and if so whether it releases (`reserved--`) or keeps stock consumed (a shipped-then-returned item isn't resellable in this round).
   - Recommendation: default to **allowing `shipping → cancelled` but NOT releasing stock** (the plants already left the farm), OR forbid the edge entirely. Flag for the planner/user; the transition table (Pattern 3) currently lists it — adjust per decision. Low blast radius (one entry + one branch).

2. **Daily price override storage (D-14 — Claude's discretion).**
   - Recommendation: a **nullable `effective_date` column on `prices`** with `UNIQUE(round_id, variety_id, tier, effective_date)` (NULL = the round default; a dated row overrides for that day). Simpler than a second table; resolution query picks the dated row for today else the NULL-date default. Planner may choose a separate table if history clarity is preferred.

3. **`products` vs `varieties` surface (INV-01 / SALE-04).**
   - What's unclear: whether `products` is a distinct catalog entity or `varieties` + `boxes` are the sellable units directly.
   - Recommendation: keep a thin `products` concept only if needed for SALE-04 multi-mode display; otherwise expose varieties+boxes directly and derive sale mode from round timing (D-11). Planner's call within D-11/D-17 shape.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | runtime, test, build | ✓ | 1.3.14 (pinned `@types/bun`) | — |
| PostgreSQL 17 (test) | concurrency/integration tests | ✓ (Docker) | 17 via `api/tests/docker-compose.pg.yml` :55432 | — |
| Docker / compose | spin up test PG | assumed ✓ (Phase 0 used it) | — | run tests against any real PG17 via `TEST_DATABASE_URL_DIRECT` |
| Neon / dev PG (runtime) | app runtime | ✓ (Phase 0) | 17 | Docker PG for local |
| Bruno (`bru`) | manual API + demo racer | user-installed (MEMORY: user tests with Bruno) | — | Bun script for parallel racer |

**Missing dependencies with no fallback:** none identified.
**Missing dependencies with fallback:** Bruno parallel run → use a Bun `Promise.all` script for the real concurrency race (Bruno folder runs are sequential).

## Sources

### Primary (HIGH confidence)
- Existing codebase: `api/src/db/schema.ts`, `client.ts`, `plugins/auth.plugin.ts`, `routes/*.ts`, `index.ts`, `env.ts`, `tests/migrate.test.ts`, `tests/auth.test.ts`, `drizzle/0000_init*.sql`, `tests/docker-compose.pg.yml`, `package.json` — actual patterns, versions, and test harness this phase extends.
- `CLAUDE.md` — locked stack, "What NOT to Use" (no Prisma), atomic-stock note (header present, body a placeholder — this RESEARCH fills the implementation), Version Compatibility.
- orm.drizzle.team/docs/transactions — `db.transaction(async (tx) => …)`, nested savepoints, `tx.rollback()` throws to roll back. (WebFetch, verified.)
- postgresql.org/docs/17 — READ COMMITTED `UPDATE` re-check semantics (§13.2.1) and lock-ordering deadlock avoidance (§13.3.3). `[CITED]`

### Secondary (MEDIUM confidence)
- Drizzle `.for("update")` / `{ skipLocked: true }` / `{ noWait: true }` syntax and the **noWait bug** — GitHub drizzle-orm issue #3554; answeroverflow discussions. (WebSearch; cross-checked with PG SQL grammar `nowait` vs `skip locked`.)

### Tertiary (LOW confidence)
- Integer-satang money convention — industry-standard practice, tagged `[ASSUMED]` (A1); not a library decision.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all pinned + already installed and used in Phase 0.
- Atomic decrement mechanism: HIGH — grounded in PostgreSQL READ COMMITTED UPDATE semantics + Drizzle raw `sql`; proven by a real-PG concurrency test.
- Architecture/schema: MEDIUM-HIGH — follows existing pg-core style; exact column layout is Claude's discretion (flagged).
- Pitfalls: HIGH — mostly derived from the existing codebase's own documented Phase 0 pitfalls + the Drizzle noWait bug.

**Research date:** 2026-07-02
**Valid until:** 2026-08-01 (stable stack; re-verify Drizzle noWait bug status and any drizzle-orm minor bump before relying on `.for()` options)
