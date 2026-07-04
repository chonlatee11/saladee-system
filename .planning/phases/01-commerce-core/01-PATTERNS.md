# Phase 1: Commerce Core - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 24 (2 modified, 22 new)
**Analogs found:** 21 / 24 (3 services have no direct analog → use RESEARCH Patterns 1/2/3)

> All excerpts below are real, load-bearing code from the existing Phase-0 codebase.
> The planner should reference the analog file + line range in each plan's action
> section. "Copy the pg-core table style from `schema.ts:10-21`" — not "follow the style."

---

## File Classification

### New/Modified — Schema & Migrations

| File | New/Mod | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `api/src/db/schema.ts` | modify | model (schema) | CRUD | itself (`users`/`roleEnum`, lines 6-21) | exact (self-extend) |
| `api/drizzle/0001_commerce.sql` | new | migration (up) | batch/DDL | `api/drizzle/0000_init.sql` | exact |
| `api/drizzle/0001_commerce.down.sql` | new | migration (down) | batch/DDL | `api/drizzle/0000_init.down.sql` | exact |

### New — Services (pure logic, route- and test-reused)

| File | New/Mod | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `api/src/services/reservation.ts` | new | service | transactional CRUD | none (RESEARCH Pattern 1 & 2) | no-analog |
| `api/src/services/pricing.ts` | new | service (utility) | transform | none (RESEARCH Money Handling) | no-analog |
| `api/src/services/order-status.ts` | new | service (utility) | transform/validate | none (RESEARCH Pattern 3) | no-analog |

### New — Routes

| File | New/Mod | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `api/src/routes/catalog.ts` | new | route (public reads) | request-response | `api/src/routes/files.ts` (GET) | role-match |
| `api/src/routes/varieties.ts` | new | route (staff CRUD) | CRUD | `files.ts` + `auth.plugin` `requireRole` | role-match |
| `api/src/routes/rounds.ts` | new | route (staff CRUD) | CRUD | `files.ts` + `requireRole` | role-match |
| `api/src/routes/prices.ts` | new | route (staff CRUD) | CRUD | `files.ts` + `requireRole` | role-match |
| `api/src/routes/boxes.ts` | new | route (staff CRUD) | CRUD | `files.ts` + `requireRole` | role-match |
| `api/src/routes/orders.ts` | new | route (open POST + staff PATCH) | transactional request-response | `files.ts` + `reservation` service + `auth.ts` | role-match |
| `api/src/routes/stock.ts` | new | route (back-in-stock records) | CRUD (data-only) | `files.ts` | role-match |
| `api/src/index.ts` | modify | config (composition) | — | itself (lines 21-38) | exact (self-extend) |

### New/Modified — Tests

| File | New/Mod | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `api/tests/reservation.test.ts` | new | test (integration, real PG) | concurrency | `api/tests/migrate.test.ts` (PG wiring) | role-match |
| `api/tests/box-reservation.test.ts` | new | test (integration) | concurrency | `migrate.test.ts` | role-match |
| `api/tests/order-snapshot.test.ts` | new | test (integration) | CRUD | `migrate.test.ts` | role-match |
| `api/tests/cancel-release.test.ts` | new | test (integration) | CRUD | `migrate.test.ts` | role-match |
| `api/tests/round-cutoff.test.ts` | new | test (integration) | CRUD | `migrate.test.ts` | role-match |
| `api/tests/auth-boundary.test.ts` | new | test (integration) | request-response | `migrate.test.ts` + `auth.test.ts` | role-match |
| `api/tests/soldout-notify.test.ts` | new | test (integration) | CRUD | `migrate.test.ts` | role-match |
| `api/tests/pricing.test.ts` | new | test (unit, no DB) | transform | `api/tests/auth.test.ts` | exact |
| `api/tests/order-status.test.ts` | new | test (unit, no DB) | transform | `auth.test.ts` | exact |
| `api/tests/migrate.test.ts` | modify | test (integration) | batch/DDL | itself | exact (self-extend) |
| `api/tests/seed.ts` | new (optional) | test helper | CRUD | `migrate.test.ts` (postgres.js wiring) | partial |

---

## Pattern Assignments

### `api/src/db/schema.ts` (model, CRUD) — MODIFY

**Analog:** itself — `api/src/db/schema.ts:6-21` (the existing `users`/`roleEnum`).

**Import + pgEnum + pgTable style to replicate** (lines 6-21):
```typescript
import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["owner", "admin", "grower", "packer"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("packer"),
    lineUserId: text("line_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);
```

