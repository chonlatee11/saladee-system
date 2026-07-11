// Robust YYYY-MM-DD formatter for server-sourced dates.
//
// Eden Treaty deserializes the API's timestamptz fields into runtime `Date`
// objects (NOT the ISO strings the raw JSON carries), so calling
// `String.prototype.slice` on them throws "x.slice is not a function". This
// accepts whatever the typed client hands back — Date | string | number — and
// always returns the leading `YYYY-MM-DD`.
export function fmtDate(value: Date | string | number | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
