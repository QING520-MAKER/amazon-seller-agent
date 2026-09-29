import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { CreateProductSchema } from "../src/schemas.js";
import { KnowledgeRepository } from "../src/knowledge/repository.js";
import { ImageService } from "../src/image/service.js";
import type { ImageProvider } from "../src/image/provider.js";
import { CatalogError } from "../src/catalog/errors.js";
import { STORAGE_LIMITS } from "../src/storage/settings.js";
import { hashBytes } from "../src/storage/files.js";
import { png } from "./fixtures/catalog-images.js";

let catalog: CatalogService | undefined;
let images: ImageService;

async function setup(provider?: ImageProvider) {
  const dataDir = await mkdtemp("E:\\CodexTemp\\asa-image-");
  catalog = (await openCatalog({ dataDir }, {}, { image: provider })).catalog;
  expect(catalog.imageService).toBeDefined();
  images = catalog.imageService!;
  return dataDir;
}

function product(sku = "IMAGE-A") {
  return catalog!.repository.create(CreateProductSchema.parse({ sku, brief: { name: "Travel Blender", attributes: ["500 ml"] } })).product;
}

async function original(productId: string) {
  return catalog!.upload(productId, new File([await png(40, 32)], "original.png", { type: "image/png" }));
}

function request(productId: string, asset: { id: string; version: number }, overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(), sourceRevisionId: catalog!.repository.product(productId).currentRevisionId,
    originalAssetId: asset.id, originalAssetVersion: asset.version, knowledgeRevisionIds: [], mode: "local" as const,
    plan: { purpose: "feature" as const, headline: "Built for daily use", captions: ["Lightweight", "Easy to carry"], prompt: "" },
    ...overrides,
  };
}

beforeEach(async () => { await setup(); });
afterEach(() => catalog?.close());

