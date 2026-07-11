// Subscription server-state layer (03-07). TanStack Query composables wrapping the
// Eden subscriptions endpoints (D-18): the admin roster + the pause/resume/cancel
// mutations. Queries throw on the Eden `error` channel so the view surfaces
// loading/error; every mutation invalidates the roster key so the table re-fetches.
// The staff Bearer is attached from the session store — the server (owner/admin
// guard + ownership check) is the authority; these headers just let staff through.
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../api";
import { useSession } from "../stores/session";

/** Build the Authorization header for an authenticated subscriptions request. */
function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

const ROSTER_KEY = ["subscriptions", "roster"];

/** The full subscription roster (member · package · frequency · latest round). */
export function useSubscriptions() {
  return useQuery({
    queryKey: ROSTER_KEY,
    queryFn: async () => {
      const { data, error } = await api.subscriptions.get({ headers: authHeaders() });
      if (error) throw error;
      return data;
    },
  });
}

/** Pause a subscription (takes effect next round, D-14). */
export function usePauseSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api
        .subscriptions({ id })
        .pause.post({}, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ROSTER_KEY }),
  });
}

/** Resume a paused subscription. */
export function useResumeSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api
        .subscriptions({ id })
        .resume.post({}, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ROSTER_KEY }),
  });
}

/** Cancel a subscription (destructive — the next round will not be generated, D-14). */
export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api
        .subscriptions({ id })
        .cancel.post({}, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ROSTER_KEY }),
  });
}
