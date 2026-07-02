// Criterion 3 — object-storage round-trip via short-lived signed URLs (00-03).
//
// Proven against MinIO (S3-compatible, tests/docker-compose.minio.yml) so this
// runs in CI without a real Cloudflare R2 account. The SAME code path exercises
// prod R2: only the endpoint differs (R2_ENDPOINT override → account-scoped
// endpoint in prod; Pitfall 6 pattern preserved).
//
// We set R2_ENDPOINT to the local MinIO BEFORE importing the app, so the storage
// plugin's S3Client (built at import) signs URLs that target MinIO. The app is
// therefore imported dynamically inside beforeAll, after the override is in place.
import { beforeAll, describe, expect, test } from "bun:test";

const MINIO_ENDPOINT = "http://localhost:9000";
// Must run before the dynamic import of ../src/index below.
process.env.R2_ENDPOINT = MINIO_ENDPOINT;

const BUCKET = process.env.R2_BUCKET ?? "saladee-uploads-test";

type Handler = { handle: (req: Request) => Promise<Response> };
let app: Handler;

async function presignPut(key: string): Promise<Response> {
  return app.handle(
    new Request("http://localhost/files/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    }),
  );
}

async function presignPutUrl(key: string): Promise<string> {
  const res = await presignPut(key);
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  return url;
}

async function presignGetUrl(key: string): Promise<string> {
  const res = await app.handle(
    new Request(`http://localhost/files/${encodeURIComponent(key)}/url`),
  );
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  return url;
}

// Wait until MinIO is up AND the private bucket exists by retrying a real
// presigned PUT (covers container boot + one-shot bucket creation).
async function waitReady(timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  let lastErr = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const url = await presignPutUrl(`__ready_${crypto.randomUUID()}`);
      const r = await fetch(url, { method: "PUT", body: new Uint8Array([1]) });
      if (r.ok) return;
      lastErr = `PUT ${r.status}`;
    } catch (e) {
      lastErr = String(e);
    }
    await Bun.sleep(500);
  }
  throw new Error(`MinIO/bucket not ready within ${timeoutMs}ms (last: ${lastErr})`);
}

beforeAll(async () => {
  ({ app } = (await import("../src/index")) as unknown as { app: Handler });
  await waitReady();
});

describe("object storage — presigned round-trip (Criterion 3)", () => {
  test("presigned PUT uploads, then presigned GET downloads identical bytes", async () => {
    const key = `round-trip-${crypto.randomUUID()}.bin`;
    const payload = new TextEncoder().encode(`hello saladee ${crypto.randomUUID()}`);

    const putUrl = await presignPutUrl(key);
    // The signed URL targets the account/endpoint-scoped host, not AWS (Pitfall 6).
    expect(putUrl.startsWith(`${MINIO_ENDPOINT}/${BUCKET}/`)).toBe(true);
    expect(putUrl).toContain("X-Amz-Signature=");
    expect(putUrl).toContain("X-Amz-Expires=300");

    const putRes = await fetch(putUrl, { method: "PUT", body: payload });
    expect(putRes.status).toBeGreaterThanOrEqual(200);
    expect(putRes.status).toBeLessThan(300);

    const getUrl = await presignGetUrl(key);
    const getRes = await fetch(getUrl);
    expect(getRes.status).toBe(200);
    const got = new Uint8Array(await getRes.arrayBuffer());
    expect(got).toEqual(payload);
  });

  test("unsigned GET of the object is rejected — bucket stays private (Pitfall 4)", async () => {
    const key = `private-${crypto.randomUUID()}.bin`;
    const payload = new TextEncoder().encode("secret slip bytes");

    const putUrl = await presignPutUrl(key);
    const putRes = await fetch(putUrl, { method: "PUT", body: payload });
    expect(putRes.ok).toBe(true);

    // Same object path, but WITHOUT the signature query string.
    const unsigned = `${MINIO_ENDPOINT}/${BUCKET}/${key}`;
    const res = await fetch(unsigned);
    expect([401, 403]).toContain(res.status);
  });

  test("presign rejects path-traversal / absolute keys (T-00-09 / V12)", async () => {
    for (const bad of ["../etc/passwd", "/abs/key", "a/../../b", ""]) {
      const res = await presignPut(bad);
      expect(res.status).toBe(400);
    }
  });
});
