#!/usr/bin/env bun
// One-time LINE Rich Menu provisioning (LINE-01 / D-18). NOT a runtime route — an
// operator runs this once after the LIFF app id is created in the LINE console:
//
//     cd api
//     LIFF_ID=<your-liff-id> bun run scripts/provision-rich-menu.ts ./rich-menu.png
//
// It builds the 5-button "saladee-main" menu (2500×1686, 3-top + 2-bottom grid),
// deep-links each button into the LIFF routes the SPA router already registers,
// uploads the image, and sets the menu as the default for the OA.
//
// Idempotency: every existing menu named "saladee-main" is deleted first, so
// re-running never accumulates duplicates. The channel access token is read ONLY
// from env (never a literal, never logged — T-02-07 / Phase-0 D-15).
import { messagingApi } from "@line/bot-sdk";
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

// 5 areas: 3 across the top row, 2 across the bottom (D-18 order + Thai labels).
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
    // Bottom-left — ติดต่อร้าน
    {
      bounds: { x: 0, y: 843, width: 1250, height: 843 },
      action: { type: "uri", uri: `${liffBase}/contact` },
    },
    // Bottom-right — ความรู้เรื่องผัก
    {
      bounds: { x: 1250, y: 843, width: 1250, height: 843 },
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

  // 3) Upload the image (must be exactly the declared 2500×1686 size).
  const file = Bun.file(IMAGE_PATH);
  if (!(await file.exists())) fail(`image not found at ${IMAGE_PATH}`);
  const bytes = await file.arrayBuffer();
  const contentType = IMAGE_PATH.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png";
  await blob.setRichMenuImage(richMenuId, new Blob([bytes], { type: contentType }));
  console.log("  ✓ uploaded menu image");

  // 4) Make it the default menu for every chat with the OA.
  await client.setDefaultRichMenu(richMenuId);
  console.log("  ✓ set as default rich menu");

  console.log("\n✅ Rich Menu provisioned (LINE-01). The 5 buttons are now live.");
}

main().catch((e) => fail(`provisioning failed: ${(e as Error).message}`));
