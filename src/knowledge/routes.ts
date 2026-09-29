import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  CatalogIdSchema, CatalogPaginationSchema, KnowledgePageSchema,
  KnowledgeQuerySchema, KnowledgeRevisionSchema, SaveKnowledgeSchema,
} from "../schemas.js";
import type { CatalogService } from "../catalog/service.js";
import { CatalogError, storageError } from "../catalog/errors.js";
import { boundedBody } from "../http/catalog-routes.js";
import { STORAGE_LIMITS } from "../storage/settings.js";
import { KnowledgeRepository } from "./repository.js";
import { CreateKnowledgeRequestSchema } from "./contracts.js";

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

function id(c: Context, key: string) {
  return parse(CatalogIdSchema, c.req.param(key));
}

function media(c: Context) {
  if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new CatalogError(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 application/json 提交请求。");
  }
}

async function jsonBody(c: Context) {
  media(c);
  const bytes = await boundedBody(c.req.raw, STORAGE_LIMITS.jsonBytes);
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new CatalogError(400, "INVALID_JSON", "请求正文不是有效的 JSON。"); }
}

function success<S extends z.ZodTypeAny>(c: Context, schema: S, value: unknown, status: 200 | 201 = 200) {
  const result = schema.safeParse(value);
  if (!result.success) throw new CatalogError(500, "INVALID_RESULT", "知识库返回的数据未通过校验，请检查服务日志。");
  return c.json(result.data, status);
}

export function createKnowledgeRoutes(catalog?: CatalogService) {
  const app = new Hono();
  const knowledge = catalog ? new KnowledgeRepository(catalog.repository) : undefined;

  app.use("*", async (c, next) => {
    if (!catalog || !knowledge) return c.json({ error: { code: "STORAGE_UNAVAILABLE", message: "商品存储尚未就绪，请启动本地 API 服务。" } }, 503);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin !== undefined && !origins.has(origin)) return c.json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "此网页来源不能修改本地知识库。" } }, 403);
    }
    await next();
  });

  app.onError((error, c) => {
    const failure = storageError(error);
    if (!(error instanceof CatalogError)) console.error("knowledge operation failed", failure.code);
    return c.json({ error: { code: failure.code, message: failure.message, details: failure.details, issues: failure.issues } }, failure.status);
  });

  app.get("/:productId/knowledge", (c) => {
    const productId = id(c, "productId");
    return success(c, KnowledgePageSchema, knowledge!.list(productId, parse(KnowledgeQuerySchema, query(c))));
  });
  app.post("/:productId/knowledge", async (c) => {
    const productId = id(c, "productId");
    const request = parse(CreateKnowledgeRequestSchema, await jsonBody(c));
    const { requestId, ...fields } = request;
    return success(c, KnowledgeRevisionSchema, knowledge!.create(productId, fields, requestId), 201);
  });
  app.put("/:productId/knowledge/:entryId", async (c) => {
    const productId = id(c, "productId");
    const entryId = id(c, "entryId");
    return success(c, KnowledgeRevisionSchema, knowledge!.save(productId, entryId, parse(SaveKnowledgeSchema, await jsonBody(c))));
  });
  app.get("/:productId/knowledge/:entryId/revisions", (c) => {
    const productId = id(c, "productId");
    const entryId = id(c, "entryId");
    return success(c, KnowledgePageSchema, knowledge!.history(productId, entryId, parse(CatalogPaginationSchema, query(c))));
  });
  app.get("/:productId/knowledge/:entryId/revisions/:revisionId", (c) => {
    const productId = id(c, "productId");
    const entryId = id(c, "entryId");
    const revisionId = id(c, "revisionId");
    return success(c, KnowledgeRevisionSchema, knowledge!.revision(productId, entryId, revisionId));
  });
  return app;
}
