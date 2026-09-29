import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { createApp } from "../src/http/routes.js";
import { CreateProductSchema, GenerateContentSchema } from "../src/schemas.js";
import { getContentExport } from "../apps/web/src/content/api.js";
import { contentDownloadUrl } from "../apps/web/src/shared/DownloadLink.js";

let catalog: CatalogService | undefined;
afterEach(() => { catalog?.close(); catalog = undefined; });
describe("native content download contract", () => {
  it("accepts the actual client URLs for formal and draft downloads and rechecks review", async () => {
    const dataDir = await mkdtemp("E:\\CodexTemp\\asa-download-contract-");
    catalog = (await openCatalog({ dataDir })).catalog;
    const product = catalog.repository.create(CreateProductSchema.parse({ sku: "DOWNLOAD", brief: { name: "Synthetic test cup" } }));
    const generated = await catalog.contentService!.generate(product.product.id, GenerateContentSchema.parse({ requestId: randomUUID(),
      sourceRevisionId: product.currentRevision.id, baseContentVersionId: null, keywords: ["cup"], mode: "template" }));
    const versionId = generated.content!.id, productId = product.product.id;
    catalog.contentService!.review(productId, versionId, "approved", "QA");
    const app = createApp({ catalog });
    vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => app.request(input, init)));
    expect((await getContentExport(productId, versionId, false)).status).toBe("approved");
    expect((await getContentExport(productId, versionId, true)).status).toBe("draft");
    const url = contentDownloadUrl(productId, versionId, false);
    const response = await app.request(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(await response.json()).toMatchObject({ status: "approved", detail: { content: { id: versionId } } });
    catalog.contentService!.review(productId, versionId, "rejected", "Needs correction");
    expect((await app.request(url)).status).toBe(409);
    expect((await app.request(contentDownloadUrl(productId, versionId, true))).status).toBe(200);
  });
});
