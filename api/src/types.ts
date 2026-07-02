// Shared type aliases used across slices without importing the DB schema.

// Full staff role set scaffolded up front (D-07). Phase 3 uses grower/packer;
// enforcement is added per-endpoint as features arrive.
export type Role = "owner" | "admin" | "grower" | "packer";

export const ROLES: readonly Role[] = ["owner", "admin", "grower", "packer"] as const;
