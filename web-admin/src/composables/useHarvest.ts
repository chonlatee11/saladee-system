// Harvest server-state layer (03-05). TanStack Query composables wrapping the Eden
// harvest endpoints: the round harvest calendar (draft/published/manual-override per
// variety), the publish action (round-open orchestrator — reserves standing in-tx +
// fires subscription-generate post-commit, server-side), the manual sellable-qty
// override (D-03, kept permanently), and the actual-harvest log (1 batch = 1 lot,
// auto lot/best-before + delta). Queries throw on the Eden `error` channel so views
// surface loading/error; every mutation invalidates the affected key so the
// calendar/log re-fetch fresh. The staff Bearer is attached from the session store —
// the server requireRole("owner","admin","grower") is the authority (D-19).
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, type Ref, unref } from "vue";
import { api } from "../api";
import { useSession } from "../stores/session";

/** Build the Authorization header for an authenticated harvest request. */
function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Sale rounds (open reads) — used to pick which round's calendar to review. */
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

/** The harvest calendar for one round: draft + published + manual-override per variety. */
export function useHarvestCalendar(roundId: Ref<string | null> | string | null) {
  const rid = computed(() => unref(roundId));
  return useQuery({
    queryKey: ["harvest", "calendar", rid],
    enabled: computed(() => !!rid.value),
    queryFn: async () => {
      const { data, error } = await api.harvest.calendar.get({
        query: { roundId: rid.value as string },
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
  });
}

/** The logged-harvest history (confirmed lots + actual-vs-forecast delta). */
export function useHarvestLogs() {
  return useQuery({
    queryKey: ["harvest", "logs"],
    queryFn: async () => {
      const { data, error } = await api.harvest.logs.get({ headers: authHeaders() });
      if (error) throw error;
      return data;
    },
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** Publish sellable qty for a round (D-03 gate) — the round-open orchestrator. */
export function usePublishQuota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (roundId: string) => {
      const { data, error } = await api.harvest.publish.post(
        { roundId },
        { headers: authHeaders() },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["harvest", "calendar"] }),
  });
}

/** Manually override the sellable qty of a (round, variety) — kept permanently (D-03). */
export function useOverrideQuota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { roundId: string; varietyId: string; quotaPlants: number }) => {
      const { data, error } = await api.harvest.quota.patch(input, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["harvest", "calendar"] }),
  });
}

/** Log an actual harvest (1 batch = 1 lot) — returns lot/best-before + delta. */
export function useLogHarvest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      batchId: string;
      harvestedAt: string;
      actualPlants: number;
      actualGrams: number;
      wasteGrams?: number;
    }) => {
      const { data, error } = await api.harvest.logs.post(input, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["harvest", "logs"] });
      qc.invalidateQueries({ queryKey: ["crop", "planting-batches"] });
    },
  });
}
