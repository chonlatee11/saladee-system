<script setup lang="ts">
// Product images (04-04, D-26/27/28 / ORD-05). The staff picks a product, uploads
// real photos through the SAME sharp+R2 pipeline as the Phase-2 SlipUploader (the
// server compresses + stores them on a public marketing path), and manages the
// gallery (cover + additional images). Removing an image opens the shared
// destructive-confirm modal ("ลบรูปนี้ออกจากสินค้า?" / confirm "ลบรูป"); the last
// remaining cover cannot be removed — the server blocks it and the UI mirrors the
// rule. Accent is reserved for the single primary upload CTA (UI-SPEC).
import { computed, ref } from "vue";
import { useVarieties } from "../composables/useCrop";
import {
  type GalleryImage,
  useDeleteProductImage,
  useProductGallery,
  useUploadProductImages,
} from "../composables/useProductImages";

interface VarietyOption {
  id: string;
  name: string;
}

const { data: varieties, isLoading: varietiesLoading } = useVarieties();
const options = computed<VarietyOption[]>(
  () => (varieties.value ?? []) as unknown as VarietyOption[],
);

const selectedId = ref<string | null>(null);
const selectedName = computed(
  () => options.value.find((v) => v.id === selectedId.value)?.name ?? "",
);

const { data: gallery, isLoading: galleryLoading } = useProductGallery(selectedId);
const upload = useUploadProductImages();
const removeImage = useDeleteProductImage();

// The legacy cover (if any) + uploaded rows back the product's gallery.
const coverUrl = computed(() => gallery.value?.cover ?? null);
const images = computed<GalleryImage[]>(() => gallery.value?.images ?? []);
// Mirror the server rule: an image is the "last cover" when no separate legacy
// cover exists and it is the only gallery row — removal is blocked.
const isLastCover = computed(() => !coverUrl.value && images.value.length <= 1);

const fileInput = ref<HTMLInputElement | null>(null);
const uploadError = ref<string | null>(null);

function pick(): void {
  fileInput.value?.click();
}

async function onFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = ""; // allow re-picking the same file
  if (!selectedId.value || files.length === 0) return;
  uploadError.value = null;
  try {
    await upload.mutateAsync({ varietyId: selectedId.value, files });
  } catch {
    uploadError.value = "อัปโหลดรูปไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}

// ── Remove-confirm modal (destructive) ───────────────────────────────────────
const removeTarget = ref<GalleryImage | null>(null);
const removeError = ref<string | null>(null);

async function confirmRemove(): Promise<void> {
  if (!removeTarget.value) return;
  removeError.value = null;
  try {
    await removeImage.mutateAsync(removeTarget.value.id);
    removeTarget.value = null;
  } catch (e) {
    // The server refuses to delete a product's last cover (409).
    const code = (e as { value?: { error?: string } })?.value?.error;
    removeError.value =
      code === "cannot_delete_last_cover"
        ? "ลบไม่ได้ — นี่คือรูปปกสุดท้ายของสินค้า"
        : "ลบรูปไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
</script>

<template>
  <section class="max-w-[720px]">
    <h1 class="mb-lg text-[28px] font-semibold">รูปสินค้า</h1>

    <!-- product picker -->
    <label class="mb-lg block">
      <span class="mb-xs block text-[14px] font-semibold text-ink">เลือกสินค้า</span>
      <select
        v-model="selectedId"
        class="h-11 w-full rounded-md border border-hairline bg-canvas px-md text-[16px] text-ink"
        :disabled="varietiesLoading"
      >
        <option :value="null" disabled>— เลือกผักสลัด —</option>
        <option v-for="v in options" :key="v.id" :value="v.id">{{ v.name }}</option>
      </select>
    </label>

    <template v-if="selectedId">
      <div class="mb-md flex items-center justify-between">
        <h2 class="text-[18px] font-semibold text-ink">แกลเลอรีของ "{{ selectedName }}"</h2>
        <!-- the ONE primary CTA carries the accent (UI-SPEC) -->
        <button
          type="button"
          class="min-h-[44px] rounded-lg bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-40"
          :disabled="upload.isPending.value"
          @click="pick"
        >
          {{ upload.isPending.value ? "กำลังอัปโหลด…" : "อัปโหลดรูปสินค้า" }}
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          @change="onFiles"
        />
      </div>

      <p v-if="uploadError" class="mb-md text-[14px] text-destructive">{{ uploadError }}</p>
      <p v-if="removeError" class="mb-md text-[14px] text-destructive">{{ removeError }}</p>

      <!-- empty state -->
      <div
        v-if="!galleryLoading && !coverUrl && images.length === 0"
        class="rounded-lg border border-hairline bg-canvas p-2xl text-center"
      >
        <p class="text-[18px] font-semibold text-ink">ยังไม่มีรูปสินค้า</p>
        <p class="mt-xs text-[14px] text-muted">อัปโหลดรูปสินค้าเพื่อแสดงในหน้าร้าน</p>
      </div>

      <!-- gallery grid: cover first, then uploaded images -->
      <div v-else class="grid grid-cols-2 gap-md sm:grid-cols-3">
        <div
          v-if="coverUrl"
          class="relative overflow-hidden rounded-lg border border-hairline bg-canvas"
        >
          <img :src="coverUrl" alt="รูปปก" class="aspect-square w-full object-cover" />
          <span
            class="absolute left-1 top-1 rounded-full bg-positive-surface px-sm py-[2px] text-[12px] font-semibold text-positive"
          >
            รูปปก
          </span>
        </div>
        <div
          v-for="(img, i) in images"
          :key="img.id"
          class="relative overflow-hidden rounded-lg border border-hairline bg-canvas"
        >
          <img
            :src="img.url"
            :alt="`รูปสินค้า ${i + 1}`"
            class="aspect-square w-full object-cover"
          />
          <span
            v-if="!coverUrl && i === 0"
            class="absolute left-1 top-1 rounded-full bg-positive-surface px-sm py-[2px] text-[12px] font-semibold text-positive"
          >
            รูปปก
          </span>
          <button
            type="button"
            :disabled="isLastCover"
            class="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-[16px] font-semibold text-white disabled:opacity-30"
            :title="isLastCover ? 'ลบรูปปกสุดท้ายไม่ได้' : 'ลบรูปนี้'"
            @click="removeTarget = img"
          >
            ×
          </button>
        </div>
      </div>
    </template>

    <!-- empty picker state -->
    <div v-else class="rounded-lg border border-hairline bg-canvas p-2xl text-center">
      <p class="text-[18px] font-semibold text-ink">เลือกสินค้าเพื่อจัดการรูป</p>
      <p class="mt-xs text-[14px] text-muted">อัปโหลดรูปสินค้าเพื่อแสดงในหน้าร้าน</p>
    </div>

    <!-- Remove-confirm modal (destructive confirm on the right, neutral dismiss left) -->
    <div
      v-if="removeTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="removeTarget = null"
    >
      <div class="w-full max-w-[420px] rounded-lg border border-hairline bg-canvas p-xl">
        <h2 class="mb-md text-[20px] font-semibold">ลบรูปนี้ออกจากสินค้า?</h2>
        <img
          :src="removeTarget.url"
          alt="รูปที่จะลบ"
          class="mb-lg aspect-square w-full max-w-[160px] rounded-md object-cover"
        />
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="removeTarget = null"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            :disabled="removeImage.isPending.value"
            class="h-10 rounded-md bg-destructive px-lg text-[16px] font-semibold text-white disabled:opacity-60"
            @click="confirmRemove"
          >
            ลบรูป
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
