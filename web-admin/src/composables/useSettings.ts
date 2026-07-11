// Settings server-state layer (03-12 / ADM-03, D-22). TanStack Query composables
// wrapping the Eden `settings` endpoints (D-18): read the hot config, and a
// mutation that upserts a partial patch then invalidates so the form re-reads the
// authoritative values. The staff Bearer is attached from the session store — the
// server requireRole("owner","admin") is the authority (D-19). SECURITY: this layer
// only ever moves the hot values (hold window, haircut %, B2B ceiling, delivery);
// no secret is ever fetched or sent (secrets are env-only, T-03-31).
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../api";
import { useSession } from "../stores/session";

/** Build the Authorization header for an authenticated settings request. */
function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

/** The hot settings the API returns / accepts (never any secret). */
export interface HotSettings {
  holdWindowSeconds: number;
  haircutDefaultPct: number;
  b2bQuotaCeilingPct: number;
  delivery: {
    zones: { id: string; nameTh: string; fees: Record<string, number | undefined> }[];
    freeShippingThresholdSatang: number;
    freeShippingMethods: string[];
  };
}

export type HotSettingsPatch = Partial<HotSettings>;

/** Read the current hot system config. */
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await api.settings.get({ headers: authHeaders() });
      if (error) throw error;
      return data as HotSettings;
    },
  });
}

/** Save a partial hot-config patch (no redeploy), then invalidate to re-read. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: HotSettingsPatch) => {
      const { data, error } = await api.settings.put(patch, { headers: authHeaders() });
      if (error) throw error;
      return data as HotSettings;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
