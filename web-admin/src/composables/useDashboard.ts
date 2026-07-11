// Dashboard server-state (03-10 / ADM-01, D-23). One TanStack Query wrapping the
// staff-gated Eden GET /dashboard — the whole 5-card summary in a single fetch.
// The query throws on the Eden `error` channel so the view surfaces loading/error;
// the staff Bearer is attached from the session store (the server requireRole is
// the real authority — D-19). roundId is omitted so the server picks the latest
// open round; passing one lets the owner pin a specific round later.
import { useQuery } from "@tanstack/vue-query";
import { api } from "../api";
import { useSession } from "../stores/session";

/** Build the Authorization header for an authenticated staff request. */
function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

/** The at-a-glance owner dashboard summary (5 cards). */
export function useDashboard(roundId?: string) {
  return useQuery({
    queryKey: ["dashboard", roundId ?? "current"],
    queryFn: async () => {
      const { data, error } = await api.dashboard.get({
        query: roundId ? { roundId } : {},
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
  });
}