**Conventions to copy exactly:**
- `id: uuid("id").defaultRandom().primaryKey()` for every table PK.
- `createdAt: timestamp(..., { withTimezone: true }).defaultNow().notNull()` timestamp convention.
- Composite/unique indexes via the third `(t) => [ ... ]` array arg, named `<table>_<cols>_idx`.
- `pgEnum` declared as a top-level `export const` **before** the tables that use it (migration ordering — Pitfall 4).
- snake_case column names in the DB string, camelCase in the TS key (e.g. `line_user_id` ↔ `lineUserId`).
- Money columns as `integer(...satang...)` (RESEARCH Money Handling — no `numeric`, no float).

**New enums to add** (RESEARCH schema example, lines 362-367 of RESEARCH):
`tierEnum` (`b2c`/`b2b`), `orderStatusEnum` (7 states), `substitutionEnum` (`allow`/`disallow`), `unitKindEnum` (`kg`/`bag`/`pack`/`plant`), `roundStatusEnum` (`open`/`closed`).

**The oversell-critical counter** — add table CHECKs in the migration SQL (not expressible in this pg-core style):
`CHECK (reserved_plants >= 0)`, `CHECK (reserved_plants <= quota_plants)`.

**Full table set** (per RESEARCH line 390): `varieties`, `sale_units`, `products`, `rounds`, `round_stock`, `prices`, `boxes`, `box_components`, `customers`, `customer_addresses`, `orders`, `order_lines`, `back_in_stock_requests`.

---

### `api/drizzle/0001_commerce.sql` (migration up) — NEW

**Analog:** `api/drizzle/0000_init.sql` (whole file, 11 lines).

**Pattern:** drizzle-kit emits this via `bun run db:generate`. Emitted format to expect:
```sql
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'grower', 'packer');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	...
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
```

**Conventions:**
- `CREATE TYPE` for each pgEnum comes **before** any table that references it (drizzle-kit orders this automatically).
- Statements separated by `--> statement-breakpoint`.
- `gen_random_uuid()` default, `timestamp with time zone DEFAULT now()`.
- **Manual step:** the reservation CHECK constraints (`reserved_plants >= 0`, `reserved_plants <= quota_plants`) are NOT emitted by drizzle-kit from the pg-core schema — hand-add them to the generated up SQL (or via a follow-on `ALTER TABLE`), and mirror-drop in the down.

---

### `api/drizzle/0001_commerce.down.sql` (migration down) — NEW

**Analog:** `api/drizzle/0000_init.down.sql` (whole file, 5 lines).

**Pattern to copy exactly:**
```sql
-- Hand-written reverse of 0000_init.sql (Pitfall 3: drizzle-kit emits no down).
-- Exact reverse DDL, dropped in dependency order (table first, then its enum type).
-- IF EXISTS keeps the down idempotent so up→down→up leaves no residue.
DROP TABLE IF EXISTS "users";--> statement-breakpoint
DROP TYPE IF EXISTS "role";
```

**Conventions (Pitfall 3 & 4):**
- Drop **children before parents** (FK dependency order), then **tables before their pgEnum types**.
- Every `DROP` uses `IF EXISTS` for idempotency (up→down→up leaves no residue).
- Same `--> statement-breakpoint` separator.
- New pgEnums to `DROP TYPE IF EXISTS`: `tier`, `order_status`, `substitution_policy`, `unit_kind`, `round_status`.
- Runner: `bun run db:down drizzle/0001_commerce.down.sql` (`api/package.json:13` → `src/lib/migrate-down.ts`).

---

### `api/src/routes/varieties.ts` / `rounds.ts` / `prices.ts` / `boxes.ts` (staff CRUD) — NEW

**Analogs:** route structure from `api/src/routes/files.ts:29-53`; RBAC gate from `api/src/plugins/auth.plugin.ts:87-109`; DB access from `api/src/plugins/db.plugin.ts:8`.

**Route + TypeBox structure to copy** (`files.ts:29-45`):
```typescript
import { Elysia, t } from "elysia";
import { storagePlugin } from "../plugins/storage.plugin";

export const filesRoutes = new Elysia()
  .use(storagePlugin)
  .post(
    "/files/presign",
    ({ storage, body, set }) => {
      if (!isSafeKey(body.key)) {
        set.status = 400;
        return { error: "invalid key" };
      }
      return { url: storage.presignPut(body.key, PRESIGN_TTL) };
    },
    { body: t.Object({ key: t.String() }) },
  );
```

