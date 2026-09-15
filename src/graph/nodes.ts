import type { AgentStateType, AgentUpdate } from "./state.js";
import { loadSettings } from "../config.js";
import { generateListing } from "../copywriting.js";
import { getMarketplace } from "../marketplace.js";
import { AutocompleteClient } from "../providers/autocomplete.js";
import {
  ListingCopySchema, ListingCreateRequestSchema, ListingOptimizeRequestSchema,
  ListingResultSchema, ResearchReportSchema, ResearchRequestSchema,
} from "../schemas.js";
import { coverageReport } from "../scoring/coverage.js";
import { toKeywords } from "../scoring/keywords.js";
import { auditListing } from "../scoring/listing.js";
import { scoreOpportunity } from "../scoring/opportunity.js";

export async function researchNode(state: AgentStateType): Promise<AgentUpdate> {
  const request = ResearchRequestSchema.parse(state);
  const marketplace = getMarketplace(request.marketplace);
  const client = new AutocompleteClient(loadSettings());
  const seeds = toKeywords([request.keyword, ...request.compareWith], "user").map((item) => item.phrase);
  if (!request.keyword.trim()) throw new Error("Research keyword must not be blank");
  const phrases: string[] = [];
  for (const seed of seeds) phrases.push(...await client.suggestions(seed, marketplace, { deep: request.deep }));
  const keywords = toKeywords(phrases);
  const researchReport = ResearchReportSchema.parse({
    keyword: request.keyword.replace(/\s+/g, " ").trim(),
    marketplace: marketplace.code,
    keywords,
    competition: {
      notes: `Only public autocomplete was queried. Competitor counts, prices, ratings, brands, search volume and BSR were not collected. Seeds: ${seeds.join(", ")}.${seeds.length > 1 ? " Suggestions from comparison seeds are pooled; no comparative market metrics are available." : ""}`,
    },
    seasonality: { summary: "Autocomplete alone does not establish seasonality or demand trends; no historical data was collected." },
    opportunity: scoreOpportunity(keywords, request.keyword),
  });
  return { researchReport, keywords: researchReport.keywords.map((item) => item.phrase) };
}

export async function listingCreateNode(state: AgentStateType): Promise<AgentUpdate> {
  const request = ListingCreateRequestSchema.parse({ product: state.product, keywords: state.keywords, marketplace: state.marketplace });
  getMarketplace(request.marketplace);
  const listing = await generateListing(request.product, request.keywords);
  const listingResult = ListingResultSchema.parse({
    listing,
    audit: null,
    coverage: coverageReport(listing, request.keywords),
  });
  return { listingResult };
}

export async function listingAuditNode(state: AgentStateType): Promise<AgentUpdate> {
  const request = ListingOptimizeRequestSchema.parse({
    listing: state.listingInput, product: state.product, keywords: state.keywords, marketplace: state.marketplace,
  });
  getMarketplace(request.marketplace);
  const audit = auditListing(request.listing, request.keywords);
  const listing = request.product
    ? await generateListing(request.product, request.keywords)
    : ListingCopySchema.parse(request.listing);
  if (request.product) {
    for (const dimension of audit.dimensions) dimension.notes += " Audit refers to the original input; the returned listing is a template rewrite from the supplied product brief.";
  }
  const listingResult = ListingResultSchema.parse({
    listing, audit, coverage: coverageReport(listing, request.keywords),
  });
  return { listingResult };
}

export function routeIntent(
  state: AgentStateType,
): "runResearch" | "createListing" | "auditListing" {
  if (state.intent === "listing_create") return "createListing";
  if (state.intent === "listing_audit") return "auditListing";
  return "runResearch";
}

export function afterResearch(state: AgentStateType): "createListing" | "__end__" {
  return state.intent === "pipeline" ? "createListing" : "__end__";
}
