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

/** Normalize a stored message_json snapshot into a LINE message array. */
function normalizeMessages(messageJson: unknown): messagingApi.Message[] {
  if (Array.isArray(messageJson)) return messageJson as messagingApi.Message[];
  if (messageJson && typeof messageJson === "object") return [messageJson as messagingApi.Message];
  return [{ type: "text", text: "มีข่าวสารใหม่จากสวนสลัด 🥬" }];
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
