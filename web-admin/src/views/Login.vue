<script setup lang="ts">
// Staff login (D-17) — the one FUNCTIONAL screen in this scaffold. Posts to
// /auth/staff, stores the returned session token (role decoded client-side for
// nav gating), then routes to the redirect target or the role's first screen.
// Inline destructive error on bad credentials; server returns a single generic
// 401 for both unknown-email and wrong-password (no enumeration signal).
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import { firstRouteForRole } from "../router";
import { useSession } from "../stores/session";

const route = useRoute();
const router = useRouter();
const session = useSession();

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const submitting = ref(false);

async function submit(): Promise<void> {
  if (submitting.value) return;
  error.value = null;
  submitting.value = true;
  try {
    const { data, error: apiError } = await api.auth.staff.post({
      email: email.value,
      password: password.value,
    });
    if (apiError || !data?.token) {
      error.value = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
      return;
    }
    session.setSession(data.token);
    const role = session.role.value;
    if (!role) {
      // A valid token that is not a staff role (e.g. a customer token) can never
      // use the back-office — reject it rather than land on an empty shell.
      session.clear();
      error.value = "บัญชีนี้ไม่มีสิทธิ์เข้าหลังบ้าน";
      return;
    }
    const redirect =
      typeof route.query.redirect === "string" ? route.query.redirect : firstRouteForRole(role);
    await router.replace(redirect);
  } catch {
    error.value = "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-surface p-lg">
    <form
      class="w-full max-w-[400px] rounded-lg border border-hairline bg-canvas p-xl"
      @submit.prevent="submit"
    >
      <h1 class="mb-lg text-[20px] font-semibold text-accent">Saladee หลังบ้าน</h1>

      <label class="mb-md block">
        <span class="mb-xs block text-[14px] text-muted">อีเมล</span>
        <input
          v-model="email"
          type="email"
          required
          autocomplete="username"
          class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
        />
      </label>

      <label class="mb-md block">
        <span class="mb-xs block text-[14px] text-muted">รหัสผ่าน</span>
        <input
          v-model="password"
          type="password"
          required
          autocomplete="current-password"
          class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
        />
      </label>

      <p v-if="error" class="mb-md text-[14px] text-destructive">{{ error }}</p>

      <button
        type="submit"
        :disabled="submitting"
        class="flex h-10 w-full items-center justify-center gap-xs rounded-md bg-accent text-[16px] font-semibold text-white disabled:opacity-60"
      >
        <span
          v-if="submitting"
          class="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
        />
        เข้าสู่ระบบ
      </button>
    </form>
  </div>
</template>
