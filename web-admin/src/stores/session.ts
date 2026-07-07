// Staff session store (D-17) — the auth hand-off every back-office view consumes.
//
// SECURITY (T-03-05): this store is a COSMETIC convenience only. The role read
// here drives nav visibility + router guards (nav-hide), NOT access control. The
// server `requireRole` guard (api/src/plugins/auth.plugin.ts) is the sole
// authority — a tampered client role can hide/show menu items but can never make
// a protected endpoint answer (it 403s on the server-verified session role). Only
// STAFF roles ever reach here: /auth/staff mints owner/admin/grower/packer, and a
// customer token (role="customer") is not in StaffRole so its nav resolves empty.
//
// State is a module-level reactive singleton (no Pinia — keep the dependency count
// low, NFR-08) mirrored into sessionStorage so a page refresh keeps the operator
// signed in. sessionStorage access is guarded so the module imports cleanly under
// `bun test` (no DOM/storage).
import { computed, reactive } from "vue";

/** The staff role set (mirrors api StaffRole — customer is intentionally excluded). */
export type StaffRole = "owner" | "admin" | "grower" | "packer";

const STAFF_ROLES: readonly StaffRole[] = ["owner", "admin", "grower", "packer"];

interface SessionState {
  token: string | null;
  role: StaffRole | null;
}

const STORAGE_KEY = "saladee.admin.session.v1";

/**
 * Decode the `role` claim from a session JWT WITHOUT verifying the signature.
 * This is safe precisely because it is cosmetic: the value is used only to pick
 * which nav items to render. The server re-verifies the signed token on every
 * request, so a forged payload here changes nothing an attacker can exploit.
 * Returns null for a malformed token or a non-staff (customer) role.
 */
function decodeRole(token: string): StaffRole | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { role?: string };
    return STAFF_ROLES.includes(claims.role as StaffRole)
      ? (claims.role as StaffRole)
      : null;
  } catch {
    return null;
  }
}

function loadPersisted(): SessionState {
  if (typeof sessionStorage === "undefined") return { token: null, role: null };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, role: null };
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    const token = typeof parsed.token === "string" ? parsed.token : null;
    // Re-derive role from the token so the persisted role can never drift from it.
    return { token, role: token ? decodeRole(token) : null };
  } catch {
    return { token: null, role: null };
  }
}

const state = reactive<SessionState>(loadPersisted());

function persist(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (state.token) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: state.token }));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // A full/blocked sessionStorage must never break the session — best-effort.
  }
}

/**
 * The session API. A single shared store is returned to every caller (module
 * singleton), so the router guard, AppShell and Login all read one source.
 */
export function useSession() {
  /** Establish a staff session from the token returned by POST /auth/staff. */
  function setSession(token: string): void {
    state.token = token;
    state.role = decodeRole(token);
    persist();
  }

  /** Clear the session (sign-out or a rejected token). */
  function clear(): void {
    state.token = null;
    state.role = null;
    persist();
  }

  return {
    state,
    token: computed(() => state.token),
    role: computed(() => state.role),
    isAuthenticated: computed(() => state.token !== null && state.role !== null),
    /** The `Authorization` header value for authenticated api calls, or null. */
    authHeader: computed(() => (state.token ? `Bearer ${state.token}` : null)),
    setSession,
    clear,
  };
}
