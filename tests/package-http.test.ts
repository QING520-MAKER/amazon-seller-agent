import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdir, mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { CreateContentPackageSchema, CreateProductSchema, GenerateContentSchema, ContentPackagePageSchema, ContentPackageSchema } from "../src/schemas.js";
import { PackageService } from "../src/packages/service.js";
import { createPackageRoutes } from "../src/packages/routes.js";
import { png } from "./fixtures/catalog-images.js";

let catalog: CatalogService;
let packages: PackageService;
let app: Hono;
let productId: string;
let contentVersionId: string;
let imageVersionIds: string[];

const json = (method: string, value: unknown, origin?: string) => ({
  method,
  headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
  body: JSON.stringify(value),
});

beforeEach(async () => {
  await mkdir("E:\\CodexTemp", { recursive: true });
  const dataDir = await mkdtemp("E:\\CodexTemp\\asa-package-http-");
  catalog = (await openCatalog({ dataDir })).catalog;
  expect(catalog.contentService).toBeDefined();
  expect(catalog.imageService).toBeDefined();
  expect(catalog.packageService).toBeDefined();
  const content = catalog.contentService!;
  const images = catalog.imageService!;
  packages = catalog.packageService!;
  const product = catalog.repository.create(CreateProductSchema.parse({
    sku: "HTTP-PACKAGE", brief: { name: "Travel Mug", brand: "Acme", attributes: ["300 ml"], features: ["Steel"], included: ["Lid"] },
  }));
  productId = product.product.id;
  const contentResult = await content.generate(productId, GenerateContentSchema.parse({ requestId: randomUUID(), sourceRevisionId: product.currentRevision.id,
    baseContentVersionId: null, marketplace: "us", keywords: ["travel mug"], mode: "template" }));
  contentVersionId = contentResult.content!.id;
  content.review(productId, contentVersionId, "approved", "checked");
  const asset = await catalog.upload(productId, new File([await png(40, 32)], "original.png", { type: "image/png" }));
  imageVersionIds = [];
  for (const headline of ["Lightweight mug", "Easy to carry"]) {
    const generated = await images.generate(productId, { requestId: randomUUID(), sourceRevisionId: product.currentRevision.id,
      originalAssetId: asset.asset.id, originalAssetVersion: asset.asset.version, knowledgeRevisionIds: [], mode: "local",
      plan: { purpose: "feature", headline, captions: ["Steel"], prompt: "" } });
    imageVersionIds.push(generated.image!.id);
    images.review(productId, generated.image!.id, "approved", "checked");
  }
  app = new Hono();
  app.route("/api/products", createPackageRoutes(packages));
});

afterEach(() => catalog.close());

describe("package HTTP contract", () => {
  it("creates, lists, reads, and downloads an approved package", async () => {
    const input = CreateContentPackageSchema.parse({ requestId: randomUUID(), contentVersionId, imageVersionIds, status: "approved" });
    const createdResponse = await app.request(`/api/products/${productId}/packages`, json("POST", input, "http://localhost:5173"));
    expect(createdResponse.status).toBe(201);
    const created = ContentPackageSchema.parse(await createdResponse.json());

    const page = ContentPackagePageSchema.parse(await (await app.request(`/api/products/${productId}/packages?limit=20&offset=0`)).json());
    expect(page.total).toBe(1);
    expect(page.items[0]!.id).toBe(created.id);
    expect(ContentPackageSchema.parse(await (await app.request(`/api/products/${productId}/packages/${created.id}`)).json()).manifest.status).toBe("approved");

    const downloaded = await app.request(`/api/products/${productId}/packages/${created.id}/download`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("application/zip");
    expect(downloaded.headers.get("content-disposition")).toContain("attachment");
    expect(downloaded.headers.get("content-disposition")).toContain("approved-content-package-");
    expect(Buffer.from(await downloaded.arrayBuffer()).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("returns controlled not-ready, Origin, body, and query errors", async () => {
    const unavailable = createPackageRoutes();
    expect((await unavailable.request(`/00000000-0000-4000-8000-000000000000/packages`)).status).toBe(503);
    const input = { requestId: randomUUID(), contentVersionId, imageVersionIds, status: "draft" as const };
    expect((await app.request(`/api/products/${productId}/packages`, json("POST", input, "https://evil.invalid"))).status).toBe(403);
    expect((await app.request(`/api/products/${productId}/packages`, { method: "POST", body: JSON.stringify(input) })).status).toBe(415);
    expect((await app.request(`/api/products/${productId}/packages?unknown=1`)).status).toBe(422);
  });
});
