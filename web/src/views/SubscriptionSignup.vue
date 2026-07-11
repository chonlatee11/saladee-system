<script setup lang="ts">
// สมัครสมาชิกกล่องผัก — LIFF subscription sign-up (03-08, SALE-03 / D-12). Route
// "/subscription". A member picks a package (S/M/L, BY VALUE) + a delivery cadence
// and confirms; POST /me/subscriptions creates it (the server resolves the box value
// from the code — T-03-20). Inherits the Phase-2 mobile contract verbatim.
//
// States (UI-SPEC §Empty/CTA): guest-gate · not-a-member-yet (the picker) ·
// already-a-member (summary + link to manage) · submitting · error. The loading
// state is owned by the App.vue <Suspense> fallback (the 02-02 shell pattern).
// `sessionToken`/`loader`/`createFn` are injectable so the view test runs DOM-free.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { ensureLineLogin, getSessionToken, loginWithLine } from "../liff";
import {
  baht,
  FREQUENCIES,
  type Frequency,
  PACKAGES,
  type PackageCode,
  useSubscription,
} from "../stores/subscription";
import BusyOverlay from "../components/BusyOverlay.vue";
import EmptyState from "../components/EmptyState.vue";

interface MySubscription {
  id: string;
  packageCode: string;
  packageValueSatang: number;
  frequency: string;
  status: string;
}
interface ListResult {
  data: { subscriptions: MySubscription[]; nextRound: unknown } | null;
  error: unknown | null;
}
interface CreateResult {
  data: MySubscription | null;
  error: unknown | null;
}

const props = defineProps<{
  sessionToken?: string | null;
  loader?: () => Promise<ListResult>;
  createFn?: (body: { packageCode: PackageCode; frequency: Frequency }) => Promise<CreateResult>;
}>();

const router = useRouter();
const sub = useSubscription();

const token = props.sessionToken !== undefined ? props.sessionToken : getSessionToken();
const isMember = Boolean(token);

function authHeaders() {
  return { authorization: `Bearer ${token ?? ""}` };
}

const defaultLoader = (): Promise<ListResult> =>
  api.me.subscriptions.get({ headers: authHeaders() }) as unknown as Promise<ListResult>;
const defaultCreate = (body: {
  packageCode: PackageCode;
  frequency: Frequency;
}): Promise<CreateResult> =>
  api.me.subscriptions.post(body, { headers: authHeaders() }) as unknown as Promise<CreateResult>;

// Async setup: only members fetch. Guests short-circuit to the login gate below. An
// existing active/paused subscription means "already a member" (manage, don't sign up).
let errored = false;
let existing: MySubscription[] = [];
if (isMember) {
  const res = await (props.loader ?? defaultLoader)().catch(
    () => ({ data: null, error: { network: true } }) as ListResult,
  );
  errored = res.error != null;
  existing = res.data?.subscriptions ?? [];
}
const activeMember = computed(() =>
  existing.some((s) => s.status === "active" || s.status === "paused"),
);

const submitting = ref(false);
const submitError = ref<string | null>(null);

async function onLogin(): Promise<void> {
  await ensureLineLogin();
  const session = await loginWithLine().catch(() => null);
  if (session) location.reload();
}

