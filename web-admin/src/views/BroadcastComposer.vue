<script setup lang="ts">
// Broadcast composer (04-06 / MKT-03 + LINE-04). Staff picks a customer segment, writes
// a message, previews the CONSENT-SCOPED audience count (PDPA / NFR-04), then sends now
// or schedules — and can cancel a not-yet-sent campaign through a destructive confirm
// (UI-SPEC §Destructive confirmations). The server (requireRole owner|admin +
// resolveAudience) is the real authority; the composer only assembles the campaign. ONE
// accent primary CTA — "ส่งบรอดแคสต์". The audience count copy is ALWAYS scoped to
// marketing-consented customers, and shows the PDPA empty state when zero.
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ColumnDef } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import { api } from "../api";
import DataTable from "../components/DataTable.vue";
import { useSession } from "../stores/session";

type SegmentType = "all" | "b2c" | "b2b" | "subscription" | "inactive";

interface BroadcastRow {
  id: string;
  title: string;
  status: "draft" | "scheduled" | "sent" | "failed";
  sentCount: number;
  scheduledAt: string | null;
  createdAt: string;
}

function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

const qc = useQueryClient();

// ── Roster ────────────────────────────────────────────────────────────────────
const { data, isLoading, isError } = useQuery({
  queryKey: ["broadcasts"],
  queryFn: async () => {
    const { data, error } = await api.broadcasts.get({ headers: authHeaders() });
    if (error) throw error;
    return data as unknown as { broadcasts: BroadcastRow[] };
  },
});

const rows = computed<BroadcastRow[]>(() => data.value?.broadcasts ?? []);

const columns: ColumnDef<BroadcastRow, unknown>[] = [
  { accessorKey: "title", header: "หัวข้อ" },
  { id: "status", header: "สถานะ", accessorKey: "status" },
  { id: "sent", header: "ส่งแล้ว", accessorKey: "sentCount", meta: { numeric: true } },
  { id: "scheduled", header: "ตั้งเวลา", accessorKey: "scheduledAt" },
];

const STATUS_LABEL: Record<BroadcastRow["status"], string> = {
  draft: "ฉบับร่าง",
  scheduled: "ตั้งเวลาไว้",
  sent: "ส่งแล้ว",
  failed: "ล้มเหลว",
};

function scheduleLabel(row: BroadcastRow): string {
  if (!row.scheduledAt) return "—";
  return new Date(row.scheduledAt).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ── Segment picker (selected-tile) ─────────────────────────────────────────────
const SEGMENTS: { value: SegmentType; label: string; hint: string }[] = [
  { value: "all", label: "ทั้งหมด", hint: "ลูกค้าที่ยินยอมรับข่าวสารทุกคน" },
  { value: "b2c", label: "ค้าปลีก (B2C)", hint: "ลูกค้าทั่วไป" },
  { value: "b2b", label: "ค้าส่ง (B2B)", hint: "บัญชีค้าส่งที่อนุมัติแล้ว" },
  { value: "subscription", label: "สมาชิกรายรอบ", hint: "ผู้สมัครแบบ Subscription" },
  { value: "inactive", label: "ไม่ได้สั่งนาน", hint: "ไม่มีคำสั่งซื้อใน 60 วัน" },
];

type MessageType = "text" | "flex";

const form = ref({
  title: "",
  segmentType: "all" as SegmentType,
  tag: "",
  messageType: "text" as MessageType,
  // Plain-text body (also reused as the Flex body copy).
  message: "",
  // Flex-only fields.
  heroImageUrl: "",
  headline: "",
  ctaLabel: "",
  // CTA / promo link — shared: plain mode appends it, Flex mode uses it as the button uri.
  promoLink: "",
  scheduledAt: "",
});
const formError = ref<string | null>(null);

// The saved draft we preview + send. Cleared whenever the segment/message changes.
const draftId = ref<string | null>(null);
const audienceCount = ref<number | null>(null);
const previewLoading = ref(false);

function resetPreview(): void {
  draftId.value = null;
  audienceCount.value = null;
}

function segmentPayload() {
  const seg: { type: SegmentType; tag?: string } = { type: form.value.segmentType };
  if (form.value.tag.trim()) seg.tag = form.value.tag.trim();
  return seg;
}

function messagePayload() {
  const text = form.value.promoLink.trim()
    ? `${form.value.message.trim()}\n${form.value.promoLink.trim()}`
    : form.value.message.trim();
  return [{ type: "text", text }];
}

// Default marketing copy — kept identical to broadcast.ts DEFAULT_MARKETING_TEXT so the
// client-built altText/fallback matches the server guarantee.
const DEFAULT_MARKETING_TEXT = "มีข่าวสารใหม่จากสวนสลัด 🥬";
const ALT_TEXT_MAX = 400;

// CANONICAL SHAPE MIRROR — this MUST match api/src/services/broadcast.ts `buildBroadcastFlex`
// field-for-field (type "flex", altText, bubble hero/body/footer). Cross-package import is
// not available between web-admin and api, so the shape is duplicated; if buildBroadcastFlex
// changes, update this builder in the same PR. Runtime delivery sends THIS object via
// normalizeMessages, so keeping it identical is what prevents the two shapes diverging.
function flexPayload(): Record<string, unknown> {
  const heroImageUrl = form.value.heroImageUrl.trim();
  const headline = form.value.headline.trim();
  const body = form.value.message.trim();
  const ctaLabel = form.value.ctaLabel.trim();
  const ctaUrl = form.value.promoLink.trim();

  const altText = (headline || DEFAULT_MARKETING_TEXT).slice(0, ALT_TEXT_MAX);

  const bodyContents: Record<string, unknown>[] = [];
  if (headline)
    bodyContents.push({
      type: "text",
      text: headline,
      weight: "bold",
      size: "lg",
      color: "#3a7d20",
      wrap: true,
    });
  if (body)
    bodyContents.push({ type: "text", text: body, size: "sm", color: "#555555", wrap: true });
  if (bodyContents.length === 0)
    bodyContents.push({
      type: "text",
      text: DEFAULT_MARKETING_TEXT,
      size: "sm",
      color: "#555555",
      wrap: true,
    });

  const bubble: Record<string, unknown> = {
    type: "bubble",
    body: { type: "box", layout: "vertical", spacing: "md", contents: bodyContents },
  };
  if (heroImageUrl)
    bubble.hero = {
      type: "image",
      url: heroImageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
    };
  if (ctaUrl)
    bubble.footer = {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#3a7d20",
          action: { type: "uri", label: ctaLabel || "ดูเพิ่มเติม", uri: ctaUrl },
        },
      ],
    };

  return { type: "flex", altText, contents: bubble };
}

