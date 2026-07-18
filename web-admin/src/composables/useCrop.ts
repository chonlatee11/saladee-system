// Crop-planning server-state layer (03-04). TanStack Query composables wrapping
// the Eden crop endpoints (D-18) — queries throw on the Eden `error` channel so
// the views surface loading/error states, and every mutation invalidates the
// affected query key so the tables/forms re-fetch fresh after a write. The staff
// Bearer is attached from the session store (the server requireRole is the
// authority — these headers just let the grower's request through, D-19).
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../api";
import { useSession } from "../stores/session";

/** Build the Authorization header for an authenticated crop request. */
function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

/** Variety yield parameters saved by the CROP-01 form. */
export interface VarietyParams {
  daysToHarvest: number;
  survivalPct: number;
  harvestWindowDays: number;
  shelfLifeDays: number;
}

/** One recipe line of a planting-mix template. */
export interface MixItemInput {
  varietyId: string;
  plantCount: number;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Public catalog of varieties (used to pick a variety in forms/dropdowns). */
export function useVarieties() {
  return useQuery({
    queryKey: ["varieties"],
    queryFn: async () => {
      const { data, error } = await api.varieties.get();
      if (error) throw error;
      return data;
    },
  });
}

/** Planting batches with server-computed harvest date + expected plants. */
export function usePlantingBatches() {
  return useQuery({
    queryKey: ["crop", "planting-batches"],
    queryFn: async () => {
      const { data, error } = await api.crop["planting-batches"].get({
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
  });
}

/** One per-variety line of the demand-driven planting recommendation (CROP-07). */
export interface RecommendationItem {
  varietyId: string;
  varietyName: string;
  survivalPct: number;
  demandPlants: number;
  recommendedPlants: number;
}

/** The demand recommendation payload (CROP-07). `noData` drives the empty state. */
export interface PlantingRecommendation {
  noData: boolean;
  nRounds: number;
  roundsConsidered: number;
  items: RecommendationItem[];
}

/**
 * Demand-driven per-variety planting recommendation (CROP-07). On-demand compute:
 * trailing realised sales + unmet demand run through the survival-haircut inverse.
 * The admin applies it as a PREFILL of the mix editor (D-25 — never auto-committed).
 */
export function usePlantingRecommendation() {
  return useQuery({
    queryKey: ["crop", "planting-recommendation"],
    queryFn: async () => {
      const { data, error } = await api.crop["planting-recommendation"].get({
        headers: authHeaders(),
      });
      if (error) throw error;
      return data as PlantingRecommendation;
    },
  });
}

/** Planting-mix templates with their recipe items. */
export function useMixTemplates() {
  return useQuery({
    queryKey: ["crop", "mix-templates"],
    queryFn: async () => {
      const { data, error } = await api.crop["mix-templates"].get({
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** Save the yield params of one variety (CROP-01). */
export function useSaveVarietyParams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; params: VarietyParams }) => {
      const { data, error } = await api.crop
        .varieties({ id: input.id })
        .params.put(input.params, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["varieties"] }),
  });
}

/** Record a new planting batch (CROP-02). */
export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      varietyId: string;
      plantDate: string;
      plantCount: number;
      bed?: string | null;
    }) => {
      const { data, error } = await api.crop["planting-batches"].post(input, {
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crop", "planting-batches"] }),
  });
}

/** Edit an existing planting batch. */
export function useUpdateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      plantDate?: string;
      plantCount?: number;
      bed?: string | null;
    }) => {
      const { id, ...patch } = input;
      const { data, error } = await api.crop["planting-batches"]({ id }).patch(patch, {
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crop", "planting-batches"] }),
  });
}

/** Delete a planting batch (hard delete — batches only feed forecast compute). */
export function useDeleteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.crop["planting-batches"]({ id }).delete(
        {},
        { headers: authHeaders() },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crop", "planting-batches"] }),
  });
}

/** Create a reusable planting-mix template (recipe). */
export function useCreateMixTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; items: MixItemInput[] }) => {
      const { data, error } = await api.crop["mix-templates"].post(input, {
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crop", "mix-templates"] }),
  });
}

/** Edit a mix template's name and/or recipe items. */
export function useUpdateMixTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; items?: MixItemInput[] }) => {
      const { id, ...patch } = input;
      const { data, error } = await api.crop["mix-templates"]({ id }).patch(patch, {
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crop", "mix-templates"] }),
  });
}

/** One-click spawn of this week's batches from a mix template (D-06). */
export function useCreateBatchesFromMix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; plantDate: string }) => {
      const { data, error } = await api.crop["mix-templates"]({ id: input.id })[
        "create-batches"
      ].post({ plantDate: input.plantDate }, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crop", "planting-batches"] }),
  });
}
