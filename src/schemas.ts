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

// Product-bound content studio. Legacy CLI / graph contracts above remain unchanged.
export const ContentMarketplaceSchema = z.literal("us");
export const ContentKeywordsSchema = z.array(z.string().trim().min(1).max(200)).max(50)
  .transform(values => [...new Map(values.map(value => [value.toLowerCase(), value])).values()]);
export const ContentCopyFieldsSchema = z.object({
  title: z.string().trim().min(1).max(75),
  itemHighlights: z.string().trim().max(125),
  bullets: z.array(z.string().trim().min(1).max(500)).length(5),
  description: z.string().trim().min(1).max(2000),
  backendSearchTerms: z.array(z.string().trim().min(1).max(249)).max(100),
}).strict();
export const ContentCopySchema = ContentCopyFieldsSchema.superRefine((copy, ctx) => {
  if (new TextEncoder().encode(copy.backendSearchTerms.join(" ")).byteLength > 249) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backendSearchTerms"], message: "后台词合计不能超过 249 UTF-8 字节。" });
  }
});
export const ContentEvidenceSchema = z.object({
  entryId: CatalogIdSchema, revisionId: CatalogIdSchema, title: z.string(),
  content: z.string(), source: z.string(),
  kind: z.enum(["product_fact", "brand", "platform_rule", "reference"]).default("product_fact"),
}).strict();
export const GenerateContentSchema = z.object({
  requestId: CatalogIdSchema, sourceRevisionId: CatalogIdSchema,
  baseContentVersionId: CatalogIdSchema.nullable(), marketplace: ContentMarketplaceSchema.default("us"),
  keywords: ContentKeywordsSchema, mode: z.enum(["template", "model"]).default("template"),
  knowledgeRevisionIds: z.array(CatalogIdSchema).max(20).default([]),
}).strict();
export const SaveContentSchema = z.object({
  baseContentVersionId: CatalogIdSchema, copy: ContentCopySchema,
}).strict();
export const ContentVersionSchema = z.object({
  id: CatalogIdSchema, productId: CatalogIdSchema, sourceRevisionId: CatalogIdSchema,
  versionNumber: z.number().int().positive(), parentVersionId: CatalogIdSchema.nullable(),
  marketplace: ContentMarketplaceSchema, language: z.literal("en_US"),
  keywords: z.array(z.string()), copy: ContentCopySchema, coverage: CoverageReportSchema,
  evidence: z.array(ContentEvidenceSchema), rulesVersion: z.string(),
  source: z.enum(["template", "model", "manual"]), model: z.string().nullable(),
  generationRunId: CatalogIdSchema.nullable(), createdAt: catalogTime,
}).strict();
export const ContentRunSchema = z.object({
  id: CatalogIdSchema, productId: CatalogIdSchema, requestId: CatalogIdSchema,
  sourceRevisionId: CatalogIdSchema, mode: z.enum(["template", "model"]),
  status: z.enum(["running", "succeeded", "failed", "interrupted"]),
  contentVersionId: CatalogIdSchema.nullable(),
  errorCode: z.string().nullable(), errorMessage: z.string().nullable(),
  startedAt: catalogTime, finishedAt: catalogTime.nullable(),
}).strict();
export const GenerateContentResultSchema = z.object({
  run: ContentRunSchema, content: ContentVersionSchema.nullable(), reused: z.boolean(),
}).strict();
export const ContentPageSchema = PageSchema(ContentVersionSchema).extend({ headVersionId: CatalogIdSchema.nullable() }).strict();
export const ContentRunPageSchema = PageSchema(ContentRunSchema);
export const ContentReviewRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]), notes: z.string().trim().max(10000),
}).strict();
export const ContentReviewSchema = ContentReviewRequestSchema.extend({
  id: CatalogIdSchema, productId: CatalogIdSchema, contentVersionId: CatalogIdSchema, createdAt: catalogTime,
}).strict();
export const ContentDetailSchema = z.object({
  content: ContentVersionSchema, review: ContentReviewSchema.nullable(),
  stale: z.boolean(), staleReasons: z.array(z.string()),
}).strict();
export const ContentExportSchema = z.object({
  schemaVersion: z.literal(1), status: z.enum(["draft", "approved"]), exportedAt: catalogTime,
  sku: z.string(), detail: ContentDetailSchema,
}).strict();
export type ContentCopy = z.infer<typeof ContentCopySchema>;
export type ContentEvidence = z.infer<typeof ContentEvidenceSchema>;
export type GenerateContent = z.infer<typeof GenerateContentSchema>;
export type SaveContent = z.infer<typeof SaveContentSchema>;
export type ContentVersion = z.infer<typeof ContentVersionSchema>;
export type ContentRun = z.infer<typeof ContentRunSchema>;
export type GenerateContentResult = z.infer<typeof GenerateContentResultSchema>;
export type ContentReviewRequest = z.infer<typeof ContentReviewRequestSchema>;
export type ContentReview = z.infer<typeof ContentReviewSchema>;
export type ContentDetail = z.infer<typeof ContentDetailSchema>;

