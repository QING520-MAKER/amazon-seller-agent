import { createHash, randomUUID } from "node:crypto";
import type { CatalogService } from "../catalog/service.js";
import type { ContentService } from "../content/service.js";
import { CatalogError } from "../catalog/errors.js";
import { ContentPackageSchema, CreateContentPackageSchema, type ContentPackage, type CreateContentPackage,
  type CatalogPagination, type ImageDetail, type ImageVersion } from "../schemas.js";
import { createZip } from "./zip.js";

interface ImageReader {
  detail(productId: string, id: string): ImageDetail;
  content(productId: string, id: string): Promise<{ image: ImageVersion; bytes: Buffer }>;
}
interface Row { id: string; product_id: string; request_id: string; input_hash: string; version_number: number; manifest_json: string; created_at: string }
function dto(row: Row): ContentPackage {
  return ContentPackageSchema.parse({ id: row.id, productId: row.product_id, requestId: row.request_id,
    versionNumber: row.version_number, createdAt: row.created_at, manifest: JSON.parse(row.manifest_json) });
}
export class PackageService {
  private exporting = 0;
  constructor(readonly catalog: CatalogService, readonly content: ContentService, readonly images: ImageReader) {}
  create(productId: string, raw: CreateContentPackage): ContentPackage {
    const input = CreateContentPackageSchema.parse(raw);
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const db = this.catalog.repository.db;
    return db.transaction(() => {
      const product = this.catalog.repository.product(productId);
      const existing = db.prepare("SELECT * FROM content_packages WHERE product_id=? AND request_id=?").get(productId, input.requestId) as Row | undefined;
      if (existing) {
        if (existing.input_hash !== hash) throw new CatalogError(409, "REQUEST_CONFLICT", "同一请求 ID 的内容不同，请创建新请求。");
        return dto(existing);
      }
      const content = this.content.detail(productId, input.contentVersionId);
      const images = input.imageVersionIds.map(id => this.images.detail(productId, id));
      if (input.status === "approved" && (content.stale || content.review?.decision !== "approved" || images.some(image => image.stale || image.review?.decision !== "approved")))
        throw new CatalogError(409, "PACKAGE_NOT_APPROVED", "正式内容包要求所选文案和图片均已批准，且来源没有过期。");
      const version = (db.prepare("SELECT COALESCE(MAX(version_number), 0)+1 AS n FROM content_packages WHERE product_id=?").get(productId) as { n: number }).n;
      const result = ContentPackageSchema.parse({ id: randomUUID(), productId, requestId: input.requestId, versionNumber: version,
        createdAt: new Date().toISOString(), manifest: { schemaVersion: 1, sku: product.sku, status: input.status, content, images } });
      db.prepare("INSERT INTO content_packages VALUES(?,?,?,?,?,?,?,?)").run(result.id, productId, input.requestId, hash, version, input.contentVersionId, JSON.stringify(result.manifest), result.createdAt);
      return result;
    }).immediate();
  }
  get(productId: string, id: string) {
    this.catalog.repository.product(productId);
    const row = this.catalog.repository.db.prepare("SELECT * FROM content_packages WHERE product_id=? AND id=?").get(productId, id) as Row | undefined;
    if (!row) throw new CatalogError(404, "PACKAGE_NOT_FOUND", "该商品的内容包不存在。");
    return dto(row);
  }
  list(productId: string, page: CatalogPagination) {
    this.catalog.repository.product(productId);
    const db = this.catalog.repository.db;
    const total = (db.prepare("SELECT COUNT(*) AS n FROM content_packages WHERE product_id=?").get(productId) as { n: number }).n;
    const rows = db.prepare("SELECT * FROM content_packages WHERE product_id=? ORDER BY version_number DESC LIMIT ? OFFSET ?").all(productId, page.limit, page.offset) as Row[];
    return { ...page, total, items: rows.map(dto) };
  }
  private assertFresh(pack: ContentPackage) {
    if (pack.manifest.status === "draft") return;
    const content = this.content.detail(pack.productId, pack.manifest.content.content.id);
    if (content.stale || content.review?.decision !== "approved" || content.review.id !== pack.manifest.content.review?.id)
      throw new CatalogError(409, "PACKAGE_STALE", "文案依据或审核已变化，请复核并创建新的内容包。旧包记录仍保留。");
    for (const item of pack.manifest.images) {
      const current = this.images.detail(pack.productId, item.image.id);
      if (current.stale || current.review?.decision !== "approved" || current.review.id !== item.review?.id)
        throw new CatalogError(409, "PACKAGE_STALE", "图片依据或审核已变化，请复核并创建新的内容包。旧包记录仍保留。");
    }
  }
  async download(productId: string, id: string) {
    if (this.exporting) throw new CatalogError(503, "EXPORT_BUSY", "已有内容包正在打包，请稍后重试。");
    this.exporting++;
    try {
      const pack = this.get(productId, id);
      this.assertFresh(pack);
      const files: { name: string; bytes: Buffer }[] = [];
      let size = 0;
      for (let index = 0; index < pack.manifest.images.length; index++) {
        const snapshot = pack.manifest.images[index]!.image;
        size += snapshot.sizeBytes;
        if (size > 95 * 1024 * 1024) throw new CatalogError(413, "PACKAGE_TOO_LARGE", "图片合计超过 95 MiB，请减少图片数量后创建内容包。");
        const { image, bytes } = await this.images.content(productId, snapshot.id);
        if (image.sha256 !== snapshot.sha256) throw new CatalogError(500, "PACKAGE_IMAGE_CHANGED", "图片与固定清单不一致，请检查本地数据。");
        files.push({ name: `images/${String(index + 1).padStart(2, "0")}-${image.id}.${image.mimeType === "image/png" ? "png" : "jpg"}`, bytes });
      }
      this.assertFresh(pack); // Recheck after async file reads before releasing the bundle.
      const copy = pack.manifest.content.content.copy;
      const label = pack.manifest.status === "draft" ? "DRAFT - NOT APPROVED" : "APPROVED LOCAL CONTENT PACKAGE";
      files.unshift({ name: "manifest.json", bytes: Buffer.from(JSON.stringify(pack, null, 2)) },
        { name: "listing.txt", bytes: Buffer.from([label, `SKU: ${pack.manifest.sku}`, copy.title, copy.itemHighlights, ...copy.bullets, copy.description, copy.backendSearchTerms.join(" ")].join("\n\n")) },
        { name: "README.txt", bytes: Buffer.from(`${label}\nImage order is the numeric filename prefix and manifest.images order.\nThis package records local review; it does not confirm Amazon publication or category compliance.\n`) });
      return { pack, bytes: createZip(files) };
    } finally { this.exporting--; }
  }
}
