// Broadcast service (04-06 / MKT-03 + LINE-04). Resolves a marketing-consented
// audience and delivers a LINE multicast campaign in ≤500-id chunks.
//
// Two hard invariants (Pitfalls 3/6/7, PDPA/NFR-04):
//  1. CONSENT — a customer receives a broadcast ONLY if their LATEST marketing
//     consent_logs row is granted=true AND they have a non-null line_user_id. The
//     consent trail is append-only (a withdrawal is a NEW granted=false row), so the
//     audience query is a DISTINCT ON (customer_id) … ORDER BY created_at DESC filter
//     that keeps the most-recent row per customer, then admits only the granted ones.
//  2. CHUNKING — LINE multicast caps recipients per call; we split the audience into
//     ≤500-id batches so a large segment never exceeds the cap.
//
// The segment predicate is built from parameterized drizzle `sql` fragments exactly
// like reports.ts whereFrag() — NEVER string-concatenated user input (T-03-29).

import { messagingApi } from "@line/bot-sdk";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";
import { broadcasts } from "../db/schema";
import { env } from "../env";
import { log } from "../lib/logger";

export type BroadcastDb = PostgresJsDatabase<typeof schema>;

// Predefined audience type + an optional manual tag (D-15). `all`/undefined = every
// consented customer; the tag narrows to customers labelled with it.
export interface BroadcastSegment {
  type?: "all" | "b2c" | "b2b" | "subscription" | "inactive";
  tag?: string;
}

// Inactivity window for the `inactive` segment — no realised order in this many days.
const INACTIVE_DAYS = 60;

// The LINE multicast recipient cap per call (Pitfall 7). Reverify in LINE docs before
// shipping very large segments (A1); staying at 500 is the documented safe ceiling.
export const MULTICAST_CHUNK = 500;

/** Split an array into ≤`size`-length batches (multicast recipient cap, Pitfall 7). */
export function chunk<T>(items: readonly T[], size: number = MULTICAST_CHUNK): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Build the parameterized segment predicate as `sql` fragments (never string concat).
 * The base predicate (`line_user_id is not null`) is always present; the type/tag add
 * exists/not-exists sub-selects bound to the customer alias `c`.
 */
function segmentPredicate(segment: BroadcastSegment) {
  const frags = [sql`c.line_user_id is not null`];
  switch (segment.type) {
    case "b2b":
      frags.push(sql`c.b2b_status = 'approved'`);
      break;
    case "b2c":
      frags.push(sql`c.b2b_status is null`);
      break;
    case "subscription":
      frags.push(
        sql`exists (select 1 from subscriptions s where s.customer_id = c.id and s.status = 'active')`,
      );
      break;
    case "inactive":
      frags.push(
        sql`not exists (select 1 from orders o where o.customer_id = c.id and o.created_at > now() - (${INACTIVE_DAYS} || ' days')::interval)`,
      );
      break;
    default:
      break; // "all" / undefined → no extra predicate
  }
  if (segment.tag) {
    frags.push(
      sql`exists (select 1 from customer_tags ct where ct.customer_id = c.id and ct.tag = ${segment.tag})`,
    );
  }
  return sql.join(frags, sql` and `);
}

/**
 * Resolve the LINE user-ids of every marketing-consented customer in the segment.
 *
 * The DISTINCT ON keeps the LATEST marketing consent row per customer (Pitfall 3);
 * a customer who later withdrew (a newer granted=false row) is therefore dropped, and
 * a customer with no line_user_id never enters the set. Returns the line_user_ids.
 */
export async function resolveAudience(
  db: BroadcastDb,
  segment: BroadcastSegment = {},
): Promise<string[]> {
  const where = segmentPredicate(segment);
  const rows = (await db.execute(sql`
    select distinct on (c.id)
           c.line_user_id as line_user_id,
           cl.granted     as granted
    from customers c
    join consent_logs cl
      on cl.customer_id = c.id
     and cl.consent_type = 'marketing'
    where ${where}
    order by c.id, cl.created_at desc
  `)) as unknown as { line_user_id: string | null; granted: boolean }[];

  return rows
    .filter((r) => r.granted === true && r.line_user_id != null)
    .map((r) => r.line_user_id as string);
}

// The real push client (offline construction; only multicast hits the network),
// mirroring notify.ts. Never logs the token.
const defaultClient = new messagingApi.MessagingApiClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});

// A minimal multicast seam so tests can inject a mock instead of the live client.
export interface MulticastClient {
  multicast(req: { to: string[]; messages: messagingApi.Message[] }): Promise<unknown>;
}

// The default marketing copy used both as the plain-text fallback message and as the
// injected altText when a stored Flex message is missing one (LINE rejects Flex w/o it).
const DEFAULT_MARKETING_TEXT = "มีข่าวสารใหม่จากสวนสลัด 🥬";

// LINE's altText hard cap. buildBroadcastFlex trims the headline-derived altText to this.
const ALT_TEXT_MAX = 400;

