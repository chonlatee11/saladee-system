// Object storage slice (00-03, PLAT-02 / PLAT-03 groundwork).
// Bun-native S3Client wired to a PRIVATE Cloudflare R2 bucket, exposing
// short-TTL presign helpers. No AWS SDK (locked stack), no public-read ACL.
//
// Pitfall 6: the account-scoped endpoint below is REQUIRED — without it Bun's
// client would target AWS (s3.amazonaws.com) instead of R2.
// Pitfall 4: the bucket stays private; access is only ever granted through a
// short-lived presigned URL (default 300s), minted after the caller is checked.
// A1 (verified against Bun 1.3.14): the signature is `s3.presign(key, { method, expiresIn })`.
import { S3Client } from "bun";
import { Elysia } from "elysia";
import { env } from "../env";

// Private R2 client. Credentials come only from validated env (never literals,
// never logged — T-00-10). No `acl` / public-read is set anywhere (T-00-08).
const s3 = new S3Client({
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
});

export interface StorageClient {
  /** Presigned PUT URL for uploading `key`. Short TTL (default 300s). */
  presignPut(key: string, ttl?: number): string;
  /** Presigned GET URL for downloading `key`. Short TTL (default 300s). */
  presignGet(key: string, ttl?: number): string;
}

// Synchronous local signing (no network call). Method + short expiry only —
// no public capability is ever attached to the object.
export const storage: StorageClient = {
  presignPut: (key: string, ttl = 300) => s3.presign(key, { method: "PUT", expiresIn: ttl }),
  presignGet: (key: string, ttl = 300) => s3.presign(key, { method: "GET", expiresIn: ttl }),
};

// Keep the plugin name "storage" (00-01 contract); index.ts already composes it.
export const storagePlugin = new Elysia({ name: "storage" }).decorate("storage", storage);
