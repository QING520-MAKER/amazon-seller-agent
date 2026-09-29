import { z } from "zod";
import { ApiFailureSchema, ContentPackagePageSchema, ContentPackageSchema, type CreateContentPackage } from "../../../../src/schemas.js";
import { CatalogApiError } from "../products/api.js";

async function request(path: string, init: RequestInit = {}) {
  const write = init.method !== undefined && init.method !== "GET";
  try { return await fetch(`/api/products${path}`, init); }
  catch (error) {
    if (!write && error instanceof Error && error.name === "AbortError") throw error;
    throw new CatalogApiError(write ? "保存结果待确认。请核对内容包记录后再决定是否重试。" : "无法连接内容包服务，请检查本地 API 后重试。", 0, "NETWORK_ERROR", undefined, undefined, write);
  }
}
async function failure(response: Response) {
  let value: unknown;
  try { value = await response.json(); } catch {}
  const parsed = ApiFailureSchema.safeParse(value);
  return parsed.success ? new CatalogApiError(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.details, parsed.data.error.issues) : new CatalogApiError(`内容包服务返回异常（HTTP ${response.status}）。`, response.status, "INVALID_RESPONSE");
}
async function json<S extends z.ZodTypeAny>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const response = await request(path, init);
  if (!response.ok) throw await failure(response);
  let value: unknown;
  try { value = await response.json(); } catch {}
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CatalogApiError("服务器响应未通过内容包契约校验，请重新读取记录核对结果。", response.status, "INVALID_RESPONSE", undefined, undefined, Boolean(init.method));
  return parsed.data;
}
const body = (method: string, value: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
export const listPackages = (productId: string, offset = 0, limit = 20, signal?: AbortSignal) => json(`/${productId}/packages?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`, ContentPackagePageSchema, { signal });
export const getPackage = (productId: string, packageId: string, signal?: AbortSignal) => json(`/${productId}/packages/${packageId}`, ContentPackageSchema, { signal });
export const createPackage = (productId: string, input: CreateContentPackage) => json(`/${productId}/packages`, ContentPackageSchema, body("POST", input));

export async function downloadPackage(productId: string, packageId: string, signal?: AbortSignal) {
  const response = await request(`/${productId}/packages/${packageId}/download`, { signal });
  if (!response.ok) throw await failure(response);
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    let value: unknown;
    try { value = await response.json(); } catch {}
    const parsed = ApiFailureSchema.safeParse(value);
    throw parsed.success ? new CatalogApiError(parsed.data.error.message, response.status, parsed.data.error.code) : new CatalogApiError("内容包下载返回异常。", response.status, "INVALID_RESPONSE");
  }
  return { blob: await response.blob(), contentDisposition: response.headers.get("content-disposition") ?? "" };
}

export const randomRequestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40; bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};
