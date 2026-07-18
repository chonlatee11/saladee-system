// Product-image routes (04-04, D-26/27/28 / ORD-05). Admin uploads real product
// photos through the SAME sharp+R2 pipeline the payment slips use (payments.ts),
// but to a PUBLIC marketing path — product photos are public assets (D-26), unlike
// the private signed-URL slips. Multiple images per product form a gallery the
// catalog returns so the store, LIFF, and Flex cards render real imagery.
//
//   POST   /product-images   — ADMIN (requireRole owner|admin): multipart upload
//     of ONE image (≤ 5 MiB, bounded BEFORE sharp) for a variety OR a box. The
//     image is sharp-compressed and stored under a SERVER-ASSIGNED public R2 key
//     (the client never names the object — T-04-13); a variety_images/box_images
//     gallery row is created and the stored public URL returned.
//   GET    /product-images   — ADMIN: the product's gallery (cover from
//     varieties.imageUrl/boxes.imageUrl first, then the additional gallery rows).
//   DELETE /product-images/:id — ADMIN: remove a gallery image, but REFUSE if it
//     is the product's last remaining cover (no legacy imageUrl + last gallery row)
//     so a product is never left coverless (D-28 backward-compat rule).
//
// Storage discipline (T-04-12/T-04-13, mirrors payments.ts): admin-only + 5 MiB
// bound + sharp compress + server-assigned key. DI: makeProductImagesRoutes(db,
// deps) injects the compressor + uploader + public base URL so the route is
// testable without a live R2/sharp path.
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import sharp from "sharp";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { boxes, boxImages, varieties, varietyImages } from "../db/schema";
import { env } from "../env";
import { requireRole } from "../plugins/auth.plugin";
import { storage as defaultStorage, type StorageClient } from "../plugins/storage.plugin";

type ProductImagesDb = PostgresJsDatabase<typeof schema>;

// Short-lived signed-PUT TTL (seconds) — mirrors payments.ts (Pitfall 4).
const PRESIGN_TTL = 300;
// Upload size bound, reused from payments.ts (WR-03) — cap CPU/storage abuse.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ProductImagesDeps {
  /** Storage client for R2 (presign helpers). */
  storage?: StorageClient;
  /** Compress raw image bytes → jpeg (default: sharp rotate/resize/quality). */
  compress?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** Persist compressed bytes at `key` (default: presigned PUT to R2). */
  putImage?: (key: string, bytes: Uint8Array) => Promise<void>;
  /** Public base URL for the stored object (default: env.R2_PUBLIC_BASE_URL). */
  publicBaseUrl?: string;
}

