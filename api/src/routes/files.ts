// Object-storage routes (00-03, PLAT-02): mint short-lived presigned URLs for
// uploading and downloading objects in the PRIVATE R2 bucket. The bucket is
// never public — access is only ever a time-boxed (300s) presigned URL.
//
// Signing is delegated to the storage plugin (storage.presignPut/presignGet);
// this route never hand-rolls SigV4. Untrusted keys are validated before signing
// (T-00-09 / V12: reject traversal and absolute keys).
import { Elysia, t } from "elysia";
import { storagePlugin } from "../plugins/storage.plugin";

// Presign TTL (seconds). Short-lived by design (Pitfall 4).
const PRESIGN_TTL = 300;

/**
 * Guard untrusted object keys before they reach the signer.
 * Rejects empty keys, absolute keys (leading `/`), backslashes, and any `..`
 * path-traversal segment. Returns true when the key is safe to sign.
 */
export function isSafeKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0) return false;
  if (key.startsWith("/")) return false;
  if (key.includes("\\")) return false;
  // Reject a `..` segment anywhere (start, middle, or end).
  const segments = key.split("/");
  if (segments.some((s) => s === "..")) return false;
  return true;
}

export const filesRoutes = new Elysia()
  // `storage` decoration (name "storage" — deduped with index.ts composition).
  .use(storagePlugin)
  // Mint a presigned PUT URL for a client-chosen key (short TTL, private bucket).
  .post(
    "/files/presign",
    ({ storage, body, set }) => {
      if (!isSafeKey(body.key)) {
        set.status = 400;
        return { error: "invalid key" };
      }
      return { url: storage.presignPut(body.key, PRESIGN_TTL) };
    },
    // Schema accepts any string; the key *policy* (empty/traversal/absolute) is
    // enforced by isSafeKey so it returns a consistent 400 for all bad keys.
    { body: t.Object({ key: t.String() }) },
  )
  // Mint a presigned GET URL for a single-segment key.
  .get("/files/:key/url", ({ storage, params, set }) => {
    if (!isSafeKey(params.key)) {
      set.status = 400;
      return { error: "invalid key" };
    }
    return { url: storage.presignGet(params.key, PRESIGN_TTL) };
  });
