import { describe, expect, it } from "vitest";
import { buildSellerGraph } from "../src/graph/index.js";
import { afterResearch, routeIntent } from "../src/graph/nodes.js";
import { getMarketplace } from "../src/marketplace.js";
import { classifyIntent } from "../src/scoring/keywords.js";
import { ListingCreateRequestSchema, ResearchRequestSchema } from "../src/schemas.js";

describe("marketplace", () => {
  it("resolves US", () => {
    const market = getMarketplace("US");
    expect(market.domain).toBe("amazon.com");
    expect(market.marketplaceId).toBe("ATVPDKIKX0DER");
  });

  it("rejects unknown codes", () => {
    expect(() => getMarketplace("xx")).toThrow(/Unknown marketplace/);
  });
});

describe("keyword intent", () => {
  it("classifies commercial, informational, and niche", () => {
    expect(classifyIntent("best portable blender")).toBe("commercial");
    expect(classifyIntent("how to use blender")).toBe("informational");
    expect(classifyIntent("380ml tritán blender")).toBe("niche");
  });
});

describe("zod contracts", () => {
  it("parses research request", () => {
    const parsed = ResearchRequestSchema.parse({
      keyword: "portable blender",
      marketplace: "us",
    });
    expect(parsed.deep).toBe(false);
    expect(parsed.compareWith).toEqual([]);
  });

  it("parses listing create example shape", () => {
    const parsed = ListingCreateRequestSchema.parse({
      product: { name: "USB-C Portable Blender" },
      keywords: ["portable blender"],
    });
    expect(parsed.product.tone).toBe("professional");
    expect(parsed.marketplace).toBe("us");
  });
});

describe("langgraph routing", () => {
  it("compiles the seller graph", () => {
    expect(buildSellerGraph()).toBeTruthy();
  });

  it("routes intents", () => {
    expect(routeIntent({ intent: "listing_create" } as never)).toBe("createListing");
    expect(routeIntent({ intent: "listing_audit" } as never)).toBe("auditListing");
    expect(routeIntent({ intent: "pipeline" } as never)).toBe("runResearch");
    expect(afterResearch({ intent: "pipeline" } as never)).toBe("createListing");
    expect(afterResearch({ intent: "research" } as never)).toBe("__end__");
  });
});