async function onConfirm(): Promise<void> {
  if (submitting.value || !sub.isComplete.value) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const res = await (props.createFn ?? defaultCreate)({
      // isComplete guarantees both are non-null here.
      packageCode: sub.packageCode.value as PackageCode,
      frequency: sub.frequency.value as Frequency,
    });
    if (res.error != null || !res.data) {
      submitError.value = "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง";
      return;
    }
    sub.clear();
    await router.push("/subscription/manage");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="p-md">
    <BusyOverlay :show="submitting" label="กำลังสมัครสมาชิก…" />
    <h1 class="mb-md text-[28px] font-semibold leading-[1.3] text-ink">สมาชิกกล่องผัก</h1>

    <!-- Guest gate: signup needs a LINE login (the box is tied to the member). -->
    <EmptyState
      v-if="!isMember"
      heading="เข้าสู่ระบบเพื่อสมัครสมาชิก"
      body="สมัครกล่องผักรายรอบได้เมื่อเข้าสู่ระบบด้วย LINE"
    >
      <button
        type="button"
        class="rounded-lg bg-accent px-lg py-sm text-[16px] font-semibold text-white"
        @click="onLogin"
      >
        เข้าสู่ระบบด้วย LINE
      </button>
    </EmptyState>

    <!-- Error -->
    <div v-else-if="errored" class="flex flex-col items-center gap-md py-2xl text-center" role="alert">
      <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
    </div>

    <!-- Already a member → route them to manage instead of signing up again. -->
    <EmptyState
      v-else-if="activeMember"
      heading="คุณเป็นสมาชิกกล่องผักอยู่แล้ว"
      body="จัดการแพ็กเกจ หยุดชั่วคราว ข้ามรอบ หรือยกเลิกได้ที่หน้าจัดการสมาชิก"
    >
      <RouterLink
        to="/subscription/manage"
        class="rounded-lg bg-accent px-lg py-sm text-[16px] font-semibold text-white"
      >
        จัดการสมาชิก
      </RouterLink>
    </EmptyState>

    <!-- Not a member yet → the package + frequency picker. -->
    <template v-else>
      <p class="mb-lg max-w-[42ch] text-[16px] leading-[1.6] text-muted">
        เลือกแพ็กเกจและความถี่ที่ต้องการ แล้วเราจัดผักสดให้ทุกรอบ
      </p>

      <p
        v-if="submitError"
        class="mb-md rounded-lg bg-destructive/10 px-md py-sm text-[15px] text-destructive"
        role="alert"
      >
        {{ submitError }}
      </p>

      <!-- Package tiles (S/M/L, by value) -->
      <h2 class="mb-sm text-[18px] font-semibold text-ink">เลือกแพ็กเกจ</h2>
      <div class="mb-lg flex flex-col gap-sm">
        <button
          v-for="p in PACKAGES"
          :key="p.code"
          type="button"
          class="rounded-xl border p-md text-left transition-colors"
          :class="
            sub.packageCode.value === p.code
              ? 'border-accent bg-accent/5'
              : 'border-border bg-white'
          "
          :aria-pressed="sub.packageCode.value === p.code"
          @click="sub.selectPackage(p.code)"
        >
          <div class="flex items-center justify-between gap-md">
            <span class="text-[16px] font-semibold text-ink">{{ p.label }}</span>
            <span class="text-[16px] font-semibold text-accent">{{ baht(p.valueSatang) }}/รอบ</span>
          </div>
          <p class="mt-[2px] text-[14px] leading-[1.5] text-muted">{{ p.blurb }}</p>
        </button>
      </div>

      <!-- Frequency tiles -->
      <h2 class="mb-sm text-[18px] font-semibold text-ink">ความถี่</h2>
      <div class="mb-xl flex gap-sm">
        <button
          v-for="f in FREQUENCIES"
          :key="f.code"
          type="button"
          class="flex-1 rounded-xl border px-md py-sm text-[16px] font-medium transition-colors"
          :class="
            sub.frequency.value === f.code
              ? 'border-accent bg-accent/5 text-ink'
              : 'border-border bg-white text-muted'
          "
          :aria-pressed="sub.frequency.value === f.code"
          @click="sub.selectFrequency(f.code)"
        >
          {{ f.label }}
        </button>
      </div>

      <!-- Confirm CTA — disabled until a package + frequency are chosen. -->
      <button
        type="button"
        class="w-full rounded-lg bg-accent px-lg py-md text-[17px] font-semibold text-white disabled:opacity-50"
        :disabled="!sub.isComplete.value || submitting"
        @click="onConfirm"
      >
        ยืนยันแพ็กเกจ
      </button>
    </template>
  </section>
</template>
