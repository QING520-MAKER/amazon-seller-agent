import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { CreateProductSchema, GenerateContentSchema, SaveContentSchema } from "../src/schemas.js";

const opened = new Set<CatalogService>();
async function setup() {
  await mkdir("E:\\CodexTemp", { recursive: true });
  const dataDir = await mkdtemp("E:\\CodexTemp\\asa-content-storage-");
  const result = await openCatalog({ dataDir });
  opened.add(result.catalog);
  return { ...result, dataDir };
}
function close(catalog: CatalogService) { catalog.close(); opened.delete(catalog); }
afterEach(() => { for (const catalog of opened) catalog.close(); opened.clear(); });

describe("durable content studio records", () => {
  it("generates, edits, reviews, exports and reopens immutable versions", async () => {
    const { catalog, dataDir } = await setup();
    const product = catalog.repository.create(CreateProductSchema.parse({
      sku: "CONTENT-A", brief: { name: "Travel Mug", brand: "Acme", attributes: ["300 ml"], features: ["Steel"], included: ["Lid"] }, sourceNote: "manual",
    }));
    const request = GenerateContentSchema.parse({ requestId: randomUUID(), sourceRevisionId: product.currentRevision.id,
      baseContentVersionId: null, keywords: ["travel mug"], mode: "template" });
    const generated = await catalog.contentService!.generate(product.product.id, request);
    expect(generated.run.status).toBe("succeeded");
    expect(generated.content?.source).toBe("template");
    const first = generated.content!;
    const edited = { ...first.copy, title: "Acme travel mug edited" };
    const second = catalog.contentService!.save(product.product.id, SaveContentSchema.parse({ baseContentVersionId: first.id, copy: edited }));
    expect(second.source).toBe("manual");
    expect(second.parentVersionId).toBe(first.id);
    expect(() => catalog.repository.db.prepare("UPDATE content_versions SET rules_version='bad' WHERE id=?").run(first.id)).toThrow("immutable");
    expect(() => catalog.repository.db.prepare("DELETE FROM content_versions WHERE id=?").run(first.id)).toThrow("immutable");
    const review = catalog.contentService!.review(product.product.id, second.id, "approved", "checked");
    expect(() => catalog.repository.db.prepare("UPDATE content_reviews SET notes='bad' WHERE id=?").run(review.id)).toThrow("immutable");
    expect(() => catalog.repository.db.prepare("DELETE FROM content_reviews WHERE id=?").run(review.id)).toThrow("immutable");
    expect(catalog.contentService!.export(product.product.id, second.id, false).status).toBe("approved");
    close(catalog);

    const reopened = (await openCatalog({ dataDir })).catalog;
    opened.add(reopened);
    const versions = reopened.contentService!.list(product.product.id, { limit: 20, offset: 0 });
    expect(versions.items.map(item => item.versionNumber)).toEqual([2, 1]);
    expect(versions.items[0]!.copy.title).toBe("Acme travel mug edited");
    expect(reopened.contentService!.runs(product.product.id, { limit: 20, offset: 0 }).total).toBe(1);
    expect(reopened.contentService!.detail(product.product.id, second.id).review?.decision).toBe("approved");
  });

  it("replays the same request without calling generation twice and rejects another payload", async () => {
    const { catalog } = await setup();
    const product = catalog.repository.create(CreateProductSchema.parse({ sku: "CONTENT-B", brief: { name: "Mug" } }));
    const request = GenerateContentSchema.parse({ requestId: randomUUID(), sourceRevisionId: product.currentRevision.id,
      baseContentVersionId: null, keywords: ["mug"], mode: "template" });
    const first = await catalog.contentService!.generate(product.product.id, request);
    const replay = await catalog.contentService!.generate(product.product.id, request);
    expect(replay.reused).toBe(true);
    expect(replay.run.id).toBe(first.run.id);
    await expect(catalog.contentService!.generate(product.product.id, { ...request, keywords: ["different"] })).rejects.toMatchObject({ code: "CONTENT_REQUEST_CONFLICT" });
  });

  it("marks content stale after a product fact revision and blocks approval", async () => {
    const { catalog } = await setup();
    const product = catalog.repository.create(CreateProductSchema.parse({ sku: "CONTENT-C", brief: { name: "Mug" } }));
    const request = GenerateContentSchema.parse({ requestId: randomUUID(), sourceRevisionId: product.currentRevision.id,
      baseContentVersionId: null, keywords: ["mug"], mode: "template" });
    const generated = await catalog.contentService!.generate(product.product.id, request);
    catalog.repository.save(product.product.id, { baseRevisionId: product.currentRevision.id, brief: { ...product.currentRevision.brief, brand: "Changed" }, sourceNote: "edited" });
    expect(catalog.contentService!.detail(product.product.id, generated.content!.id).stale).toBe(true);
    expect(() => catalog.contentService!.review(product.product.id, generated.content!.id, "approved", "approve")).toThrowError(expect.objectContaining({ code: "CONTENT_STALE" }));
    expect(() => catalog.contentService!.export(product.product.id, generated.content!.id, false)).toThrowError(expect.objectContaining({ code: "CONTENT_STALE" }));
  });

  it("recovers a running provider call as interrupted on reopen", async () => {
    const { catalog, dataDir } = await setup();
    const product = catalog.repository.create(CreateProductSchema.parse({ sku: "CONTENT-D", brief: { name: "Mug" } }));
    const started = catalog.contentService!.repository.startRun({ productId: product.product.id, requestId: randomUUID(),
      sourceRevisionId: product.currentRevision.id, baseContentVersionId: null, mode: "template", inputHash: "hash", inputJson: "{}" });
    expect(started.run.status).toBe("running");
    close(catalog);
    const reopened = (await openCatalog({ dataDir })).catalog;
    opened.add(reopened);
    expect(reopened.contentService!.repository.run(product.product.id, started.run.id)).toMatchObject({ status: "interrupted", errorCode: "INTERRUPTED" });
  });
});
