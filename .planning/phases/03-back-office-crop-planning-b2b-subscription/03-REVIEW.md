---
phase: 03-back-office-crop-planning-b2b-subscription
reviewed: 2026-07-11T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - api/scripts/provision-rich-menu.ts
  - api/src/routes/catalog.ts
  - api/tests/catalog.test.ts
  - web-admin/src/views/StandingOrders.vue
  - web/src/views/CatalogView.vue
  - web/src/views/SubscriptionSignup.vue
  - web/tests/catalog-view.test.ts
  - web/tests/subscription-view.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-07-11
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The UAT gap-closure changes were reviewed with an adversarial focus on the b2b
wholesale price-leak gate (03-13). **The gate logic itself is correct and
well-tested.** `showB2bFor()` is fail-closed on all three axes (`session !== null`
&& `role === "customer"` && live `wholesaleVisible()` DB check), `Role` genuinely
includes `"customer"` (`api/src/types.ts:11`), invalid/forged tokens are swallowed
to `null` in `.derive`, and both `/catalog` and `/catalog/rounds/:id` route the
same `showB2b` flag through variety tiers AND box tiers. The test file exercises
anonymous, approved, pending, forged-token, and the round-scoped route. No direct
b2b price leak was found in the handler code path.

The defects that remain are (1) a **cache-safety gap**: the catalog response body
now varies by the `Authorization` header but sets no cache directives, so any
shared cache placed in front (the stack uses Caddy + Cloudflare) could serve an
approved customer's wholesale prices to anonymous callers — and (2) a Vue
list-key anti-pattern in the standing-order form. Remaining items are minor.

## Warnings

### WR-01: Auth-varying catalog response has no `Cache-Control: private` / `Vary: Authorization` — wholesale-price leak if cached

**File:** `api/src/routes/catalog.ts:155-158`, `:334-338` (both `GET /catalog` and `GET /catalog/rounds/:id`)
**Issue:** As of 03-13 the response body of these public GETs is **auth-dependent**:
an approved-B2B customer receives `prices.b2b` populated, everyone else receives
`b2b: null`. Neither route sets `Cache-Control` or `Vary`. There is no global cache
middleware (`api/src/index.ts` sets none), and the codebase's own convention
(`api/src/routes/packing.ts:38` sets `"cache-control": "no-store, private"` on its
sensitive route) confirms that unmarked responses are treated as cacheable by
default. If a shared/CDN cache (Caddy, Cloudflare per the stack) caches a `/catalog`
response produced for an approved-B2B session, it can subsequently serve that cached
body — **including the wholesale tier** — to anonymous callers, silently defeating
the D-08 / T-03-21 gate the whole change set is built to enforce. This is exactly
the class of bug the gate is meant to prevent; the gate is correct in-process but
undefended at the HTTP boundary.
**Fix:** Mark the catalog responses so no shared cache can cross-serve auth tiers.
Mirror the `packing.ts` precedent:
```ts
.get("/catalog", async ({ session, set }) => {
  set.headers["cache-control"] = "private, no-store";
  set.headers.vary = "Authorization";
  // ...
```
(`private` alone blocks shared caches; add `Vary: Authorization` as defense-in-depth
so any future permissible caching still keys on the token.)

### WR-02: `v-for` uses array index as `:key` on a mutable, `v-model`-bound list that supports mid-list removal

**File:** `web-admin/src/views/StandingOrders.vue:280` (`:key="i"` with `removeItem(i)` → `splice` at `:132-134`)
**Issue:** The basket-item rows are keyed by loop index `i` while each row hosts
`v-model="item.varietyId"` and `v-model.number="item.plantsPerRound"`, and
`removeItem(i)` removes an element by `splice`. Index-as-key on a list that inserts/
removes in the middle is a documented Vue foot-gun: after a `splice`, every element
past the removal point shifts to a lower index, so Vue patches existing DOM/vnodes
in place against the wrong logical item. With controlled inputs the displayed values
usually re-render correctly, but transient/native input state (an in-progress number
edit, focus, IME composition for the Thai UI) can attach to the wrong row. The other
`v-for`s in this file correctly key by stable id (`:key="c.id"`, `:key="v.id"`); this
one is the exception.
**Fix:** Give each form item a stable id and key on it:
```ts
formItems.value.push({ key: crypto.randomUUID(), varietyId: "...", plantsPerRound: 0 });
// template:
<div v-for="(item, i) in formItems" :key="item.key" ...>
```
(or key on `item` identity if the object references are guaranteed stable across
renders).

## Info

### IN-01: Dead branch in `bearer()` — `headers.Authorization` is unreachable

**File:** `api/src/routes/catalog.ts:53`
**Issue:** `headers.authorization ?? headers.Authorization` — Elysia/Bun expose Web
`Request` header keys lower-cased, so `headers.Authorization` is always `undefined`
and the `??` fallback is dead code. Harmless but misleading (implies case handling
that does not exist).
**Fix:** Drop the fallback: `const header = headers.authorization;`.

### IN-02: Rich-menu image resized with `fit: "fill"` silently distorts non-conforming sources

**File:** `api/scripts/provision-rich-menu.ts:135`
**Issue:** `.resize(width, height, { fit: "fill" })` force-fits any input to
2500×1686, stretching an image of the wrong aspect ratio without warning. An operator
who supplies, e.g., a square export will get a distorted live menu with no signal
that anything is wrong. Acceptable as an intentional "guarantee LINE's exact
dimensions" choice, but the silent distortion is worth a guard.
**Fix:** Detect a meaningful aspect-ratio mismatch (`sharp(source).metadata()`) and
either `console.warn` or `fail(...)` before uploading, so a wrong source is caught at
provision time rather than shipped to every chat.

### IN-03: `showB2bFor` DB call is uncaught — a transient DB error 500s the OPEN catalog for logged-in customers

**File:** `api/src/routes/catalog.ts:133-139` (`wholesaleVisible` call), invoked at `:157` / `:338`
**Issue:** `showB2bFor` awaits `wholesaleVisible()` (a DB read) with no try/catch,
unlike the `.derive` session resolution which deliberately fails soft to `null`. A
transient DB hiccup on that one query turns the D-03 "OPEN, never a gate" catalog
into a 500 specifically for authenticated callers. The handler makes other unguarded
DB calls too, so this is not uniquely fragile, but the gate query is the one added by
this change and the one most tied to the "stay open" contract.
**Fix:** Fail soft to `false` (deny wholesale, keep catalog serving):
```ts
async function showB2bFor(session: Session | null): Promise<boolean> {
  if (session === null || session.role !== "customer") return false;
  try { return await wholesaleVisible(database, session.sub); }
  catch { return false; }
}
```

---

_Reviewed: 2026-07-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