/** Default image compression: auto-rotate, cap width 1080, jpeg q~72 (payments.ts). */
async function sharpCompress(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(bytes))
    .rotate()
    .resize({ width: 1080, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  return new Uint8Array(out);
}

/** Compose the stored public URL from the base + server-assigned key. */
function publicUrl(base: string, key: string): string {
  return base ? `${base.replace(/\/+$/, "")}/${key}` : `/${key}`;
}

export function makeProductImagesRoutes(
  database: ProductImagesDb = defaultDb,
  deps: ProductImagesDeps = {},
) {
  const storage = deps.storage ?? defaultStorage;
  const compress = deps.compress ?? sharpCompress;
  const publicBaseUrl = deps.publicBaseUrl ?? env.R2_PUBLIC_BASE_URL;
  const putImage =
    deps.putImage ??
    (async (key: string, bytes: Uint8Array) => {
      const url = storage.presignPut(key, PRESIGN_TTL);
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: new Uint8Array(bytes),
      });
      if (!res.ok) throw new Error(`image store failed: ${res.status}`);
    });

  const adminOnly = requireRole("owner", "admin");

  return (
    new Elysia()
      // Admin uploads ONE product image → compress → public R2 → gallery row.
      .post(
        "/product-images",
        async ({ body, set }) => {
          const { varietyId, boxId, image } = body;
          // Exactly one target must be named.
          if ((!varietyId && !boxId) || (varietyId && boxId)) {
            set.status = 422;
            return { error: "one_of_variety_or_box" };
          }
          // T-04-12: bound size BEFORE sharp/R2 to cap CPU + storage abuse.
          if (image.size > MAX_IMAGE_BYTES) {
            set.status = 413;
            return { error: "image_too_large" };
          }

          if (varietyId) {
            const [v] = await database
              .select({ id: varieties.id })
              .from(varieties)
              .where(eq(varieties.id, varietyId))
              .limit(1);
            if (!v) {
              set.status = 404;
              return { error: "variety_not_found" };
            }
          } else if (boxId) {
            const [b] = await database
              .select({ id: boxes.id })
              .from(boxes)
              .where(eq(boxes.id, boxId))
              .limit(1);
            if (!b) {
              set.status = 404;
              return { error: "box_not_found" };
            }
          }

          const raw = new Uint8Array(await image.arrayBuffer());
          const bytes = await compress(raw);
          // T-04-13: the SERVER assigns the key — the client can never name the
          // object (no path traversal, no clobber). Public marketing path (D-26).
          const target = varietyId ? `varieties/${varietyId}` : `boxes/${boxId}`;
          const key = `product-images/${target}/${crypto.randomUUID()}.jpg`;
          await putImage(key, bytes);
          const url = publicUrl(publicBaseUrl, key);

          if (varietyId) {
            const [nextSort] = await database
              .select({ n: sql<number>`coalesce(max(${varietyImages.sort}) + 1, 0)::int` })
              .from(varietyImages)
              .where(eq(varietyImages.varietyId, varietyId));
            const [row] = await database
              .insert(varietyImages)
              .values({ varietyId, url, sort: nextSort?.n ?? 0 })
              .returning({
                id: varietyImages.id,
                url: varietyImages.url,
                sort: varietyImages.sort,
              });
            set.status = 201;
            return row;
          }
          const [nextSort] = await database
            .select({ n: sql<number>`coalesce(max(${boxImages.sort}) + 1, 0)::int` })
            .from(boxImages)
            .where(eq(boxImages.boxId, boxId as string));
          const [row] = await database
            .insert(boxImages)
            .values({ boxId: boxId as string, url, sort: nextSort?.n ?? 0 })
            .returning({ id: boxImages.id, url: boxImages.url, sort: boxImages.sort });
          set.status = 201;
          return row;
        },
        {
          body: t.Object({
            image: t.File(),
            varietyId: t.Optional(t.String({ format: "uuid" })),
            boxId: t.Optional(t.String({ format: "uuid" })),
          }),
          beforeHandle: adminOnly,
        },
      )
      // Admin lists a product's gallery: cover (legacy imageUrl) first, then rows.
      .get(
        "/product-images",
        async ({ query, set }) => {
          const { varietyId, boxId } = query;
          if ((!varietyId && !boxId) || (varietyId && boxId)) {
            set.status = 422;
            return { error: "one_of_variety_or_box" };
          }
          if (varietyId) {
            const [v] = await database
              .select({ cover: varieties.imageUrl })
              .from(varieties)
              .where(eq(varieties.id, varietyId))
              .limit(1);
            if (!v) {
              set.status = 404;
              return { error: "variety_not_found" };
            }
            const rows = await database
              .select({ id: varietyImages.id, url: varietyImages.url, sort: varietyImages.sort })
              .from(varietyImages)
              .where(eq(varietyImages.varietyId, varietyId))
              .orderBy(varietyImages.sort, varietyImages.createdAt);
            return { cover: v.cover, images: rows };
          }
          const [b] = await database
            .select({ cover: boxes.imageUrl })
            .from(boxes)
            .where(eq(boxes.id, boxId as string))
            .limit(1);
          if (!b) {
            set.status = 404;
            return { error: "box_not_found" };
          }
          const rows = await database
            .select({ id: boxImages.id, url: boxImages.url, sort: boxImages.sort })
            .from(boxImages)
            .where(eq(boxImages.boxId, boxId as string))
            .orderBy(boxImages.sort, boxImages.createdAt);
          return { cover: b.cover, images: rows };
        },
        {
          query: t.Object({
            varietyId: t.Optional(t.String({ format: "uuid" })),
            boxId: t.Optional(t.String({ format: "uuid" })),
          }),
          beforeHandle: adminOnly,
        },
      )
      // Admin deletes a gallery image — REFUSED if it would leave the product with no
      // cover (legacy imageUrl null AND this is the last remaining gallery row, D-28).
      .delete(
        "/product-images/:id",
        async ({ params, set }) => {
          const id = params.id;
          // Look in variety_images first, then box_images.
          const [vImg] = await database
            .select({ varietyId: varietyImages.varietyId })
            .from(varietyImages)
            .where(eq(varietyImages.id, id))
            .limit(1);
          if (vImg) {
            const [cov] = await database
              .select({ cover: varieties.imageUrl })
              .from(varieties)
              .where(eq(varieties.id, vImg.varietyId))
              .limit(1);
            const [cnt] = await database
              .select({ n: sql<number>`count(*)::int` })
              .from(varietyImages)
              .where(eq(varietyImages.varietyId, vImg.varietyId));
            // Last cover: no legacy cover set AND this is the only gallery row.
            if (!cov?.cover && (cnt?.n ?? 0) <= 1) {
              set.status = 409;
              return { error: "cannot_delete_last_cover" };
            }
            await database.delete(varietyImages).where(eq(varietyImages.id, id));
            return { id, deleted: true };
          }
          const [bImg] = await database
            .select({ boxId: boxImages.boxId })
            .from(boxImages)
            .where(eq(boxImages.id, id))
            .limit(1);
          if (bImg) {
            const [cov] = await database
              .select({ cover: boxes.imageUrl })
              .from(boxes)
              .where(eq(boxes.id, bImg.boxId))
              .limit(1);
            const [cnt] = await database
              .select({ n: sql<number>`count(*)::int` })
              .from(boxImages)
              .where(eq(boxImages.boxId, bImg.boxId));
            if (!cov?.cover && (cnt?.n ?? 0) <= 1) {
              set.status = 409;
              return { error: "cannot_delete_last_cover" };
            }
            await database.delete(boxImages).where(eq(boxImages.id, id));
            return { id, deleted: true };
          }
          set.status = 404;
          return { error: "image_not_found" };
        },
        {
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          beforeHandle: adminOnly,
        },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const productImagesRoutes = makeProductImagesRoutes();