function validate(): boolean {
  formError.value = null;
  const f = form.value;
  if (!f.title.trim()) {
    formError.value = "กรุณากรอกหัวข้อบรอดแคสต์";
    return false;
  }
  if (f.messageType === "flex") {
    if (!f.headline.trim()) {
      formError.value = "กรุณากรอกพาดหัวการ์ด Flex";
      return false;
    }
    if (!f.message.trim()) {
      formError.value = "กรุณากรอกข้อความในการ์ด Flex";
      return false;
    }
    return true;
  }
  if (!f.message.trim()) {
    formError.value = "กรุณากรอกข้อความ";
    return false;
  }
  return true;
}

// Save a draft (or scheduled) broadcast, then fetch its consent-scoped audience count.
const saveDraft = useMutation({
  mutationFn: async () => {
    const body: {
      title: string;
      segment: { type: SegmentType; tag?: string };
      messageJson: unknown;
      scheduledAt?: string;
    } = {
      title: form.value.title.trim(),
      segment: segmentPayload(),
      messageJson: form.value.messageType === "flex" ? flexPayload() : messagePayload(),
    };
    if (form.value.scheduledAt) body.scheduledAt = new Date(form.value.scheduledAt).toISOString();
    const { data, error } = await api.broadcasts.post(body, { headers: authHeaders() });
    if (error) throw error;
    return data as unknown as { id: string };
  },
});

async function preview(): Promise<void> {
  if (!validate()) return;
  previewLoading.value = true;
  audienceCount.value = null;
  try {
    const created = await saveDraft.mutateAsync();
    draftId.value = created.id;
    const { data, error } = await api
      .broadcasts({ id: created.id })
      ["audience-count"].get({ headers: authHeaders() });
    if (error) throw error;
    audienceCount.value = (data as unknown as { count: number }).count;
    qc.invalidateQueries({ queryKey: ["broadcasts"] });
  } catch {
    formError.value = "บันทึกฉบับร่างหรือคำนวณผู้รับไม่สำเร็จ โปรดลองใหม่";
  } finally {
    previewLoading.value = false;
  }
}

// Send / schedule the previewed draft.
const send = useMutation({
  mutationFn: async () => {
    if (!draftId.value) throw new Error("no draft");
    const { data, error } = await api
      .broadcasts({ id: draftId.value })
      .send.post({}, { headers: authHeaders() });
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    resetPreview();
    form.value.title = "";
    form.value.message = "";
    form.value.heroImageUrl = "";
    form.value.headline = "";
    form.value.ctaLabel = "";
    form.value.promoLink = "";
    form.value.scheduledAt = "";
    qc.invalidateQueries({ queryKey: ["broadcasts"] });
  },
});

