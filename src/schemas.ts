import { z } from "zod";

export const ToneSchema = z.enum(["professional", "friendly", "urgent", "luxury"]);
export const KeywordIntentSchema = z.enum(["commercial", "informational", "niche"]);
export const KeywordSourceSchema = z.enum([
  "autocomplete",
  "prefix",
  "alphabet",
  "user",
  "competitor",
]);

export const KeywordSchema = z.object({
  phrase: z.string().min(1),
  intent: KeywordIntentSchema.default("niche"),
  source: KeywordSourceSchema.default("autocomplete"),
});

export const ResearchRequestSchema = z.object({
  keyword: z.string().min(1),
  marketplace: z.string().default("us"),
  deep: z.boolean().default(false),
  compareWith: z.array(z.string()).default([]),
});

export const CompetitionSnapshotSchema = z.object({
  estimatedCompetitors: z.number().nullable().default(null),
  priceMin: z.number().nullable().default(null),
  priceMax: z.number().nullable().default(null),
  priceAvg: z.number().nullable().default(null),
  averageRating: z.number().nullable().default(null),
  topBrands: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

export const SeasonalitySchema = z.object({
  direction: z.enum(["rising", "stable", "declining", "unknown"]).default("unknown"),
  peakMonths: z.array(z.string()).default([]),
  summary: z.string().default(""),
});

export const OpportunityScoreSchema = z.object({
  total: z.number().int().min(1).max(10),
  competitionDensity: z.enum(["low", "medium", "high"]),
  priceRoom: z.enum(["low", "medium", "high", "unknown"]).default("unknown"),
  demandTrend: z.enum(["growing", "stable", "declining", "unknown"]).default("unknown"),
  nichePotential: z.enum(["low", "medium", "high"]),
  reasoning: z.string(),
  recommendation: z.string(),
});

export const ResearchReportSchema = z.object({
  keyword: z.string(),
  marketplace: z.string(),
  keywords: z.array(KeywordSchema),
  competition: CompetitionSnapshotSchema,
  seasonality: SeasonalitySchema,
  opportunity: OpportunityScoreSchema,
});

export const ProductBriefSchema = z.object({
  name: z.string().min(1),
  brand: z.string().default(""),
  attributes: z.array(z.string()).default([]),
  features: z.array(z.string()).default([]),
  audience: z.string().default(""),
  useCases: z.array(z.string()).default([]),
  included: z.array(z.string()).default([]),
  tone: ToneSchema.default("professional"),
});

export const ListingCopySchema = z.object({
  title: z.string(),
  bullets: z.array(z.string()),
  description: z.string(),
  backendSearchTerms: z.array(z.string()),
});

export const ListingInputSchema = z.object({
  asin: z.string().nullable().optional(),
  title: z.string().default(""),
  bullets: z.array(z.string()).default([]),
  description: z.string().default(""),
  backendSearchTerms: z.array(z.string()).default([]),
  imageCount: z.number().nullable().optional(),
  hasAPlus: z.boolean().nullable().optional(),
  price: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  reviewCount: z.number().nullable().optional(),
});

export const CoverageRowSchema = z.object({
  keyword: z.string(),
  inTitle: z.boolean(),
  inBullets: z.boolean(),
  inDescription: z.boolean(),
  status: z.enum(["covered", "partial", "missing"]),
});

export const CoverageReportSchema = z.object({
  rows: z.array(CoverageRowSchema),
  coveragePct: z.number(),
  uncovered: z.array(z.string()),
});

export const DimensionScoreSchema = z.object({
  name: z.string(),
  score: z.number(),
  maxScore: z.number(),
  notes: z.string().default(""),
});

export const ListingAuditSchema = z.object({
  total: z.number(),
  dimensions: z.array(DimensionScoreSchema),
  coverage: CoverageReportSchema,
});

export const ListingCreateRequestSchema = z.object({
  product: ProductBriefSchema,
  keywords: z.array(z.string()),
  marketplace: z.string().default("us"),
});

export const ListingOptimizeRequestSchema = z.object({
  listing: ListingInputSchema,
  keywords: z.array(z.string()),
  product: ProductBriefSchema.optional(),
  marketplace: z.string().default("us"),
});

export const ListingResultSchema = z.object({
  listing: ListingCopySchema,
  audit: ListingAuditSchema.nullable().optional(),
  coverage: CoverageReportSchema,
});

export type Tone = z.infer<typeof ToneSchema>;
export type KeywordIntent = z.infer<typeof KeywordIntentSchema>;
export type Keyword = z.infer<typeof KeywordSchema>;
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;
export type CompetitionSnapshot = z.infer<typeof CompetitionSnapshotSchema>;
export type Seasonality = z.infer<typeof SeasonalitySchema>;
export type OpportunityScore = z.infer<typeof OpportunityScoreSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type ProductBrief = z.infer<typeof ProductBriefSchema>;
export type ListingCopy = z.infer<typeof ListingCopySchema>;
export type ListingInput = z.infer<typeof ListingInputSchema>;
export type CoverageRow = z.infer<typeof CoverageRowSchema>;
export type CoverageReport = z.infer<typeof CoverageReportSchema>;
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;
export type ListingAudit = z.infer<typeof ListingAuditSchema>;
export type ListingCreateRequest = z.infer<typeof ListingCreateRequestSchema>;
export type ListingOptimizeRequest = z.infer<typeof ListingOptimizeRequestSchema>;
export type ListingResult = z.infer<typeof ListingResultSchema>;
export type Intent = "research" | "listing_create" | "listing_audit" | "pipeline";
