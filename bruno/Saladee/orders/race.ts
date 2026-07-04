// Manual Criterion-2 oversell demo — fires K PARALLEL POST /orders at a running
// API for the same last pack, then reports how many won (201) vs sold out (409).
// `bru run` executes requests sequentially and cannot demonstrate concurrency, so
// this small Bun script uses Promise.all to hit the endpoint truly in parallel.
//
// Prereqs: the API is running and an OPEN round has quota == one pack, so exactly
// one request can win. Seed a round/variety/sale_unit and pass their ids via env:
//
//   API_URL=http://127.0.0.1:3000 \
//   ROUND_ID=... VARIETY_ID=... SALE_UNIT_ID=... K=8 \
//   bun run bruno/Saladee/orders/race.ts
//
// Expected: exactly one `201`, the rest `409 { error: "sold_out" }` — proving the
// endpoint never oversells the last pack under real concurrency (PLAT-01).

// The Bruno "Local" environment uses URL=127.0.0.1:3000 (no scheme); default to
// the same host with an explicit http:// scheme so fetch() accepts it.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3000";
const K = Number(process.env.K ?? "8");
const ROUND_ID = process.env.ROUND_ID;
const VARIETY_ID = process.env.VARIETY_ID;
const SALE_UNIT_ID = process.env.SALE_UNIT_ID;

if (!ROUND_ID || !VARIETY_ID || !SALE_UNIT_ID) {
  console.error(
    "Set ROUND_ID, VARIETY_ID and SALE_UNIT_ID (ids from a seeded open round with quota == one pack).",
  );
  process.exit(1);
}

const body = JSON.stringify({
  tier: "b2c",
  customer: {
    name: "ผู้แข่ง",
    phone: "0800000000",
    recipientName: "ผู้รับ",
    recipientPhone: "0800000000",
    recipientAddress: "1 ถนนสลัด",
  },
  lines: [{ roundId: ROUND_ID, varietyId: VARIETY_ID, saleUnitId: SALE_UNIT_ID, qty: 1 }],
});

const responses = await Promise.all(
  Array.from({ length: K }, () =>
    fetch(`${API_URL}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  ),
);

const statuses = await Promise.all(responses.map((r) => r.status));
const wins = statuses.filter((s) => s === 201).length;
const soldOut = statuses.filter((s) => s === 409).length;

console.log(`fired K=${K} parallel POST /orders → ${wins} × 201, ${soldOut} × 409`);
console.log(`oversell = ${wins > 1 ? "DETECTED (BUG)" : "NONE (exactly one winner)"}`);
if (wins !== 1) process.exit(1);