export const KnowledgeKindSchema = z.enum(["product_fact", "brand", "platform_rule", "reference"]);
export const KnowledgeFieldsSchema = z.object({
  kind: KnowledgeKindSchema, title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50000), source: z.string().trim().min(1).max(2000),
  status: z.enum(["draft", "approved", "archived"]).default("draft"),
}).strict();
export const CreateKnowledgeSchema = KnowledgeFieldsSchema;
export const CreateKnowledgeRequestSchema = KnowledgeFieldsSchema.extend({ requestId: CatalogIdSchema.optional() }).strict();
export type CreateKnowledgeRequest = z.infer<typeof CreateKnowledgeRequestSchema>;
export const SaveKnowledgeSchema = KnowledgeFieldsSchema.extend({ baseRevisionId: CatalogIdSchema }).strict();
export const KnowledgeRevisionSchema = KnowledgeFieldsSchema.extend({
  id: CatalogIdSchema, entryId: CatalogIdSchema, productId: CatalogIdSchema,
  revisionNumber: z.number().int().positive(), createdAt: catalogTime,
}).strict();
export const KnowledgePageSchema = PageSchema(KnowledgeRevisionSchema);
export const KnowledgeQuerySchema = CatalogPaginationSchema.extend({
  q: z.string().trim().max(200).default(""), status: z.enum(["all", "draft", "approved", "archived"]).default("all"),
}).strict();
export type KnowledgeFields = z.infer<typeof KnowledgeFieldsSchema>;
export type SaveKnowledge = z.infer<typeof SaveKnowledgeSchema>;
export type KnowledgeRevision = z.infer<typeof KnowledgeRevisionSchema>;
export type KnowledgeQuery = z.infer<typeof KnowledgeQuerySchema>;

// Image candidates keep original references and the exact independently editable layout.
export const ImagePlanSchema = z.object({
  purpose: z.enum(["feature", "scene"]), headline: z.string().trim().min(1).max(80),
  captions: z.array(z.string().trim().min(1).max(100)).max(3),
  prompt: z.string().trim().max(2000),
  // Absence preserves the original request hash and historical layout meaning.
  template: z.object({ layout: z.enum(["split", "stacked"]), version: z.literal(2) }).strict().optional(),
}).strict();
export const GenerateImageSchema = z.object({
  requestId: CatalogIdSchema, sourceRevisionId: CatalogIdSchema,
  originalAssetId: CatalogIdSchema, originalAssetVersion: z.number().int().positive(),
  knowledgeRevisionIds: z.array(CatalogIdSchema).max(20).default([]),
  mode: z.enum(["local", "model"]).default("local"), plan: ImagePlanSchema,
}).strict();
export const ImageVersionSchema = z.object({
  id: CatalogIdSchema, productId: CatalogIdSchema, sourceRevisionId: CatalogIdSchema,
  versionNumber: z.number().int().positive(), original: OriginalAssetSchema,
  plan: ImagePlanSchema, evidence: z.array(ContentEvidenceSchema),
  mode: z.enum(["local", "model"]), provider: z.string(), model: z.string().nullable(),
  mimeType: z.enum(["image/png", "image/jpeg"]), width: z.number().int().positive(), height: z.number().int().positive(),
  sizeBytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  generationRunId: CatalogIdSchema, createdAt: catalogTime,
}).strict();
export const ImageRunSchema = z.object({
  id: CatalogIdSchema, productId: CatalogIdSchema, requestId: CatalogIdSchema,
  sourceRevisionId: CatalogIdSchema, mode: z.enum(["local", "model"]),
  status: z.enum(["running", "succeeded", "failed", "interrupted"]),
  imageVersionId: CatalogIdSchema.nullable(), errorCode: z.string().nullable(), errorMessage: z.string().nullable(),
  startedAt: catalogTime, finishedAt: catalogTime.nullable(),
}).strict();
export const ImageReviewSchema = ContentReviewRequestSchema.extend({
  id: CatalogIdSchema, productId: CatalogIdSchema, imageVersionId: CatalogIdSchema, createdAt: catalogTime,
}).strict();
export const ImageDetailSchema = z.object({
  image: ImageVersionSchema, review: ImageReviewSchema.nullable(), stale: z.boolean(), staleReasons: z.array(z.string()),
}).strict();
export const GenerateImageResultSchema = z.object({
  run: ImageRunSchema, image: ImageVersionSchema.nullable(), reused: z.boolean(),
}).strict();
export const ImagePageSchema = PageSchema(ImageVersionSchema);
export const ImageRunPageSchema = PageSchema(ImageRunSchema);
export type ImagePlan = z.infer<typeof ImagePlanSchema>;
export type GenerateImage = z.infer<typeof GenerateImageSchema>;
export type ImageVersion = z.infer<typeof ImageVersionSchema>;
export type ImageRun = z.infer<typeof ImageRunSchema>;
export type ImageDetail = z.infer<typeof ImageDetailSchema>;
export type ImageReview = z.infer<typeof ImageReviewSchema>;
export type GenerateImageResult = z.infer<typeof GenerateImageResultSchema>;

