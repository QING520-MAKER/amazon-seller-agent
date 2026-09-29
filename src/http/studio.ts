import { Hono, type Context } from "hono";
import { z } from "zod";
import { CatalogError, storageError } from "../catalog/errors.js";
import { CatalogIdSchema } from "../schemas.js";
import { STORAGE_LIMITS } from "../storage/settings.js";
import { boundedBody } from "./catalog-routes.js";

const origins = new Set(["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8787", "http://localhost:8787"]);
export function studioRoutes(available: boolean, paths: string[] = ["*"]) {
  const app = new Hono();
  for (const path of paths) app.use(path, async (c, next) => {
    if (!available) return c.json({ error: { code: "STORAGE_UNAVAILABLE", message: "本地存储尚未就绪，请稍后重试。" } }, 503);
    const origin = c.req.header("origin");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) && origin !== undefined && !origins.has(origin))
      return c.json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "此网页来源不能修改本地数据。" } }, 403);
    await next();
  });
  app.onError((error, c) => {
    const failure = storageError(error);
    return c.json({ error: { code: failure.code, message: failure.message, details: failure.details, issues: failure.issues } }, failure.status);
  });
  return app;
}
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CatalogError(422, "INVALID_REQUEST", "请求字段不符合要求。", undefined,
    parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })));
  return parsed.data;
}
export function query(c: Context) {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of new URL(c.req.url).searchParams) {
    if (key in result) throw new CatalogError(422, "INVALID_REQUEST", "查询参数不能重复。");
    result[key] = value;
  }
  return result;
}
export const paramId = (c: Context, key: string) => parse(CatalogIdSchema, c.req.param(key));
export async function readJson(c: Context): Promise<unknown> {
  if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    throw new CatalogError(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 application/json 提交请求。");
  const bytes = await boundedBody(c.req.raw, STORAGE_LIMITS.jsonBytes);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new CatalogError(400, "INVALID_JSON", "请求正文不是有效的 JSON。"); }
}
export function output<S extends z.ZodTypeAny>(c: Context, schema: S, value: unknown, status: 200 | 201 = 200) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CatalogError(500, "INVALID_RESULT", "服务返回的数据未通过校验。");
  c.header("Cache-Control", "no-store");
  return c.json(parsed.data, status);
}
