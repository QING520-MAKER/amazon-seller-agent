import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { CreateProductSchema, GenerateImageResultSchema, ImageDetailSchema, ImagePageSchema, ImageRunPageSchema } from "../src/schemas.js";
import { createImageRoutes } from "../src/image/routes.js";
import { ImageService } from "../src/image/service.js";
import { png } from "./fixtures/catalog-images.js";

let catalog: CatalogService;
let service: ImageService;
let app: Hono;
let productId: string;
let sourceRevisionId: string;
let assetId: string;
let assetVersion: number;

const json = (method: string, value: unknown, origin?: string) => ({
  method,
  headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
  body: JSON.stringify(value),
});

beforeEach(async () => {
  const dataDir = await mkdtemp("E:\\CodexTemp\\asa-image-http-");
  catalog = (await openCatalog({ dataDir })).catalog;
  expect(catalog.imageService).toBeDefined();
  service = catalog.imageService!;
  const product = catalog.repository.create(CreateProductSchema.parse({ sku: "HTTP-IMAGE", brief: { name: "Travel Mug" } })).product;
  productId = product.id;
  sourceRevisionId = product.currentRevisionId;
  const uploaded = await catalog.upload(productId, new File([await png(40, 32)], "original.png", { type: "image/png" }));
  assetId = uploaded.asset.id;
  assetVersion = uploaded.asset.version;
  app = new Hono();
  app.route("/api/products", createImageRoutes(service));
});

afterEach(() => catalog.close());

function input(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(), sourceRevisionId, originalAssetId: assetId, originalAssetVersion: assetVersion,
    knowledgeRevisionIds: [], mode: "local" as const,
    plan: { purpose: "feature" as const, headline: "Built for travel", captions: ["Lightweight"], prompt: "" },
    ...overrides,
  };
}

describe("image HTTP contract", () => {
  it("generates, lists, reviews, and downloads a controlled derived image", async () => {
    const generatedResponse = await app.request(`/api/products/${productId}/images/generate`, json("POST", input(), "http://localhost:5173"));
    expect(generatedResponse.status).toBe(201);
    const generated = GenerateImageResultSchema.parse(await generatedResponse.json());
    expect(generated.run.status).toBe("succeeded");

    const page = ImagePageSchema.parse(await (await app.request(`/api/products/${productId}/images?limit=20&offset=0`)).json());
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe(generated.image!.id);
    const detail = ImageDetailSchema.parse(await (await app.request(`/api/products/${productId}/images/${generated.image!.id}`)).json());
    expect(detail.stale).toBe(false);

    const runs = ImageRunPageSchema.parse(await (await app.request(`/api/products/${productId}/images/runs`)).json());
    expect(runs.items[0]?.id).toBe(generated.run.id);
    const content = await app.request(`/api/products/${productId}/images/${generated.image!.id}/content`);
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(content.headers.get("content-disposition")).toContain("inline");
    expect(Buffer.from(await content.arrayBuffer()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const download = await app.request(`/api/products/${productId}/images/${generated.image!.id}/content?download=1`);
    expect(download.headers.get("content-disposition")).toContain("attachment");

    const reviewed = await app.request(`/api/products/${productId}/images/${generated.image!.id}/reviews`, json("POST", { decision: "approved", notes: "checked" }, "http://localhost:5173"));
    expect(reviewed.status).toBe(201);
    expect((await app.request(`/api/products/${productId}/images/${generated.image!.id}`)).status).toBe(200);
  });

  it("enforces availability, Origin, content type, query validation, and strict knowledge selection", async () => {
    const unavailable = createImageRoutes();
    expect((await unavailable.request(`/00000000-0000-4000-8000-000000000000/images`)).status).toBe(503);

    const denied = await app.request(`/api/products/${productId}/images/generate`, json("POST", input(), "https://evil.invalid"));
    expect(denied.status).toBe(403);
    const unsupported = await app.request(`/api/products/${productId}/images/generate`, { method: "POST", body: JSON.stringify(input()) });
    expect(unsupported.status).toBe(415);
    const badQuery = await app.request(`/api/products/${productId}/images?limit=1&limit=2`);
    expect(badQuery.status).toBe(422);

    const invalidKnowledge = await app.request(`/api/products/${productId}/images/generate`, json("POST", input({ knowledgeRevisionIds: [randomUUID()] })));
    expect(invalidKnowledge.status).toBe(422);
    expect(await invalidKnowledge.json()).toMatchObject({ error: { code: "KNOWLEDGE_NOT_APPROVED" } });
  });
});
