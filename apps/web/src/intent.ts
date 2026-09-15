import { z } from "zod";
import listingCreateExample from "../../../examples/listing_create.json";
import listingAuditExample from "../../../examples/listing_input.json";
import productExample from "../../../examples/product_brief.json";
import researchExample from "../../../examples/research_request.json";
import { getMarketplace, MARKETPLACES } from "../../../src/marketplace.js";
import {
  ListingCreateRequestSchema,
  ListingOptimizeRequestSchema,
  ProductBriefSchema,
  ResearchRequestSchema,
  type ListingCreateRequest,
  type ListingOptimizeRequest,
  type ProductBrief,
  type ResearchRequest,
  type Tone,
} from "../../../src/schemas.js";

export type RequestKind = "research" | "listing-create" | "listing-audit" | "pipeline";
export type PipelineRequest = { keyword: string; marketplace: string; product: ProductBrief };
export type WorkbenchRequest = (
  | { kind: "research"; payload: ResearchRequest }
  | { kind: "listing-create"; payload: ListingCreateRequest }
  | { kind: "listing-audit"; payload: ListingOptimizeRequest }
  | { kind: "pipeline"; payload: PipelineRequest }
) & { exampleData: string[] };

export const REQUEST_LABELS: Record<RequestKind, string> = {
  research: "选品关键词研究",
  "listing-create": "生成 Listing",
  "listing-audit": "审计 Listing",
  pipeline: "一键研究与生成",
};

const PipelineRequestSchema = z.object({
  keyword: ResearchRequestSchema.shape.keyword,
  marketplace: ResearchRequestSchema.shape.marketplace,
  product: ProductBriefSchema,
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求 JSON 必须是一个对象。");
  }
  return value as Record<string, unknown>;
}

function requestWithDefaults(
  kind: RequestKind,
  input: Record<string, unknown>,
  exampleData: string[] = [],
): WorkbenchRequest {
  const data = { ...input };
  const examples = [...exampleData];
  const useExample = (field: string, value: unknown, source: string) => {
    if (data[field] === undefined) {
      data[field] = structuredClone(value);
      examples.push(source);
    }
  };
  if (kind === "research" || kind === "pipeline") {
    useExample("keyword", researchExample.keyword, "examples/research_request.json（关键词）");
  }
  if (kind === "listing-create") {
    useExample("product", listingCreateExample.product, "examples/listing_create.json（产品）");
    useExample("keywords", listingCreateExample.keywords, "examples/listing_create.json（关键词）");
  }
  if (kind === "listing-audit") {
    useExample("listing", listingAuditExample.listing, "examples/listing_input.json（Listing）");
    useExample("keywords", listingAuditExample.keywords, "examples/listing_input.json（关键词）");
  }
  if (kind === "pipeline") useExample("product", productExample, "examples/product_brief.json");
  const metadata = { exampleData: [...new Set(examples)] };
  const normalizeMarket = <T extends { marketplace: string }>(payload: T): T => ({
    ...payload,
    marketplace: getMarketplace(payload.marketplace).code,
  });

  try {
    switch (kind) {
      case "research":
        return { kind, payload: normalizeMarket(ResearchRequestSchema.parse(data)), ...metadata };
      case "listing-create":
        return { kind, payload: normalizeMarket(ListingCreateRequestSchema.parse(data)), ...metadata };
      case "listing-audit":
        return { kind, payload: normalizeMarket(ListingOptimizeRequestSchema.parse(data)), ...metadata };
      case "pipeline":
        return { kind, payload: normalizeMarket(PipelineRequestSchema.parse(data)), ...metadata };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`请求字段不符合现有契约：${error.issues.map((issue) => `${issue.path.join(".") || "请求"} ${issue.message}`).join("；")}`);
    }
    throw error;
  }
}

/** Shortcut prompts have fixed, reviewable payloads sourced from the repository examples. */
export function createExampleRequest(kind: RequestKind, marketplace = "us"): WorkbenchRequest {
  if (kind === "research") {
    return requestWithDefaults(kind, { keyword: researchExample.keyword, marketplace });
  }
  return requestWithDefaults(kind, { marketplace });
}

function getKind(text: string): RequestKind | null {
  if (/pipeline|一键|全流程/i.test(text)) return "pipeline";
  if (/审计|audit|优化/i.test(text)) return "listing-audit";
  if (/研究|research|选品|关键词/i.test(text)) return "research";
  if (/生成|create|listing/i.test(text)) return "listing-create";
  return null;
}

