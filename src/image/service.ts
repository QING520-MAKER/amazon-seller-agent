import { createHash, randomUUID } from "node:crypto";
import {
  ContentReviewRequestSchema, GenerateImageSchema, ImageDetailSchema,
  type CatalogPagination, type GenerateImage, type ImageDetail, type ImageReview, type ImageRun,
  type ImageVersion, type Page,
} from "../schemas.js";
import { CatalogError } from "../catalog/errors.js";
import { assetDto } from "../catalog/repository.js";
import type { CatalogService } from "../catalog/service.js";
import { KnowledgeRepository } from "../knowledge/repository.js";
import { imageProvider, type ImageProvider } from "./provider.js";
import { ImageFiles } from "./files.js";
import { ImageRepository } from "./repository.js";

const safeMessages: Record<string, string> = {
  IMAGE_PROVIDER_NOT_CONFIGURED: "图片服务商尚未配置，请选择本地卖点图或补充服务端配置。",
  IMAGE_MODE_UNSUPPORTED: "当前图片模式暂不可用，请选择本地卖点图或配置图片服务商。",
  IMAGE_OUTPUT_INVALID: "图片服务返回内容未通过完整图片校验。",
  IMAGE_OUTPUT_TOO_LARGE: "图片服务返回内容超过本地大小限制。",
  IMAGE_TEXT_OVERFLOW: "文字超出版式安全区域，请缩短文字或切换版式后重新制作。",
  IMAGE_INTERRUPTED: "图片制作被中断，结果未知；请使用新的请求 ID 重试。",
  KNOWLEDGE_NOT_APPROVED: "所选知识必须是该商品当前已确认的版本。",
  IMAGE_ORIGINAL_UNAVAILABLE: "所选原图当前不可用，请重新选择原图。",
  IMAGE_PROVIDER_FAILED: "图片服务调用失败，制作记录已保留；请使用新的请求 ID 重试。",
};

function failure(error: unknown) {
  if (error instanceof CatalogError && safeMessages[error.code]) return { code: error.code, message: safeMessages[error.code]! };
  if (error instanceof CatalogError && ["ASSET_FILE_MISSING", "ASSET_FILE_CORRUPT"].includes(error.code)) {
    return { code: "IMAGE_ORIGINAL_UNAVAILABLE", message: safeMessages.IMAGE_ORIGINAL_UNAVAILABLE! };
  }
  return { code: "IMAGE_PROVIDER_FAILED", message: safeMessages.IMAGE_PROVIDER_FAILED! };
}

/** Coordinates bounded image generation, local files, durable runs, and review. */
export class ImageService {
  private activeGenerations = 0;
  private static readonly MAX_ACTIVE_GENERATIONS = 2;
  readonly repository: ImageRepository;
  private readonly files: ImageFiles;
  private readonly knowledge: KnowledgeRepository;

  constructor(readonly catalog: CatalogService, private readonly configuredProvider?: ImageProvider) {
    this.repository = new ImageRepository(catalog.repository);
    this.files = new ImageFiles(catalog.files);
    this.knowledge = new KnowledgeRepository(catalog.repository);
  }

  async initialize() {
    await this.files.init();
    this.repository.recoverRuns();
    return this.files.recover(this.repository.allFiles());
  }

  recoverRuns() { return this.repository.recoverRuns(); }

