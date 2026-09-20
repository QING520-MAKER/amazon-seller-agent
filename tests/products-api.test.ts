import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogApiError, createProduct, getProduct, listProducts, saveProduct, uploadAsset } from "../apps/web/src/products/api.js";
import { ProductBriefSchema } from "../src/schemas.js";
const id = "10000000-0000-4000-8000-000000000001";
describe("product browser API", () => {
  it("keeps structured failure status, code, issues and conflict details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: {
      code: "REVISION_CONFLICT", message: "conflict", details: { currentRevisionId: id }, issues: [{ path: "brief.name", message: "invalid" }],
    } }, { status: 409 })));
    await expect(saveProduct(id, { baseRevisionId: id, brief: ProductBriefSchema.parse({ name: "A" }), sourceNote: "" }))
      .rejects.toMatchObject({ status: 409, code: "REVISION_CONFLICT", details: { currentRevisionId: id }, issues: [{ path: "brief.name", message: "invalid" }] });
  });
  it("rejects malformed successful DTOs and marks ambiguous writes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ storageKey: "private" })));
    await expect(createProduct({ sku: "A", brief: { name: "N" } })).rejects.toMatchObject({ code: "INVALID_RESPONSE", uncertain: true });
    await expect(getProduct(id)).rejects.toBeInstanceOf(CatalogApiError);
  });
  it("distinguishes read failures from a write whose response was lost", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(listProducts()).rejects.toMatchObject({ uncertain: false });
    await expect(createProduct({ sku: "A", brief: { name: "N" } })).rejects.toMatchObject({ uncertain: true });
  });
  it("lets the browser set multipart boundaries", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetch);
    await expect(uploadAsset(id, new File(["bytes"], "photo.png"))).rejects.toBeInstanceOf(CatalogApiError);
    expect(fetch.mock.calls[0]?.[1].headers).toBeUndefined();
    expect(fetch.mock.calls[0]?.[1].body).toBeInstanceOf(FormData);
  });
});
