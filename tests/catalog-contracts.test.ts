import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CreateProductSchema, SaveProductBriefSchema, ProductBriefSchema, ProductQuerySchema, AssetQuerySchema } from "../src/schemas.js";

describe("catalog contracts keep user facts separate from legacy defaults", () => {
  it("creates an incomplete record without example facts", () => {
    expect(CreateProductSchema.parse({ sku: " A ", brief: { name: " 商品 " } })).toEqual({
      sku: "A", brief: ProductBriefSchema.parse({ name: "商品" }), sourceNote: "",
    });
    expect(ProductBriefSchema.parse({ name: "   " }).name).toBe("   ");
  });
  it.each(["", "  ", "A\nB", "A\u007fB"])("rejects invalid SKU %j", (sku) => {
    expect(CreateProductSchema.safeParse({ sku, brief: { name: "真实名称" } }).success).toBe(false);
  });
  it("requires every snapshot key, while explicit clears stay valid", () => {
    const brief = ProductBriefSchema.parse({ name: "商品", brand: "品牌", attributes: ["规格"] });
    for (const key of Object.keys(brief)) {
      const partial = { ...brief } as Record<string, unknown>;
      delete partial[key];
      expect(SaveProductBriefSchema.safeParse({ baseRevisionId: randomUUID(), brief: partial, sourceNote: "" }).success).toBe(false);
    }
    expect(SaveProductBriefSchema.parse({ baseRevisionId: randomUUID(), brief: { ...brief, attributes: [] }, sourceNote: "" }).brief)
      .toEqual({ ...brief, attributes: [] });
  });
  it("normalizes consistently and rejects unknown fields at both levels", () => {
    const created = CreateProductSchema.parse({ sku: "A", brief: { name: "N", features: [" 真实事实 ", "  "] } });
    expect(created.brief.features).toEqual(["真实事实"]);
    expect(SaveProductBriefSchema.parse({ baseRevisionId: randomUUID(), brief: created.brief, sourceNote: created.sourceNote }).brief).toEqual(created.brief);
    for (const body of [{ sku: "A", brief: { name: "N", assetIds: [] } }, { sku: "A", brief: { name: "N" }, workspaceId: "other" }]) {
      expect(CreateProductSchema.safeParse(body).success).toBe(false);
    }
  });
  it("enforces capacity and strict pagination", () => {
    expect(CreateProductSchema.safeParse({ sku: "A", brief: { name: " ", features: [] } }).success).toBe(false);
    expect(CreateProductSchema.safeParse({ sku: "A", brief: { name: "N", included: Array(101).fill("x") } }).success).toBe(false);
    expect(CreateProductSchema.safeParse({ sku: "A", brief: { name: "N", features: ["x".repeat(2001)] } }).success).toBe(false);
    expect(ProductQuerySchema.parse({})).toEqual({ q: "", limit: 20, offset: 0 });
    for (const value of ["", "0", "101", "1.1", "-1", "1e2"]) expect(ProductQuerySchema.safeParse({ limit: value }).success).toBe(false);
    expect(AssetQuerySchema.safeParse({ state: "all" }).success).toBe(false);
  });
});
