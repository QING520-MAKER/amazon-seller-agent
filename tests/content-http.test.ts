import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/http/routes.js";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { CreateProductSchema, ContentDetailSchema, ContentExportSchema, ContentPageSchema, GenerateContentSchema, GenerateContentResultSchema, ProductDetailSchema } from "../src/schemas.js";

let catalog: CatalogService;
let app: ReturnType<typeof createApp>;
let productId: string;
let revisionId: string;
const json = (method: string, value: unknown, origin?: string) => ({ method, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(value) });

beforeEach(async () => {
  await mkdir("E:\\CodexTemp", { recursive: true });
  const dataDir = await mkdtemp("E:\\CodexTemp\\asa-content-http-");
  catalog = (await openCatalog({ dataDir })).catalog;
  app = createApp({ catalog });
  const response = await app.request("/api/products", json("POST", { sku: "HTTP-CONTENT", brief: { name: "Travel Mug", brand: "Acme", attributes: ["300 ml"] } }));
  const product = ProductDetailSchema.parse(await response.json());
  productId = product.product.id;
  revisionId = product.currentRevision.id;
});
afterEach(() => catalog.close());

describe("content HTTP contract", () => {
  it("generates, lists, edits, reviews and exports a product-bound version", async () => {
    const input = GenerateContentSchema.parse({ requestId: randomUUID(), sourceRevisionId: revisionId,
      baseContentVersionId: null, marketplace: "us", keywords: ["travel mug"], mode: "template" });
    const generatedResponse = await app.request(`/api/products/${productId}/content/generate`, json("POST", input, "http://localhost:5173"));
    expect(generatedResponse.status).toBe(200);
    const generated = GenerateContentResultSchema.parse(await generatedResponse.json());
    expect(generated.run.status).toBe("succeeded");
    const first = generated.content!;

    const page = ContentPageSchema.parse(await (await app.request(`/api/products/${productId}/content`)).json());
    expect(page.total).toBe(1);
    expect(page.headVersionId).toBe(first.id);
    const detail = ContentDetailSchema.parse(await (await app.request(`/api/products/${productId}/content/${first.id}`)).json());
    expect(detail.content.sourceRevisionId).toBe(revisionId);

    const edited = { ...first.copy, title: "Acme travel mug edited" };
    const savedResponse = await app.request(`/api/products/${productId}/content`, json("PUT", { baseContentVersionId: first.id, copy: edited }, "http://localhost:5173"));
    expect(savedResponse.status).toBe(200);
    const saved = ContentDetailSchema.shape.content.parse(await savedResponse.json());
    const reviewed = await app.request(`/api/products/${productId}/content/${saved.id}/reviews`, json("POST", { decision: "approved", notes: "checked" }, "http://localhost:5173"));
    expect(reviewed.status).toBe(201);
    const exported = await app.request(`/api/products/${productId}/content/${saved.id}/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain("attachment");
    expect(ContentExportSchema.parse(await exported.json()).status).toBe("approved");
  });

  it("keeps request IDs idempotent, rejects invalid knowledge, and enforces Origin", async () => {
    const input = { requestId: randomUUID(), sourceRevisionId: revisionId, baseContentVersionId: null, keywords: ["travel mug"], mode: "template" as const };
    const first = await app.request(`/api/products/${productId}/content/generate`, json("POST", input));
    const firstBody = GenerateContentResultSchema.parse(await first.json());
    const replay = await app.request(`/api/products/${productId}/content/generate`, json("POST", input));
    const replayBody = GenerateContentResultSchema.parse(await replay.json());
    expect(replayBody.reused).toBe(true);
    expect(replayBody.run.id).toBe(firstBody.run.id);
    const knowledge = await app.request(`/api/products/${productId}/content/generate`, json("POST", { ...input, requestId: randomUUID(), knowledgeRevisionIds: [randomUUID()] }));
    expect(knowledge.status).toBe(422);
    expect(await knowledge.json()).toMatchObject({ error: { code: "KNOWLEDGE_NOT_APPROVED" } });
    const denied = await app.request(`/api/products/${productId}/content/generate`, json("POST", { ...input, requestId: randomUUID() }, "https://example.invalid"));
    expect(denied.status).toBe(403);
  });
});