export const CreateContentBatchSchema = z.object({
  requestId: CatalogIdSchema,
  items: z.array(z.object({ productId: CatalogIdSchema, input: GenerateContentSchema }).strict()).min(1).max(20),
}).strict().superRefine((batch, ctx) => {
  if (new Set(batch.items.map(item => item.productId)).size !== batch.items.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "每批同一个商品只能出现一次。" });
});
export const ContentBatchItemSchema = z.object({
  id: CatalogIdSchema, productId: CatalogIdSchema, input: GenerateContentSchema,
  status: z.enum(["queued", "running", "succeeded", "failed", "interrupted"]),
  runId: CatalogIdSchema.nullable(), contentVersionId: CatalogIdSchema.nullable(),
  errorCode: z.string().nullable(), errorMessage: z.string().nullable(),
}).strict();
export const ContentBatchSchema = z.object({
  id: CatalogIdSchema, requestId: CatalogIdSchema, createdAt: catalogTime, finishedAt: catalogTime.nullable(),
  status: z.enum(["queued", "running", "succeeded", "partial", "failed", "interrupted"]),
  items: z.array(ContentBatchItemSchema),
}).strict();
export const ContentBatchPageSchema = PageSchema(ContentBatchSchema);
export const ProductImportSchema = z.object({ items: z.array(CreateProductSchema).min(1).max(20) }).strict();
export const ProductImportResultSchema = z.object({ items: z.array(z.object({
  index: z.number().int().nonnegative(), sku: z.string(), productId: CatalogIdSchema.nullable(),
  status: z.enum(["created", "failed"]), errorCode: z.string().nullable(), errorMessage: z.string().nullable(),
}).strict()) }).strict();
export type CreateContentBatch = z.infer<typeof CreateContentBatchSchema>;
export type ContentBatch = z.infer<typeof ContentBatchSchema>;
export type ContentBatchItem = z.infer<typeof ContentBatchItemSchema>;

export const CreateContentPackageSchema = z.object({
  requestId: CatalogIdSchema, contentVersionId: CatalogIdSchema,
  imageVersionIds: z.array(CatalogIdSchema).min(1).max(9),
  status: z.enum(["draft", "approved"]),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.imageVersionIds).size !== input.imageVersionIds.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imageVersionIds"], message: "内容包不能包含重复图片。" });
});
export const ContentPackageSchema = z.object({
  id: CatalogIdSchema, productId: CatalogIdSchema, requestId: CatalogIdSchema,
  versionNumber: z.number().int().positive(), createdAt: catalogTime,
  manifest: z.object({ schemaVersion: z.literal(1), sku: z.string(), status: z.enum(["draft", "approved"]),
    content: ContentDetailSchema, images: z.array(ImageDetailSchema),
  }).strict(),
}).strict();
export const ContentPackagePageSchema = PageSchema(ContentPackageSchema);
export type CreateContentPackage = z.infer<typeof CreateContentPackageSchema>;
export type ContentPackage = z.infer<typeof ContentPackageSchema>;
