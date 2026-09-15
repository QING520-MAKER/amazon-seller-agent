import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/http/routes.js";
import {
  ListingCreateRequestSchema,
  ListingOptimizeRequestSchema,
  ListingResultSchema,
  ProductBriefSchema,
  ResearchReportSchema,
} from "../src/schemas.js";

const listingCreate = ListingCreateRequestSchema.parse(JSON.parse(
  await readFile(new URL("../examples/listing_create.json", import.meta.url), "utf8"),
));
const listingAudit = ListingOptimizeRequestSchema.parse(JSON.parse(
  await readFile(new URL("../examples/listing_input.json", import.meta.url), "utf8"),
));
const product = ProductBriefSchema.parse(JSON.parse(
  await readFile(new URL("../examples/product_brief.json", import.meta.url), "utf8"),
));

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function mockAutocomplete() {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
    suggestions: [
      { value: "portable blender for travel" },
      { value: "how to clean portable blender" },
      { value: "portable blender 380ml" },
    ],
  }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("AUTOCOMPLETE_DELAY_MS", "0");
  vi.stubEnv("AUTOCOMPLETE_TIMEOUT_MS", "1000");
  vi.stubEnv("OPENAI_API_KEY", "");
});

describe("seller HTTP API using the existing graph", () => {
  it("health is JSON and does not run a workflow", async () => {
    const invoke = vi.fn();
    const response = await createApp({ invoke }).request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(invoke).not.toHaveBeenCalled();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("research returns the CLI report contract, forwards deep, and uses the selected marketplace", async () => {
    const fetchMock = mockAutocomplete();
    const response = await createApp().request("/api/research", post({
      keyword: "portable blender", marketplace: " UK ", deep: true,
    }));
    expect(response.status).toBe(200);
    const report = ResearchReportSchema.parse(await response.json());
    expect(report.marketplace).toBe("uk");
    expect(report.keywords).toHaveLength(3);
    expect(report.keywords.map((keyword) => keyword.intent)).toEqual(["commercial", "informational", "niche"]);
    expect(report.competition.estimatedCompetitors).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(30);
    for (const [url] of fetchMock.mock.calls) {
      expect(new URL(String(url)).hostname).toBe("completion.amazon.co.uk");
    }
  });

  it("creates a listing with graph-computed coverage and no HTTP", async () => {
    const response = await createApp().request("/api/listing-create", post(listingCreate));
    expect(response.status).toBe(200);
    const result = ListingResultSchema.parse(await response.json());
    expect(result.listing.bullets).toHaveLength(5);
    expect(result.listing.title).toContain("Acme portable blender");
    expect(result.coverage.coveragePct).toBe(100);
    expect(result.coverage.rows).toHaveLength(listingCreate.keywords.length);
    expect(result.audit).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("audits the supplied example with the original 20% coverage and eight dimensions", async () => {
    const response = await createApp().request("/api/listing-audit", post(listingAudit));
    expect(response.status).toBe(200);
    const result = ListingResultSchema.parse(await response.json());
    expect(result.listing.title).toBe(listingAudit.listing.title);
    expect(result.audit?.dimensions).toHaveLength(8);
    expect(result.audit?.dimensions.reduce((total, dimension) => total + dimension.maxScore, 0)).toBe(100);
    expect(result.audit?.coverage.coveragePct).toBe(20);
    expect(result.coverage.coveragePct).toBe(20);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps original audit coverage separate from rewritten listing coverage", async () => {
    const response = await createApp().request("/api/listing-audit", post({ ...listingAudit, product }));
    expect(response.status).toBe(200);
    const result = ListingResultSchema.parse(await response.json());
    expect(result.audit?.coverage.coveragePct).toBe(20);
    expect(result.coverage.coveragePct).toBe(100);
    expect(result.listing.bullets).toHaveLength(5);
    expect(result.listing.title).not.toBe(listingAudit.listing.title);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pipeline researches before generation and returns the CLI ListingResult contract", async () => {
    const fetchMock = mockAutocomplete();
    const response = await createApp().request("/api/pipeline", post({ keyword: "portable blender", product }));
    expect(response.status).toBe(200);
    const result = ListingResultSchema.parse(await response.json());
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.listing.title).toContain("portable blender for travel");
    expect(result.coverage.rows.map((row) => row.keyword)).toEqual([
      "portable blender for travel", "how to clean portable blender", "portable blender 380ml",
    ]);
  });
});

describe("HTTP input and output boundaries", () => {
  it.each([
    ["research", { keyword: "portable blender" }, { intent: "research", keyword: "portable blender", marketplace: "us", deep: false, compareWith: [] }],
    ["listing-create", { product: { name: "Blender" }, keywords: ["blender"] }, { intent: "listing_create", marketplace: "us", keywords: ["blender"] }],
    ["listing-audit", listingAudit, { intent: "listing_audit", listingInput: listingAudit.listing, marketplace: "us" }],
    ["pipeline", { keyword: "portable blender", product }, { intent: "pipeline", marketplace: "us", keyword: "portable blender", product }],
  ])("maps %s to the existing graph state with Zod defaults", async (path, body, expected) => {
    const invoke = vi.fn(async () => ({}));
    await createApp({ invoke }).request(`/api/${path}`, post(body));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining(expected));
  });

  it.each([
    ["research", {}],
    ["research", { keyword: "   " }],
    ["research", { keyword: "blender", deep: "yes" }],
    ["listing-create", { keywords: ["blender"] }],
    ["listing-audit", { keywords: ["blender"] }],
    ["pipeline", { keyword: "blender" }],
  ])("rejects invalid %s input before graph invocation", async (path, body) => {
    const invoke = vi.fn();
    const response = await createApp({ invoke }).request(`/api/${path}`, post(body));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(invoke).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["research", { keyword: "blender" }],
    ["listing-create", listingCreate],
    ["listing-audit", listingAudit],
    ["pipeline", { keyword: "blender", product }],
  ])("rejects unsupported marketplaces for %s before graph invocation", async (path, body) => {
    const invoke = vi.fn();
    const response = await createApp({ invoke }).request(`/api/${path}`, post({ ...body, marketplace: "xx" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_MARKETPLACE", message: expect.stringContaining("Unknown marketplace") } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns a JSON error for malformed JSON", async () => {
    const response = await createApp().request("/api/research", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{broken",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_JSON" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires JSON instead of accepting browser form submissions", async () => {
    const response = await createApp().request("/api/research", {
      method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ keyword: "blender" }),
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
  });

  it("returns structured graph errors without fabricated results or a stack trace", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const response = await createApp().request("/api/research", post({ keyword: "blender" }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "GRAPH_FAILED", message: expect.stringContaining("HTTP 503") } });
    expect(body.error).not.toHaveProperty("stack");
    expect(body).not.toHaveProperty("keywords");
  });

  it("validates graph results rather than returning invalid successful JSON", async () => {
    const invoke = vi.fn(async () => ({ listingResult: { listing: { title: "Incomplete" } } }));
    const response = await createApp({ invoke }).request("/api/listing-create", post(listingCreate));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_RESULT", issues: expect.any(Array) } });
  });

  it("unknown endpoints also return JSON", async () => {
    const response = await createApp().request("/api/not-a-workflow");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
