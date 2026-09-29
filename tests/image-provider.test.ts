import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { imageProvider, localImageProvider } from "../src/image/provider.js";
import { calculateImageLayout, wrapText } from "../src/image/layout.js";
import { hashBytes, inspectImage } from "../src/storage/files.js";
import { ProductBriefSchema } from "../src/schemas.js";

describe("real local feature-image composition", () => {
  it("keeps reference pixels, rasterizes escaped text and returns a valid 1600-square PNG", async () => {
    const originalBytes = await sharp({ create: { width: 300, height: 600, channels: 3, background: "#c22e44" } }).png().toBuffer();
    const hash = hashBytes(originalBytes);
    const output = await localImageProvider.generate({ product: ProductBriefSchema.parse({ name: "Mug" }), originalBytes, evidence: [],
      plan: { purpose: "feature", headline: 'Travel <Mug> & "Lid"', captions: ["Actual package facts", "500 ml capacity"], prompt: "" } }, { requestId: "test" });
    expect(await inspectImage(output)).toMatchObject({ width: 1600, height: 1600, mimeType: "image/png" });
    expect(hashBytes(originalBytes)).toBe(hash);
    const pixels = await sharp(output).extract({ left: 500, top: 800, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...pixels]).toEqual([194, 46, 68]);
  });
  it("refuses local scenery and unconfigured external generation", async () => {
    expect(() => imageProvider("model")).toThrowError(expect.objectContaining({ code: "IMAGE_PROVIDER_NOT_CONFIGURED" }));
    await expect(localImageProvider.generate({ product: ProductBriefSchema.parse({ name: "Mug" }), originalBytes: Buffer.alloc(0), evidence: [],
      plan: { purpose: "scene", headline: "Mug", captions: [], prompt: "Kitchen" } }, { requestId: "test" })).rejects.toMatchObject({ code: "IMAGE_MODE_UNSUPPORTED" });
  });

  it("renders both v2 presets and preserves transparent landscape and portrait bounds", async () => {
    const redLandscape = await sharp({ create: { width: 600, height: 200, channels: 3, background: "#c22e44" } }).png().toBuffer();
    const landscape = await sharp({ create: { width: 1000, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: redLandscape, left: 200, top: 100 }]).png().toBuffer();
    const redPortrait = await sharp({ create: { width: 100, height: 500, channels: 3, background: "#c22e44" } }).png().toBuffer();
    const portrait = await sharp({ create: { width: 400, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: redPortrait, left: 150, top: 250 }]).png().toBuffer();
    const splitPlan = { purpose: "feature" as const, headline: "Travel Mug", captions: ["Wide reference"], prompt: "", template: { layout: "split" as const, version: 2 as const } };
    const stackedPlan = { ...splitPlan, template: { layout: "stacked" as const, version: 2 as const } };
    const split = calculateImageLayout(splitPlan);
    const stacked = calculateImageLayout(stackedPlan);
    expect(split.layout).toBe("split");
    expect(stacked.layout).toBe("stacked");
    expect(split.safeArea.x).toBe(96);
    const splitOutput = await localImageProvider.generate({ product: ProductBriefSchema.parse({ name: "Mug" }), originalBytes: landscape, evidence: [], plan: splitPlan }, { requestId: "test" });
    const stackedOutput = await localImageProvider.generate({ product: ProductBriefSchema.parse({ name: "Mug" }), originalBytes: portrait, evidence: [], plan: stackedPlan }, { requestId: "test" });
    expect(await inspectImage(splitOutput)).toMatchObject({ width: 1600, height: 1600, mimeType: "image/png" });
    expect(await inspectImage(stackedOutput)).toMatchObject({ width: 1600, height: 1600, mimeType: "image/png" });
    const readPixels = async (output: Buffer) => sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const splitPixels = await readPixels(splitOutput);
    const stackedPixels = await readPixels(stackedOutput);
    const at = (pixels: Awaited<ReturnType<typeof readPixels>>, x: number, y: number) => {
      const index = (y * pixels.info.width + x) * pixels.info.channels;
      return [...pixels.data.subarray(index, index + pixels.info.channels)];
    };
    expect(at(splitPixels, 500, 900)).toEqual([194, 46, 68]);
    expect(at(splitPixels, 500, 700)).not.toEqual([194, 46, 68]);
    expect(at(stackedPixels, 800, 500)).toEqual([194, 46, 68]);
    expect(at(stackedPixels, 700, 500)).not.toEqual([194, 46, 68]);
  });

  it("reports legal-limit text overflow and preserves all wrapped characters", async () => {
    const plan = { purpose: "feature" as const, headline: "中文".repeat(40), captions: ["卖点".repeat(50)], prompt: "", template: { layout: "split" as const, version: 2 as const } };
    const calculated = calculateImageLayout(plan);
    expect(calculated.overflow.length).toBeGreaterThan(0);
    const wrapped = wrapText("XML <safe> & 中文", 6).join("");
    expect(wrapped).toContain("XML");
    expect(wrapped).toContain("<safe>");
    expect(wrapped).toContain("&");
    const originalBytes = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(localImageProvider.generate({ product: ProductBriefSchema.parse({ name: "Mug" }), originalBytes, evidence: [], plan }, { requestId: "test" }))
      .rejects.toMatchObject({ code: "IMAGE_TEXT_OVERFLOW" });
    const wideTitle = { ...plan, headline: "W".repeat(80), captions: ["safe caption"] };
    expect(calculateImageLayout(wideTitle).overflow.length).toBeGreaterThan(0);
  });

  it("fits schema-limit English text inside the v2 safe area", async () => {
    const plan = { purpose: "feature" as const, headline: "W".repeat(80), captions: ["M".repeat(100)], prompt: "", template: { layout: "stacked" as const, version: 2 as const } };
    const layout = calculateImageLayout(plan);
    expect(layout.overflow).toEqual([]);
    expect(layout.title.lines.join("")).toBe(plan.headline);
    expect(layout.captions.map(item => item.lines.join("")).join("")).toBe(plan.captions.join(""));
    const mixed = calculateImageLayout({ ...plan, headline: "旅行杯 Travel Cup", captions: ["safe caption"], template: { layout: "split" as const, version: 2 as const } });
    expect(mixed.title.lines).toEqual(["旅行杯", "Travel Cup"]);
    expect(mixed.overflow).toEqual([]);
    const originalBytes = await sharp({ create: { width: 300, height: 600, channels: 3, background: "#c22e44" } }).png().toBuffer();
    const output = await localImageProvider.generate({ product: ProductBriefSchema.parse({ name: "Mug" }), originalBytes, evidence: [], plan }, { requestId: "test" });
    expect(await inspectImage(output)).toMatchObject({ width: 1600, height: 1600, mimeType: "image/png" });
    const mixedOutput = await localImageProvider.generate({ product: ProductBriefSchema.parse({ name: "Mug" }), originalBytes, evidence: [], plan: { ...plan, headline: "旅行杯 Travel Cup", captions: ["safe caption"], template: { layout: "split" as const, version: 2 as const } } }, { requestId: "test" });
    expect(await inspectImage(mixedOutput)).toMatchObject({ width: 1600, height: 1600, mimeType: "image/png" });
    const mixedTopSafety = await sharp(mixedOutput).extract({ left: 96, top: 0, width: 1408, height: 96 }).removeAlpha().raw().toBuffer();
    expect([...mixedTopSafety].every((value, index) => value === [242, 244, 239][index % 3])).toBe(true);
    const rightEdge = await sharp(output).extract({ left: 1505, top: 880, width: 95, height: 320 }).removeAlpha().raw().toBuffer();
    expect([...rightEdge].every((value, index) => value === [242, 244, 239][index % 3])).toBe(true);
    const footerBelowSafeArea = await sharp(output).extract({ left: 96, top: 1505, width: 1408, height: 15 }).removeAlpha().raw().toBuffer();
    expect([...footerBelowSafeArea].every((value, index) => value === [242, 244, 239][index % 3])).toBe(true);
  });
});
