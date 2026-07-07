// B2B server-state layer (03-06). TanStack Query composables wrapping the Eden
// b2b endpoints (D-18): approval (approve/reject/credit-terms), the B2B customer
// roster, standing-order CRUD, and the unresolved overflow flags. Queries throw on
// the Eden `error` channel so views surface loading/error; every mutation
// invalidates the affected key so tables re-fetch fresh. The staff Bearer is
// attached from the session store — the server requireRole("owner","admin") is the
// authority (D-19); these headers just let the staff request through.
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../api";
import { useSession } from "../stores/session";

/** Build the Authorization header for an authenticated b2b request. */
function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

/** One standing-order basket line. */
export interface StandingItemInput {
  varietyId: string;
  plantsPerRound: number;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** The full B2B roster (pending/approved/rejected) for the approvals screen. */
export function useB2bCustomers() {
  return useQuery({
    queryKey: ["b2b", "customers"],
    queryFn: async () => {
      const { data, error } = await api.b2b.customers.get({ headers: authHeaders() });
      if (error) throw error;
      return data;
    },
  });
}

/** Standing orders with their basket items. */
export function useStandingOrders() {
  return useQuery({
    queryKey: ["b2b", "standing-orders"],
    queryFn: async () => {
      const { data, error } = await api.b2b["standing-orders"].get({ headers: authHeaders() });
      if (error) throw error;
      return data;
    },
  });
}

/** Unresolved quota-overflow flags (standing demand > forecast) — admin warnings. */
export function useOverflowFlags() {
  return useQuery({
    queryKey: ["b2b", "overflow-flags"],
    queryFn: async () => {
      const { data, error } = await api.b2b["overflow-flags"].get({ headers: authHeaders() });
      if (error) throw error;
      return data;
    },
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** Approve a B2B account (→ wholesale prices become visible, D-08). */
export function useApproveB2b() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.b2b({ id }).approve.post({}, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["b2b", "customers"] }),
  });
}

/** Reject a B2B account (destructive — the customer will not see wholesale prices). */
export function useRejectB2b() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.b2b({ id }).reject.post({}, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["b2b", "customers"] }),
  });
}

/** Save free-text credit terms on a B2B account (D-11, no credit-limit blocking). */
export function useSaveCreditTerms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; creditTerms: string | null }) => {
      const { data, error } = await api
        .b2b({ id: input.id })
        ["credit-terms"].patch({ creditTerms: input.creditTerms }, { headers: authHeaders() });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["b2b", "customers"] }),
  });
}

/** Create a standing order + its basket for an approved customer (CUST-05). */
export function useCreateStandingOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { customerId: string; items: StandingItemInput[] }) => {
      const { data, error } = await api.b2b["standing-orders"].post(input, {
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["b2b", "standing-orders"] }),
  });
}

/** Edit a standing order (active flag and/or replace its basket). */
export function useUpdateStandingOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; active?: boolean; items?: StandingItemInput[] }) => {
      const { id, ...patch } = input;
      const { data, error } = await api.b2b["standing-orders"]({ id }).patch(patch, {
        headers: authHeaders(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["b2b", "standing-orders"] }),
  });
}

/** Cancel a standing order (soft-delete active=false). */
export function useCancelStandingOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.b2b["standing-orders"]({ id }).delete(
        {},
        { headers: authHeaders() },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["b2b", "standing-orders"] }),
  });
}
