// Order-status display labels (02-09). Maps the server order_status enum to the
// Thai badge copy used by the history + detail screens. The paid / in-stock accent
// and awaiting-review amber are status colors (UI-SPEC), applied by the views.
export type OrderStatus =
  | "created"
  | "awaiting_payment"
  | "paid"
  | "packing"
  | "shipping"
  | "done"
  | "cancelled";

const STATUS_LABELS: Record<OrderStatus, string> = {
  created: "รอดำเนินการ",
  awaiting_payment: "รอชำระเงิน",
  paid: "ชำระแล้ว",
  packing: "กำลังแพ็ก",
  shipping: "กำลังจัดส่ง",
  done: "สำเร็จ",
  cancelled: "ยกเลิก",
};

/** The Thai badge label for an order status (falls back to the raw value). */
export function orderStatusLabel(status: string): string {
  return STATUS_LABELS[status as OrderStatus] ?? status;
}

/** Tailwind classes for the status badge — accent for paid, amber for awaiting,
 *  destructive for cancelled, neutral otherwise (UI-SPEC status colors). */
export function orderStatusBadgeClass(status: string): string {
  switch (status) {
    case "paid":
    case "done":
      return "bg-accent/10 text-accent";
    case "awaiting_payment":
      return "bg-[#FFF4E5] text-[#B26A00]";
    case "cancelled":
      return "text-destructive bg-destructive/10";
    default:
      return "bg-border/40 text-muted";
  }
}
