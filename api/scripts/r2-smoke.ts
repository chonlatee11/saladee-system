#!/usr/bin/env bun
// R2 live smoke test — Criterion 3 (00-07): real signed-URL upload → download
// round-trip against the REAL private Cloudflare R2 bucket, plus a check that an
// UNSIGNED request is denied (Pitfall 4: the bucket must be private).
//
// It exercises the SAME presign helpers the app uses (api/src/plugins/storage.plugin.ts),
// so a pass here proves the production code path — not a throwaway.
//
// Usage (from the api/ directory, so Bun auto-loads api/.env):
//     cd api
//     cp .env.test .env            # then edit .env with your REAL Neon/R2/LINE values
//     bun run scripts/r2-smoke.ts
//
// Requirements in api/.env:
//     R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET  (real values)
//     R2_ENDPOINT must be UNSET (leave it out) so the real account-scoped R2 endpoint is used.
//
// Exit code 0 = all checks passed; non-zero = a check failed (details printed).

import { S3Client } from "bun";
import { env } from "../src/env";
// `storage` is the exact helper the /files routes use — this is what we are verifying.
import { storage } from "../src/plugins/storage.plugin";

function fail(msg: string): never {
  console.error(`\n❌ FAIL: ${msg}`);
  process.exit(1);
}

// Guard: we want the REAL R2 endpoint, not a MinIO/local override.
if (process.env.R2_ENDPOINT) {
  fail(
    `R2_ENDPOINT is set to "${process.env.R2_ENDPOINT}". Unset it so the smoke test targets real R2 ` +
      `(account-scoped endpoint https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com).`,
  );
}

// Never print secret values — only names/lengths.
console.log("R2 live smoke test");
console.log(`  account: ${env.R2_ACCOUNT_ID}`);
console.log(`  bucket:  ${env.R2_BUCKET}`);
console.log(`  endpoint: https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);

const key = `smoke/roundtrip-${Date.now()}.txt`;
// Non-ASCII payload to catch any encoding surprises end-to-end.
const payload = `saladee r2 smoke สวัสดีจากสวนสลัด ${Date.now()}`;
const payloadBytes = new TextEncoder().encode(payload);

// A private S3Client (same creds) used ONLY for cleanup delete at the end —
// the round-trip itself goes through the presigned URLs.
const cleanupClient = new S3Client({
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
});

let uploaded = false;
try {
  // 1) Upload via a presigned PUT (short TTL).
  const putUrl = storage.presignPut(key, 300);
  const putRes = await fetch(putUrl, {
    method: "PUT",
    body: payloadBytes,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
  if (!putRes.ok) fail(`presigned PUT returned ${putRes.status} ${putRes.statusText}`);
  uploaded = true;
  console.log(`  ✓ [1/3] presigned PUT upload OK (key=${key})`);

  // 2) Download via a presigned GET and assert bytes round-trip exactly.
  const getUrl = storage.presignGet(key, 300);
  const getRes = await fetch(getUrl);
  if (!getRes.ok) fail(`presigned GET returned ${getRes.status} ${getRes.statusText}`);
  const got = await getRes.text();
  if (got !== payload) {
    fail(`downloaded bytes differ from uploaded.\n  expected: ${payload}\n  got:      ${got}`);
  }
  console.log("  ✓ [2/3] presigned GET download OK — bytes match");

  // 3) Unsigned request must be denied (bucket is private — Pitfall 4).
  const unsignedUrl = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`;
  const unsignedRes = await fetch(unsignedUrl);
  if (unsignedRes.ok) {
    fail(
      `UNSIGNED GET returned ${unsignedRes.status} — the object is publicly readable! ` +
        `The bucket must be PRIVATE (no public access).`,
    );
  }
  console.log(`  ✓ [3/3] unsigned GET correctly denied (${unsignedRes.status})`);

  console.log("\n✅ PASS — Criterion 3 (real R2 signed-URL round-trip) verified.");
} finally {
  if (uploaded) {
    try {
      await cleanupClient.delete(key);
      console.log(`  · cleaned up test object ${key}`);
    } catch (e) {
      console.warn(`  · warning: could not delete test object ${key}: ${(e as Error).message}`);
    }
  }
}
