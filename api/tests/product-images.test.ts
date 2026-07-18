// 04-04 (D-26/27/28 / ORD-05 / T-04-12/T-04-13) — admin product-image upload.
//
// Pins the security-critical upload contract of POST/GET/DELETE /product-images
// raced against the REAL PostgreSQL 17 container (:55432) through the
// makeProductImagesRoutes(db, deps) DI factory (compress + putImage injected so
// the test never touches sharp or a live R2):
//   - an image > 5 MiB is rejected (413) BEFORE compress/R2 (T-04-12 DoS bound)
//   - a non-admin token is refused 403 (admin-only surface)
//   - upload persists a variety_images row under a SERVER-ASSIGNED key
//     (`product-images/varieties/<id>/<uuid>.jpg`) — the client never names it (T-04-13)
//   - DELETE refuses to remove the product's LAST remaining cover (409, D-28)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { varietyImages } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeProductImagesRoutes, type ProductImagesDeps } from "../src/routes/product-images";
import { seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const PUBLIC_BASE = "https://cdn.test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeProductImagesRoutes>;
// Record every key handed to storage so the "server-assigned key" property is asserted.
const putKeys: string[] = [];

const deps: ProductImagesDeps = {
  // Bypass sharp (random test bytes are not a decodable image) and R2 (no network).
  compress: async (b) => b,
  putImage: async (key) => {
    putKeys.push(key);
  },
  publicBaseUrl: PUBLIC_BASE,
};

/** Multipart upload helper. `token` (Bearer) is optional so the RBAC gate is testable. */
function upload(bytes: Uint8Array, fields: Record<string, string>, token?: string) {
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: "image/jpeg" }), "photo.jpg");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return routes.handle(
    new Request("http://localhost/product-images", { method: "POST", headers, body: form }),
  );
}

function del(id: string, token: string) {
  return routes.handle(
    new Request(`http://localhost/product-images/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
}

let adminToken: string;
let customerToken: string;

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeProductImagesRoutes(db, deps);
  await client.file("drizzle/0005_phase4.down.sql").catch(() => {});
  await client.file("drizzle/0004_phase3.down.sql").catch(() => {});
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
  await client.file("drizzle/0004_phase3.sql");
  await client.file("drizzle/0005_phase4.sql");
  adminToken = await issueSession(crypto.randomUUID(), "admin");
  customerToken = await issueSession(crypto.randomUUID(), "customer");
});

afterAll(async () => {
  await client?.end();
});

describe("POST /product-images — admin upload (T-04-12/T-04-13)", () => {
  test("an image > 5 MiB is rejected 413 before sharp/R2 (DoS bound)", async () => {
    const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const before = putKeys.length;
    const big = new Uint8Array(5 * 1024 * 1024 + 1); // one byte over the bound
    const res = await upload(big, { varietyId }, adminToken);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("image_too_large");
    // Never reached storage — the size gate is BEFORE putImage.
    expect(putKeys.length).toBe(before);
  });

  test("a non-admin (customer) token is refused 403", async () => {
    const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const res = await upload(new Uint8Array([1, 2, 3]), { varietyId }, customerToken);
    expect(res.status).toBe(403);
  });

  test("a missing token is refused 401", async () => {
    const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const res = await upload(new Uint8Array([1, 2, 3]), { varietyId });
    expect(res.status).toBe(401);
  });

  test("upload persists a variety_images row under a SERVER-ASSIGNED public key", async () => {
    const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const res = await upload(new Uint8Array([9, 9, 9]), { varietyId }, adminToken);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string; sort: number };
    // The stored URL is the public path + a server-assigned key (client never names it).
    expect(body.url.startsWith(`${PUBLIC_BASE}/product-images/varieties/${varietyId}/`)).toBe(true);
    expect(body.url.endsWith(".jpg")).toBe(true);
    // The persisted row matches the returned url.
    const rows = await db.select().from(varietyImages).where(eq(varietyImages.id, body.id));
    expect(rows.length).toBe(1);
    expect(rows[0]?.url).toBe(body.url);
    // The key handed to storage is server-namespaced, not a client value.
    const key = putKeys.at(-1) ?? "";
    expect(key.startsWith(`product-images/varieties/${varietyId}/`)).toBe(true);
  });

  test("naming neither a variety nor a box is rejected 422", async () => {
    const res = await upload(new Uint8Array([1]), {}, adminToken);
    expect(res.status).toBe(422);
  });
});

describe("DELETE /product-images/:id — last-cover protection (D-28)", () => {
  test("refuses to delete the product's ONLY remaining cover (409)", async () => {
    const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const up = await upload(new Uint8Array([1, 2, 3]), { varietyId }, adminToken);
    const { id } = (await up.json()) as { id: string };
    const res = await del(id, adminToken);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("cannot_delete_last_cover");
    // Still present — the block preserved the cover.
    const rows = await db.select().from(varietyImages).where(eq(varietyImages.id, id));
    expect(rows.length).toBe(1);
  });

  test("deletes a non-last gallery image (200) once another remains as cover", async () => {
    const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const a = (await (await upload(new Uint8Array([1]), { varietyId }, adminToken)).json()) as {
      id: string;
    };
    await upload(new Uint8Array([2]), { varietyId }, adminToken); // second image → cover remains
    const res = await del(a.id, adminToken);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
  });
});
