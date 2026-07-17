#!/usr/bin/env bun
// One-time LINE Rich Menu provisioning (LINE-01 / D-18). NOT a runtime route — an
// operator runs this once after the LIFF app id is created in the LINE console:
//
//     cd api
//     LIFF_ID=<your-liff-id> bun run scripts/provision-rich-menu.ts ./rich-menu.png
//
// It builds the 6-button "saladee-main" menu (2500×1686, 3-top + 3-bottom grid),
// deep-links each button into the LIFF routes the SPA router already registers,
// uploads the image, and sets the menu as the default for the OA.
//
// NOTE (03-14): the menu grew from 5 to 6 cells (new bottom-left สมาชิกกล่องผัก →
// /subscription, UAT gap test 6 / SALE-03). Re-running requires a NEW 6-cell
// 2500×1686 image whose bottom row is three cells, not two.
//
// Idempotency: every existing menu named "saladee-main" is deleted first, so
// re-running never accumulates duplicates. The channel access token is read ONLY
// from env (never a literal, never logged — T-02-07 / Phase-0 D-15).
import { messagingApi } from "@line/bot-sdk";
import sharp from "sharp";
import { env } from "../src/env";

const MENU_NAME = "saladee-main";
const CHAT_BAR_TEXT = "เมนูร้าน";

// The LIFF id lives in the LINE console (web build env VITE_LIFF_ID). The script
// accepts it via LIFF_ID or VITE_LIFF_ID so it works standalone in the api dir.
const LIFF_ID = process.env.LIFF_ID ?? process.env.VITE_LIFF_ID ?? "";
// The 2500×1686 menu image is a design artifact produced separately (its pixel
// layout is Claude's-discretion per UI-SPEC). Path from argv[2] or RICH_MENU_IMAGE.
const IMAGE_PATH = process.argv[2] ?? process.env.RICH_MENU_IMAGE ?? "";

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

if (!LIFF_ID) {
  fail(
    "LIFF_ID (or VITE_LIFF_ID) is not set. Create the LIFF app in the LINE console " +
      "first, then re-run: LIFF_ID=<id> bun run scripts/provision-rich-menu.ts <image.png>",
  );
}
if (!IMAGE_PATH) {
  fail(
    "No image path. Pass the 2500×1686 PNG as the first argument: " +
      "bun run scripts/provision-rich-menu.ts ./rich-menu.png",
  );
}

// Both clients read the channel access token from validated env only (never a
// literal). Construction is offline; only the API calls below hit LINE.
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});
const blob = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});

// Deep-link targets — LIFF permanent links. Route paths match web/src/router.ts.
const liffBase = `https://liff.line.me/${LIFF_ID}`;

// 6 areas: 3 across the top row, 3 across the bottom (D-18 order + Thai labels;
// 03-14 adds สมาชิกกล่องผัก → /subscription for SALE-03 discoverability).
// /b2b intentionally gets NO Rich Menu cell — a niche audience; the in-LIFF
// catalog quick-link (CatalogView.vue, 03-14 Task 2) covers CUST-02 instead.
const request: messagingApi.RichMenuRequest = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: MENU_NAME,
  chatBarText: CHAT_BAR_TEXT,
  areas: [
    // Top-left — สั่งผักรอบนี้
    { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: "uri", uri: liffBase } },
    // Top-middle — ราคาวันนี้
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: "uri", uri: `${liffBase}/prices` },
    },
    // Top-right — ติดตามออเดอร์
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: "uri", uri: `${liffBase}/orders` },
    },
    // Bottom-left — สมาชิกกล่องผัก
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: { type: "uri", uri: `${liffBase}/subscription` },
    },
    // Bottom-middle — ติดต่อร้าน
    {
      bounds: { x: 833, y: 843, width: 834, height: 843 },
      action: { type: "uri", uri: `${liffBase}/contact` },
    },
    // Bottom-right — ความรู้เรื่องผัก
    {
      bounds: { x: 1667, y: 843, width: 833, height: 843 },
      action: { type: "uri", uri: `${liffBase}/care` },
    },
  ],
};

async function main(): Promise<void> {
  console.log("Provisioning LINE Rich Menu");
  console.log(`  name:  ${MENU_NAME}`);
  console.log(`  liff:  ${liffBase}`);
  console.log(`  image: ${IMAGE_PATH}`);

  // 1) Idempotency — delete any existing menu with our name before creating.
  const { richmenus } = await client.getRichMenuList();
  const stale = richmenus.filter((m) => m.name === MENU_NAME);
  for (const m of stale) {
    await client.deleteRichMenu(m.richMenuId);
    console.log(`  · deleted stale menu ${m.richMenuId}`);
  }

  // 2) Create the menu definition.
  const { richMenuId } = await client.createRichMenu(request);
  console.log(`  ✓ created rich menu ${richMenuId}`);

  // 3) Normalize + upload the image. LINE requires the uploaded bytes to match the
  //    declared size EXACTLY and stay ≤ 1 MB — a source that violates either yields a
  //    413 (Request Entity Too Large) on upload. Operators rarely hand-produce a
  //    pixel-perfect, sub-1 MB file, so we resize to request.size and JPEG-compress
  //    below the cap here (stepping quality down until it fits) rather than pushing
  //    that chore onto whoever runs the script.
  const file = Bun.file(IMAGE_PATH);
  if (!(await file.exists())) fail(`image not found at ${IMAGE_PATH}`);
  const source = Buffer.from(await file.arrayBuffer());
  const { width, height } = request.size;
  const MAX_BYTES = 1024 * 1024; // LINE's hard limit for a rich-menu image.
  let bytes: Buffer = source;
  for (const quality of [90, 80, 70, 60, 50, 40]) {
    bytes = await sharp(source)
      .resize(width, height, { fit: "fill" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (bytes.byteLength <= MAX_BYTES) break;
  }
  if (bytes.byteLength > MAX_BYTES) {
    fail(
      `image still ${(bytes.byteLength / 1048576).toFixed(2)} MB after max compression — ` +
        "use a flatter/simpler menu image",
    );
  }
  await blob.setRichMenuImage(richMenuId, new Blob([bytes], { type: "image/jpeg" }));
  console.log(
    `  ✓ uploaded menu image (${(bytes.byteLength / 1024).toFixed(0)} KB, ${width}×${height} jpeg)`,
  );

  // 4) Make it the default menu for every chat with the OA.
  await client.setDefaultRichMenu(richMenuId);
  console.log("  ✓ set as default rich menu");

  console.log("\n✅ Rich Menu provisioned (LINE-01). The 6 buttons are now live.");
}

main().catch((e) => fail(`provisioning failed: ${(e as Error).message}`));