describe("image storage and service", () => {
  it("generates a real local PNG while preserving the original bytes and hash", async () => {
    const p = product();
    const saved = await original(p.id);
    const originalBytes = (await catalog!.content(p.id, saved.asset.id)).bytes;
    const result = await images.generate(p.id, request(p.id, saved.asset));
    expect(result.run.status).toBe("succeeded");
    expect(result.image).toMatchObject({ mode: "local", provider: "local-compositor", mimeType: "image/png", width: 1600, height: 1600 });
    const content = await images.content(p.id, result.image!.id);
    expect(content.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(hashBytes((await catalog!.content(p.id, saved.asset.id)).bytes)).toBe(hashBytes(originalBytes));
    expect(content.image.original.version).toBe(saved.asset.version);
  }, 30000);

  it("isolates products and keeps same request id idempotent", async () => {
    const a = product("IMAGE-A"), b = product("IMAGE-B");
    const assetA = await original(a.id), assetB = await original(b.id);
    const input = request(a.id, assetA.asset);
    const first = await images.generate(a.id, input);
    const second = await images.generate(a.id, input);
    expect(second).toMatchObject({ reused: true, run: { id: first.run.id }, image: { id: first.image!.id } });
    await expect(images.generate(a.id, request(a.id, assetB.asset))).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    await expect(images.generate(a.id, { ...input, plan: { ...input.plan, headline: "Changed" } })).rejects.toMatchObject({ code: "IMAGE_REQUEST_CONFLICT" });
  }, 30000);

  it("records provider failures without leaking provider details", async () => {
    const provider: ImageProvider = {
      id: "test-provider", model: "test-model", capabilities: { cancellation: false, idempotency: false, statusLookup: false },
      async generate() { throw new Error("secret provider response at E:\\private\\key"); },
    };
    await images.catalog.close();
    await setup(provider);
    const p = product(), asset = await original(p.id);
    const result = await images.generate(p.id, request(p.id, asset.asset, { mode: "model" }));
    expect(result).toMatchObject({ image: null, run: { status: "failed", errorCode: "IMAGE_PROVIDER_FAILED", errorMessage: expect.not.stringContaining("secret") } });
  }, 30000);

  it("persists provider interruption and replays it without another provider call", async () => {
    let calls = 0;
    const provider: ImageProvider = {
      id: "interrupting-provider", model: "interrupting-model", capabilities: { cancellation: true, idempotency: true, statusLookup: false },
      async generate() { calls += 1; throw new CatalogError(409, "IMAGE_INTERRUPTED", "provider stopped"); },
    };
    await images.catalog.close();
    await setup(provider);
    const p = product(), asset = await original(p.id), input = request(p.id, asset.asset, { mode: "model" });
    const first = await images.generate(p.id, input);
    expect(first).toMatchObject({ reused: false, image: null, run: { status: "interrupted", errorCode: "IMAGE_INTERRUPTED", errorMessage: "图片制作被中断，结果未知；请使用新的请求 ID 重试。" } });
    expect(calls).toBe(1);

    const replay = await images.generate(p.id, input);
    expect(replay).toMatchObject({ reused: true, image: null, run: { id: first.run.id, status: "interrupted", errorCode: "IMAGE_INTERRUPTED" } });
    expect(calls).toBe(1);
    expect(images.repository.runs(p.id, { limit: 20, offset: 0 }).items[0]).toMatchObject({ status: "interrupted", errorCode: "IMAGE_INTERRUPTED" });
  }, 30000);

  it("marks archived originals and changed knowledge stale; only reject remains allowed", async () => {
    const p = product(), asset = await original(p.id);
    const knowledge = new KnowledgeRepository(catalog!.repository);
    const draft = knowledge.create(p.id, { kind: "product_fact", title: "Capacity", content: "500 ml", source: "manual", status: "draft" });
    const approved = knowledge.save(p.id, draft.entryId, { kind: draft.kind, title: draft.title, content: draft.content, source: draft.source, status: "approved", baseRevisionId: draft.id });
    const result = await images.generate(p.id, request(p.id, asset.asset, { knowledgeRevisionIds: [approved.id] }));
    expect(images.detail(p.id, result.image!.id).stale).toBe(false);
    knowledge.save(p.id, approved.entryId, { kind: approved.kind, title: approved.title, content: "600 ml", source: approved.source, status: "draft", baseRevisionId: approved.id });
    catalog!.repository.setAssetState(p.id, asset.asset.id, asset.asset.version, true);
    const stale = images.detail(p.id, result.image!.id);
    expect(stale.staleReasons).toEqual(expect.arrayContaining(["ORIGINAL_ASSET_ARCHIVED", "KNOWLEDGE_UPDATED"]));
    expect(() => images.review(p.id, result.image!.id, "approved", "ok")).toThrowError(expect.objectContaining({ code: "IMAGE_STALE" }));
    expect(images.review(p.id, result.image!.id, "rejected", "needs new source").decision).toBe("rejected");
  }, 30000);

  it("detects derived corruption, rejects oversized output, and recovers runs after restart", async () => {
    const p = product(), asset = await original(p.id);
    const result = await images.generate(p.id, request(p.id, asset.asset));
    const file = images.repository.file(p.id, result.image!.id);
    await writeFile(join(catalog!.files.root, file.storageKey), Buffer.from("not an image"));
    await expect(images.content(p.id, result.image!.id)).rejects.toMatchObject({ code: "IMAGE_FILE_CORRUPT" });
    const tooLarge: ImageProvider = {
      id: "large", model: null, capabilities: { cancellation: false, idempotency: true, statusLookup: false },
      async generate() { return Buffer.alloc(STORAGE_LIMITS.fileBytes + 1); },
    };
    const failed = new ImageService(catalog!, tooLarge);
    const failedResult = await failed.generate(p.id, request(p.id, asset.asset, { mode: "model" }));
    expect(failedResult.run).toMatchObject({ status: "failed", errorCode: "IMAGE_OUTPUT_TOO_LARGE" });
    const dataDir = catalog!.repository.db.name.substring(0, catalog!.repository.db.name.lastIndexOf("\\"));
    catalog!.close();
    catalog = (await openCatalog({ dataDir })).catalog;
    images = new ImageService(catalog);
    await images.initialize();
    expect(images.repository.runs(p.id, { limit: 20, offset: 0 }).total).toBe(2);
  }, 30000);

  it("does not queue a third provider call beyond the global two-run limit", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const provider: ImageProvider = {
      id: "blocking", model: null, capabilities: { cancellation: false, idempotency: true, statusLookup: false },
      async generate(input) { await gate; return (await import("sharp")).default(input.originalBytes).png().toBuffer(); },
    };
    await images.catalog.close();
    await setup(provider);
    const p = product(), asset = await original(p.id);
    const first = images.generate(p.id, request(p.id, asset.asset, { mode: "model" }));
    const second = images.generate(p.id, request(p.id, asset.asset, { mode: "model" }));
    await new Promise(resolve => setTimeout(resolve, 20));
    await expect(images.generate(p.id, request(p.id, asset.asset))).rejects.toMatchObject({ code: "IMAGE_GENERATION_BUSY" });
    release();
    await Promise.all([first, second]);
  }, 30000);
});
