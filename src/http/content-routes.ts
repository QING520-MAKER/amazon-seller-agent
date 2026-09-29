import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  CatalogIdSchema, CatalogPaginationSchema, ContentDetailSchema, ContentExportSchema, ContentPageSchema,
  ContentReviewRequestSchema, ContentReviewSchema, ContentRunPageSchema, ContentVersionSchema,
  GenerateContentResultSchema, GenerateContentSchema, SaveContentSchema,
} from "../schemas.js";
import { CatalogError, storageError } from "../catalog/errors.js";
import type { CatalogService } from "../catalog/service.js";
import { boundedBody } from "./catalog-routes.js";
import { STORAGE_LIMITS } from "../storage/settings.js";

const origins = new Set(["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8787", "http://localhost:8787"]);

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new CatalogError(422, "INVALID_REQUEST", "请求字段不符合要求。", undefined,
    result.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })));
  return result.data;
}
function query(c: Context) {
  const params = new URL(c.req.url).searchParams;
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (key in result) throw new CatalogError(422, "INVALID_REQUEST", "查询参数不能重复。");
    result[key] = value;
  }
  return result;
}
function id(c: Context, key: string) { return parse(CatalogIdSchema, c.req.param(key)); }
async function jsonBody(c: Context) {
  if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new CatalogError(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 application/json 提交请求。");
  }
  const bytes = await boundedBody(c.req.raw, STORAGE_LIMITS.jsonBytes);
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new CatalogError(400, "INVALID_JSON", "请求正文不是有效的 JSON。"); }
}
function success<S extends z.ZodTypeAny>(c: Context, schema: S, data: unknown, status: 200 | 201 = 200) {
  const result = schema.safeParse(data);
  if (!result.success) throw new CatalogError(500, "INVALID_RESULT", "存储返回的数据未通过校验，请检查服务日志。");
  return c.json(result.data, status);
}

export function createContentRoutes(catalog?: CatalogService) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!catalog?.contentService) return c.json({ error: { code: "STORAGE_UNAVAILABLE", message: "商品存储尚未就绪，请启动本地 API 服务。" } }, 503);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin !== undefined && !origins.has(origin)) return c.json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "此网页来源不能修改本地商品。" } }, 403);
    }
    await next();
  });
  app.onError((error, c) => {
    const failure = storageError(error);
    if (!(error instanceof CatalogError)) console.error("content operation failed", failure.code);
    return c.json({ error: { code: failure.code, message: failure.message, details: failure.details, issues: failure.issues } }, failure.status);
  });

  // Keep runs before /:versionId so the literal segment cannot be captured as an ID.
  app.get("/:productId/content/runs", c => {
    const page = parse(CatalogPaginationSchema, query(c));
    return success(c, ContentRunPageSchema, catalog!.contentService!.runs(id(c, "productId"), page));
  });
  app.get("/:productId/content", c => {
    const page = parse(CatalogPaginationSchema, query(c));
    return success(c, ContentPageSchema, catalog!.contentService!.list(id(c, "productId"), page));
  });
  app.post("/:productId/content/generate", async c => {
    const productId = id(c, "productId");
    const result = await catalog!.contentService!.generate(productId, parse(GenerateContentSchema, await jsonBody(c)));
    return success(c, GenerateContentResultSchema, result);
  });
  app.put("/:productId/content", async c => {
    const productId = id(c, "productId");
    const result = catalog!.contentService!.save(productId, parse(SaveContentSchema, await jsonBody(c)));
    return success(c, ContentVersionSchema, result);
  });
  app.get("/:productId/content/:versionId/export", c => {
    const params = parse(z.object({ draft: z.literal("1").optional() }).strict(), query(c));
    const result = catalog!.contentService!.export(id(c, "productId"), id(c, "versionId"), params.draft === "1");
    const body = parse(ContentExportSchema, result);
    const filename = encodeURIComponent(`listing-${body.sku}.json`).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16));
    return new Response(JSON.stringify(body), { headers: {
      "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="listing.json"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
    } });
  });
  app.get("/:productId/content/:versionId", c => success(c, ContentDetailSchema,
    catalog!.contentService!.detail(id(c, "productId"), id(c, "versionId"))));
  app.post("/:productId/content/:versionId/reviews", async c => {
    const productId = id(c, "productId"), versionId = id(c, "versionId");
    const input = parse(ContentReviewRequestSchema, await jsonBody(c));
    return success(c, ContentReviewSchema, catalog!.contentService!.review(productId, versionId, input.decision, input.notes), 201);
  });
  return app;
}
