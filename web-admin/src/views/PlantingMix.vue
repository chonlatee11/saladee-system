<script setup lang="ts">
// Planting-mix templates (CROP-06 / D-06). List saved recipes, create/edit a
// recipe (varieties + plant counts, ~200 plants / 6 varieties), and one-click
// spawn this week's batches from a template on a chosen Monday plant date. The
// primary CTA is "สร้างแบตช์จากสูตรปลูก"; a re-click for the same week surfaces
// the "already created" notice (server idempotency). Empty state per UI-SPEC.
import { computed, ref } from "vue";
import {
  type MixItemInput,
  type RecommendationItem,
  useCreateBatchesFromMix,
  useCreateMixTemplate,
  useMixTemplates,
  usePlantingRecommendation,
  useUpdateMixTemplate,
  useVarieties,
} from "../composables/useCrop";

interface MixItem {
  id: string;
  varietyId: string;
  plantCount: number;
}
interface MixTemplate {
  id: string;
  name: string;
  active: boolean;
  items: MixItem[];
}

const { data: templates, isLoading, isError } = useMixTemplates();
const { data: varieties } = useVarieties();
const {
  data: recommendation,
  isLoading: recLoading,
  isError: recError,
} = usePlantingRecommendation();
const createTemplate = useCreateMixTemplate();
const updateTemplate = useUpdateMixTemplate();
const spawn = useCreateBatchesFromMix();

const list = computed<MixTemplate[]>(() => (templates.value ?? []) as MixTemplate[]);
const varietyName = (id: string) => (varieties.value ?? []).find((v) => v.id === id)?.name ?? id;

// ── Create / edit recipe modal ───────────────────────────────────────────────
const editorOpen = ref(false);
const editingId = ref<string | null>(null); // null = create
const nameInput = ref("");
const itemsInput = ref<MixItemInput[]>([]);
const editorError = ref<string | null>(null);

