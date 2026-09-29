import sharp from "sharp";
import { CatalogError } from "../catalog/errors.js";
import type { ContentEvidence, ImagePlan, ProductBrief } from "../schemas.js";

/** Providers return bytes, never arbitrary remote URLs for the server to fetch. */
export interface ImageProvider {
  readonly id: string;
  readonly model: string | null;
  readonly capabilities: { cancellation: boolean; idempotency: boolean; statusLookup: boolean };
  generate(input: { product: ProductBrief; originalBytes: Buffer; plan: ImagePlan; evidence: ContentEvidence[] },
    context: { requestId: string; signal?: AbortSignal }): Promise<Buffer>;
}

const xml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
function lines(value: string, width: number): string[] {
  const result: string[] = [];
  let current = "", units = 0;
  for (const char of value.replace(/[\u0000-\u001f\u007f]/g, " ")) {
    // Wide glyphs consume roughly twice the room of Latin characters.
    const advance = char.codePointAt(0)! > 255 ? 2 : 1;
    if (units + advance > width) { result.push(current.trim()); current = ""; units = 0; }
    current += char; units += advance;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
const textBlock = (value: string, x: number, y: number, width: number, size: number, color: string, weight = 400) =>
  `<text x="${x}" y="${y}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${size}" fill="${color}" font-weight="${weight}">${lines(value, width).map((line, index) => `<tspan x="${x}" dy="${index ? size * 1.3 : 0}">${xml(line)}</tspan>`).join("")}</text>`;

/** Deterministic real image processing. Does not invent scenery or alter the product. */
export const localImageProvider: ImageProvider = {
  id: "local-compositor", model: null,
  capabilities: { cancellation: false, idempotency: true, statusLookup: false },
  async generate({ originalBytes, plan }, { signal }) {
    if (signal?.aborted) throw new CatalogError(409, "IMAGE_INTERRUPTED", "图片制作已中断。");
    if (plan.purpose !== "feature") throw new CatalogError(422, "IMAGE_MODE_UNSUPPORTED", "本地排版仅支持卖点图；场景生图需要配置图片服务商。");
    const product = await sharp(originalBytes, { failOn: "warning", limitInputPixels: 40_000_000 })
      .rotate().resize(870, 1060, { fit: "contain", background: "#ffffff" }).png().toBuffer();
    const title = textBlock(plan.headline, 92, 130, 48, 58, "#152d2b", 700);
    let y = 430;
    const captions = plan.captions.map((caption, index) => {
      const block = `<circle cx="1065" cy="${y - 10}" r="20" fill="#2a6258"/><text x="1065" y="${y - 2}" text-anchor="middle" fill="white" font-family="Arial" font-size="22">${index + 1}</text>`
        + textBlock(caption, 1110, y, 26, 28, "#263b36");
      y += Math.max(210, lines(caption, 26).length * 37 + 42);
      return block;
    }).join("");
    // Put text in a separate raster layer. User data is XML-escaped; no external resources.
    const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600">${title}${captions}<rect x="92" y="1520" width="1416" height="3" fill="#d9e1d9"/></svg>`);
    return sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#f2f4ef" } })
      .composite([{ input: product, left: 92, top: 370 }, { input: overlay, left: 0, top: 0 }]).png().toBuffer();
  },
};

/** A future provider is passed explicitly at application assembly, never from browser secrets. */
export function imageProvider(mode: "local" | "model", configured?: ImageProvider): ImageProvider {
  if (mode === "local") return localImageProvider;
  if (!configured) throw new CatalogError(503, "IMAGE_PROVIDER_NOT_CONFIGURED", "尚未配置图片服务商。可先使用本地卖点图排版；场景生图将在配置后启用。");
  return configured;
}
