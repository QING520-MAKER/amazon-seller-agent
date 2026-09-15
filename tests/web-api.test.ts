import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth, executeRequest } from "../apps/web/src/api.js";
import { createExampleRequest } from "../apps/web/src/intent.js";
import { ListingResultSchema, ResearchReportSchema } from "../src/schemas.js";

const report = ResearchReportSchema.parse({
  keyword: "portable blender",
  marketplace: "us",
  keywords: [{ phrase: "portable blender for travel" }],
  competition: {},
  seasonality: {},
  opportunity: { total: 5, competitionDensity: "medium", nichePotential: "medium", reasoning: "Autocomplete only", recommendation: "Check suitability" },
});
const listing = ListingResultSchema.parse({
  listing: { title: "My blender", bullets: ["One"], description: "A blender", backendSearchTerms: [] },
  audit: null,
  coverage: { rows: [], coveragePct: 0, uncovered: [] },
});

afterEach(() => vi.unstubAllGlobals());

describe("workbench local API client", () => {
  it.each(["research", "listing-create", "listing-audit", "pipeline"] as const)(
    "posts %s only to the local API and omits UI-only metadata",
    async (kind) => {
      const payload = kind === "research" ? report : listing;
      const fetch = vi.fn().mockResolvedValue(Response.json(payload));
      vi.stubGlobal("fetch", fetch);
      const request = createExampleRequest(kind);
      expect(await executeRequest(request)).toEqual(payload);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(`/api/${kind}`, expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.payload),
      }));
    },
  );

  it("validates response contracts before displaying graph output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ unexpected: true })));
    await expect(executeRequest(createExampleRequest("research"))).rejects.toThrow("Zod 契约校验");
  });

  it("preserves the backend explanation for a failed graph call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "graph_error", message: "Autocomplete request timed out" } }, { status: 502 })));
    await expect(executeRequest(createExampleRequest("research"))).rejects.toThrow("Autocomplete request timed out");
  });

  it("explains how to start the API when the connection fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(executeRequest(createExampleRequest("listing-create"))).rejects.toThrow("npm run dev:ui");
  });

  it("distinguishes non-JSON server output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("proxy unavailable", { status: 502 })));
    await expect(executeRequest(createExampleRequest("research"))).rejects.toThrow("无法解析的 JSON");
  });

  it("passes cancellation to fetch and preserves AbortError for the UI", async () => {
    const error = new DOMException("Cancelled", "AbortError");
    const fetch = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(executeRequest(createExampleRequest("research"), controller.signal)).rejects.toBe(error);
    expect(fetch.mock.calls[0]?.[1].signal).toBe(controller.signal);
  });

  it("checks the API health endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetch);
    expect(await checkHealth()).toEqual({ status: "ok" });
    expect(fetch).toHaveBeenCalledWith("/api/health", undefined);
  });
});
