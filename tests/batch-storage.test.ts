import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openCatalog, type CatalogService, type StudioProviders } from "../src/catalog/service.js";
import { CreateProductSchema, CreateContentBatchSchema, GenerateContentSchema, ProductImportSchema } from "../src/schemas.js";
import { BatchService } from "../src/batch/service.js";
import { ContentGenerationError } from "../src/content/generation.js";

const opened = new Set<CatalogService>();
async function setup(providers: StudioProviders = {}) {
  await mkdir("E:\\CodexTemp", { recursive: true });
  const dataDir = await mkdtemp("E:\\CodexTemp\\asa-batch-storage-");
  const result = await openCatalog({ dataDir }, {}, providers);
  expect(result.catalog.batchService).toBeDefined();
  opened.add(result.catalog);
  return { ...result, service: result.catalog.batchService!, dataDir };
}
function close(catalog: CatalogService) { catalog.close(); opened.delete(catalog); }
afterEach(() => { for (const catalog of opened) catalog.close(); opened.clear(); });

function product(catalog: CatalogService, sku: string) {
  return catalog.repository.create(CreateProductSchema.parse({ sku, brief: { name: "Travel Mug", brand: "Acme", features: ["Steel"], included: ["Lid"] }, sourceNote: "manual" }));
}
function input(productId: string, sourceRevisionId: string, requestId = randomUUID()) {
  return GenerateContentSchema.parse({ requestId, sourceRevisionId, baseContentVersionId: null, keywords: ["travel mug"], mode: "template" });
}

