<script setup lang="ts">
// Slip uploader (02-08 / UI-SPEC pay states). The customer picks a PromptPay transfer
// slip image; this component POSTs it to /orders/:id/slip (02-06) and emits a
// NORMALIZED result the pay screen renders (paid · awaiting-review · rejected-per-reason).
//
// The api response is mapped here so the pay screen never touches HTTP codes:
//   200 {status:"paid"}            → { status: "paid" }
//   202 {status:"awaiting_review"} → { status: "review" }   (D-04, verifier unavailable)
//   409 duplicate / duplicate_slip → { status:"rejected", reason:"duplicate" }   (D-06)
//   422 wrong_amount / wrong_payee → { status:"rejected", reason:"wrong_amount|wrong_payee" }
//   anything else                  → { status:"rejected", reason:"other" }
//
// The `uploader` is injectable so the pay screen (or a test) can drive the states
// without a live api. Money/keys never touch the client — only the image file is sent.
import { ref } from "vue";
import { api } from "../api";

export type SlipRejectReason = "duplicate" | "wrong_amount" | "wrong_payee" | "other";
export interface SlipResult {
  status: "paid" | "review" | "rejected";
  reason?: SlipRejectReason;
}

const props = defineProps<{
  orderId: string;
  label?: string;
  uploader?: (orderId: string, file: File) => Promise<SlipResult>;
}>();
const emit = defineEmits<{
  (e: "uploading"): void;
  (e: "result", result: SlipResult): void;
}>();

// Default uploader → POST /orders/:id/slip (multipart). Maps the response + error body
// to a normalized SlipResult.
const defaultUploader = async (orderId: string, file: File): Promise<SlipResult> => {
  const res = await (
    api.orders as unknown as (p: { id: string }) => {
      slip: {
        post: (b: { slip: File }) => Promise<{
          data: { status?: string } | null;
          error: { value?: { error?: string } } | null;
        }>;
      };
    }
  )({ id: orderId }).slip.post({ slip: file });
  if (res.data?.status === "paid") return { status: "paid" };
  if (res.data?.status === "awaiting_review") return { status: "review" };
  const code = res.error?.value?.error ?? "other";
  if (code === "duplicate" || code === "duplicate_slip")
    return { status: "rejected", reason: "duplicate" };
  if (code === "wrong_amount") return { status: "rejected", reason: "wrong_amount" };
  if (code === "wrong_payee") return { status: "rejected", reason: "wrong_payee" };
  return { status: "rejected", reason: "other" };
};

const fileInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);

function pick(): void {
  fileInput.value?.click();
}

async function onChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  busy.value = true;
  emit("uploading");
  const upload = props.uploader ?? defaultUploader;
  const result = await upload(props.orderId, file).catch(
    () => ({ status: "rejected", reason: "other" }) as SlipResult,
  );
  busy.value = false;
  input.value = ""; // allow re-picking the same file (replace flow)
  emit("result", result);
}
</script>

<template>
  <div class="flex flex-col gap-sm">
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onChange"
    />
    <button
      type="button"
      class="flex min-h-[48px] items-center justify-center rounded-lg bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-40"
      :disabled="busy"
      @click="pick"
    >
      {{ label ?? "อัปโหลดสลิปการโอน" }}
    </button>
  </div>
</template>
