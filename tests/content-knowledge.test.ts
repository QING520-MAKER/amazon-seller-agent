import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { KnowledgeRepository } from "../src/knowledge/repository.js";
import { ContentService } from "../src/content/service.js";
import { generateContent } from "../src/content/generation.js";
import { CreateProductSchema, GenerateContentSchema } from "../src/schemas.js";

let catalog: CatalogService;
beforeEach(async () => { catalog = (await openCatalog({ dataDir: await mkdtemp("E:\\CodexTemp\\asa-evidence-") })).catalog; });
afterEach(() => { vi.useRealTimers(); catalog.close(); });

describe("knowledge binding in the content studio", () => {
  it("freezes selected evidence, invalidates approval on edits, and replays the original request without charging again", async () => {
    const product = catalog.repository.create(CreateProductSchema.parse({ sku: "K1", brief: { name: "Travel Mug" } }));
    const knowledge = new KnowledgeRepository(catalog.repository);
    const fields = { kind: "product_fact" as const, title: "Volume", content: "500 ml", source: "Manual p2", status: "approved" as const };
    const fact = knowledge.create(product.product.id, fields);
    const provider = vi.fn(generateContent);
    const service = new ContentService(catalog.contentService!.repository, provider);
    const input = GenerateContentSchema.parse({ requestId: randomUUID(), sourceRevisionId: product.currentRevision.id,
      baseContentVersionId: null, keywords: ["travel mug"], knowledgeRevisionIds: [fact.id] });
    const result = await service.generate(product.product.id, input);
    const saved = result.content!;
    expect(saved.evidence).toEqual([expect.objectContaining({ revisionId: fact.id, content: "500 ml", source: "Manual p2" })]);
    expect(provider.mock.calls[0]![3]).toEqual(saved.evidence);
    service.review(product.product.id, saved.id, "approved", "Facts verified");
    expect(service.export(product.product.id, saved.id, false).status).toBe("approved");
    knowledge.save(product.product.id, fact.entryId, { ...fields, content: "600 ml", baseRevisionId: fact.id });
    expect(service.detail(product.product.id, saved.id)).toMatchObject({ stale: true, staleReasons: ["KNOWLEDGE_UPDATED"] });
    expect(() => service.export(product.product.id, saved.id, false)).toThrowError(expect.objectContaining({ code: "CONTENT_STALE" }));
    expect(() => service.review(product.product.id, saved.id, "approved", "Again")).toThrowError(expect.objectContaining({ code: "CONTENT_STALE" }));
    expect(service.review(product.product.id, saved.id, "rejected", "Source changed").decision).toBe("rejected");
    expect((await service.generate(product.product.id, input)).content).toEqual(saved);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(service.export(product.product.id, saved.id, true).detail.content.evidence[0]!.content).toBe("500 ml");
  });
  it("refuses mixed valid and invalid evidence without silently ignoring the selection", async () => {
    const one = catalog.repository.create(CreateProductSchema.parse({ sku: "A", brief: { name: "Mug" } }));
    const two = catalog.repository.create(CreateProductSchema.parse({ sku: "B", brief: { name: "Cable" } }));
    const knowledge = new KnowledgeRepository(catalog.repository);
    const foreign = knowledge.create(two.product.id, { kind: "product_fact", title: "Length", content: "2 m", source: "Packaging", status: "approved" });
    await expect(catalog.contentService!.generate(one.product.id, GenerateContentSchema.parse({ requestId: randomUUID(), sourceRevisionId: one.currentRevision.id,
      baseContentVersionId: null, keywords: [], knowledgeRevisionIds: [foreign.id] }))).rejects.toMatchObject({ code: "KNOWLEDGE_NOT_APPROVED" });
    expect(catalog.contentService!.runs(one.product.id, { limit: 20, offset: 0 }).total).toBe(0);
  });
  it("uses the last submitted review when several reviews have the same timestamp", async () => {
    const p = catalog.repository.create(CreateProductSchema.parse({ sku: "R", brief: { name: "Mug" } }));
    const service = catalog.contentService!;
    const generated = await service.generate(p.product.id, GenerateContentSchema.parse({ requestId: randomUUID(), sourceRevisionId: p.currentRevision.id, baseContentVersionId: null, keywords: [] }));
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T00:00:00Z"));
    service.review(p.product.id, generated.content!.id, "approved", "First");
    const latest = service.review(p.product.id, generated.content!.id, "rejected", "Correction");
    expect(service.detail(p.product.id, generated.content!.id).review?.id).toBe(latest.id);
    expect(() => service.export(p.product.id, generated.content!.id, false)).toThrowError(expect.objectContaining({ code: "CONTENT_NOT_APPROVED" }));
  });
});
