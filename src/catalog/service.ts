import { CatalogRepository, assetDto, type StoredOriginalAsset } from "./repository.js";
import { CatalogError } from "./errors.js";
import { OriginalFiles, type FileFaults } from "../storage/files.js";
import { openDatabase, closeDatabase } from "../storage/database.js";
import { STORAGE_LIMITS, type StorageSettings } from "../storage/settings.js";

export class CatalogService {
  private uploads = 0;
  constructor(readonly repository: CatalogRepository, readonly files: OriginalFiles) {}
  /** Acquire before reading/parsing the body, with no unbounded in-memory wait queue. */
  async withUploadSlot<T>(work: () => Promise<T>) {
    if (this.uploads >= STORAGE_LIMITS.concurrentUploads) throw new CatalogError(503, "STORAGE_BUSY", "已有图片正在上传或校验，请稍后重试。");
    this.uploads++;
    try { return await work(); } finally { this.uploads--; }
  }
  async upload(productId: string, file: File) {
    this.repository.product(productId);
    const { key, asset } = await this.files.stage(productId, file);
    let published = false;
    let retain = false;
    try {
      const existing = this.repository.byHash(productId, asset.sha256);
      if (existing) {
        await this.files.read(existing);
        return { asset: assetDto(existing), reused: true };
      }
      await this.files.publish(key, asset);
      published = true;
      await this.files.faults.point?.("file-copied", asset);
      await this.files.faults.point?.("before-register", asset);
      const result = this.repository.register(asset);
      retain = !result.reused;
      if (result.reused) await this.files.read(result.asset);
      await this.files.faults.point?.("after-register", result.asset);
      return { asset: assetDto(result.asset), reused: result.reused };
    } catch (error) {
      // Resolve ambiguous commit outcomes before considering any original for cleanup.
      if (published) {
        try { retain = this.repository.byHash(productId, asset.sha256)?.id === asset.id; }
        catch { retain = true; } // Unknown means preserve for startup diagnosis.
      }
      throw error;
    } finally {
      await this.files.removeOwned(key).catch(() => {});
      if (published && !retain) await this.files.removeOwned(asset.storageKey).catch(() => {});
    }
  }
  async content(productId: string, assetId: string) {
    const asset = this.repository.asset(productId, assetId);
    return { asset: assetDto(asset), bytes: await this.files.read(asset) };
  }
  close() { closeDatabase(this.repository.db); }
}

export async function openCatalog(settings: StorageSettings, faults: FileFaults = {}) {
  const db = openDatabase(settings);
  const catalog = new CatalogService(new CatalogRepository(db), new OriginalFiles(settings.dataDir, faults));
  try {
    await catalog.files.init();
    const recoveryRecords = await catalog.files.recover(catalog.repository.allStoredAssets());
    return { catalog, recoveryRecords };
  } catch (error) { db.close(); throw error; }
}