type MarketMatch = { code: string; text: string };
function marketplaceFromText(text: string): MarketMatch | undefined {
  const explicit = text.match(/(?:marketplace|站点|换站|切换到|换到|amazon|-m)\s*(?:为|到|是|[:=：])?\s*([a-z]{2})(?![a-z])/i);
  if (explicit?.[1]) return { code: getMarketplace(explicit[1]).code, text: explicit[0] };
  const supported = Object.keys(MARKETPLACES).join("|");
  // A bare code is accepted as a suffix, including before an optional deep flag.
  const suffix = text.match(new RegExp(`(?:^|[\\s(（])(${supported})(?=\\s*(?:[)）]|(?:关闭|取消|禁用)\\s*)?(?:deep|深度|扩词|$))`, "i"));
  if (suffix?.[1]) return { code: getMarketplace(suffix[1]).code, text: suffix[0] };
  return undefined;
}

function toneFromText(text: string): Tone | undefined {
  if (/friendly|友好|亲切|轻松/i.test(text)) return "friendly";
  if (/professional|专业/i.test(text)) return "professional";
  if (/urgent|紧迫|紧急/i.test(text)) return "urgent";
  if (/luxury|奢华|高端/i.test(text)) return "luxury";
  return undefined;
}

function deepFromText(text: string): boolean | undefined {
  if (/(?:关闭|取消|禁用|不要)\s*(?:deep|深度|扩词)|deep\s*(?:[=:：]\s*false|\s+off)\b/i.test(text)) return false;
  if (/deep|深度|扩词/i.test(text)) return true;
  return undefined;
}

function keywordFromText(text: string, market?: MarketMatch): string | undefined {
  const quoted = text.match(/["“「]([^"”」]+)["”」]/);
  if (quoted?.[1]) return quoted[1].trim();
  let keyword = market ? text.replace(market.text, " ") : text;
  keyword = keyword
    .replace(/(?:examples[/\\][\w_]+\.json)/gi, " ")
    .replace(/(?:关闭|取消|禁用|不要)\s*(?:deep|深度(?:扩词)?|扩词)|deep(?:\s*[=:：]\s*(?:true|false)|\s+off)?/gi, " ")
    .replace(/pipeline|research|一键|全流程|研究|选品|关键词|深度|扩词/gi, " ")
    .replace(/^(?:\s*(?:请|帮我|帮忙|麻烦|please|一下|：|:|研究完|直接|生成|listing|\+|[-—]))+/i, "")
    .replace(/[()（）+]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,，;；:：、]+|[\s,，;；:：、]+$/g, "");
  return keyword || undefined;
}

function withTone(request: WorkbenchRequest, tone: Tone | undefined): WorkbenchRequest {
  if (!tone || request.kind === "research") return request;
  const product = request.payload.product ?? ProductBriefSchema.parse(productExample);
  const examples = request.payload.product
    ? request.exampleData
    : [...request.exampleData, "examples/product_brief.json（改写产品）"];
  return requestWithDefaults(request.kind, {
    ...request.payload,
    product: { ...product, tone },
  }, examples);
}

/** A deliberately small command protocol. Unrecognized input never invokes an LLM. */
export function parseIntent(text: string, previous?: WorkbenchRequest, defaultMarketplace = "us"): WorkbenchRequest | null {
  const value = text.trim();
  if (!value) return null;
  const jsonStart = value.indexOf("{");
  const command = jsonStart >= 0 ? value.slice(0, jsonStart).trim() : value;
  const kind = getKind(command);
  const market = marketplaceFromText(command);
  const tone = toneFromText(command);
  const deep = deepFromText(command);

  if (!kind) {
    if (!previous || jsonStart >= 0) return null;
    const changeMarket = market && /换|切换|marketplace|站点|^\s*[a-z]{2}\s*$/i.test(command);
    const changeTone = tone && /语气|tone|换|改/i.test(command) && previous.kind !== "research";
    const changeDeep = deep !== undefined && previous.kind === "research";
    if (!changeMarket && !changeTone && !changeDeep) return null;
    const next = requestWithDefaults(previous.kind, {
      ...previous.payload,
      ...(changeMarket ? { marketplace: market.code } : {}),
      ...(changeDeep ? { deep } : {}),
    }, previous.exampleData);
    return withTone(next, changeTone ? tone : undefined);
  }

  let raw: Record<string, unknown> = {};
  if (jsonStart >= 0) {
    try {
      raw = record(JSON.parse(value.slice(jsonStart)));
    } catch (error) {
      throw new Error(`无法读取请求 JSON：${error instanceof Error ? error.message : "请检查 JSON 格式。"}`);
    }
  } else if (kind === "research" || kind === "pipeline") {
    const keyword = keywordFromText(command, market);
    if (keyword) raw.keyword = keyword;
  }
  if (market) raw.marketplace = market.code;
  if (raw.marketplace === undefined) raw.marketplace = previous?.payload.marketplace ?? defaultMarketplace;
  if (kind === "research" && deep !== undefined) raw.deep = deep;
  return withTone(requestWithDefaults(kind, raw), tone);
}
