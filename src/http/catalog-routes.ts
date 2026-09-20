import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  CatalogIdSchema, CreateProductSchema, SaveProductBriefSchema, SetAssetStateSchema,
  CatalogPaginationSchema, ProductQuerySchema, AssetQuerySchema, ProductPageSchema,
  ProductDetailSchema, ProductRevisionSchema, RevisionPageSchema, AssetPageSchema,
  SaveProductResultSchema, UploadAssetResultSchema, AssetStateResultSchema,
} from "../schemas.js";
import { CatalogError, storageError } from "../catalog/errors.js";
import type { CatalogService } from "../catalog/service.js";
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
function id(c: Context, key = "productId") { return parse(CatalogIdSchema, c.req.param(key)); }
function media(c: Context, type: string) {
  if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== type) {
    throw new CatalogError(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 " + type + " 提交请求。");
  }
}
export async function boundedBody(request: Request, max: number, upload = false) {
  const fail = () => new CatalogError(413, upload ? "UPLOAD_TOO_LARGE" : "REQUEST_TOO_LARGE",
    upload ? "上传请求不能超过 21 MiB，单张原图不能超过 20 MiB。" : "资料请求超过 8 MiB 容量限制。");
  const length = request.headers.get("content-length");
  if (length && Number(length) > max) throw fail();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) throw fail();
      parts.push(value);
    }
    return Buffer.concat(parts, bytes);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function jsonBody(c: Context) {
  media(c, "application/json");
  const bytes = await boundedBody(c.req.raw, STORAGE_LIMITS.jsonBytes);
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new CatalogError(400, "INVALID_JSON", "请求正文不是有效的 JSON。"); }
}
function success<S extends z.ZodTypeAny>(c: Context, schema: S, data: unknown, status: 200 | 201 = 200) {
  const result = schema.safeParse(data);
  if (!result.success) throw new CatalogError(500, "INVALID_RESULT", "存储返回的数据未通过校验，请检查服务日志。");
  return c.json(result.data, status);
}
export function createCatalogRoutes(catalog?: CatalogService) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!catalog) return c.json({ error: { code: "STORAGE_UNAVAILABLE", message: "商品存储尚未就绪，请启动本地 API 服务。" } }, 503);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin !== undefined && !origins.has(origin)) return c.json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "此网页来源不能修改本地商品。" } }, 403);
    }
    await next();
  });
  app.onError((error, c) => {
    const failure = storageError(error);
    if (!(error instanceof CatalogError)) console.error("catalog operation failed", failure.code);
    return c.json({ error: { code: failure.code, message: failure.message, details: failure.details, issues: failure.issues } }, failure.status);
  });
  app.get("/", (c) => {
    const { q, ...page } = parse(ProductQuerySchema, query(c));
    return success(c, ProductPageSchema, catalog!.repository.list(q, page));
  });
  app.post("/", async (c) => success(c, ProductDetailSchema, catalog!.repository.create(parse(CreateProductSchema, await jsonBody(c))), 201));
  app.get("/:productId", (c) => success(c, ProductDetailSchema, catalog!.repository.detail(id(c))));
  app.put("/:productId/brief", async (c) => {
    const productId = id(c);
    return success(c, SaveProductResultSchema, catalog!.repository.save(productId, parse(SaveProductBriefSchema, await jsonBody(c))));
  });
  app.get("/:productId/revisions", (c) => success(c, RevisionPageSchema, catalog!.repository.revisions(id(c), parse(CatalogPaginationSchema, query(c)))));
  app.get("/:productId/revisions/:revisionId", (c) => success(c, ProductRevisionSchema, catalog!.repository.revision(id(c), id(c, "revisionId"))));
  app.get("/:productId/assets", (c) => {
    const { state, ...page } = parse(AssetQuerySchema, query(c));
    return success(c, AssetPageSchema, catalog!.repository.assets(id(c), state, page));
  });
  app.post("/:productId/assets", async (c) => {
    const productId = id(c);
    catalog!.repository.product(productId);
    media(c, "multipart/form-data");
    return catalog!.withUploadSlot(async () => {
      const bytes = await boundedBody(c.req.raw, STORAGE_LIMITS.multipartBytes, true);
      let form: FormData;
      try { form = await new Response(bytes, { headers: { "content-type": c.req.header("content-type")! } }).formData(); }
      catch { throw new CatalogError(400, "INVALID_MULTIPART", "上传正文无法解析，请重新选择图片。"); }
      const entries = [...form.entries()];
      if (entries.length !== 1 || entries[0]![0] !== "file" || typeof entries[0]![1] === "string") {
        throw new CatalogError(422, "INVALID_REQUEST", "每次请求只能包含一个 file 文件字段。");
      }
      const result = await catalog!.upload(productId, entries[0]![1]);
      return success(c, UploadAssetResultSchema, result, result.reused ? 200 : 201);
    });
  });
  app.patch("/:productId/assets/:assetId", async (c) => {
    const productId = id(c), assetId = id(c, "assetId");
    const { archived, expectedVersion } = parse(SetAssetStateSchema, await jsonBody(c));
    return success(c, AssetStateResultSchema, catalog!.repository.setAssetState(productId, assetId, expectedVersion, archived));
  });
  app.get("/:productId/assets/:assetId/content", async (c) => {
    const { download } = parse(z.object({ download: z.literal("1").optional() }).strict(), query(c));
    const { asset, bytes } = await catalog!.content(id(c), id(c, "assetId"));
    const displayName = Buffer.from(asset.originalName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255), "utf8").toString("utf8");
    const encoded = encodeURIComponent(displayName).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16));
    return new Response(bytes, { headers: {
      "Content-Type": asset.mimeType, "Content-Length": String(bytes.length),
      "Content-Disposition": (download ? "attachment" : "inline") + "; filename=\"original." + (asset.mimeType === "image/png" ? "png" : "jpg") + "\"; filename*=UTF-8''" + encoded,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
    } });
  });
  return app;
}
