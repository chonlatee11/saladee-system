// Product-image server-state layer (04-04, D-26/27/28). TanStack Query composables
// wrapping the Eden /product-images endpoints (D-18): a product's gallery (cover +
// uploaded images), multi-image upload (multipart, reuses the sharp+R2 server
// pipeline), and delete (server blocks removing the last cover). The staff Bearer
// is attached from the session store — the server requireRole("owner","admin") is
// the authority; these headers just let the staff request through.
import { type MaybeRefOrGetter, toValue } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../api";
import { useSession } from "../stores/session";

/** Build the Authorization header for an authenticated product-image request. */
function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

export interface GalleryImage {
  id: string;
  url: string;
  sort: number;
}
export interface Gallery {
  cover: string | null;
  images: GalleryImage[];
}

/** A product's gallery (cover + additional images). Disabled until a variety is picked. */
export function useProductGallery(varietyId: MaybeRefOrGetter<string | null>) {
  return useQuery({
    queryKey: ["product-images", varietyId],
    enabled: () => !!toValue(varietyId),
    queryFn: async (): Promise<Gallery> => {
      const id = toValue(varietyId) as string;
      const { data, error } = await api["product-images"].get({
        query: { varietyId: id },
        headers: authHeaders(),
      });
      if (error) throw error;
      return data as Gallery;
    },
  });
}

/** Upload one or more images to a variety's gallery (sequential multipart POSTs). */
export function useUploadProductImages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { varietyId: string; files: File[] }) => {
      for (const file of input.files) {
        const { error } = await api["product-images"].post(
          { image: file, varietyId: input.varietyId },
          { headers: authHeaders() },
        );
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product-images"] }),
  });
}

/** Remove a gallery image (the server refuses to delete the product's last cover). */
export function useDeleteProductImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api["product-images"]({ id }).delete(
        {},
        { headers: authHeaders() },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product-images"] }),
  });
}
