import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { BatchService } from "../src/batch/service.js";
import { createBatchRoutes } from "../src/batch/routes.js";
import { ContentBatchSchema, CreateProductSchema, ProductImportResultSchema, ProductDetailSchema } from "../src/schemas.js";

let catalog: CatalogService;
let app: Hono;
const json = (method: string, value: unknown, origin?: string) => ({ method, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(value) });

beforeEach(async () => {
  await mkdir("E:\\CodexTemp", { recursive: true });
  const dataDir = await mkdtemp("E:\\CodexTemp\\asa-batch-http-");
  catalog = (await openCatalog({ dataDir })).catalog;
  expect(catalog.batchService).toBeDefined();
  app = new Hono();
  app.route("/api", createBatchRoutes(catalog.batchService));
});
afterEach(() => catalog.close());

describe("batch HTTP contract", () => {
  it("creates, lists and explicitly executes a batch, with strict origin and query validation", async () => {
    const productResponse = await app.request("/api/products/import", json("POST", { items: [{ sku: "HTTP-BATCH", brief: { name: "Travel Mug" } }] }, "http://localhost:5173"));
    expect(productResponse.status).toBe(200);
    const imported = ProductImportResultSchema.parse(await productResponse.json());
    const productId = imported.items[0]!.productId!;
    const detail = catalog.repository.detail(productId);
    const payload = { requestId: randomUUID(), items: [{ productId, input: {
      requestId: randomUUID(), sourceRevisionId: detail.currentRevision.id, baseContentVersionId: null,
      keywords: ["mug"], mode: "template",
    } }] };
    const createdResponse = await app.request("/api/batches", json("POST", payload, "http://localhost:5173"));
    expect(createdResponse.status).toBe(201);
    const created = ContentBatchSchema.parse(await createdResponse.json());
    expect(created.status).toBe("queued");
    expect((await app.request("/api/batches?limit=20&offset=0")).status).toBe(200);
    const executed = await app.request(`/api/batches/${created.id}/execute`, json("POST", {}, "http://localhost:5173"));
    expect(executed.status).toBe(200);
    expect(ContentBatchSchema.parse(await executed.json()).items[0]!.status).toBe("succeeded");
    expect((await app.request(`/api/batches/${created.id}?random=1`)).status).toBe(422);
    expect((await app.request("/api/batches", json("POST", payload, "https://evil.invalid"))).status).toBe(403);
  });

  it("returns safe not-ready and schema errors", async () => {
    const unavailable = new Hono();
    unavailable.route("/api", createBatchRoutes());
    const notReady = await unavailable.request("/api/batches");
    expect(notReady.status).toBe(503);
    const bad = await app.request("/api/batches", json("POST", { requestId: "bad", items: [] }, "http://localhost:5173"));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });
});
