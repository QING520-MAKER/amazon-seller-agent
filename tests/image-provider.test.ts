import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { imageProvider, localImageProvider } from "../src/image/provider.js";
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
});