const sendError = ref<string | null>(null);
async function submitSend(): Promise<void> {
  sendError.value = null;
  try {
    await send.mutateAsync();
  } catch {
    sendError.value = "ส่งบรอดแคสต์ไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}

const isScheduled = computed(() => form.value.scheduledAt.trim().length > 0);
const canSend = computed(() => draftId.value != null && (audienceCount.value ?? 0) > 0);

// ── Cancel-scheduled (destructive) ─────────────────────────────────────────────
const cancelTarget = ref<BroadcastRow | null>(null);
const cancelError = ref<string | null>(null);

const cancel = useMutation({
  mutationFn: async (id: string) => {
    const { data, error } = await api.broadcasts({ id }).delete({}, { headers: authHeaders() });
    if (error) throw error;
    return data;
  },
  onSuccess: () => qc.invalidateQueries({ queryKey: ["broadcasts"] }),
});

async function confirmCancel(): Promise<void> {
  if (!cancelTarget.value) return;
  cancelError.value = null;
  try {
    await cancel.mutateAsync(cancelTarget.value.id);
  } catch {
    cancelError.value = "ยกเลิกบรอดแคสต์ไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  } finally {
    cancelTarget.value = null;
  }
}
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">บรอดแคสต์</h1>

    <form
      class="mb-xl max-w-[640px] space-y-md rounded-lg border border-hairline bg-canvas p-lg"
      @submit.prevent="preview"
    >
      <label class="block">
        <span class="mb-xs block text-[14px] text-muted">หัวข้อแคมเปญ</span>
        <input
          v-model="form.title"
          type="text"
          maxlength="200"
          placeholder="เช่น ผักสลัดรอบใหม่มาแล้ว!"
          class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
        />
      </label>

      <!-- Segment picker — selected tile gets the ring accent -->
      <div>
        <span class="mb-xs block text-[14px] text-muted">กลุ่มผู้รับ</span>
        <div class="grid grid-cols-2 gap-sm sm:grid-cols-3">
          <button
            v-for="s in SEGMENTS"
            :key="s.value"
            type="button"
            class="flex flex-col items-start rounded-md border border-hairline px-sm py-xs text-left"
            :class="form.segmentType === s.value ? 'ring-2 ring-accent border-accent' : ''"
            @click="((form.segmentType = s.value), resetPreview())"
          >
            <span class="text-[15px] font-semibold text-ink">{{ s.label }}</span>
            <span class="text-[12px] text-muted">{{ s.hint }}</span>
          </button>
        </div>
      </div>

      <label class="block">
        <span class="mb-xs block text-[14px] text-muted">แท็กเพิ่มเติม (เว้นว่างได้)</span>
        <input
          v-model="form.tag"
          type="text"
          maxlength="64"
          placeholder="เช่น vip"
          class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          @input="resetPreview"
        />
      </label>

      <!-- Message-type toggle: plain text (fallback) vs styled Flex card -->
      <div>
        <span class="mb-xs block text-[14px] text-muted">รูปแบบข้อความ</span>
        <div class="grid grid-cols-2 gap-sm">
          <button
            type="button"
            class="rounded-md border border-hairline px-sm py-xs text-[15px] font-semibold text-ink"
            :class="form.messageType === 'text' ? 'ring-2 ring-accent border-accent' : ''"
            @click="((form.messageType = 'text'), resetPreview())"
          >
            ข้อความธรรมดา
          </button>
          <button
            type="button"
            class="rounded-md border border-hairline px-sm py-xs text-[15px] font-semibold text-ink"
            :class="form.messageType === 'flex' ? 'ring-2 ring-accent border-accent' : ''"
            @click="((form.messageType = 'flex'), resetPreview())"
          >
            การ์ด Flex
          </button>
        </div>
      </div>

      <!-- Flex-only fields: hero image + headline (body reuses ข้อความ below) -->
      <template v-if="form.messageType === 'flex'">
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">รูปหน้าปก (URL รูปสินค้า, เว้นว่างได้)</span>
          <input
            v-model="form.heroImageUrl"
            type="url"
            placeholder="วางลิงก์รูปสินค้า (เช่น รูปหน้าปกจากแคตตาล็อก)"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
            @input="resetPreview"
          />
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">พาดหัว</span>
          <input
            v-model="form.headline"
            type="text"
            maxlength="120"
            placeholder="เช่น ผักสลัดรอบใหม่มาแล้ว!"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
            @input="resetPreview"
          />
        </label>
      </template>

      <label class="block">
        <span class="mb-xs block text-[14px] text-muted">ข้อความ</span>
        <textarea
          v-model="form.message"
          rows="3"
          maxlength="1000"
          placeholder="พิมพ์ข้อความข่าวสารการตลาด…"
          class="w-full rounded-md border border-hairline px-sm py-xs text-[16px] outline-none focus:border-accent"
          @input="resetPreview"
        />
      </label>

      <label v-if="form.messageType === 'flex'" class="block">
        <span class="mb-xs block text-[14px] text-muted">ข้อความบนปุ่ม (เว้นว่างได้)</span>
        <input
          v-model="form.ctaLabel"
          type="text"
          maxlength="40"
          placeholder="เช่น สั่งเลย"
          class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          @input="resetPreview"
        />
      </label>

      <div class="grid grid-cols-2 gap-md">
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">
            {{ form.messageType === "flex" ? "ลิงก์ปุ่ม (เว้นว่างได้)" : "ลิงก์โปรโมชัน (เว้นว่างได้)" }}
          </span>
          <input
            v-model="form.promoLink"
            type="url"
            placeholder="https://…"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
            @input="resetPreview"
          />
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">ตั้งเวลาส่ง (เว้นว่าง = ส่งทันที)</span>
          <input
            v-model="form.scheduledAt"
            type="datetime-local"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          />
        </label>
      </div>

      <p v-if="formError" class="text-[14px] text-destructive">{{ formError }}</p>

      <!-- Preview: consent-scoped audience count (PDPA empty state when zero) -->
      <button
        type="submit"
        :disabled="previewLoading"
        class="flex h-10 items-center justify-center gap-xs rounded-md border border-hairline px-lg text-[16px] font-semibold text-ink disabled:opacity-60"
      >
        <span
          v-if="previewLoading"
          class="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink"
        />
        บันทึกฉบับร่าง / ดูจำนวนผู้รับ
      </button>

      <div v-if="audienceCount !== null" class="rounded-md border border-hairline bg-surface p-md">
        <p v-if="audienceCount > 0" class="text-[15px] font-semibold text-ink">
          ส่งถึง {{ audienceCount }} คน (เฉพาะผู้ยินยอมรับข่าวสารการตลาด)
        </p>
        <div v-else class="text-center">
          <p class="text-[15px] font-semibold text-ink">ไม่มีผู้รับในกลุ่มนี้</p>
          <p class="mt-xs text-[13px] text-muted">
            ส่งได้เฉพาะลูกค้าที่ยินยอมรับข่าวสารการตลาด (PDPA) และเชื่อม LINE แล้วเท่านั้น
          </p>
        </div>
      </div>

      <p v-if="sendError" class="text-[14px] text-destructive">{{ sendError }}</p>

      <!-- The single accent CTA -->
      <button
        type="button"
        :disabled="!canSend || send.isPending.value"
        class="flex h-11 w-full items-center justify-center gap-xs rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-50"
        @click="submitSend"
      >
        <span
          v-if="send.isPending.value"
          class="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
        />
        {{ isScheduled ? "ตั้งเวลาส่ง" : "ส่งบรอดแคสต์" }}
      </button>
    </form>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดรายการบรอดแคสต์ไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>
    <p v-if="cancelError" class="mb-md text-[14px] text-destructive">{{ cancelError }}</p>

    <!-- empty state -->
    <div
      v-if="!isLoading && rows.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีบรอดแคสต์</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        ส่งข่าวสารการตลาดถึงลูกค้าที่ยินยอมรับข่าวสาร (PDPA)
      </p>
    </div>

    <!-- broadcast roster -->
    <DataTable v-else :columns="columns" :data="rows" :loading="isLoading">
      <template #cell:status="{ row }">
        <span class="rounded-full bg-surface px-sm py-[2px] text-[12px] font-semibold text-ink">
          {{ STATUS_LABEL[(row as BroadcastRow).status] }}
        </span>
      </template>
      <template #cell:scheduled="{ row }">{{ scheduleLabel(row as BroadcastRow) }}</template>

      <template #row-actions="{ row }">
        <button
          v-if="(row as BroadcastRow).status === 'scheduled' || (row as BroadcastRow).status === 'draft'"
          type="button"
          class="text-[14px] text-destructive hover:underline"
          @click="cancelTarget = row as BroadcastRow"
        >
          ยกเลิก
        </button>
        <span v-else class="text-[14px] text-muted">—</span>
      </template>
    </DataTable>

    <!-- Cancel-confirm modal (destructive) -->
    <div
      v-if="cancelTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="cancelTarget = null"
    >
      <div class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl">
        <h2 class="mb-md text-[20px] font-semibold">ยกเลิกบรอดแคสต์</h2>
        <p class="mb-lg text-[16px] text-ink">
          ยกเลิกการตั้งเวลาบรอดแคสต์นี้? "{{ cancelTarget.title }}" จะไม่ถูกส่งออกไป
        </p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="cancelTarget = null"
          >
            ปิด
          </button>
          <button
            type="button"
            :disabled="cancel.isPending.value"
            class="h-10 rounded-md bg-destructive px-lg text-[16px] font-semibold text-white disabled:opacity-60"
            @click="confirmCancel"
          >
            ยกเลิกบรอดแคสต์
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
