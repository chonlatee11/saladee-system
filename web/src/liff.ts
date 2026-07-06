// LIFF client wiring (LINE-02 / D-17). Three seams:
//   initLiff()      — guarded on VITE_LIFF_ID so the static build/test never need a
//                     live LIFF id; the guest path (no id / not logged in) still runs.
//   getIdToken()    — the logged-in user's LINE idToken (or null for guests).
//   loginWithLine() — exchanges the idToken at POST /auth/line and stores the
//                     returned CUSTOMER session token. Returns null on the guest path.
//
// `@line/liff` is imported dynamically inside each function so its browser globals
// never load at module top level (keeps `bun test` importing this file DOM-free).
import { api } from "./api";

const SESSION_KEY = "saladee_session";
const CUSTOMER_KEY = "saladee_customer";

/** The stored customer session token (issued by POST /auth/line), or null. */
export function getSessionToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(SESSION_KEY);
}

/** Persist / clear the customer session token. */
export function setSessionToken(token: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(SESSION_KEY, token);
  else {
    localStorage.removeItem(SESSION_KEY);
    // Clearing the session must never leave a stale customer id behind — a logged-
    // out client must fall back to the guest checkout body (LINE-02 / D-19).
    localStorage.removeItem(CUSTOMER_KEY);
  }
}

/** The logged-in member's customer id (bears line_user_id), or null for guests. */
export function getCustomerId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(CUSTOMER_KEY);
}

/** Persist / clear the member customer id (set on login, cleared on logout). */
export function setCustomerId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (id) localStorage.setItem(CUSTOMER_KEY, id);
  else localStorage.removeItem(CUSTOMER_KEY);
}

/** True when a LIFF id is configured — i.e. LINE Login is available at all. */
export function isLiffConfigured(): boolean {
  return Boolean(import.meta.env?.VITE_LIFF_ID);
}

/**
 * Guarded LIFF init: only initialises when VITE_LIFF_ID is configured, so the
 * static build/test never require a live LIFF id and the guest path always works.
 */
export async function initLiff(): Promise<void> {
  const liffId = import.meta.env?.VITE_LIFF_ID;
  if (!liffId) return;
  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId });
}

/** The current LINE idToken, or null when unconfigured / not logged in (guest). */
export async function getIdToken(): Promise<string | null> {
  const liffId = import.meta.env?.VITE_LIFF_ID;
  if (!liffId) return null;
  const liff = (await import("@line/liff")).default;
  if (!liff.isLoggedIn()) return null;
  return liff.getIDToken();
}

/** Trigger the LINE Login redirect (only when configured and not already in). */
export async function ensureLineLogin(): Promise<void> {
  const liffId = import.meta.env?.VITE_LIFF_ID;
  if (!liffId) return;
  const liff = (await import("@line/liff")).default;
  if (!liff.isLoggedIn()) liff.login();
}

/**
 * Exchange the LINE idToken for a server-verified customer session (D-17). Returns
 * the customer identity on success, or null on the guest path / failure — the app
 * stays usable as a guest either way (history/reorder/push are gated off).
 */
export async function loginWithLine(): Promise<{
  customerId: string;
  lineUserId: string;
} | null> {
  const idToken = await getIdToken();
  if (!idToken) return null; // guest path — no idToken to verify
  const { data, error } = await api.auth.line.post({ idToken });
  // WR-05: narrow ALL three success fields, not just `token`. Eden infers the
  // response as a success|error union; checking only `"token" in data` left
  // customerId/lineUserId as `string | undefined`, failing the vue-tsc gate. The
  // server always sends all three on the success path, so this is a type guard.
  if (error || !data || !("token" in data) || !data.customerId || !data.lineUserId) return null;
  setSessionToken(data.token);
  // Persist the member customer id so the LINE checkout can bind the order to this
  // member's identity + recipient (LINE-02 / UAT-4). Cleared on session clear above.
  setCustomerId(data.customerId);
  return { customerId: data.customerId, lineUserId: data.lineUserId };
}
