// Shared type aliases used across slices without importing the DB schema.

// Staff role set scaffolded up front (D-07). Phase 3 uses grower/packer;
// enforcement is added per-endpoint as features arrive.
export type StaffRole = "owner" | "admin" | "grower" | "packer";

// A session role is either a staff role OR a LINE customer (Phase-2 LINE Login,
// 02-02). `customer` is intentionally NOT in ROLES (the staff set): requireRole()
// is only ever called with staff roles, so a customer session can never satisfy a
// staff gate (T-02-06 — /auth/line must never mint owner/admin/grower/packer).
export type Role = StaffRole | "customer";

export const ROLES: readonly StaffRole[] = ["owner", "admin", "grower", "packer"] as const;
