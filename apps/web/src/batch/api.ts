import { z } from "zod";
import { ApiFailureSchema, ContentBatchPageSchema, ContentBatchSchema, CreateContentBatchSchema, ProductImportResultSchema, ProductImportSchema, type CreateContentBatch } from "../../../../src/schemas.js";
import { CatalogApiError } from "../products/api.js";

async function request(path: string, init: RequestInit = {}) {
  const write = init.method !== undefined && init.method !== "GET";
  try { return await fetch(`/api${path}`, init); }
  catch (error) {
    if (!write && error instanceof Error && error.name === "AbortError") throw error;
    throw new CatalogApiError(write ? "保存结果待确认。请核对批次记录后再决定是否重试。" : "无法连接批次服务，请检查本地 API 后重试。", 0, "NETWORK_ERROR", undefined, undefined, write);
  }
}
async function failure(response: Response) {
  let value: unknown;
  try { value = await response.json(); } catch {}
  const parsed = ApiFailureSchema.safeParse(value);
  return parsed.success ? new CatalogApiError(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.details, parsed.data.error.issues) : new CatalogApiError(`批次服务返回异常（HTTP ${response.status}）。`, response.status, "INVALID_RESPONSE");
}
async function json<S extends z.ZodTypeAny>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const response = await request(path, init);
  if (!response.ok) throw await failure(response);
  let value: unknown;
  try { value = await response.json(); } catch {}
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CatalogApiError("服务器响应未通过批次契约校验，请重新读取记录核对结果。", response.status, "INVALID_RESPONSE", undefined, undefined, Boolean(init.method));
  return parsed.data;
}
const body = (method: string, value: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
export const listBatches = (offset = 0, limit = 20, signal?: AbortSignal) => json(`/batches?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`, ContentBatchPageSchema, { signal });
export const getBatch = (id: string, signal?: AbortSignal) => json(`/batches/${id}`, ContentBatchSchema, { signal });
export const createBatch = (input: CreateContentBatch) => json("/batches", ContentBatchSchema, body("POST", CreateContentBatchSchema.parse(input)));
export const executeBatch = (id: string) => json(`/batches/${id}/execute`, ContentBatchSchema, body("POST", {}));
export const importProducts = (value: unknown) => json("/products/import", ProductImportResultSchema, body("POST", ProductImportSchema.parse(value)));
export const randomRequestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40; bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};