**Staff-auth gate** — NO existing route currently *mounts* `requireRole`, so this is a first application. Compose it as an Elysia `beforeHandle` guard using the exported helper (`auth.plugin.ts:87-109`):
```typescript
// requireRole returns an async beforeHandle guard: 401 no/invalid token, 403 wrong role.
export function requireRole(...allowed: Role[]) {
  return async ({ headers, set }: GuardContext) => {
    const header = headers.authorization ?? headers.Authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) { set.status = 401; return { error: "unauthorized" }; }
    let session: Session;
    try { session = await verifySession(token); }
    catch { set.status = 401; return { error: "invalid_token" }; }
    if (!allowed.includes(session.role)) { set.status = 403; return { error: "forbidden" }; }
    return undefined; // authorized → proceed
  };
}
```
Apply `requireRole("owner", "admin")` on every **write** route (D-03). Wire it via `.use(authPlugin)` then `.guard({ beforeHandle: ... })` or per-route `beforeHandle`. The planner should pick the Elysia composition form; the *contract* is: Bearer header → `verifySession` → role check.

**DB access in handlers** — decorate with `dbPlugin` and read `db` from context (`db.plugin.ts:8`, consumed like `storage` in files.ts):
```typescript
export const dbPlugin = new Elysia({ name: "db" }).decorate("db", db);
// in a handler:  async ({ db, body, set }) => { await db.insert(varieties).values(...); }
```

**Conventions to copy:**
- Named-plugin dedup: `new Elysia({ name: "..." })` so double-`.use()` in `index.ts` is deduped (see `db.plugin.ts:8`, `auth.plugin.ts:113`).
- Error shape `{ error: "..." }` + `set.status = <code>` (files.ts:38, auth.ts:22-24).
- TypeBox validation on every body/params (`t.Object`, `t.String`, and for this phase `t.Integer({ minimum: 1 })` on quantities, `t.Enum`/`t.Union` for `tier`, `t.String({ format: "uuid" })`).

---

### `api/src/routes/catalog.ts` (public reads) — NEW

**Analog:** `files.ts:47-53` (GET handler, no auth) + `db.plugin.ts`.

**Pattern** (`files.ts:47-52`):
```typescript
.get("/files/:key/url", ({ storage, params, set }) => {
  if (!isSafeKey(params.key)) { set.status = 400; return { error: "invalid key" }; }
  return { url: storage.presignGet(params.key, PRESIGN_TTL) };
});
```
**No `requireRole` guard** (D-03 — catalog reads are public for Phase 2 LIFF). Compute availability = `quota_plants - reserved_plants`; expose sold-out label "หมดรอบนี้" when 0 (INV-08/D-20). Box availability = `min(floor((quota-reserved)/plantsPerBox))` across components (RESEARCH Pattern 2, line 257).

---

### `api/src/routes/orders.ts` (open POST + staff PATCH) — NEW

**Analogs:** route/TypeBox from `files.ts`; transactional core from `services/reservation.ts` (new); status gate from `auth.ts:14-39` (open POST pattern) + `requireRole` for PATCH.

**`POST /orders` is OPEN** (D-02/D-03 — no `requireRole`), mirroring `auth.ts` POST-with-body-validation but calling the reservation service inside `db.transaction`. Snapshot the **server-resolved** price (never a client amount — Security §Tier-price manipulation).

**`PATCH /orders/:id/status` is staff-guarded** (`requireRole("owner","admin")`) and validates the transition via `services/order-status.ts` before writing; a `cancelled` transition must release stock in the **same transaction** (D-08, Pitfall 5).

Return `201` on reserve success, `409` on sold-out (zero-row guarded UPDATE) — the contract the concurrency test asserts.

---

### `api/src/services/reservation.ts` (service, transactional) — NEW — NO ANALOG

No existing transactional/locking code in the codebase. **Copy from RESEARCH Pattern 1 (lines 214-231) and Pattern 2 (lines 243-256)**, using the `sql` template + `db.execute` idiom already proven in `migrate.test.ts:27` (`db.execute(sql\`...\`)`) and `client.ts` drizzle wiring.

