<script setup lang="ts">
// การรับข่าวสาร (PDPA) — LIFF marketing opt-out surface (04-10, D-17 / NFR-04).
// Route "/consent". A LINE member sees their current marketing-consent state (GET
// /me/consent-status) and can opt out (POST /me/marketing-opt-out) behind a confirm.
// The opt-out is APPEND-ONLY server-side (a new granted=false consent_logs row); the
// broadcast audience (04-06) then excludes them. This screen only mirrors the state —
// the server is the authority. `sessionToken` + loaders/action are injectable so the
// view test runs DOM-free (mirrors B2bAccount.vue). The loading state is owned by the
// App.vue <Suspense> fallback.
import { computed, ref } from "vue";
import { api } from "../api";
import { ensureLineLogin, getSessionToken, loginWithLine } from "../liff";
import BusyOverlay from "../components/BusyOverlay.vue";
import EmptyState from "../components/EmptyState.vue";

interface ConsentStatus {
  currentPolicyVersion: string;
  latestMarketingGranted: boolean;
  needsReconsent: boolean;
}

const props = defineProps<{
  sessionToken?: string | null;
  statusFn?: () => Promise<{ data: ConsentStatus | null; error: unknown }>;
  optOutFn?: () => Promise<{ error: unknown }>;
}>();

const token = props.sessionToken !== undefined ? props.sessionToken : getSessionToken();
const isMember = Boolean(token);
function authHeaders() {
  return { authorization: `Bearer ${token ?? ""}` };
}

const statusLoad =
  props.statusFn ??
  (() =>
    api.me["consent-status"].get({ headers: authHeaders() }) as unknown as Promise<{
      data: ConsentStatus | null;
      error: unknown;
    }>);
const optOutCall =
  props.optOutFn ??
  (() =>
    api.me["marketing-opt-out"].post({}, { headers: authHeaders() }) as unknown as Promise<{
      error: unknown;
    }>);

const errored = ref(false);
const status = ref<ConsentStatus | null>(null);

async function reload(): Promise<void> {
  const res = await statusLoad().catch(() => ({ data: null, error: { network: true } }));
  errored.value = res.error != null;
  status.value = res.data ?? null;
}

if (isMember) await reload();

const granted = computed(() => status.value?.latestMarketingGranted === true);
const busy = ref(false);
const confirming = ref(false);
const actionError = ref<string | null>(null);

async function onLogin(): Promise<void> {
  await ensureLineLogin();
  const session = await loginWithLine().catch(() => null);
  if (session) location.reload();
}

async function onOptOut(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    const res = await optOutCall();
    if (res.error != null) {
      actionError.value = "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง";
      return;
    }
    confirming.value = false;
    await reload();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="p-md">
    <BusyOverlay :show="busy" label="กำลังดำเนินการ…" />
    <h1 class="mb-md text-[28px] font-semibold leading-[1.3] text-ink">การรับข่าวสาร</h1>

    <!-- Guest gate -->
    <EmptyState
      v-if="!isMember"
      heading="เข้าสู่ระบบเพื่อจัดการการรับข่าวสาร"
      body="ตั้งค่าการรับข่าวสารการตลาดได้เมื่อเข้าสู่ระบบด้วย LINE"
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
    <div
      v-else-if="errored"
      class="flex flex-col items-center gap-md py-2xl text-center"
      role="alert"
    >
      <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
    </div>

    <template v-else>
      <p
        v-if="actionError"
        class="mb-md rounded-lg bg-destructive/10 px-md py-sm text-[15px] text-destructive"
        role="alert"
      >
        {{ actionError }}
      </p>

      <!-- Currently subscribed → offer opt-out. -->
      <template v-if="granted">
        <p class="mb-md text-[16px] text-ink">
          คุณกำลังรับข่าวสาร โปรโมชัน และรอบผักใหม่ผ่าน LINE
        </p>

        <template v-if="!confirming">
          <button
            type="button"
            class="w-full rounded-lg border border-hairline px-lg py-md text-[16px] font-semibold text-ink"
            @click="confirming = true"
          >
            ยกเลิกรับข่าวสารการตลาด
          </button>
        </template>

        <!-- Destructive confirm (UI-SPEC): neutral surface, accent confirm CTA. -->
        <div v-else class="flex flex-col gap-md rounded-lg bg-surface p-md">
          <p class="text-[16px] font-semibold text-ink">ยกเลิกรับข่าวสารการตลาด?</p>
          <p class="text-[14px] text-muted">
            คุณจะไม่ได้รับข่าวสารและโปรโมชันผ่าน LINE อีก (ยังสั่งซื้อได้ตามปกติ)
          </p>
          <div class="flex gap-md">
            <button
              type="button"
              class="flex-1 rounded-lg border border-hairline px-lg py-md text-[16px] text-ink"
              :disabled="busy"
              @click="confirming = false"
            >
              ไม่ใช่ตอนนี้
            </button>
            <button
              type="button"
              class="flex-[2] rounded-lg bg-accent px-lg py-md text-[16px] font-semibold text-white disabled:opacity-50"
              :disabled="busy"
              @click="onOptOut"
            >
              ยืนยันยกเลิก
            </button>
          </div>
        </div>
      </template>

      <!-- Already opted out. -->
      <EmptyState
        v-else
        heading="คุณไม่ได้รับข่าวสารการตลาด"
        body="คุณเลือกไม่รับข่าวสารและโปรโมชันผ่าน LINE แล้ว"
      />
    </template>
  </section>
</template>
