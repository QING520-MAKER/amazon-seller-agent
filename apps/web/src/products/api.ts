import { z } from "zod";
import {
  ApiFailureSchema, AssetPageSchema, AssetStateResultSchema, ProductDetailSchema, ProductPageSchema,
  ProductRevisionSchema, RevisionPageSchema, SaveProductResultSchema, UploadAssetResultSchema,
  type CreateProductInput, type SaveProductBrief, type OriginalAsset, type ApiFailure,
} from "../../../../src/schemas.js";

export class CatalogApiError extends Error {
  constructor(message: string, readonly status = 0, readonly code = "NETWORK_ERROR",
    readonly details?: ApiFailure["error"]["details"], readonly issues?: ApiFailure["error"]["issues"],
    readonly uncertain = false) { super(message); }
}
async function request(path: string, init: RequestInit = {}) {
  const write = init.method !== undefined && init.method !== "GET";
  try { return await fetch("/api/products" + path, init); }
  catch (error) {
    if (!write && error instanceof Error && error.name === "AbortError") throw error;
    throw new CatalogApiError(write ? "保存结果待确认。请先核对服务器记录，再重试。" : "无法连接商品服务，请检查本地 API 后重试。",
      0, "NETWORK_ERROR", undefined, undefined, write);
  }
}
async function failure(response: Response) {
  let data: unknown;
  try { data = await response.json(); } catch {}
  const result = ApiFailureSchema.safeParse(data);
  return result.success
    ? new CatalogApiError(result.data.error.message, response.status, result.data.error.code, result.data.error.details, result.data.error.issues)
    : new CatalogApiError("商品服务返回异常（HTTP " + response.status + "）。", response.status, "INVALID_RESPONSE");
}
async function json<S extends z.ZodTypeAny>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const response = await request(path, init);
  if (!response.ok) throw await failure(response);
  let data: unknown;
  try { data = await response.json(); } catch {}
  const result = schema.safeParse(data);
  if (!result.success) throw new CatalogApiError("服务器响应未通过校验，请重新读取记录核对结果。", response.status, "INVALID_RESPONSE", undefined, undefined, Boolean(init.method));
  return result.data;
}
const body = (method: string, input: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const listProducts = (q = "", offset = 0, signal?: AbortSignal) => json("?" + new URLSearchParams({ q, offset: String(offset), limit: "20" }), ProductPageSchema, { signal });
export const getProduct = (id: string, signal?: AbortSignal) => json("/" + id, ProductDetailSchema, { signal });
export const createProduct = (input: CreateProductInput) => json("", ProductDetailSchema, body("POST", input));
export const saveProduct = (id: string, input: SaveProductBrief) => json("/" + id + "/brief", SaveProductResultSchema, body("PUT", input));
export const listRevisions = (id: string, offset = 0, signal?: AbortSignal) => json("/" + id + "/revisions?offset=" + offset, RevisionPageSchema, { signal });
export const getRevision = (id: string, revisionId: string, signal?: AbortSignal) => json("/" + id + "/revisions/" + revisionId, ProductRevisionSchema, { signal });
export const listAssets = (id: string, state: "active" | "archived", offset = 0, signal?: AbortSignal) => json("/" + id + "/assets?" + new URLSearchParams({ state, offset: String(offset) }), AssetPageSchema, { signal });
export const setAssetState = (id: string, asset: OriginalAsset, archived: boolean) => json("/" + id + "/assets/" + asset.id, AssetStateResultSchema, body("PATCH", { expectedVersion: asset.version, archived }));
export function uploadAsset(id: string, file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.append("file", file);
  return json("/" + id + "/assets", UploadAssetResultSchema, { method: "POST", body: form, signal });
}
export const contentUrl = (id: string, assetId: string, download = false) => "/api/products/" + id + "/assets/" + assetId + "/content" + (download ? "?download=1" : "");
export async function getAssetBlob(id: string, assetId: string, signal: AbortSignal) {
  const response = await request("/" + id + "/assets/" + assetId + "/content", { signal });
  if (!response.ok) throw await failure(response);
  return response.blob();
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试。";
