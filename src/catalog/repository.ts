import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ProductBriefSchema, type CatalogPagination, type CreateProduct, type SaveProductBrief, type ProductRecord,
  type ProductRevision, type ProductDetail, type ProductSummary, type OriginalAsset, type MissingField, type Page,
} from "../schemas.js";
import { CatalogError } from "./errors.js";

export type StoredOriginalAsset = OriginalAsset & { storageKey: string };
interface ProductRow { id: string; workspace_id: "local"; sku: string; current_revision_id: string; created_at: string; updated_at: string }
interface RevisionRow { id: string; product_id: string; revision_number: number; brief_json: string; source_note: string; created_at: string }
interface AssetRow { id: string; product_id: string; original_name: string; mime_type: OriginalAsset["mimeType"]; size_bytes: number; width: number; height: number; orientation: number | null; sha256: string; storage_key: string; created_at: string; archived_at: string | null; version: number }
const productDto = (r: ProductRow): ProductRecord => ({ id: r.id, workspaceId: r.workspace_id, sku: r.sku, currentRevisionId: r.current_revision_id, createdAt: r.created_at, updatedAt: r.updated_at });
const revisionDto = (r: RevisionRow): ProductRevision => ({ id: r.id, productId: r.product_id, revisionNumber: r.revision_number, brief: ProductBriefSchema.parse(JSON.parse(r.brief_json)), sourceNote: r.source_note, createdAt: r.created_at });
const assetRow = (r: AssetRow): StoredOriginalAsset => ({ id: r.id, productId: r.product_id, kind: "original", originalName: r.original_name, mimeType: r.mime_type, sizeBytes: r.size_bytes, width: r.width, height: r.height, orientation: r.orientation, sha256: r.sha256, storageKey: r.storage_key, createdAt: r.created_at, archivedAt: r.archived_at, version: r.version });
export function assetDto({ storageKey: _key, ...asset }: StoredOriginalAsset): OriginalAsset { return asset; }
function missing(revision: ProductRevision, count: number): MissingField[] {
  return [
    ...(["attributes", "features", "included"] as const).filter(key => !revision.brief[key].length),
    ...(!revision.sourceNote.trim() ? ["sourceNote" as const] : []),
    ...(!count ? ["originalAssets" as const] : []),
  ];
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export class CatalogRepository {
  constructor(readonly db: Database.Database) {}
  product(id: string): ProductRecord {
    const row = this.db.prepare("SELECT * FROM products WHERE id=?").get(id) as ProductRow | undefined;
    if (!row) throw new CatalogError(404, "PRODUCT_NOT_FOUND", "商品不存在。");
    return productDto(row);
  }
  revision(productId: string, id: string): ProductRevision {
    this.product(productId);
    const row = this.db.prepare("SELECT * FROM product_revisions WHERE product_id=? AND id=?").get(productId, id) as RevisionRow | undefined;
    if (!row) throw new CatalogError(404, "REVISION_NOT_FOUND", "该商品的资料版本不存在。");
    return revisionDto(row);
  }
  activeCount(productId: string) {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM original_assets WHERE product_id=? AND archived_at IS NULL").get(productId) as { n: number }).n;
  }
  detail(id: string): ProductDetail {
    const product = this.product(id);
    const currentRevision = this.revision(id, product.currentRevisionId);
    return { product, currentRevision, missingFields: missing(currentRevision, this.activeCount(id)) };
  }
  list(q: string, page: CatalogPagination): Page<ProductSummary> {
    const search = "%" + escapeLike(q) + "%";
    const where = " FROM products p JOIN product_revisions r ON r.id=p.current_revision_id AND r.product_id=p.id WHERE (p.sku LIKE ? ESCAPE '\\' OR json_extract(r.brief_json, '$.name') LIKE ? ESCAPE '\\')";
    const total = (this.db.prepare("SELECT COUNT(*) AS n" + where).get(search, search) as { n: number }).n;
    const rows = this.db.prepare("SELECT p.*" + where + " ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?").all(search, search, page.limit, page.offset) as ProductRow[];
    const items = rows.map(row => {
      const product = productDto(row);
      const revision = this.revision(product.id, product.currentRevisionId);
      const originalAssetCount = this.activeCount(product.id);
      return { product, name: revision.brief.name, revisionNumber: revision.revisionNumber, originalAssetCount, missingFields: missing(revision, originalAssetCount) };
    });
    return { ...page, total, items };
  }
  create(input: CreateProduct): ProductDetail {
    const id = randomUUID(), revisionId = randomUUID(), now = new Date().toISOString();
    try {
      this.db.transaction(() => {
        this.db.prepare("INSERT INTO products VALUES(?, 'local', ?, ?, ?, ?)").run(id, input.sku, revisionId, now, now);
        this.db.prepare("INSERT INTO product_revisions VALUES(?, ?, 1, ?, ?, ?)").run(revisionId, id, JSON.stringify(input.brief), input.sourceNote, now);
      }).immediate();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        const existing = this.db.prepare("SELECT id FROM products WHERE workspace_id='local' AND sku=?").get(input.sku) as { id: string } | undefined;
        if (existing) throw new CatalogError(409, "SKU_CONFLICT", "此 SKU 已存在。大小写不同的 SKU 在本地视为不同商品。", { existingProductId: existing.id });
      }
      throw error;
    }
    return this.detail(id);
  }
  save(id: string, input: SaveProductBrief) {
    return this.db.transaction(() => {
      const product = this.product(id);
      if (product.currentRevisionId !== input.baseRevisionId) throw new CatalogError(409, "REVISION_CONFLICT", "资料已在另一窗口修改，本地草稿已保留。", { currentRevisionId: product.currentRevisionId });
      const current = this.revision(id, product.currentRevisionId);
      if (JSON.stringify(input.brief) === JSON.stringify(current.brief) && input.sourceNote === current.sourceNote) return { product, revision: current, changed: false };
      const revisionId = randomUUID(), now = new Date().toISOString();
      this.db.prepare("INSERT INTO product_revisions VALUES(?, ?, ?, ?, ?, ?)").run(revisionId, id, current.revisionNumber + 1, JSON.stringify(input.brief), input.sourceNote, now);
      const changed = this.db.prepare("UPDATE products SET current_revision_id=?, updated_at=? WHERE id=? AND current_revision_id=?").run(revisionId, now, id, input.baseRevisionId);
      if (changed.changes !== 1) throw new CatalogError(409, "REVISION_CONFLICT", "资料已更新，请查看最新版本。");
      return { product: this.product(id), revision: this.revision(id, revisionId), changed: true };
    }).immediate();
  }
  revisions(id: string, page: CatalogPagination) {
    this.product(id);
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM product_revisions WHERE product_id=?").get(id) as { n: number }).n;
    const items = this.db.prepare("SELECT id, revision_number AS revisionNumber, created_at AS createdAt FROM product_revisions WHERE product_id=? ORDER BY revision_number DESC LIMIT ? OFFSET ?")
      .all(id, page.limit, page.offset) as Pick<ProductRevision, "id" | "revisionNumber" | "createdAt">[];
    return { ...page, total, items };
  }
  asset(productId: string, id: string): StoredOriginalAsset {
    this.product(productId);
    const row = this.db.prepare("SELECT * FROM original_assets WHERE product_id=? AND id=?").get(productId, id) as AssetRow | undefined;
    if (!row) throw new CatalogError(404, "ASSET_NOT_FOUND", "该商品的原图不存在。");
    return assetRow(row);
  }
  byHash(productId: string, hash: string): StoredOriginalAsset | undefined {
    const row = this.db.prepare("SELECT * FROM original_assets WHERE product_id=? AND sha256=?").get(productId, hash) as AssetRow | undefined;
    return row ? assetRow(row) : undefined;
  }
  allStoredAssets() { return (this.db.prepare("SELECT * FROM original_assets").all() as AssetRow[]).map(assetRow); }
  assets(id: string, state: "active" | "archived", page: CatalogPagination): Page<OriginalAsset> {
    this.product(id);
    const where = " FROM original_assets WHERE product_id=? AND archived_at IS " + (state === "active" ? "NULL" : "NOT NULL");
    const total = (this.db.prepare("SELECT COUNT(*) AS n" + where).get(id) as { n: number }).n;
    const items = (this.db.prepare("SELECT *" + where + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(id, page.limit, page.offset) as AssetRow[]).map(row => assetDto(assetRow(row)));
    return { ...page, total, items };
  }
  register(asset: StoredOriginalAsset): { asset: StoredOriginalAsset; reused: boolean } {
    return this.db.transaction(() => {
      this.product(asset.productId);
      const existing = this.byHash(asset.productId, asset.sha256);
      if (existing) return { asset: existing, reused: true };
      this.db.prepare("INSERT INTO original_assets VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)")
        .run(asset.id, asset.productId, asset.originalName, asset.mimeType, asset.sizeBytes, asset.width, asset.height, asset.orientation, asset.sha256, asset.storageKey, asset.createdAt);
      this.db.prepare("UPDATE products SET updated_at=MAX(updated_at, ?) WHERE id=?").run(new Date().toISOString(), asset.productId);
      return { asset, reused: false };
    }).immediate();
  }
  setAssetState(productId: string, id: string, expectedVersion: number, archived: boolean) {
    return this.db.transaction(() => {
      const current = this.asset(productId, id);
      if (current.version !== expectedVersion) throw new CatalogError(409, "ASSET_VERSION_CONFLICT", "原图状态已改变，请刷新后再操作。", { currentAssetVersion: current.version });
      if ((current.archivedAt !== null) === archived) return { asset: assetDto(current), changed: false };
      const now = new Date().toISOString();
      this.db.prepare("UPDATE original_assets SET archived_at=?, version=version+1 WHERE product_id=? AND id=? AND version=?").run(archived ? now : null, productId, id, expectedVersion);
      this.db.prepare("UPDATE products SET updated_at=? WHERE id=?").run(now, productId);
      return { asset: assetDto(this.asset(productId, id)), changed: true };
    }).immediate();
  }
}
