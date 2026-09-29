import { z } from "zod";
import {
  ApiFailureSchema,
  KnowledgePageSchema,
  KnowledgeRevisionSchema,
  SaveKnowledgeSchema,
  type KnowledgeFields,
  type SaveKnowledge,
} from "../../../../src/schemas.js";
import { CatalogApiError } from "../products/api.js";
import { CreateKnowledgeRequestSchema } from "../../../../src/knowledge/contracts.js";

async function request(path: string, init: RequestInit = {}) {
  const write = init.method !== undefined && init.method !== "GET";
  try {
    return await fetch(`/api/products${path}`, init);
  } catch (error) {
    if (!write && error instanceof Error && error.name === "AbortError") throw error;
    throw new CatalogApiError(
      write ? "保存结果待确认。请先核对知识库记录，再重试。" : "无法连接知识库服务，请检查本地 API 后重试。",
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
    : new CatalogApiError(`知识库服务返回异常（HTTP ${response.status}）。`, response.status, "INVALID_RESPONSE");
}

async function json<S extends z.ZodTypeAny>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const response = await request(path, init);
  if (!response.ok) throw await failure(response);
  let data: unknown;
  try { data = await response.json(); } catch { /* handled as a schema error below */ }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new CatalogApiError("服务器响应未通过知识库契约校验，请重新读取记录核对结果。", response.status, "INVALID_RESPONSE", undefined, undefined, Boolean(init.method));
  return parsed.data;
}

const body = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

export const listKnowledge = (productId: string, query = "", status: "all" | "draft" | "approved" | "archived" = "all", offset = 0, limit = 20, signal?: AbortSignal) =>
  json(`/${productId}/knowledge?${new URLSearchParams({ q: query, status, limit: String(limit), offset: String(offset) })}`, KnowledgePageSchema, { signal });

export const createKnowledge = (productId: string, input: KnowledgeFields, requestId?: string) => {
  const value = CreateKnowledgeRequestSchema.parse({ ...input, ...(requestId === undefined ? {} : { requestId }) });
  return json(`/${productId}/knowledge`, KnowledgeRevisionSchema, body("POST", value));
};

export const randomRequestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40;
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};

export const saveKnowledge = (productId: string, entryId: string, input: SaveKnowledge) =>
  json(`/${productId}/knowledge/${entryId}`, KnowledgeRevisionSchema, body("PUT", SaveKnowledgeSchema.parse(input)));

export const listKnowledgeRevisions = (productId: string, entryId: string, offset = 0, limit = 20, signal?: AbortSignal) =>
  json(`/${productId}/knowledge/${entryId}/revisions?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`, KnowledgePageSchema, { signal });

export const getKnowledgeRevision = (productId: string, entryId: string, revisionId: string, signal?: AbortSignal) =>
  json(`/${productId}/knowledge/${entryId}/revisions/${revisionId}`, KnowledgeRevisionSchema, { signal });
