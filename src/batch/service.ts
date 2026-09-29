import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ContentBatchSchema, CreateContentBatchSchema, GenerateContentSchema,
  ProductImportResultSchema, ProductImportSchema, type CatalogPagination, type ContentBatch,
  type ContentBatchItem, type CreateContentBatch,
} from "../schemas.js";
import type { z } from "zod";
import { CatalogError } from "../catalog/errors.js";
import type { CatalogService } from "../catalog/service.js";
import { batchMigrationSQL } from "./migration.js";

const safeMessages: Record<string, string> = {
  PRODUCT_NOT_FOUND: "商品不存在。",
  REVISION_NOT_FOUND: "商品资料版本不存在。",
  SOURCE_REVISION_CONFLICT: "商品资料已更新，请创建新批次。",
  CONTENT_REQUEST_CONFLICT: "内容请求已使用不同输入，请创建新的请求。",
  CONTENT_HEAD_CONFLICT: "文案版本已更新，请创建新的请求。",
  KNOWLEDGE_NOT_APPROVED: "选择的知识未确认或版本已变化，请重新选择后创建新批次。",
  KNOWLEDGE_LIMIT: "一次最多选择 20 条知识。",
  MODEL_NOT_CONFIGURED: "模型服务尚未配置，请改用模板生成或补充服务端配置。",
  MODEL_REQUEST_FAILED: "模型服务调用失败，请使用新的请求 ID 重试。",
  INVALID_MODEL_RESULT: "模型返回内容未通过校验，请使用新的请求 ID 重试。",
  TITLE_INPUT_TOO_LONG: "品牌和主关键词过长，请缩短后重试。",
  CONTENT_GENERATION_BUSY: "文案生成服务繁忙，请使用新的请求 ID 重试。",
  INTERRUPTED: "该批次在服务重启时中断，请创建新的批次重试。",
  SKU_CONFLICT: "此 SKU 已存在，未覆盖已有商品。",
};

const genericItemFailure = "批次项未能完成，请检查输入后创建新的请求。";
const interruptedMessage = "该批次在服务重启时中断，请创建新的批次重试。";

interface BatchRow {
  id: string; request_id: string; input_hash: string; input_json: string; items_json: string;
  status: ContentBatch["status"]; created_at: string; updated_at: string; finished_at: string | null;
  error_code: string | null; error_message: string | null;
}

interface DurableRunRow {
  id: string; status: "running" | "succeeded" | "failed" | "interrupted";
  input_hash: string;
  content_version_id: string | null; error_code: string | null; error_message: string | null;
}