Core (guarded single-statement decrement — RESEARCH Pattern 1):
```typescript
import { sql } from "drizzle-orm";
async function reserve(tx, roundId, varietyId, plants) {
  const rows = await tx.execute(sql`
    UPDATE round_stock SET reserved_plants = reserved_plants + ${plants}
     WHERE round_id = ${roundId} AND variety_id = ${varietyId}
       AND quota_plants - reserved_plants >= ${plants}
    RETURNING id`);
  return rows.length === 1; // 0 rows ⇒ sold out ⇒ caller rejects / rolls back
}
```
Box = per-component `reserve` inside one `db.transaction`, components sorted by `variety_id` for a global lock order (RESEARCH Pattern 2). Cancel-release = `UPDATE ... SET reserved_plants = reserved_plants - n WHERE reserved_plants >= n` guarded by `status != 'cancelled'` (Pitfall 5). **Never** `.for("update", { noWait: true })` (Drizzle #3554).

---

### `api/src/services/pricing.ts` (service, transform) — NEW — NO ANALOG

No existing pricing code. **Copy from RESEARCH Money Handling (lines 304-311).** Pure function, integer satang, round UP to whole baht:
```typescript
// derived unit price satang = ceil((price_per_kg_satang * grams_per_unit / 1000) / 100) * 100
```
Unit-testable with no DB (analog test: `auth.test.ts`).

---

### `api/src/services/order-status.ts` (service, validate) — NEW — NO ANALOG

No existing state machine. **Copy from RESEARCH Pattern 3 (lines 264-279)** — an explicit `Record<Status, Status[]>` transition table + `canTransition(from, to)`. Note Open Question 1: whether `shipping → cancelled` is legal / releases stock is a planner/user decision (one table entry + one branch).

---

### `api/src/index.ts` (composition) — MODIFY

**Analog:** itself, `index.ts:21-38`.

**Pattern** (`index.ts:31-38`):
```typescript
export const app = new Elysia()
  .use(cors({ ... }))
  .use(dbPlugin)
  .use(storagePlugin)
  .use(linePlugin)
  .use(authPlugin)
  .use(healthRoutes)
  .use(webhookRoutes)
  .use(filesRoutes)
  .use(authRoutes);
```
Add the new route instances via `.use(...)` in the same chain (e.g. `.use(catalogRoutes).use(varietiesRoutes).use(roundsRoutes).use(pricesRoutes).use(boxesRoutes).use(ordersRoutes).use(stockRoutes)`). **Note:** the Phase-0 "do NOT edit index.ts" freeze applied to wave-2 slices; Phase 1 legitimately composes its new routes here — keep the existing order and only append.

---

### `api/tests/reservation.test.ts` + other integration tests (real PG) — NEW

**Analog:** `api/tests/migrate.test.ts` (whole file — the real-PG17 harness) + concurrency harness in RESEARCH lines 393-414.

**Real-PG wiring to copy** (`migrate.test.ts:16-45`):
```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const TEST_URL = process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 1 }); // ← bump max >= N for concurrency
  db = drizzle(client);
});
afterAll(async () => { await client?.end(); });
```

**Concurrency proof** (RESEARCH lines 398-412) — race N parallel `app.handle(new Request("http://x/orders", {...}))` via `Promise.allSettled`, assert exactly one `201` and N-1 `409`, then assert `reserved_plants === 1`. **CRITICAL** (Pitfall 2): set the test pool `max >= N` or the racers serialize on one connection and the test proves nothing. Bring up PG first: `docker compose -f api/tests/docker-compose.pg.yml up`.

**`db.execute(sql\`...\`)` regclass/type assertion idiom** (`migrate.test.ts:26-34`) is the pattern for asserting DB state (e.g. `SELECT reserved_plants FROM round_stock ...`).

---

### `api/tests/pricing.test.ts` + `api/tests/order-status.test.ts` (unit, no DB) — NEW

**Analog:** `api/tests/auth.test.ts` (whole file — pure unit tests, no DB/network).

**Pattern** (`auth.test.ts:8-24`):
```typescript
import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../src/plugins/auth.plugin";

describe("...", () => {
  test("...", async () => {
    expect(await verifyPassword("s3cret", hash)).toBe(true);
  });
});
```
Import the pure service (`pricing.ts` / `order-status.ts`), assert a table of inputs → expected outputs (ceil-to-baht cases; legal/illegal transition edges). No Docker needed.

---

### `api/tests/migrate.test.ts` (extend) — MODIFY

**Analog:** itself. Extend the up→down→up proof (lines 47-65) to assert the new commerce tables/enums appear/disappear cleanly. Reuse the `to_regclass` / `pg_type` helpers (`migrate.test.ts:26-34`) for each new table + enum. Point `UP_SQL`/`DOWN_SQL` at (or additionally load) `0001_commerce.sql` / `0001_commerce.down.sql`.

---

### `api/tests/auth-boundary.test.ts` (integration) — NEW

**Analogs:** `migrate.test.ts` (PG wiring) + `auth.test.ts` (session minting via `issueSession`). Mint a staff Bearer with `issueSession(userId, "admin")` (`auth.plugin.ts:43`), assert `requireRole`-guarded writes return 401 without / 403 with wrong role / 200 with owner|admin, and that `POST /orders` + catalog reads succeed with no token (D-03).

---

## Shared Patterns

### Authentication / RBAC gate
**Source:** `api/src/plugins/auth.plugin.ts:87-109` (`requireRole`), `:43-56` (`issueSession`/`verifySession`).
**Apply to:** every catalog/price/round/box **write** route + `PATCH /orders/:id/status`. NOT on catalog reads or `POST /orders` (D-03).
```typescript
requireRole("owner", "admin") // beforeHandle guard: 401 no token, 401 bad token, 403 wrong role
```

### DB context injection
**Source:** `api/src/plugins/db.plugin.ts:8`, consumed like `storage` in `files.ts:35`.
**Apply to:** every route that touches the DB — `.use(dbPlugin)` then read `db` from the handler context. Do NOT import the client directly in routes.
```typescript
export const dbPlugin = new Elysia({ name: "db" }).decorate("db", db);
```

### Error response shape
**Source:** `files.ts:38-39`, `auth.ts:22-24`.
**Apply to:** all handlers. `set.status = <code>; return { error: "<snake_or_code>" };` — generic messages, no user-enumeration signal on auth (auth.ts:23 comment).

### TypeBox validation
**Source:** `files.ts:44` (`{ body: t.Object({ key: t.String() }) }`), `auth.ts:30-38`.
**Apply to:** every endpoint. For this phase: `t.Integer({ minimum: 1 })` on all plant/qty fields (blocks negative-reserve exploit — Security V5), `t.String({ format: "uuid" })` on ids, enum types for `tier`/`status`/`substitution_policy`.

### Named-plugin composition (dedup)
**Source:** `auth.plugin.ts:113`, `db.plugin.ts:8` (`new Elysia({ name: "..." })`), composed in `index.ts:31-38`.
**Apply to:** any plugin re-`.use()`d across routes so Elysia dedupes it.

### Real-PG integration harness
**Source:** `api/tests/migrate.test.ts:16-45` + `api/tests/docker-compose.pg.yml` (PG17, port 55432).
**Apply to:** every stock/order/snapshot/cancel/cutoff/soldout integration test. `postgres(TEST_URL, { prepare: false, max: N })` — bump `max` for concurrency tests (Pitfall 2).

### Migration up + hand-written down pair
**Source:** `api/drizzle/0000_init.sql` + `0000_init.down.sql`; runner `api/package.json:13` (`db:down` → `src/lib/migrate-down.ts`).
**Apply to:** the new `0001_commerce.*` pair — drop children→parents→enum types, all `IF EXISTS` (Pitfall 3/4).

### Money as integer satang
**Source:** RESEARCH Money Handling (lines 304-311); mirrors schema `integer(...)` style.
**Apply to:** every price/amount column and all pricing math. No `numeric`, no float. Round UP to whole baht in `services/pricing.ts` (D-13).

---

## No Analog Found

Files with no close match in the codebase — planner should use the cited RESEARCH pattern instead:

| File | Role | Data Flow | Reason | Use Instead |
|------|------|-----------|--------|-------------|
| `api/src/services/reservation.ts` | service | transactional CRUD | No existing transaction/row-lock code — Phase 0 is stateless auth + presign only | RESEARCH Pattern 1 (lines 214-231) + Pattern 2 (243-256); `sql` idiom from `migrate.test.ts:27` |
| `api/src/services/pricing.ts` | service | transform | No existing money/pricing logic | RESEARCH Money Handling (304-311); unit-test like `auth.test.ts` |
| `api/src/services/order-status.ts` | service | validate | No existing state machine | RESEARCH Pattern 3 (264-279) |

Note: the *route*, *schema*, *migration*, and *test* wrappers around these services all have strong Phase-0 analogs (above) — only the pure business-logic cores are greenfield.

---

## Metadata

**Analog search scope:** `api/src/{db,routes,plugins,lib}`, `api/drizzle/`, `api/tests/`, `api/package.json`.
**Files scanned:** 15 existing source/migration/test files read in full (all ≤ 121 lines — single-read each, no re-reads).
**Key structural facts established:**
1. Only one existing table (`users`/`roleEnum`) — all commerce tables are greenfield but follow its exact pg-core style.
2. `requireRole` exists and is tested but is **not yet mounted on any route** — Phase 1 is its first real application (gate all writes).
3. The real-PG17 test harness (`docker-compose.pg.yml` :55432 + `migrate.test.ts` wiring) is the proven pattern for the concurrency proof; the concurrency-specific need is `pool max >= N` (Pitfall 2).
4. Migration convention is a generated up + hand-written idempotent down (`IF EXISTS`, reverse dependency order), run via `db:down`.
5. No new npm dependencies — every library is pinned in `api/package.json` from Phase 0.

**Pattern extraction date:** 2026-07-02