describe("durable content batches", () => {
  it.each([false, true])("recovers durable failure without replay and checks exact input (mismatch=%s)", async mismatch => {
    const provider = vi.fn().mockRejectedValue(new ContentGenerationError("MODEL_REQUEST_FAILED", "private provider detail"));
    const { catalog, service, dataDir } = await setup({ text: provider });
    const p = product(catalog, "BATCH-FAILED-RECOVER");
    const request = { ...input(p.product.id, p.currentRevision.id), mode: "model" as const };
    const batch = service.create({ requestId: randomUUID(), items: [{ productId: p.product.id, input: request }] });
    const generated = await catalog.contentService!.generate(p.product.id, mismatch ? { ...request, keywords: ["other keyword"] } : request);
    expect(generated.run).toMatchObject({ status: "failed", errorCode: "MODEL_REQUEST_FAILED" });
    const runningItems = batch.items.map(item => ({ ...item, status: "running" }));
    catalog.repository.db.prepare("UPDATE content_batches SET status='running', items_json=? WHERE id=?").run(JSON.stringify(runningItems), batch.id);
    close(catalog);

    const reopened = (await openCatalog({ dataDir }, {}, { text: provider })).catalog;
    opened.add(reopened);
    const recovered = reopened.batchService!.get(batch.id);
    expect(recovered).toMatchObject({ status: "failed", items: [{ status: "failed", runId: generated.run.id,
      contentVersionId: null, errorCode: mismatch ? "CONTENT_REQUEST_CONFLICT" : "MODEL_REQUEST_FAILED" }] });
    expect(recovered.finishedAt).not.toBeNull();
    expect(JSON.stringify(recovered)).not.toContain("private provider detail");
    expect(await reopened.batchService!.execute(batch.id)).toEqual(recovered);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("finalizes a batch after all items were committed but its terminal status was not", async () => {
    const { catalog, service, dataDir } = await setup();
    const p = product(catalog, "BATCH-FINALIZE");
    const created = service.create({ requestId: randomUUID(), items: [{ productId: p.product.id, input: input(p.product.id, p.currentRevision.id) }] });
    const completed = await service.execute(created.id);
    catalog.repository.db.prepare("UPDATE content_batches SET status='running', finished_at=NULL WHERE id=?").run(created.id);
    close(catalog);
    const reopened = (await openCatalog({ dataDir })).catalog;
    opened.add(reopened);
    expect(reopened.batchService!.get(created.id)).toMatchObject({ status: "succeeded", items: completed.items });
    expect(reopened.contentService!.list(p.product.id, { limit: 20, offset: 0 }).total).toBe(1);
  });

  it("executes 20 fixed items in order, isolates one missing source, and preserves idempotency", async () => {
    const { catalog, service } = await setup();
    const products = Array.from({ length: 19 }, (_, index) => product(catalog, `BATCH-${index}`));
    const payload = CreateContentBatchSchema.parse({
      requestId: randomUUID(),
      items: [...products.map(value => ({ productId: value.product.id, input: input(value.product.id, value.currentRevision.id) })),
        { productId: randomUUID(), input: input(randomUUID(), randomUUID()) }],
    });
    const created = service.create(payload);
    expect(created.status).toBe("queued");
    const result = await service.execute(created.id);
    expect(result.status).toBe("partial");
    expect(result.items).toHaveLength(20);
    expect(result.items.filter(item => item.status === "succeeded")).toHaveLength(19);
    expect(result.items.filter(item => item.status === "failed")).toHaveLength(1);
    const replay = service.create(payload);
    expect(replay.id).toBe(created.id);
    const changed = { ...payload, items: payload.items.map((item, index) => index === 0 ? { ...item, input: { ...item.input, keywords: ["different"] } } : item) };
    expect(() => service.create(changed)).toThrowError(expect.objectContaining({ code: "BATCH_REQUEST_CONFLICT" }));
    expect(catalog.repository.db.prepare("SELECT COUNT(*) AS n FROM content_batches").get()).toEqual({ n: 1 });
  });

  it("keeps the input snapshot immutable and recovers durable success without provider replay", async () => {
    const { catalog, service, dataDir } = await setup();
    const createdProduct = product(catalog, "BATCH-RECOVER");
    const payload = CreateContentBatchSchema.parse({ requestId: randomUUID(), items: [{
      productId: createdProduct.product.id, input: input(createdProduct.product.id, createdProduct.currentRevision.id),
    }] });
    const batch = service.create(payload);
    const generated = await catalog.contentService!.generate(createdProduct.product.id, batch.items[0]!.input);
    expect(generated.run.status).toBe("succeeded");
    catalog.repository.db.prepare("UPDATE content_batches SET status='running', finished_at=NULL WHERE id=?").run(batch.id);
    expect(() => catalog.repository.db.prepare("UPDATE content_batches SET input_json='{}' WHERE id=?").run(batch.id)).toThrow("immutable");
    close(catalog);

    const reopened = (await openCatalog({ dataDir })).catalog;
    opened.add(reopened);
    const recoveredService = new BatchService(reopened);
    recoveredService.recoverRuns();
    expect(recoveredService.get(batch.id).status).toBe("succeeded");
    expect(recoveredService.get(batch.id).items[0]!.contentVersionId).toBe(generated.content!.id);
  });

  it("marks queued work interrupted on recovery, serializes same-batch execution, and imports products independently", async () => {
    const { catalog, service } = await setup();
    const a = product(catalog, "BATCH-IMPORT-EXISTING");
    const queued = service.create(CreateContentBatchSchema.parse({ requestId: randomUUID(), items: [{
      productId: a.product.id, input: input(a.product.id, a.currentRevision.id),
    }] }));
    service.recoverRuns();
    expect(service.get(queued.id).status).toBe("interrupted");

    const other = product(catalog, "BATCH-CONCURRENT");
    const work = service.create(CreateContentBatchSchema.parse({ requestId: randomUUID(), items: [{
      productId: other.product.id, input: input(other.product.id, other.currentRevision.id),
    }] }));
    const [first, second] = await Promise.all([service.execute(work.id), service.execute(work.id)]);
    expect(first.id).toBe(second.id);
    expect(first.items[0]!.status).toBe("succeeded");

    const imported = ProductImportSchema.parse({ items: [
      { sku: "BATCH-IMPORT-EXISTING", brief: { name: "Overwrite attempt" } },
      { sku: "BATCH-IMPORT-NEW", brief: { name: "New item" } },
    ] });
    const result = service.importProducts(imported);
    expect(result.items[0]).toMatchObject({ status: "failed", errorCode: "SKU_CONFLICT", productId: a.product.id });
    expect(result.items[1]).toMatchObject({ status: "created" });
    expect(catalog.repository.product(a.product.id).sku).toBe("BATCH-IMPORT-EXISTING");
  });
});
