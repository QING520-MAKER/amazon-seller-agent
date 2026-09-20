import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { createApp } from "../src/http/routes.js";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { boundedBody } from "../src/http/catalog-routes.js";
import { STORAGE_LIMITS } from "../src/storage/settings.js";
import { CreateProductSchema, OriginalAssetSchema, ProductDetailSchema } from "../src/schemas.js";
import { apng, png, pngChunk } from "./fixtures/catalog-images.js";

let catalog: CatalogService, app: ReturnType<typeof createApp>, productId: string;
const json = (method: string, value: unknown, origin?: string) => ({ method, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(value) });
function upload(bytes: Uint8Array, name = "原图.jpg", type = "text/html") {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  return { method: "POST", body: form };
}
beforeEach(async () => {
  await mkdir("E:\\CodexTemp", { recursive: true });
  const dataDir = await mkdtemp("E:\\CodexTemp\\asa-http-");
  catalog = (await openCatalog({ dataDir })).catalog;
  app = createApp({ catalog });
  productId = catalog.repository.create(CreateProductSchema.parse({ sku: "A", brief: { name: "真实商品" } })).product.id;
});
afterEach(() => catalog.close());

describe("catalog HTTP contract", () => {
  it("keeps the old synchronous app factory usable without storage", async () => {
    const old = createApp();
    expect((await old.request("/api/health")).status).toBe(200);
    expect((await old.request("/api/products")).status).toBe(503);
    expect((await old.request("/api/products", json("POST", {}))).status).toBe(503);
  });
  it("creates, lists, searches and returns structured duplicate SKU errors", async () => {
    const input = { sku: " B ", brief: { name: "新资料" } };
    const responses = await Promise.all([app.request("/api/products", json("POST", input)), app.request("/api/products", json("POST", input))]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const response = responses.find(response => response.status === 201)!;
    const created = ProductDetailSchema.parse(await response.json());
    expect(created.currentRevision.brief.features).toEqual([]);
    const conflict = responses.find(response => response.status === 409)!;
    expect(await conflict.json()).toMatchObject({ error: { code: "SKU_CONFLICT", details: { existingProductId: created.product.id } } });
    expect(catalog.repository.db.prepare("SELECT COUNT(*) AS n FROM product_revisions").get()).toEqual({ n: 2 });
    const page = await (await app.request("/api/products?q=" + encodeURIComponent("新资料"))).json();
    expect(page).toMatchObject({ total: 1, limit: 20, offset: 0 });
  });
  it.each(["?limit=0", "?limit=1.5", "?offset=-1", "?x=1", "?limit=1&limit=2"])("rejects invalid query %s", async query => {
    expect((await app.request("/api/products" + query)).status).toBe(422);
  });
  it("checks content types, JSON parsing, unknown fields and origins", async () => {
    expect((await app.request("/api/products", { method: "POST", body: "{}" })).status).toBe(415);
    expect((await app.request("/api/products", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })).status).toBe(400);
    const body = { sku: "B", brief: { name: "N" }, assetIds: [] };
    expect((await app.request("/api/products", json("POST", body))).status).toBe(422);
    for (const origin of ["https://example.invalid", "null", "http://localhost:5174"]) {
      expect((await app.request("/api/products", json("POST", body, origin))).status).toBe(403);
    }
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
      const result = await app.request("/api/products", json("POST", { sku: origin, brief: { name: "N" } }, origin));
      expect(result.status).toBe(201);
      expect(result.headers.has("access-control-allow-origin")).toBe(false);
    }
  });
  it("only one same-base change succeeds and a missing snapshot field never clears data", async () => {
    const current = catalog.repository.detail(productId);
    const input = { baseRevisionId: current.currentRevision.id, brief: { ...current.currentRevision.brief, brand: "品牌" }, sourceNote: "包装" };
    const responses = await Promise.all([app.request("/api/products/" + productId + "/brief", json("PUT", input)), app.request("/api/products/" + productId + "/brief", json("PUT", input))]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const saved = catalog.repository.detail(productId);
    const missing = await app.request("/api/products/" + productId + "/brief", json("PUT", { ...input, baseRevisionId: saved.currentRevision.id, brief: { name: "新名称" } }));
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ error: { code: "INVALID_REQUEST", issues: expect.arrayContaining([expect.objectContaining({ path: "brief.brand" })]) } });
    expect(catalog.repository.detail(productId).currentRevision.brief.brand).toBe("品牌");
    const noOp = await app.request("/api/products/" + productId + "/brief", json("PUT", { ...input, baseRevisionId: saved.currentRevision.id }));
    expect(await noOp.json()).toMatchObject({ changed: false });
  });
  it("checks ownership, keeps raw bytes, ignores declared MIME and never exposes storageKey", async () => {
    const bytes = await png();
    const response = await app.request("/api/products/" + productId + "/assets", upload(bytes, "..\\中文 % 原图.jpg"));
    expect(response.status).toBe(201);
    const result = await response.json();
    const asset = OriginalAssetSchema.parse(result.asset);
    expect(asset.mimeType).toBe("image/png");
    expect(result.asset).not.toHaveProperty("storageKey");
    const url = "/api/products/" + productId + "/assets/" + asset.id;
    const content = await app.request(url + "/content?download=1");
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(content.headers.get("content-disposition")).toContain("attachment;");
    expect(Buffer.from(await content.arrayBuffer())).toEqual(bytes);
    const other = catalog.repository.create(CreateProductSchema.parse({ sku: "B", brief: { name: "B" } }));
    expect((await app.request("/api/products/" + other.product.id + "/assets/" + asset.id + "/content")).status).toBe(404);
    expect((await app.request("/api/products/" + productId + "/revisions/" + other.currentRevision.id)).status).toBe(404);
    expect((await app.request(url, json("PATCH", { expectedVersion: 1, archived: true }))).status).toBe(200);
    const reused = await app.request("/api/products/" + productId + "/assets", upload(bytes));
    expect(reused.status).toBe(200);
    expect(await reused.json()).toMatchObject({ reused: true, asset: { id: asset.id, version: 2, archivedAt: expect.any(String) } });
    expect((await app.request(url + "/content")).status).toBe(200);
    expect((await app.request(url, json("PATCH", { expectedVersion: 1, archived: false }))).status).toBe(409);
  });
  it("rejects invalid multipart and duplicate/extra fields", async () => {
    const path = "/api/products/" + productId + "/assets";
    expect((await app.request(path, { method: "POST", headers: { "content-type": "multipart/form-data" }, body: "broken" })).status).toBe(400);
    for (const field of ["file", "extra"]) {
      const request = upload(await png());
      request.body.append(field, new File([await png()], "second.png"));
      expect((await app.request(path, request)).status).toBe(422);
    }
  });
  it("rejects empty, HTML, SVG, APNG, truncated and pixel-corrupt files without saving assets", async () => {
    const valid = await png();
    const jpeg = await sharp(valid).jpeg().toBuffer();
    const corrupt = Buffer.from(valid);
    const at = corrupt.indexOf(Buffer.from("IDAT")) + 4;
    corrupt[at + 4] = (corrupt[at + 4] ?? 0) ^ 0xff;
    await sharp(corrupt).metadata(); // headers alone still pass.
    for (const bytes of [Buffer.alloc(0), Buffer.from("<html>not a photo</html>"), Buffer.from("<svg></svg>"), await apng(), valid.subarray(0, 45), jpeg.subarray(0, jpeg.length - 50), corrupt]) {
      const response = await app.request("/api/products/" + productId + "/assets", upload(bytes));
      expect([415, 422]).toContain(response.status);
    }
    expect(catalog.repository.assets(productId, "active", { limit: 20, offset: 0 }).total).toBe(0);
    expect(await readdir(join(catalog.files.root, "tmp"))).toHaveLength(0);
  });
  it("rejects excess edges/pixels and accepts the edge boundary", async () => {
    for (const [width, height] of [[12001, 1], [8001, 5000]]) {
      const response = await app.request("/api/products/" + productId + "/assets", upload(await png(width, height)));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: "IMAGE_LIMIT_EXCEEDED" } });
    }
    expect((await app.request("/api/products/" + productId + "/assets", upload(await png(12000, 1)))).status).toBe(201);
  }, 20000);
  it("enforces the file byte boundary independently of the multipart limit", async () => {
    const base = await png();
    const padded = Buffer.concat([base.subarray(0, -12), pngChunk("raNd", Buffer.alloc(STORAGE_LIMITS.fileBytes - base.length - 12)), base.subarray(-12)]);
    expect(padded.length).toBe(STORAGE_LIMITS.fileBytes);
    const path = "/api/products/" + productId + "/assets";
    expect((await app.request(path, upload(padded))).status).toBe(201);
    const over = await app.request(path, upload(Buffer.concat([padded, Buffer.alloc(1)])));
    expect(over.status).toBe(413);
  }, 30000);
  it("counts real bytes even with an understated length and cancels overflowing streams", async () => {
    for (const headers of [{}, { "content-length": "1" }]) {
      let pulls = 0;
      const cancelled = vi.fn();
      const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(5)); }, cancel: cancelled });
      const request = new Request("http://localhost/", { method: "POST", headers, body: stream, duplex: "half" } as RequestInit);
      await expect(boundedBody(request, 8, true)).rejects.toMatchObject({ code: "UPLOAD_TOO_LARGE" });
      expect(cancelled).toHaveBeenCalledOnce();
      expect(pulls).toBeLessThanOrEqual(3);
    }
  });
  it("does not queue unbounded uploads and maps storage failures without leaking paths", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = catalog.withUploadSlot(() => gate), second = catalog.withUploadSlot(() => gate);
    await expect(catalog.withUploadSlot(async () => {})).rejects.toMatchObject({ code: "STORAGE_BUSY" });
    release(); await Promise.all([first, second]);
    vi.spyOn(catalog.repository, "create").mockImplementation(() => { throw Object.assign(new Error("secret SQL E:\\private\\file"), { code: "SQLITE_FULL" }); });
    const response = await app.request("/api/products", json("POST", { sku: "B", brief: { name: "N" } }));
    expect(response.status).toBe(507);
    expect(await response.text()).not.toMatch(/secret|private|SQL/);
  });
});
