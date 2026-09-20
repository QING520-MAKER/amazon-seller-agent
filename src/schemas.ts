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

// Local catalog contracts. Deliberately separate from the original CLI/graph schemas.
const factLines = z.array(z.string().trim().max(2000)).max(100)
  .transform((lines) => lines.filter(Boolean));
const catalogBriefShape = {
  name: z.string().trim().min(1).max(300),
  brand: z.string().trim().max(500),
  attributes: factLines,
  features: factLines,
  audience: z.string().trim().max(500),
  useCases: factLines,
  included: factLines,
  tone: ToneSchema,
};
// No defaults here: a missing key in a full snapshot must never silently clear a fact.
export const CatalogBriefSchema = z.object(catalogBriefShape).strict();
export const CreateCatalogBriefSchema = z.object({
  ...catalogBriefShape,
  brand: catalogBriefShape.brand.default(""),
  attributes: factLines.default([]),
  features: factLines.default([]),
  audience: catalogBriefShape.audience.default(""),
  useCases: factLines.default([]),
  included: factLines.default([]),
  tone: ToneSchema.default("professional"),
}).strict();
export const CatalogIdSchema = z.string().uuid();
const catalogTime = z.string().datetime();
const sourceNote = z.string().trim().max(10000);
export const CreateProductSchema = z.object({
  sku: z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f-\u009f]+$/, "SKU 不能包含控制字符"),
  brief: CreateCatalogBriefSchema,
  sourceNote: sourceNote.default(""),
}).strict();
export const SaveProductBriefSchema = z.object({
  baseRevisionId: CatalogIdSchema,
  brief: CatalogBriefSchema,
  sourceNote,
}).strict();
export const SetAssetStateSchema = z.object({
  expectedVersion: z.number().int().positive().safe(),
  archived: z.boolean(),
}).strict();
export const ProductRecordSchema = z.object({
  id: CatalogIdSchema, workspaceId: z.literal("local"), sku: z.string(),
  currentRevisionId: CatalogIdSchema, createdAt: catalogTime, updatedAt: catalogTime,
}).strict();
export const ProductRevisionSchema = z.object({
  id: CatalogIdSchema, productId: CatalogIdSchema, revisionNumber: z.number().int().positive(),
  brief: ProductBriefSchema, sourceNote: z.string(), createdAt: catalogTime,
}).strict();
export const OriginalAssetSchema = z.object({
  id: CatalogIdSchema, productId: CatalogIdSchema, kind: z.literal("original"),
  originalName: z.string(), mimeType: z.enum(["image/jpeg", "image/png"]),
  sizeBytes: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive(),
  orientation: z.number().int().min(1).max(8).nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: catalogTime, archivedAt: catalogTime.nullable(), version: z.number().int().positive(),
}).strict();
export const MissingFieldSchema = z.enum(["attributes", "features", "included", "sourceNote", "originalAssets"]);
export const ProductSummarySchema = z.object({
  product: ProductRecordSchema, name: z.string(), revisionNumber: z.number().int().positive(),
  originalAssetCount: z.number().int().nonnegative(), missingFields: z.array(MissingFieldSchema),
}).strict();
export const ProductDetailSchema = z.object({
  product: ProductRecordSchema, currentRevision: ProductRevisionSchema, missingFields: z.array(MissingFieldSchema),
}).strict();
export function PageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), total: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100), offset: z.number().int().nonnegative() }).strict();
}
export const RevisionSummarySchema = ProductRevisionSchema.pick({ id: true, revisionNumber: true, createdAt: true });
export const ProductPageSchema = PageSchema(ProductSummarySchema);
export const RevisionPageSchema = PageSchema(RevisionSummarySchema);
export const AssetPageSchema = PageSchema(OriginalAssetSchema);
export const SaveProductResultSchema = z.object({
  product: ProductRecordSchema, revision: ProductRevisionSchema, changed: z.boolean(),
}).strict();
export const UploadAssetResultSchema = z.object({ asset: OriginalAssetSchema, reused: z.boolean() }).strict();
export const AssetStateResultSchema = z.object({ asset: OriginalAssetSchema, changed: z.boolean() }).strict();
export const ApiFailureSchema = z.object({ error: z.object({
  code: z.string(), message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  details: z.object({ currentRevisionId: CatalogIdSchema.optional(), currentAssetVersion: z.number().int().positive().optional(),
    existingProductId: CatalogIdSchema.optional() }).optional(),
}) });
const queryInteger = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().safe());
export const CatalogPaginationSchema = z.object({
  limit: queryInteger.pipe(z.number().min(1).max(100)).default("20"),
  offset: queryInteger.pipe(z.number().min(0)).default("0"),
}).strict();
export const ProductQuerySchema = CatalogPaginationSchema.extend({ q: z.string().trim().max(200).default("") });
export const AssetQuerySchema = CatalogPaginationSchema.extend({ state: z.enum(["active", "archived"]).default("active") });
export type CreateProductInput = z.input<typeof CreateProductSchema>;
export type CreateProduct = z.infer<typeof CreateProductSchema>;
export type SaveProductBrief = z.infer<typeof SaveProductBriefSchema>;
export type ProductRecord = z.infer<typeof ProductRecordSchema>;
export type ProductRevision = z.infer<typeof ProductRevisionSchema>;
export type OriginalAsset = z.infer<typeof OriginalAssetSchema>;
export type MissingField = z.infer<typeof MissingFieldSchema>;
export type ProductSummary = z.infer<typeof ProductSummarySchema>;
export type ProductDetail = z.infer<typeof ProductDetailSchema>;
export type ApiFailure = z.infer<typeof ApiFailureSchema>;
export type CatalogPagination = z.infer<typeof CatalogPaginationSchema>;
export type Page<T> = { items: T[]; total: number; limit: number; offset: number };