type ImportResult = ReturnType<typeof ProductImportResultSchema.parse>;
type ProductImport = z.infer<typeof ProductImportSchema>;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function hashInput(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function generationInputHash(input: ContentBatchItem["input"]) {
  return createHash("sha256").update(JSON.stringify({
    sourceRevisionId: input.sourceRevisionId, baseContentVersionId: input.baseContentVersionId,
    marketplace: input.marketplace, language: "en_US", keywords: input.keywords,
    mode: input.mode, knowledgeRevisionIds: input.knowledgeRevisionIds,
  })).digest("hex");
}

function safeFailure(error: unknown, fallbackCode = "BATCH_ITEM_FAILED") {
  if (error instanceof CatalogError) {
    const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? error.code : fallbackCode;
    return { code, message: safeMessages[code] ?? (code === "SKU_CONFLICT" ? safeMessages.SKU_CONFLICT : undefined) ?? genericItemFailure };
  }
  return { code: fallbackCode, message: genericItemFailure };
}

function itemDto(value: unknown): ContentBatchItem {
  return ContentBatchSchema.shape.items.element.parse(value);
}

function batchDto(row: BatchRow): ContentBatch {
  return ContentBatchSchema.parse({
    id: row.id, requestId: row.request_id, createdAt: row.created_at, finishedAt: row.finished_at,
    status: row.status, items: JSON.parse(row.items_json).map(itemDto),
  });
}

/** Durable S5 batches. A batch input is fixed at creation; only item progress changes. */
export class BatchService {
  private readonly db: Database.Database;
  private activeBatchId: string | undefined;
  private activeExecution: Promise<ContentBatch> | undefined;
  private readonly executions = new Map<string, Promise<ContentBatch>>();

  constructor(readonly catalog: CatalogService) {
    this.db = catalog.repository.db;
  }

  private row(id: string): BatchRow {
    const row = this.db.prepare("SELECT * FROM content_batches WHERE id=?").get(id) as BatchRow | undefined;
    if (!row) throw new CatalogError(404, "BATCH_NOT_FOUND", "批次不存在。");
    return row;
  }

  private rowsItems(row: BatchRow) {
    return JSON.parse(row.items_json).map(itemDto) as ContentBatchItem[];
  }

  private write(row: BatchRow, items: ContentBatchItem[], status = row.status, finishedAt = row.finished_at,
    error?: { code: string; message: string } | null) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE content_batches SET items_json=?, status=?, updated_at=?, finished_at=?, error_code=?, error_message=? WHERE id=?")
      .run(JSON.stringify(items), status, now, finishedAt, error?.code ?? null, error?.message ?? null, row.id);
    return this.row(row.id);
  }

  private findRun(productId: string, requestId: string): DurableRunRow | undefined {
    return this.db.prepare("SELECT id,status,input_hash,content_version_id,error_code,error_message FROM content_runs WHERE product_id=? AND request_id=?")
      .get(productId, requestId) as DurableRunRow | undefined;
  }

  private finalStatus(items: ContentBatchItem[]): ContentBatch["status"] {
    if (items.every(item => item.status === "succeeded")) return "succeeded";
    if (items.some(item => item.status === "interrupted")) return "interrupted";
    if (items.some(item => item.status === "failed") && items.some(item => item.status === "succeeded")) return "partial";
    if (items.some(item => item.status === "failed")) return "failed";
    return "queued";
  }

  private setItem(batchId: string, itemId: string, update: (item: ContentBatchItem) => ContentBatchItem) {
    return this.db.transaction(() => {
      const row = this.row(batchId);
      const items = this.rowsItems(row);
      const index = items.findIndex(item => item.id === itemId);
      if (index < 0) throw new CatalogError(500, "INVALID_RESULT", "批次记录未通过校验。");
      items[index] = itemDto(update(items[index]!));
      this.write(row, items);
      return items[index]!;
    }).immediate();
  }

  create(raw: CreateContentBatch): ContentBatch {
    if (!this.catalog.contentService) throw new CatalogError(503, "STORAGE_UNAVAILABLE", "文案服务尚未就绪。");
    const input = CreateContentBatchSchema.parse(raw);
    if (new Set(input.items.map(item => item.input.requestId)).size !== input.items.length)
      throw new CatalogError(422, "INVALID_REQUEST", "每个批次项必须使用独立的内容请求 ID。");
    const inputJson = canonical(input);
    const inputHash = hashInput(input);
    return this.db.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM content_batches WHERE request_id=?").get(input.requestId) as BatchRow | undefined;
      if (existing) {
        if (existing.input_hash !== inputHash) throw new CatalogError(409, "BATCH_REQUEST_CONFLICT", "相同批次请求 ID 对应了不同输入，请使用新的请求 ID。");
        return batchDto(existing);
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      const items: ContentBatchItem[] = input.items.map(item => ({
        id: randomUUID(), productId: item.productId, input: GenerateContentSchema.parse(item.input),
        status: "queued", runId: null, contentVersionId: null, errorCode: null, errorMessage: null,
      }));
      this.db.prepare("INSERT INTO content_batches(id,request_id,input_hash,input_json,items_json,status,created_at,updated_at,finished_at,error_code,error_message) VALUES(?,?,?,?,?,'queued',?,?,NULL,NULL,NULL)")
        .run(id, input.requestId, inputHash, inputJson, JSON.stringify(items), now, now);
      return batchDto(this.row(id));
    }).immediate();
  }

  list(page: CatalogPagination) {
    const parsed = page;
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM content_batches").get() as { n: number }).n;
    const rows = this.db.prepare("SELECT * FROM content_batches ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
      .all(parsed.limit, parsed.offset) as BatchRow[];
    return { ...parsed, total, items: rows.map(batchDto) };
  }

  get(id: string) { return batchDto(this.row(id)); }

  /** Recover durable outcomes for the exact input. No provider call is made here. */
  recoverRuns() {
    const rows = this.db.prepare("SELECT * FROM content_batches WHERE status IN ('queued','running') ORDER BY created_at, id").all() as BatchRow[];
    for (const row of rows) {
      this.db.transaction(() => {
        const current = this.row(row.id);
        const items = this.rowsItems(current);
        for (let index = 0; index < items.length; index++) {
          const item = items[index]!;
          if (item.status === "succeeded" || item.status === "failed" || item.status === "interrupted") continue;
          const run = this.findRun(item.productId, item.input.requestId);
          if (run && run.input_hash !== generationInputHash(item.input)) {
            items[index] = itemDto({ ...item, status: "failed", runId: run.id, contentVersionId: null, errorCode: "CONTENT_REQUEST_CONFLICT", errorMessage: safeMessages.CONTENT_REQUEST_CONFLICT });
          } else if (run?.status === "succeeded" && run.content_version_id) {
            items[index] = itemDto({ ...item, status: "succeeded", runId: run.id, contentVersionId: run.content_version_id, errorCode: null, errorMessage: null });
          } else if (run?.status === "failed") {
            const failure = safeFailure(new CatalogError(500, run.error_code ?? "BATCH_ITEM_FAILED", "批次项生成失败。"));
            items[index] = itemDto({ ...item, status: "failed", runId: run.id, contentVersionId: null, errorCode: failure.code, errorMessage: failure.message });
          } else {
            items[index] = itemDto({ ...item, status: "interrupted", runId: run?.id ?? item.runId, errorCode: "INTERRUPTED", errorMessage: interruptedMessage });
          }
        }
        // The process may have stopped after the last item was saved but before
        // the batch's terminal state was committed. Finalize that case as well.
        {
          const status = this.finalStatus(items);
          const finishedAt = status === "succeeded" || status === "partial" || status === "failed" || status === "interrupted" ? new Date().toISOString() : null;
          this.write(current, items, status, finishedAt, status === "interrupted" ? { code: "INTERRUPTED", message: interruptedMessage } : null);
        }
      }).immediate();
    }
    return rows.length;
  }

  async execute(batchId: string): Promise<ContentBatch> {
    const existing = this.executions.get(batchId);
    if (existing) return existing;
    const current = this.get(batchId);
    if (["succeeded", "partial", "failed", "interrupted"].includes(current.status)) return current;
    if (current.status === "running") throw new CatalogError(503, "BATCH_BUSY", "已有批次正在执行，请稍后查看进度。");
    if (this.activeExecution) throw new CatalogError(503, "BATCH_BUSY", "已有批次正在执行，请稍后查看进度。");
    this.activeBatchId = batchId;
    const execution = this.runBatch(batchId);
    this.activeExecution = execution;
    this.executions.set(batchId, execution);
    try { return await execution; }
    finally {
      if (this.executions.get(batchId) === execution) this.executions.delete(batchId);
      if (this.activeBatchId === batchId) { this.activeBatchId = undefined; this.activeExecution = undefined; }
    }
  }

  private async runBatch(batchId: string): Promise<ContentBatch> {
    let row = this.row(batchId);
    if (row.status === "queued") {
      const items = this.rowsItems(row);
      row = this.write(row, items, "running", null, null);
    }
    for (const item of this.rowsItems(row)) {
      const live = this.rowsItems(this.row(batchId)).find(candidate => candidate.id === item.id)!;
      if (live.status !== "queued") continue;
      const running = this.db.transaction(() => {
        const current = this.row(batchId);
        const items = this.rowsItems(current);
        const index = items.findIndex(candidate => candidate.id === item.id);
        items[index] = itemDto({ ...items[index]!, status: "running", errorCode: null, errorMessage: null });
        this.write(current, items, "running", null, null);
        return items[index]!;
      }).immediate();
      try {
        const durable = this.findRun(running.productId, running.input.requestId);
        if (durable?.status === "succeeded" && durable.content_version_id && durable.input_hash === generationInputHash(running.input)) {
          this.setItem(batchId, running.id, candidate => ({ ...candidate, status: "succeeded", runId: durable.id, contentVersionId: durable.content_version_id, errorCode: null, errorMessage: null }));
          continue;
        }
        if (durable?.status === "interrupted") {
          this.setItem(batchId, running.id, candidate => ({ ...candidate, status: "interrupted", runId: durable.id, errorCode: "INTERRUPTED", errorMessage: interruptedMessage }));
          continue;
        }
        if (durable?.status === "running") {
          this.setItem(batchId, running.id, candidate => ({ ...candidate, status: "interrupted", runId: durable.id, errorCode: "INTERRUPTED", errorMessage: interruptedMessage }));
          continue;
        }
        const service = this.catalog.contentService;
        if (!service) throw new CatalogError(503, "STORAGE_UNAVAILABLE", "文案服务尚未就绪。");
        const result = await service.generate(running.productId, running.input);
        if (result.run.status === "succeeded" && result.run.contentVersionId) {
          this.setItem(batchId, running.id, candidate => ({ ...candidate, status: "succeeded", runId: result.run.id, contentVersionId: result.run.contentVersionId, errorCode: null, errorMessage: null }));
        } else if (result.run.status === "interrupted") {
          this.setItem(batchId, running.id, candidate => ({ ...candidate, status: "interrupted", runId: result.run.id, errorCode: "INTERRUPTED", errorMessage: interruptedMessage }));
        } else {
          const failure = safeFailure(new CatalogError(500, result.run.errorCode ?? "BATCH_ITEM_FAILED", "批次项生成失败。"));
          this.setItem(batchId, running.id, candidate => ({ ...candidate, status: "failed", runId: result.run.id, contentVersionId: null, errorCode: failure.code, errorMessage: failure.message }));
        }
      } catch (error) {
        const failure = safeFailure(error);
        this.setItem(batchId, running.id, candidate => ({ ...candidate, status: "failed", contentVersionId: null, errorCode: failure.code, errorMessage: failure.message }));
      }
    }
    const final = this.row(batchId);
    const items = this.rowsItems(final);
    const status = this.finalStatus(items);
    const finishedAt = new Date().toISOString();
    return batchDto(this.write(final, items, status, finishedAt, status === "interrupted" ? { code: "INTERRUPTED", message: interruptedMessage } : null));
  }

  importProducts(raw: ProductImport): ImportResult {
    const input = ProductImportSchema.parse(raw);
    const items: ImportResult["items"] = [];
    input.items.forEach((product, index) => {
      try {
        const detail = this.catalog.repository.create(product);
        items.push({ index, sku: product.sku, productId: detail.product.id, status: "created", errorCode: null, errorMessage: null });
      } catch (error) {
        const failure = safeFailure(error, "PRODUCT_IMPORT_FAILED");
        const existingProductId = error instanceof CatalogError && error.details?.existingProductId;
        items.push({ index, sku: product.sku, productId: typeof existingProductId === "string" ? existingProductId : null, status: "failed", errorCode: failure.code, errorMessage: failure.message });
      }
    });
    return ProductImportResultSchema.parse({ items });
  }
}

export { batchMigrationSQL };
