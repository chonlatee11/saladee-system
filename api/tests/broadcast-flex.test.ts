// MKT-03 / LINE-04 (gap 04-12) — a marketing broadcast can be a styled LINE Flex card
// (hero image, headline, body, CTA button), not just plain text. Two guarantees are
// asserted here as PURE unit tests (no DB, unlike broadcast-audience.test.ts):
//  1. buildBroadcastFlex produces a valid Flex bubble with a non-empty altText and only
//     emits a hero / CTA button when those fields are supplied (no empty-uri node).
//  2. normalizeMessages GUARANTEES a non-empty altText on any stored Flex message (LINE
//     rejects a Flex without altText) while preserving the plain-text fallback.
import { describe, expect, test } from "bun:test";
import { buildBroadcastFlex, normalizeMessages } from "../src/services/broadcast";

describe("buildBroadcastFlex", () => {
  test("full card: type flex, non-empty altText, hero + body + footer button", () => {
    const flex = buildBroadcastFlex({
      heroImageUrl: "https://cdn.example.com/salad.jpg",
      headline: "ผักสลัดรอบใหม่มาแล้ว!",
      body: "สดจากสวน เก็บเช้าส่งเย็น",
      ctaLabel: "สั่งเลย",
      ctaUrl: "https://shop.example.com/promo",
    });

    expect(flex.type).toBe("flex");
    expect(typeof flex.altText).toBe("string");
    expect(flex.altText.trim().length).toBeGreaterThan(0);
    expect(flex.altText).toContain("ผักสลัดรอบใหม่มาแล้ว!");

    const bubble = flex.contents as Record<string, unknown>;
    expect(bubble.type).toBe("bubble");

    // hero present
    const hero = bubble.hero as Record<string, unknown>;
    expect(hero).toBeDefined();
    expect(hero.type).toBe("image");
    expect(hero.url).toBe("https://cdn.example.com/salad.jpg");

    // body carries headline + body text
    const body = bubble.body as { contents: Array<Record<string, unknown>> };
    const texts = body.contents.map((c) => c.text);
    expect(texts).toContain("ผักสลัดรอบใหม่มาแล้ว!");
    expect(texts).toContain("สดจากสวน เก็บเช้าส่งเย็น");

    // footer CTA button
    const footer = bubble.footer as { contents: Array<Record<string, unknown>> };
    expect(footer).toBeDefined();
    const button = footer.contents[0];
    expect(button.type).toBe("button");
    const action = button.action as Record<string, unknown>;
    expect(action.type).toBe("uri");
    expect(action.label).toBe("สั่งเลย");
    expect(action.uri).toBe("https://shop.example.com/promo");
  });

  test("omits hero when heroImageUrl empty (body-only bubble still valid)", () => {
    const flex = buildBroadcastFlex({
      headline: "ข่าวสารร้าน",
      body: "โปรโมชันสัปดาห์นี้",
    });
    const bubble = flex.contents as Record<string, unknown>;
    expect(bubble.hero).toBeUndefined();
    expect(flex.altText.trim().length).toBeGreaterThan(0);
  });

  test("omits CTA footer when ctaUrl empty (no empty-uri node)", () => {
    const flex = buildBroadcastFlex({
      headline: "ข่าวสารร้าน",
      body: "โปรโมชันสัปดาห์นี้",
      ctaLabel: "ดู",
    });
    const bubble = flex.contents as Record<string, unknown>;
    expect(bubble.footer).toBeUndefined();
  });

  test("falls back to a default altText when headline empty", () => {
    const flex = buildBroadcastFlex({ body: "เนื้อหาข่าวสาร" });
    expect(flex.altText.trim().length).toBeGreaterThan(0);
  });

  test("caps altText to LINE's 400-char limit", () => {
    const flex = buildBroadcastFlex({ headline: "ก".repeat(600) });
    expect(flex.altText.length).toBeLessThanOrEqual(400);
  });
});

describe("normalizeMessages altText guarantee", () => {
  test("passes a Flex object through and preserves its altText", () => {
    const stored = {
      type: "flex",
      altText: "โปรโมชันร้านสลัด",
      contents: { type: "bubble", body: { type: "box", layout: "vertical", contents: [] } },
    };
    const out = normalizeMessages(stored);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("flex");
    expect((out[0] as { altText: string }).altText).toBe("โปรโมชันร้านสลัด");
  });

  test("injects a fallback altText when a stored Flex message has none", () => {
    const stored = {
      type: "flex",
      contents: { type: "bubble", body: { type: "box", layout: "vertical", contents: [] } },
    };
    const out = normalizeMessages(stored);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("flex");
    const altText = (out[0] as { altText?: string }).altText;
    expect(typeof altText).toBe("string");
    expect((altText ?? "").trim().length).toBeGreaterThan(0);
  });

  test("injects a fallback altText when a stored Flex message has an empty altText", () => {
    const stored = { type: "flex", altText: "   ", contents: { type: "bubble" } };
    const [msg] = normalizeMessages(stored);
    expect((msg as { altText: string }).altText.trim().length).toBeGreaterThan(0);
  });

  test("guards altText per element for an array of messages", () => {
    const out = normalizeMessages([{ type: "flex", contents: { type: "bubble" } }]);
    expect(out).toHaveLength(1);
    expect((out[0] as { altText?: string }).altText).toBeTruthy();
  });

  test("preserves the plain-text fallback for undefined input", () => {
    const out = normalizeMessages(undefined);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("text");
    expect((out[0] as { text: string }).text.length).toBeGreaterThan(0);
  });

  test("passes a plain-text object through unchanged", () => {
    const out = normalizeMessages({ type: "text", text: "สวัสดีครับ" });
    expect(out[0].type).toBe("text");
    expect((out[0] as { text: string }).text).toBe("สวัสดีครับ");
  });
});