/** The Flex fields a marketing card is composed from (mirrors BroadcastComposer.vue). */
export interface BroadcastFlexFields {
  heroImageUrl?: string;
  headline?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/**
 * CANONICAL marketing Flex bubble — the web-admin composer
 * (web-admin/src/views/BroadcastComposer.vue) MUST mirror this exact structure so the
 * client-built messageJson and this server builder never drift (the composer cannot
 * import this across packages, so the shape is duplicated and this comment is the guard).
 *
 * Builds a bubble with an optional cover hero image (only when heroImageUrl is set), a
 * vertical body carrying a bold headline + a smaller body text, and a footer primary uri
 * button (only when ctaUrl is set — so no empty-uri node is ever emitted, T-04-12-03).
 * altText is derived from the headline (trimmed, capped to LINE's limit) and always
 * non-empty — falls back to the default marketing string when headline is empty.
 * Mirrors the Flex idiom in notify.ts buildOrderFlex (same FlexMessage typing).
 */
export function buildBroadcastFlex(fields: BroadcastFlexFields): messagingApi.FlexMessage {
  const heroImageUrl = (fields.heroImageUrl ?? "").trim();
  const headline = (fields.headline ?? "").trim();
  const body = (fields.body ?? "").trim();
  const ctaLabel = (fields.ctaLabel ?? "").trim();
  const ctaUrl = (fields.ctaUrl ?? "").trim();

  const altText = (headline || DEFAULT_MARKETING_TEXT).slice(0, ALT_TEXT_MAX);

  const bodyContents: messagingApi.FlexComponent[] = [];
  if (headline) {
    bodyContents.push({
      type: "text",
      text: headline,
      weight: "bold",
      size: "lg",
      color: "#3a7d20",
      wrap: true,
    });
  }
  if (body) {
    bodyContents.push({ type: "text", text: body, size: "sm", color: "#555555", wrap: true });
  }
  // A bubble body must have at least one element — fall back to the default copy.
  if (bodyContents.length === 0) {
    bodyContents.push({
      type: "text",
      text: DEFAULT_MARKETING_TEXT,
      size: "sm",
      color: "#555555",
      wrap: true,
    });
  }

  const bubble: messagingApi.FlexBubble = {
    type: "bubble",
    body: { type: "box", layout: "vertical", spacing: "md", contents: bodyContents },
  };
  if (heroImageUrl) {
    bubble.hero = {
      type: "image",
      url: heroImageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
    };
  }
  if (ctaUrl) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#3a7d20",
          action: { type: "uri", label: ctaLabel || "ดูเพิ่มเติม", uri: ctaUrl },
        },
      ],
    };
  }

  return { type: "flex", altText, contents: bubble };
}

/**
 * Guarantee a stored message carries a non-empty altText when it is a Flex message —
 * LINE rejects a Flex without altText (T-04-12-03). Plain-text and other messages pass
 * through untouched.
 */
function ensureAltText(msg: unknown): messagingApi.Message {
  if (msg && typeof msg === "object") {
    const m = msg as Record<string, unknown>;
    if (m.type === "flex" && (typeof m.altText !== "string" || m.altText.trim().length === 0)) {
      return { ...m, altText: DEFAULT_MARKETING_TEXT } as unknown as messagingApi.Message;
    }
  }
  return msg as messagingApi.Message;
}

/**
 * Normalize a stored message_json snapshot into a LINE message array. Exported so
 * broadcast-flex.test.ts can assert the altText guarantee directly. An array passes
 * through (altText-guarded per element), a plain object becomes a single-element array
 * (altText-guarded), and undefined/other returns the plain-text fallback.
 */
export function normalizeMessages(messageJson: unknown): messagingApi.Message[] {
  if (Array.isArray(messageJson)) return messageJson.map(ensureAltText);
  if (messageJson && typeof messageJson === "object") return [ensureAltText(messageJson)];
  return [{ type: "text", text: DEFAULT_MARKETING_TEXT }];
}

/**
 * Send a broadcast: resolve its consent-filtered audience, chunk into ≤500, multicast
 * each batch, then mark the row sent with the delivered count. Under NODE_ENV=test the
 * network call is guarded off (LINE creds are harness-locked) — the chunking + count
 * still run so the worker path stays testable.
 */
export async function runBroadcast(
  db: BroadcastDb,
  broadcastId: string,
  client: MulticastClient = defaultClient,
): Promise<{ sent: number; batches: number }> {
  const [row] = await db.select().from(broadcasts).where(eq(broadcasts.id, broadcastId));
  if (!row) {
    log.warn("runBroadcast: broadcast not found", { broadcastId });
    return { sent: 0, batches: 0 };
  }

  const audience = await resolveAudience(db, (row.segment ?? {}) as BroadcastSegment);
  const messages = normalizeMessages(row.messageJson);
  const batches = chunk(audience);

  try {
    let sent = 0;
    for (const batch of batches) {
      if (env.NODE_ENV !== "test") await client.multicast({ to: batch, messages });
      sent += batch.length;
    }
    await db
      .update(broadcasts)
      .set({ status: "sent", sentCount: sent })
      .where(eq(broadcasts.id, broadcastId));
    log.info("broadcast sent", { broadcastId, sent, batches: batches.length });
    return { sent, batches: batches.length };
  } catch (err) {
    await db.update(broadcasts).set({ status: "failed" }).where(eq(broadcasts.id, broadcastId));
    log.error("broadcast failed", { broadcastId, error: String(err) });
    throw err;
  }
}
