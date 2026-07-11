// Packing server-state layer (03-09). TanStack Query composables wrapping the Eden
// packing endpoints (D-20/21): the pack queue grouped by round → route, the
// mark-packed mutation (invalidates the queue so the pack badge flips), and the
// pack/label PDF downloads. Queries throw on the Eden `error` channel so the view
// surfaces loading/error; the staff Bearer is attached from the session store —
// the server requireRole("owner","admin","packer") is the authority (D-19).
//
// The PDF endpoints are packer-gated (they carry customer addresses, PDPA T-03-24),
// so they CANNOT be opened as a bare <a href> (no Authorization header on a tab
// navigation). Instead we fetch them with the Bearer, get the Blob, and open an
// object URL — the browser renders/downloads the PDF with the auth check honoured.
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, type Ref } from "vue";
import { api } from "../api";
import { useSession } from "../stores/session";

const API_URL = import.meta.env?.VITE_API_URL ?? "http://localhost:3000";

/** Build the Authorization header for an authenticated packing request. */
function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** All rounds (open + closed) — feeds the round selector above the queue. */
export function useRounds() {
  return useQuery({
    queryKey: ["rounds"],
    queryFn: async () => {
      const { data, error } = await api.rounds.get();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * The pack queue for a round: paid orders grouped by round → route
 * (deliveryMethod/deliveryZone), each order carrying its pack state (D-20). Only
 * runs once a round is chosen.
 */
export function usePackingQueue(roundId: Ref<string | undefined>) {
  return useQuery({
    queryKey: ["packing", "queue", roundId],
    enabled: computed(() => Boolean(roundId.value)),
    queryFn: async () => {
      const { data, error } = await api.packing.queue.get({
        query: { roundId: roundId.value },
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** Mark one order packed (sets packed_at); invalidates the queue so the badge flips. */
export function useMarkPacked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await api
        .packing({ orderId })
        .packed.patch({}, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["packing", "queue"] }),
  });
}

// ── PDF downloads (Bearer fetch → Blob → object URL) ──────────────────────────

/** Fetch a packer-gated PDF with the Bearer, then open it in a new tab. */
async function openPdf(path: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("pdf_failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  // Release the object URL after the tab has had time to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Open the pack slip (picking sheet) for a round. */
export function openPackSlip(roundId: string): Promise<void> {
  return openPdf(`/packing/pack-slip.pdf?roundId=${encodeURIComponent(roundId)}`);
}

/** Open the label slip (per-parcel address) for one order. */
export function openLabelSlip(orderId: string): Promise<void> {
  return openPdf(`/packing/label-slip.pdf?orderId=${encodeURIComponent(orderId)}`);
}