  async generate(productId: string, raw: GenerateImage) {
    const request = GenerateImageSchema.parse(raw);
    const input = {
      productId,
      requestId: request.requestId,
      sourceRevisionId: request.sourceRevisionId,
      originalAssetId: request.originalAssetId,
      originalAssetVersion: request.originalAssetVersion,
      knowledgeRevisionIds: request.knowledgeRevisionIds,
      mode: request.mode,
      plan: request.plan,
    };
    const inputJson = JSON.stringify(input);
    const inputHash = createHash("sha256").update(inputJson).digest("hex");
    const existing = this.repository.findRequest(productId, request.requestId, inputHash);
    if (existing) {
      const image = existing.imageVersionId ? this.repository.version(productId, existing.imageVersionId) : null;
      return { run: existing, image, reused: true };
    }
    // Explicit knowledge selections are validated before a run is persisted.
    // This keeps invalid input as a 422 contract error instead of a provider
    // failure, while exact replays above remain available after knowledge changes.
    const evidence = this.knowledge.resolveEvidence(productId, request.knowledgeRevisionIds);
    const started = this.repository.startRun({
      productId, requestId: request.requestId, sourceRevisionId: request.sourceRevisionId,
      originalAssetId: request.originalAssetId, originalAssetVersion: request.originalAssetVersion,
      mode: request.mode, inputHash, inputJson: JSON.stringify({ ...input, evidence,
        original: assetDto(this.catalog.repository.asset(productId, request.originalAssetId)) }),
    });
    if (started.reused) {
      const image = started.run.imageVersionId ? this.repository.version(productId, started.run.imageVersionId) : null;
      return { run: started.run, image, reused: true };
    }

    if (this.activeGenerations >= ImageService.MAX_ACTIVE_GENERATIONS) {
      this.repository.failRun(productId, started.run.id, "IMAGE_GENERATION_BUSY", "已有两项图片制作正在运行，请稍后使用新的请求 ID 重试。");
      throw new CatalogError(503, "IMAGE_GENERATION_BUSY", "已有两项图片制作正在运行，请稍后使用新的请求 ID 重试。");
    }
    this.activeGenerations++;
    try {
      const source = this.repository.catalog.revision(productId, request.sourceRevisionId);
      const asset = this.repository.catalog.asset(productId, request.originalAssetId);
      const originalBytes = await this.catalog.files.read(asset);
      const provider = imageProvider(request.mode, this.configuredProvider);
      const output = await provider.generate(
        { product: source.brief, originalBytes, plan: request.plan, evidence },
        { requestId: request.requestId },
      );
      const imageId = randomUUID();
      const stored = await this.files.publish(productId, imageId, output);
      const image = this.repository.completeRun({
        id: imageId, productId, runId: started.run.id, sourceRevisionId: request.sourceRevisionId,
        original: assetDto(asset), plan: request.plan, evidence, mode: request.mode,
        provider: provider.id, model: provider.model, ...stored,
      });
      return { run: this.repository.run(productId, started.run.id), image, reused: false };
    } catch (error) {
      if (error instanceof CatalogError && error.code === "IMAGE_INTERRUPTED") {
        const run = this.repository.interruptRun(productId, started.run.id, "IMAGE_INTERRUPTED", safeMessages.IMAGE_INTERRUPTED!);
        return { run, image: null, reused: false };
      }
      const publicFailure = failure(error);
      const run = this.repository.failRun(productId, started.run.id, publicFailure.code, publicFailure.message);
      return { run, image: null, reused: false };
    } finally {
      this.activeGenerations--;
    }
  }

  list(productId: string, page: CatalogPagination): Page<ImageVersion> { return this.repository.list(productId, page); }
  runs(productId: string, page: CatalogPagination): Page<ImageRun> { return this.repository.runs(productId, page); }

  detail(productId: string, imageId: string): ImageDetail {
    const image = this.repository.version(productId, imageId);
    const product = this.repository.catalog.product(productId);
    const staleReasons: string[] = [];
    if (image.sourceRevisionId !== product.currentRevisionId) staleReasons.push("SOURCE_REVISION_CHANGED");
    try {
      const current = this.repository.catalog.asset(productId, image.original.id);
      if (current.archivedAt !== null) staleReasons.push("ORIGINAL_ASSET_ARCHIVED");
      if (current.version !== image.original.version) staleReasons.push("ORIGINAL_ASSET_CHANGED");
    } catch (error) {
      if (error instanceof CatalogError && error.code === "ASSET_NOT_FOUND") staleReasons.push("ORIGINAL_ASSET_MISSING");
      else throw error;
    }
    staleReasons.push(...this.knowledge.staleReasons(productId, image.evidence));
    const uniqueReasons = [...new Set(staleReasons)];
    const detail = ImageDetailSchema.parse({ image, review: this.repository.latestReview(productId, imageId), stale: uniqueReasons.length > 0, staleReasons: uniqueReasons });
    return detail;
  }

  review(productId: string, imageId: string, decision: "approved" | "rejected", notes: string): ImageReview {
    const input = ContentReviewRequestSchema.parse({ decision, notes });
    const detail = this.detail(productId, imageId);
    if (input.decision === "approved" && detail.stale) throw new CatalogError(409, "IMAGE_STALE", "图片依据已过期，请重新制作后再批准。");
    return this.repository.review(productId, imageId, input.decision, input.notes);
  }

  async content(productId: string, imageId: string): Promise<{ image: ImageVersion; bytes: Buffer }> {
    const stored = this.repository.file(productId, imageId);
    return { image: stored.image, bytes: await this.files.read({ ...stored.image, storageKey: stored.storageKey }) };
  }
}
