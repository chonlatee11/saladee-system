// Client subscription store (03-08) — the signup draft the SubscriptionSignup view
// builds and confirms. Mirrors cart.ts: a module-level reactive singleton (no Pinia,
// NFR-08) mirrored into sessionStorage so a package/frequency pick survives a
// navigation between the signup screen and a login redirect.
//
// SECURITY: the store holds ONLY the package CODE + frequency — never a money value.
// POST /me/subscriptions resolves packageValueSatang server-side from the code
// (T-03-20), so a tampered client draft can change WHICH package is requested but
// never the box value. The satang figures below are DISPLAY-ONLY (they mirror the
// server PACKAGE_VALUES map for the picker) and are never sent to the API.
import { computed, reactive } from "vue";

export type PackageCode = "S" | "M" | "L";
export type Frequency = "weekly" | "biweekly";

/** A selectable box package (DISPLAY mirror of the server value map, D-12). */
export interface PackageOption {
  code: PackageCode;
  label: string;
  /** DISPLAY value only — the server is the authority on the box value. */
  valueSatang: number;
  blurb: string;
}

/** The three by-value packages (S/M/L), mirroring the api PACKAGE_VALUES map. */
export const PACKAGES: readonly PackageOption[] = [
  { code: "S", label: "กล่องเล็ก (S)", valueSatang: 30000, blurb: "ผักสด ~2–3 ชนิด พอดีสำหรับ 1–2 คน" },
  { code: "M", label: "กล่องกลาง (M)", valueSatang: 50000, blurb: "ผักสด ~3–4 ชนิด สำหรับครอบครัวเล็ก" },
  { code: "L", label: "กล่องใหญ่ (L)", valueSatang: 80000, blurb: "ผักสด ~4–6 ชนิด สำหรับครอบครัวใหญ่" },
];

/** The two delivery cadences (D-12). */
export const FREQUENCIES: readonly { code: Frequency; label: string }[] = [
  { code: "weekly", label: "ทุกสัปดาห์" },
  { code: "biweekly", label: "ทุก 2 สัปดาห์" },
];

interface SignupDraft {
  packageCode: PackageCode | null;
  frequency: Frequency | null;
}

const STORAGE_KEY = "saladee.subscription.v1";

function loadPersisted(): SignupDraft {
  if (typeof sessionStorage === "undefined") return { packageCode: null, frequency: null };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { packageCode: null, frequency: null };
    const parsed = JSON.parse(raw) as Partial<SignupDraft>;
    const code = parsed.packageCode;
    const freq = parsed.frequency;
    return {
      packageCode: code === "S" || code === "M" || code === "L" ? code : null,
      frequency: freq === "weekly" || freq === "biweekly" ? freq : null,
    };
  } catch {
    return { packageCode: null, frequency: null };
  }
}

const state = reactive<SignupDraft>(loadPersisted());

function persist(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full/blocked sessionStorage must never break signup — persist best-effort.
  }
}

/** Format a satang amount as a whole-baht string (฿) for the picker. */
export function baht(satang: number): string {
  return `฿${Math.round(satang / 100)}`;
}

/**
 * The subscription signup store. A single shared draft is returned to every caller
 * (module singleton), so the picker and the confirm CTA read/write the same choice.
 */
export function useSubscription() {
  const isComplete = computed(() => state.packageCode !== null && state.frequency !== null);

  function selectPackage(code: PackageCode): void {
    state.packageCode = code;
    persist();
  }

  function selectFrequency(freq: Frequency): void {
    state.frequency = freq;
    persist();
  }

  /** Clear the draft (after a placed signup or an explicit reset). */
  function clear(): void {
    state.packageCode = null;
    state.frequency = null;
    persist();
  }

  return {
    state,
    packageCode: computed(() => state.packageCode),
    frequency: computed(() => state.frequency),
    isComplete,
    selectPackage,
    selectFrequency,
    clear,
  };
}
