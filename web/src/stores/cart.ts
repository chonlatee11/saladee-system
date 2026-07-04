// Client cart store (02-05) — the hand-off the 02-08 checkout wizard consumes.
//
// SECURITY (T-02-17): the cart stores ONLY server-referencable ids + quantity —
// never a price/plants/money field. POST /orders re-resolves every price and the
// plant reservation server-side (the Phase-1 rule), so a tampered client cart can
// change WHAT is ordered but never WHAT it costs. The line shapes below are exactly
// the `OrderLineBody` / `BoxLineBody` the api accepts (api/src/routes/orders.ts).
//
// State is a module-level reactive singleton (no Pinia — keep the dependency count
// low, NFR-08) and is mirrored into sessionStorage so the multi-step wizard survives
// navigation between the catalog and the checkout screens. sessionStorage access is
// guarded so the module imports cleanly under `bun test` (no DOM/storage).
import { computed, reactive } from "vue";

/** A single-variety pack line — the exact shape POST /orders `lines[]` expects. */
export interface CartLine {
  roundId: string;
  varietyId: string;
  saleUnitId: string;
  qty: number;
}

/** A mixed-box line — the exact shape POST /orders `boxLines[]` expects. */
export interface CartBoxLine {
  boxId: string;
  roundId: string;
  qty: number;
}

interface CartState {
  lines: CartLine[];
  boxLines: CartBoxLine[];
}

const STORAGE_KEY = "saladee.cart.v1";

function loadPersisted(): CartState {
  if (typeof sessionStorage === "undefined") return { lines: [], boxLines: [] };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { lines: [], boxLines: [] };
    const parsed = JSON.parse(raw) as Partial<CartState>;
    return {
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      boxLines: Array.isArray(parsed.boxLines) ? parsed.boxLines : [],
    };
  } catch {
    return { lines: [], boxLines: [] };
  }
}

// The single reactive cart, hydrated from sessionStorage on first import.
const state = reactive<CartState>(loadPersisted());

function persist(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lines: state.lines, boxLines: state.boxLines }),
    );
  } catch {
    // A full/blocked sessionStorage must never break the cart — persist best-effort.
  }
}

function sameLine(a: CartLine, b: CartLine): boolean {
  return a.roundId === b.roundId && a.varietyId === b.varietyId && a.saleUnitId === b.saleUnitId;
}

function sameBox(a: CartBoxLine, b: CartBoxLine): boolean {
  return a.boxId === b.boxId && a.roundId === b.roundId;
}

/**
 * The cart API. A single shared store is returned to every caller (module
 * singleton), so the catalog view and the checkout wizard mutate the same lines.
 */
export function useCart() {
  const lineCount = computed(
    () =>
      state.lines.reduce((n, l) => n + l.qty, 0) +
      state.boxLines.reduce((n, l) => n + l.qty, 0),
  );

  /** Add a pack line, merging quantity into an identical existing line. */
  function add(line: CartLine): void {
    if (line.qty <= 0) return;
    const existing = state.lines.find((l) => sameLine(l, line));
    if (existing) existing.qty += line.qty;
    else state.lines.push({ ...line });
    persist();
  }

  /** Add a mixed-box line, merging quantity into an identical existing line. */
  function addBox(line: CartBoxLine): void {
    if (line.qty <= 0) return;
    const existing = state.boxLines.find((l) => sameBox(l, line));
    if (existing) existing.qty += line.qty;
    else state.boxLines.push({ ...line });
    persist();
  }

  /** Remove a pack line entirely. */
  function remove(line: CartLine): void {
    const i = state.lines.findIndex((l) => sameLine(l, line));
    if (i >= 0) state.lines.splice(i, 1);
    persist();
  }

  /** Remove a box line entirely. */
  function removeBox(line: CartBoxLine): void {
    const i = state.boxLines.findIndex((l) => sameBox(l, line));
    if (i >= 0) state.boxLines.splice(i, 1);
    persist();
  }

  /** Set an absolute quantity for a pack line (removes it when qty <= 0). */
  function updateQty(line: CartLine, qty: number): void {
    const existing = state.lines.find((l) => sameLine(l, line));
    if (!existing) return;
    if (qty <= 0) remove(line);
    else {
      existing.qty = qty;
      persist();
    }
  }

  /** Empty the cart (after a placed order or an explicit clear). */
  function clear(): void {
    state.lines.splice(0, state.lines.length);
    state.boxLines.splice(0, state.boxLines.length);
    persist();
  }

  return {
    state,
    lines: computed(() => state.lines),
    boxLines: computed(() => state.boxLines),
    lineCount,
    add,
    addBox,
    remove,
    removeBox,
    updateQty,
    clear,
  };
}
