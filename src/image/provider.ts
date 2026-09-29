import sharp from "sharp";
import { CatalogError } from "../catalog/errors.js";
import type { ContentEvidence, ImagePlan, ProductBrief } from "../schemas.js";
import { calculateImageLayout, IMAGE_CANVAS_SIZE, type LayoutTextBlock } from "./layout.js";

/** Providers return bytes, never arbitrary remote URLs for the server to fetch. */
export interface ImageProvider {
  readonly id: string;
  readonly model: string | null;
  readonly capabilities: { cancellation: boolean; idempotency: boolean; statusLookup: boolean };
  generate(input: { product: ProductBrief; originalBytes: Buffer; plan: ImagePlan; evidence: ContentEvidence[] },
    context: { requestId: string; signal?: AbortSignal }): Promise<Buffer>;
}

const xml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
const svgText = (block: LayoutTextBlock, color: string, weight = 400) =>
  `<text x="${block.x}" y="${block.y}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${block.fontSize}" fill="${color}" font-weight="${weight}">${block.lines.map((line, index) => `<tspan x="${block.x}" dy="${index ? block.lineHeight : 0}">${xml(line)}</tspan>`).join("")}</text>`;

/** Deterministic real image processing. Does not invent scenery or alter the product. */
export const localImageProvider: ImageProvider = {
  id: "local-compositor", model: null,
  capabilities: { cancellation: false, idempotency: true, statusLookup: false },
  async generate({ originalBytes, plan }, { signal }) {
    if (signal?.aborted) throw new CatalogError(409, "IMAGE_INTERRUPTED", "图片制作已中断。");
    if (plan.purpose !== "feature") throw new CatalogError(422, "IMAGE_MODE_UNSUPPORTED", "本地排版仅支持卖点图；场景生图需要配置图片服务商。");
    const layout = calculateImageLayout(plan);
    if (layout.overflow.length) throw new CatalogError(422, "IMAGE_TEXT_OVERFLOW", "文字超出版式安全区域，请缩短文字或切换版式后重新制作。");
    const product = await sharp(originalBytes, { failOn: "warning", limitInputPixels: 40_000_000 })
      .rotate().resize(layout.image.width, layout.image.height, {
        fit: "contain",
        background: layout.layout === "legacy" ? "#ffffff" : { r: 255, g: 255, b: 255, alpha: 0 },
      }).png().toBuffer();
    const title = svgText(layout.title, "#152d2b", 700);
    const captions = plan.captions.map((caption, index) => {
      const current = layout.captions[index];
      if (!current) return "";
      const markerX = current.markerX ?? current.x - 42;
      const markerY = current.markerY ?? current.y - 10;
      return `<circle cx="${markerX}" cy="${markerY}" r="20" fill="#2a6258"/><text x="${markerX}" y="${markerY + 8}" text-anchor="middle" fill="white" font-family="Arial" font-size="22">${index + 1}</text>${svgText(current, "#263b36")}`;
    }).join("");
    // Put text in a separate raster layer. User data is XML-escaped; no external resources.
    const footerY = layout.layout === "legacy" ? 1520 : layout.safeArea.y + layout.safeArea.height - 3;
    const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_CANVAS_SIZE}" height="${IMAGE_CANVAS_SIZE}">${title}${captions}<rect x="${layout.safeArea.x}" y="${footerY}" width="${layout.safeArea.width}" height="3" fill="#d9e1d9"/></svg>`);
    return sharp({ create: { width: IMAGE_CANVAS_SIZE, height: IMAGE_CANVAS_SIZE, channels: 3, background: "#f2f4ef" } })
      .composite([{ input: product, left: layout.image.x, top: layout.image.y }, { input: overlay, left: 0, top: 0 }]).png().toBuffer();
  },
};

/** A future provider is passed explicitly at application assembly, never from browser secrets. */
export function imageProvider(mode: "local" | "model", configured?: ImageProvider): ImageProvider {
  if (mode === "local") return localImageProvider;
  if (!configured) throw new CatalogError(503, "IMAGE_PROVIDER_NOT_CONFIGURED", "尚未配置图片服务商。可先使用本地卖点图排版；场景生图将在配置后启用。");
  return configured;
}
