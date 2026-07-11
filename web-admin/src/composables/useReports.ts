// Reports server-state + chart-palette helpers (03-11 / MKT-04, D-24). ONE reactive
// TanStack Query wrapping the staff-gated Eden GET /reports — the whole analytics
// payload (sales-by-channel series, best-sellers, repeat-customers, AOV) in a
// single fetch that re-runs whenever the filter strip changes. The staff Bearer is
// attached from the session store (the server requireRole is the real authority —
// D-19). Money arrives as integer satang and is formatted only at the display seam.
//
// This module also owns the FIXED channel↔color mapping and the categorical
// palette (UI-SPEC §Chart categorical palette) so every chart colours a channel
// the same way (B2C green / B2B blue / Subscription amber) — the reader learns it
// once. Cap simultaneous series at 6; the remainder rolls into an "อื่น ๆ" grey.
import { useQuery } from "@tanstack/vue-query";
import type { Ref } from "vue";
import { api } from "../api";
import { useSession } from "../stores/session";

/** Build the Authorization header for an authenticated staff request. */
function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

export type Channel = "b2c" | "b2b" | "subscription";

/** Report filter strip state. Empty string = "no filter" (omitted from the query). */
export interface ReportsFilters {
  from: string; // YYYY-MM-DD or ""
  to: string; // YYYY-MM-DD or ""
  channel: "" | Channel;
  product: string; // varietyId or ""
  round: string; // roundId or ""
}

/** Fixed channel → color. Stable across EVERY chart (UI-SPEC — learn it once). */
export const CHANNEL_COLORS: Record<Channel, string> = {
  b2c: "#2E7D32", // leaf green (primary / B2C)
  b2b: "#1565C0", // blue
  subscription: "#B26A00", // amber
};

/** Ordered categorical palette (chart-1..6) + the "อื่น ๆ" overflow grey. */
export const CATEGORICAL = [
  "#2E7D32",
  "#1565C0",
  "#B26A00",
  "#6A1B9A",
  "#00838F",
  "#C2185B",
] as const;
export const OTHER_COLOR = "#9AA69A";

/**
 * Colour a categorical series list. Caps at 6 distinct colours; index ≥ 6 falls
 * back to the neutral "อื่น ๆ" grey (the caller rolls the tail into one bucket).
 */
export function categoricalColor(index: number): string {
  return CATEGORICAL[index] ?? OTHER_COLOR;
}

/** A key/value point for a chart (used for best-sellers rollup). */
export interface Point {
  label: string;
  value: number;
}

/**
 * Cap a ranked list of points at 6; sum the remainder into a single "อื่น ๆ"
 * bucket so no chart ever renders more than 7 slices/bars (UI-SPEC).
 */
export function capSeries(points: Point[], cap = 6): Point[] {
  if (points.length <= cap) return points;
  const head = points.slice(0, cap);
  const rest = points.slice(cap).reduce((sum, p) => sum + p.value, 0);
  return [...head, { label: "อื่น ๆ", value: rest }];
}

/** Strip empty filters → the query object the Eden client sends. */
function toQuery(f: ReportsFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.from) q.from = f.from;
  if (f.to) q.to = f.to;
  if (f.channel) q.channel = f.channel;
  if (f.product) q.product = f.product;
  if (f.round) q.round = f.round;
  return q;
}

/**
 * The sales-report analytics payload. Reactive: passing the filters ref into the
 * query key makes TanStack re-fetch whenever the strip changes (loading/error
 * surfaced to the view). placeholderData keeps the last charts on screen while the
 * next range loads (no flash-to-empty).
 */
export function useReports(filters: Ref<ReportsFilters>) {
  return useQuery({
    queryKey: ["reports", filters],
    queryFn: async () => {
      const { data, error } = await api.reports.get({
        // biome-ignore lint/suspicious/noExplicitAny: Eden's optional-union query typing
        query: toQuery(filters.value) as any,
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
    placeholderData: (prev) => prev,
  });
}