function openCreate(): void {
  editingId.value = null;
  nameInput.value = "";
  itemsInput.value = [{ varietyId: (varieties.value ?? [])[0]?.id ?? "", plantCount: 0 }];
  editorError.value = null;
  editorOpen.value = true;
}
function openEdit(tpl: MixTemplate): void {
  editingId.value = tpl.id;
  nameInput.value = tpl.name;
  itemsInput.value = tpl.items.map((it) => ({
    varietyId: it.varietyId,
    plantCount: it.plantCount,
  }));
  editorError.value = null;
  editorOpen.value = true;
}
function addItem(): void {
  itemsInput.value.push({ varietyId: (varieties.value ?? [])[0]?.id ?? "", plantCount: 0 });
}
function removeItem(idx: number): void {
  itemsInput.value.splice(idx, 1);
}
async function submitEditor(): Promise<void> {
  editorError.value = null;
  if (!nameInput.value.trim()) {
    editorError.value = "ตั้งชื่อสูตรปลูกก่อน";
    return;
  }
  if (itemsInput.value.length === 0 || itemsInput.value.some((i) => !i.varietyId)) {
    editorError.value = "เลือกพันธุ์ผักอย่างน้อย 1 ชนิด";
    return;
  }
  try {
    if (editingId.value) {
      await updateTemplate.mutateAsync({
        id: editingId.value,
        name: nameInput.value.trim(),
        items: itemsInput.value.map((i) => ({ ...i })),
      });
    } else {
      await createTemplate.mutateAsync({
        name: nameInput.value.trim(),
        items: itemsInput.value.map((i) => ({ ...i })),
      });
    }
    editorOpen.value = false;
  } catch {
    editorError.value = "บันทึกสูตรปลูกไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}

// ── Demand-driven planting recommendation (CROP-07 / D-23/24/25) ─────────────
const recNoData = computed<boolean>(() => recommendation.value?.noData !== false);
const recRounds = computed<number>(() => recommendation.value?.nRounds ?? 0);
const recItems = computed<RecommendationItem[]>(() =>
  recommendation.value && !recommendation.value.noData ? recommendation.value.items : [],
);

/**
 * Apply the recommendation as a PREFILL of the recipe editor (D-25 — the mix is
 * never silently overwritten; the admin edits + confirms before save). Opens the
 * same create-recipe form the manual flow uses, seeded with the recommended counts.
 */
function applyRecommendation(): void {
  editingId.value = null; // prefill a NEW recipe (never mutate an existing one)
  nameInput.value = `สูตรจากดีมานด์ ${new Date().toISOString().slice(0, 10)}`;
  itemsInput.value = recItems.value.map((it) => ({
    varietyId: it.varietyId,
    plantCount: it.recommendedPlants,
  }));
  editorError.value = null;
  editorOpen.value = true;
}

// ── One-click create-batches (D-06) ──────────────────────────────────────────
const spawnFor = ref<MixTemplate | null>(null);
const spawnDate = ref("");
const spawnNotice = ref<string | null>(null); // "already created" info
const spawnDone = ref<string | null>(null); // success line
const spawnError = ref<string | null>(null);

function openSpawn(tpl: MixTemplate): void {
  spawnFor.value = tpl;
  spawnDate.value = new Date().toISOString().slice(0, 10);
  spawnNotice.value = null;
  spawnDone.value = null;
  spawnError.value = null;
}
async function submitSpawn(): Promise<void> {
  if (!spawnFor.value || !spawnDate.value) return;
  spawnNotice.value = null;
  spawnDone.value = null;
  spawnError.value = null;
  try {
    const res = (await spawn.mutateAsync({
      id: spawnFor.value.id,
      plantDate: spawnDate.value,
    })) as { alreadyCreated: boolean; batches: unknown[] } | null;
    if (res?.alreadyCreated) {
      spawnNotice.value = "สร้างแบตช์รอบนี้จากสูตรปลูกไปแล้ว — แก้ไขแบตช์รายตัวได้ที่หน้าแบตช์การปลูก";
    } else {
      spawnDone.value = `สร้าง ${res?.batches.length ?? 0} แบตช์จากสูตรปลูกแล้ว`;
    }
  } catch {
    spawnError.value = "สร้างแบตช์ไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
</script>

<template>
  <section>
    <div class="mb-lg flex items-center justify-between">
      <h1 class="text-[28px] font-semibold">สูตรปลูก</h1>
      <button
        type="button"
        class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
        @click="openCreate"
      >
        เพิ่มสูตรปลูก
      </button>
    </div>

    <!-- CROP-07 demand-driven planting recommendation (prefills the mix, D-25) -->
    <div class="mb-lg rounded-lg border border-hairline bg-canvas p-lg">
      <h2 class="text-[20px] font-semibold text-ink">
        คำแนะนำปริมาณปลูก (จากดีมานด์ย้อนหลัง)
      </h2>

      <!-- loading -->
      <div v-if="recLoading" class="mt-md h-16 animate-pulse rounded-md bg-surface" />

      <!-- error -->
      <p v-else-if="recError" class="mt-md text-[14px] text-destructive">
        โหลดคำแนะนำไม่สำเร็จ โปรดลองใหม่อีกครั้ง
      </p>

      <!-- no-data (insufficient history) -->
      <div v-else-if="recNoData" class="mt-md">
        <p class="text-[16px] font-semibold text-ink">ข้อมูลดีมานด์ยังไม่พอ</p>
        <p class="mt-xs text-[14px] text-muted">
          ต้องมีประวัติการขายอย่างน้อย {{ recRounds }} รอบจึงจะแนะนำได้
        </p>
      </div>

      <!-- recommendation + apply CTA -->
      <div v-else class="mt-md">
        <ul class="mb-md space-y-xs text-[14px] text-ink">
          <li
            v-for="it in recItems"
            :key="it.varietyId"
            class="flex items-center justify-between"
          >
            <span>{{ it.varietyName }}</span>
            <span class="tabular text-muted">
              แนะนำ {{ it.recommendedPlants }} ต้น
              <span class="text-[12px]">(ดีมานด์ {{ it.demandPlants }} · รอด {{ it.survivalPct }}%)</span>
            </span>
          </li>
        </ul>
        <button
          type="button"
          class="h-10 rounded-md bg-accent px-lg text-[16px] font-semibold text-white"
          @click="applyRecommendation"
        >
          ใช้ค่านี้เติมในแผนปลูก
        </button>
      </div>
    </div>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดสูตรปลูกไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <!-- loading -->
    <div v-if="isLoading" class="space-y-md">
      <div v-for="n in 3" :key="n" class="h-24 animate-pulse rounded-lg bg-surface" />
    </div>

    <!-- empty -->
    <div
      v-else-if="list.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีสูตรปลูก</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        สร้างสูตรปลูกเพื่อสร้างแบตช์ของรอบใหม่ได้ในคลิกเดียว
      </p>
    </div>

    <!-- template cards -->
    <div v-else class="space-y-md">
      <div
        v-for="tpl in list"
        :key="tpl.id"
        class="rounded-lg border border-hairline bg-canvas p-lg"
      >
        <div class="mb-md flex items-start justify-between">
          <div>
            <h2 class="text-[20px] font-semibold text-ink">{{ tpl.name }}</h2>
            <p class="text-[14px] text-muted">
              {{ tpl.items.length }} ชนิด ·
              {{ tpl.items.reduce((s, i) => s + i.plantCount, 0) }} ต้น
            </p>
          </div>
          <button
            type="button"
            class="text-[14px] text-muted hover:text-ink"
            @click="openEdit(tpl)"
          >
            แก้ไขสูตร
          </button>
        </div>

        <ul class="mb-md space-y-xs text-[14px] text-ink">
          <li v-for="it in tpl.items" :key="it.id" class="flex justify-between">
            <span>{{ varietyName(it.varietyId) }}</span>
            <span class="tabular text-muted">{{ it.plantCount }} ต้น</span>
          </li>
        </ul>

        <button
          type="button"
          class="h-10 rounded-md bg-accent px-lg text-[16px] font-semibold text-white"
          @click="openSpawn(tpl)"
        >
          สร้างแบตช์จากสูตรปลูก
        </button>
      </div>
    </div>

    <!-- Recipe editor modal (create/edit) -->
    <div
      v-if="editorOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="editorOpen = false"
    >
      <form
        class="max-h-[90dvh] w-full max-w-[640px] overflow-y-auto rounded-lg border border-hairline bg-canvas p-xl"
        @submit.prevent="submitEditor"
      >
        <h2 class="mb-lg text-[20px] font-semibold">
          {{ editingId ? "แก้ไขสูตรปลูก" : "เพิ่มสูตรปลูก" }}
        </h2>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">ชื่อสูตร</span>
          <input
            v-model="nameInput"
            type="text"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          />
        </label>

        <div class="mb-md space-y-sm">
          <span class="block text-[14px] text-muted">พันธุ์ผัก + จำนวนต้น</span>
          <div v-for="(it, idx) in itemsInput" :key="idx" class="flex items-center gap-sm">
            <select
              v-model="it.varietyId"
              class="h-10 flex-1 rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
            >
              <option v-for="v in varieties ?? []" :key="v.id" :value="v.id">{{ v.name }}</option>
            </select>
            <input
              v-model.number="it.plantCount"
              type="number"
              min="0"
              class="h-10 w-28 rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
            />
            <button
              type="button"
              class="text-[14px] text-destructive hover:underline"
              @click="removeItem(idx)"
            >
              ลบ
            </button>
          </div>
          <button
            type="button"
            class="text-[14px] text-muted hover:text-ink"
            @click="addItem"
          >
            + เพิ่มชนิด
          </button>
        </div>

        <p v-if="editorError" class="mb-md text-[14px] text-destructive">{{ editorError }}</p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="editorOpen = false"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            :disabled="createTemplate.isPending.value || updateTemplate.isPending.value"
            class="h-10 rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
          >
            บันทึกสูตรปลูก
          </button>
        </div>
      </form>
    </div>

    <!-- Create-batches (spawn) modal -->
    <div
      v-if="spawnFor"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="spawnFor = null"
    >
      <form
        class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl"
        @submit.prevent="submitSpawn"
      >
        <h2 class="mb-lg text-[20px] font-semibold">สร้างแบตช์จากสูตรปลูก: {{ spawnFor.name }}</h2>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">วันปลูก (จันทร์)</span>
          <input
            v-model="spawnDate"
            type="date"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          />
        </label>

        <p
          v-if="spawnNotice"
          class="mb-md rounded-md bg-warning-surface px-sm py-sm text-[14px] text-warning"
        >
          {{ spawnNotice }}
        </p>
        <p
          v-else-if="spawnDone"
          class="mb-md rounded-md bg-positive-surface px-sm py-sm text-[14px] text-positive"
        >
          {{ spawnDone }}
        </p>
        <p v-if="spawnError" class="mb-md text-[14px] text-destructive">{{ spawnError }}</p>

        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="spawnFor = null"
          >
            ปิด
          </button>
          <button
            type="submit"
            :disabled="spawn.isPending.value"
            class="h-10 rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
          >
            สร้างแบตช์จากสูตรปลูก
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
