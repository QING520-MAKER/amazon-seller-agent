import type { ImagePlan } from "../schemas.js";

export const IMAGE_CANVAS_SIZE = 1600;
export const IMAGE_SAFE_MARGIN = 96;

export type ImageLayout = "split" | "stacked";

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutTextBlock extends LayoutBox {
  fontSize: number;
  lineHeight: number;
  maxUnits: number;
  lines: string[];
  requiredHeight: number;
  markerX?: number;
  markerY?: number;
}

export interface ImageLayoutResult {
  layout: ImageLayout | "legacy";
  version: 2 | null;
  safeArea: LayoutBox;
  image: LayoutBox;
  title: LayoutTextBlock;
  captions: LayoutTextBlock[];
  overflow: string[];
}

/**
 * This is deliberately a small, dependency-free approximation of text width.
 * It is shared by the browser preview and the server compositor so neither
 * side silently clips a user supplied title or caption.
 */
export function textUnits(value: string) {
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " "))
    .reduce((total, character) => total + (character.codePointAt(0)! > 255 ? 2 : 1), 0);
}

export function wrapText(value: string, maxUnits: number): string[] {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ");
  const tokens: string[] = [];
  let word = "";
  const flushWord = () => { if (word) { tokens.push(word); word = ""; } };
  for (const character of normalized) {
    if (/\s/u.test(character)) { flushWord(); tokens.push(" "); continue; }
    if (/[\p{L}\p{N}_'-]/u.test(character) && !/[\u2e80-\u9fff]/u.test(character)) { word += character; continue; }
    flushWord(); tokens.push(character);
  }
  flushWord();

  const result: string[] = [];
  let current = "";
  let units = 0;
  const pushCurrent = () => {
    if (current.trim()) result.push(current.trim());
    current = "";
    units = 0;
  };
  for (const token of tokens) {
    if (token === " ") {
      if (current && units < maxUnits) { current += token; units += 1; }
      continue;
    }
    const tokenUnits = textUnits(token);
    if (tokenUnits > maxUnits) {
      pushCurrent();
      let partial = "";
      let partialUnits = 0;
      for (const character of token) {
        const advance = character.codePointAt(0)! > 255 ? 2 : 1;
        if (partial && partialUnits + advance > maxUnits) {
          result.push(partial);
          partial = "";
          partialUnits = 0;
        }
        partial += character;
        partialUnits += advance;
      }
      if (partial) { current = partial; units = partialUnits; }
      continue;
    }
    if (units + tokenUnits > maxUnits && current) {
      result.push(current.trim());
      current = "";
      units = 0;
    }
    if (units + tokenUnits > maxUnits) {
      // A single wide glyph is kept intact; the v2 capacities are always at
      // least one wide glyph wide, but this keeps the helper total for callers.
      result.push(token);
      continue;
    }
    current += token;
    units += tokenUnits;
  }
  if (current.trim() || !result.length) result.push(current.trim());
  return result;
}

function legacyWrapText(value: string, maxUnits: number): string[] {
  const result: string[] = [];
  let current = "";
  let units = 0;
  for (const character of value.replace(/[\u0000-\u001f\u007f]/g, " ")) {
    const advance = character.codePointAt(0)! > 255 ? 2 : 1;
    if (units + advance > maxUnits) {
      result.push(current.trim());
      current = "";
      units = 0;
    }
    current += character;
    units += advance;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function block(input: LayoutBox & Pick<LayoutTextBlock, "fontSize" | "lineHeight" | "maxUnits">,
  value: string, marker?: { x: number; y: number }, wrap = wrapText): LayoutTextBlock {
  const lines = wrap(value, input.maxUnits);
  return {
    ...input,
    lines,
    requiredHeight: lines.length * input.lineHeight,
    ...(marker ? { markerX: marker.x, markerY: marker.y } : {}),
  };
}

function legacyLayout(plan: ImagePlan): ImageLayoutResult {
  const safeArea = { x: 92, y: 92, width: 1416, height: 1431 };
  const image = { x: 92, y: 370, width: 870, height: 1060 };
  const title = block({ x: 92, y: 130, width: 720, height: 220, fontSize: 58, lineHeight: 58 * 1.3, maxUnits: 48 }, plan.headline, undefined, legacyWrapText);
  const captions: LayoutTextBlock[] = [];
  let y = 430;
  for (let index = 0; index < plan.captions.length; index += 1) {
    const caption = plan.captions[index] ?? "";
    const next = block({ x: 1110, y, width: 390, height: 1200 - y, fontSize: 28, lineHeight: 28 * 1.3, maxUnits: 26 }, caption,
      { x: 1065, y: y - 10 }, legacyWrapText);
    captions.push(next);
    y += Math.max(210, next.requiredHeight + 42);
  }
  const overflow = y > safeArea.y + safeArea.height
    ? ["文字超出版式安全区域，请缩短文字或切换版式后重新制作。"]
    : [];
  return { layout: "legacy", version: null, safeArea, image, title, captions, overflow };
}

function v2Layout(plan: ImagePlan, layout: ImageLayout): ImageLayoutResult {
  const safeArea = { x: IMAGE_SAFE_MARGIN, y: IMAGE_SAFE_MARGIN, width: 1408, height: 1408 };
  // Arial's widest Latin glyphs are close to the font size. Reserving a full
  // font-size cell makes browser preview and SVG rasterisation safe for strings such
  // as WMMMM without changing the legacy layout's historical wrapping.
  const safeUnits = (width: number, fontSize: number) => Math.max(1, Math.floor(width / fontSize));
  const image = layout === "split"
    ? { x: 96, y: 352, width: 720, height: 1120 }
    : { x: 96, y: 112, width: 1408, height: 760 };
  const title = layout === "split"
    ? block({ x: 900, y: 160, width: 604, height: 500, fontSize: 56, lineHeight: 70, maxUnits: safeUnits(604, 56) }, plan.headline)
    : block({ x: 96, y: 936, width: 1408, height: 220, fontSize: 52, lineHeight: 62, maxUnits: safeUnits(1408, 52) }, plan.headline);
  const captions: LayoutTextBlock[] = [];
  let y = layout === "split" ? title.y + title.requiredHeight + 96 : title.y + title.requiredHeight + 40;
  for (let index = 0; index < plan.captions.length; index += 1) {
    const caption = plan.captions[index] ?? "";
    const next = layout === "split"
      ? block({ x: 900, y, width: 604, height: 190, fontSize: 30, lineHeight: 42, maxUnits: safeUnits(604, 30) }, caption,
        { x: 858, y: y - 10 })
      : block({ x: 168, y, width: 1336, height: 180, fontSize: 30, lineHeight: 40, maxUnits: safeUnits(1336, 30) }, caption,
        { x: 126, y: y - 10 });
    captions.push(next);
    y += next.requiredHeight + (layout === "split" ? 44 : 28);
  }
  const overflow: string[] = [];
  if (title.requiredHeight > title.height) overflow.push("标题超出版式安全区域");
  if (title.y + title.requiredHeight > safeArea.y + safeArea.height) overflow.push("标题超出版式安全区域");
  if (captions.some(caption => caption.requiredHeight > caption.height)) overflow.push("单条卖点超出版式安全区域");
  if (y > safeArea.y + safeArea.height) overflow.push("卖点文字超出版式安全区域");
  return { layout, version: 2, safeArea, image, title, captions, overflow };
}

export function calculateImageLayout(plan: ImagePlan): ImageLayoutResult {
  // Missing template is intentionally historical. It keeps old requests and
  // their hashes readable without rewriting their original layout semantics.
  if (!plan.template) return legacyLayout(plan);
  return v2Layout(plan, plan.template.layout);
}
