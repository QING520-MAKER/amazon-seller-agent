import { z } from "zod";
import {
  ApiFailureSchema,
  ContentDetailSchema,
  ContentExportSchema,
  ContentPageSchema,
  ContentRunPageSchema,
  ContentReviewSchema,
  ContentVersionSchema,
  GenerateContentResultSchema,
  SaveContentSchema,
  type ContentReviewRequest,
  type GenerateContent,
  type SaveContent,
} from "../../../../src/schemas.js";
import { CatalogApiError } from "../products/api.js";

async function request(path: string, init: RequestInit = {}) {
  const write = init.method !== undefined && init.method !== "GET";
  try {
    return await fetch(`/api/products${path}`, init);
  } catch (error) {
    if (!write && error instanceof Error && error.name === "AbortError") throw error;
    throw new CatalogApiError(
      write ? "保存结果待确认。请先核对服务器记录，再重试。" : "无法连接商品服务，请检查本地 API 后重试。",
      0,
      "NETWORK_ERROR",
      undefined,
      undefined,
      write,
    );
  }
}

async function failure(response: Response) {
  let data: unknown;
  try { data = await response.json(); } catch { /* The status still explains the failure. */ }
  const parsed = ApiFailureSchema.safeParse(data);
  return parsed.success
    ? new CatalogApiError(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.details, parsed.data.error.issues)
    : new CatalogApiError(`商品文案服务返回异常（HTTP ${response.status}）。`, response.status, "INVALID_RESPONSE");
}

async function json<S extends z.ZodTypeAny>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const response = await request(path, init);
  if (!response.ok) throw await failure(response);
  let data: unknown;
  try { data = await response.json(); } catch { /* handled as a schema error below */ }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new CatalogApiError("服务器响应未通过文案契约校验，请重新读取记录核对结果。", response.status, "INVALID_RESPONSE", undefined, undefined, Boolean(init.method));
  }
  return parsed.data;
}

const body = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

export const listContent = (productId: string, offset = 0, limit = 20, signal?: AbortSignal) =>
  json(`/${productId}/content?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`, ContentPageSchema, { signal });

export const getContentDetail = (productId: string, versionId: string, signal?: AbortSignal) =>
  json(`/${productId}/content/${versionId}`, ContentDetailSchema, { signal });

export const generateContent = (productId: string, input: GenerateContent) =>
  json(`/${productId}/content/generate`, GenerateContentResultSchema, body("POST", input));

export const saveContent = (productId: string, input: SaveContent) =>
  json(`/${productId}/content`, ContentVersionSchema, body("PUT", SaveContentSchema.parse(input)));

export const listContentRuns = (productId: string, offset = 0, limit = 20, signal?: AbortSignal) =>
  json(`/${productId}/content/runs?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`, ContentRunPageSchema, { signal });

export const reviewContent = (productId: string, versionId: string, input: ContentReviewRequest) =>
  json(`/${productId}/content/${versionId}/reviews`, ContentReviewSchema, body("POST", input));

export const getContentExport = (productId: string, versionId: string, draft: boolean, signal?: AbortSignal) =>
  json(`/${productId}/content/${versionId}/export?draft=${draft ? "1" : "0"}`, ContentExportSchema, { signal });

export const randomRequestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40;
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};
