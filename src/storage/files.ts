import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { CatalogError } from "../catalog/errors.js";
import type { StoredOriginalAsset } from "../catalog/repository.js";
import { STORAGE_LIMITS } from "./settings.js";

export const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type FailurePoint = "temporary-write" | "temporary-written" | "before-copy" | "file-copied" | "before-register" | "after-register";
/** Injected only by tests, never configured from environment/HTTP. */
export interface FileFaults { point?: (point: FailurePoint, asset?: StoredOriginalAsset) => void | Promise<void>; assetId?: () => string }
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const invalidImage = () => new CatalogError(422, "INVALID_IMAGE", "图片损坏或截断，无法完整解码。请重新导出 JPEG/PNG。");

function checkPngChunks(bytes: Buffer) {
  let end = false;
  for (let offset = 8; offset < bytes.length;) {
    if (bytes.length - offset < 12) throw invalidImage();
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) throw invalidImage();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") throw new CatalogError(415, "UNSUPPORTED_IMAGE_TYPE", "不支持动画 PNG，请另存为静态 JPEG/PNG。");
    offset += size + 12;
    if (type === "IEND") { end = size === 0 && offset === bytes.length; break; }
  }
  if (!end) throw invalidImage();
}

/** Shared decoder validation for original and derived assets; never trusts a filename. */
export async function inspectImage(bytes: Buffer) {
  if (!bytes.length) throw new CatalogError(422, "INVALID_IMAGE", "文件为空，请选择有效的 JPEG/PNG。");
  const png = bytes.subarray(0, 8).equals(pngSignature);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw new CatalogError(415, "UNSUPPORTED_IMAGE_TYPE", "只接受实际内容为 JPEG/PNG 的图片；不支持 SVG、HEIC、WebP 等格式。");
  if (png) checkPngChunks(bytes);
  try {
    // Header parsing is separate so dimension failures get a useful error.
    const metadata = await sharp(bytes, { failOn: "warning", limitInputPixels: false }).metadata();
    if (metadata.format !== (png ? "png" : "jpeg")) throw invalidImage();
    const { width, height } = metadata;
    if (!width || !height) throw invalidImage();
    if (width > STORAGE_LIMITS.edge || height > STORAGE_LIMITS.edge || width * height > STORAGE_LIMITS.pixels) {
      throw new CatalogError(422, "IMAGE_LIMIT_EXCEEDED", "图片最多 4000 万像素，单边不得超过 12000 像素。");
    }
    if ((metadata.pages ?? 1) > 1) throw new CatalogError(415, "UNSUPPORTED_IMAGE_TYPE", "只接受单帧 JPEG/PNG。");
    // Metadata alone does not decode pixels. Discard this output; persist original bytes.
    await sharp(bytes, { failOn: "warning", limitInputPixels: STORAGE_LIMITS.pixels }).raw().toBuffer();
    return { mimeType: png ? "image/png" as const : "image/jpeg" as const, width, height,
      orientation: metadata.orientation && metadata.orientation >= 1 && metadata.orientation <= 8 ? metadata.orientation : null };
  } catch (error) { if (error instanceof CatalogError) throw error; throw invalidImage(); }
}

export class OriginalFiles {
  constructor(readonly root: string, readonly faults: FileFaults = {}) {}
  async init() {
    await mkdir(this.root, { recursive: true });
    for (const directory of ["originals", "tmp", "recovery"]) {
      await mkdir(join(this.root, directory), { recursive: true });
      await this.checkedPath(directory);
    }
  }
  /** Internal storage modules only: rejects escapes, symlinks, and external junctions. */
  async checkedPath(key: string) {
    const target = resolve(this.root, key);
    const rel = relative(this.root, target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new CatalogError(500, "ASSET_FILE_CORRUPT", "素材存储位置无效，请检查本地存储。");
    const parts = rel.split(/[\\/]/);
    let parent = this.root;
    for (const part of parts) {
      parent = join(parent, part);
      try {
        if ((await lstat(parent)).isSymbolicLink()) throw new CatalogError(500, "ASSET_FILE_CORRUPT", "素材路径被外部修改，请从备份恢复。");
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    // Resolve existing parent junctions as well as symbolic links.
    const realRoot = await realpath(this.root);
    let candidate = target;
    for (let i = parts.length; i > 0; i--) {
      try {
        const actual = await realpath(candidate);
        const actualRelative = relative(realRoot, actual);
        if (actualRelative.startsWith("..") || isAbsolute(actualRelative)) throw new CatalogError(500, "ASSET_FILE_CORRUPT", "素材路径超出数据目录。");
        break;
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        candidate = resolve(candidate, "..");
      }
    }
    return target;
  }
  async stage(productId: string, file: File) {
    if (file.size > STORAGE_LIMITS.fileBytes) throw new CatalogError(413, "UPLOAD_TOO_LARGE", "单张原图不能超过 20 MiB。");
    const key = posix.join("tmp", randomUUID() + ".part");
    const path = await this.checkedPath(key);
    const handle = await open(path, "wx");
    let closed = false;
    try {
      const reader = file.stream().getReader();
      const hash = createHash("sha256");
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > STORAGE_LIMITS.fileBytes) throw new CatalogError(413, "UPLOAD_TOO_LARGE", "单张原图不能超过 20 MiB。");
          hash.update(value);
          await this.faults.point?.("temporary-write");
          await handle.writeFile(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      await handle.sync();
      await handle.close(); closed = true;
      await this.faults.point?.("temporary-written");
      const bytes = await readFile(path);
      const metadata = await inspectImage(bytes);
      const id = this.faults.assetId?.() ?? randomUUID();
      const asset: StoredOriginalAsset = { ...metadata, id, productId, kind: "original",
        originalName: file.name, sizeBytes: size, sha256: hash.digest("hex"), createdAt: new Date().toISOString(),
        archivedAt: null, version: 1,
        storageKey: posix.join("originals", productId, id + (metadata.mimeType === "image/png" ? ".png" : ".jpg")),
      };
      return { key, asset };
    } catch (error) {
      if (!closed) await handle.close().catch(() => {});
      await unlink(path).catch(() => {});
      throw error;
    }
  }
  async publish(tempKey: string, asset: StoredOriginalAsset) {
    await this.faults.point?.("before-copy", asset);
    const directory = posix.join("originals", asset.productId);
    await this.checkedPath(directory);
    await mkdir(resolve(this.root, directory), { recursive: true });
    const target = await this.checkedPath(asset.storageKey);
    // Existing destinations are never overwritten. On copy failure ownership is unknown;
    // leave any partial output for recovery rather than deleting an existing target.
    await copyFile(await this.checkedPath(tempKey), target, constants.COPYFILE_EXCL);
    const handle = await open(target, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async removeOwned(key: string) { await unlink(await this.checkedPath(key)); }
  async read(asset: StoredOriginalAsset) {
    const extension = asset.mimeType === "image/png" ? ".png" : ".jpg";
    if (asset.storageKey !== posix.join("originals", asset.productId, asset.id + extension)) {
      throw new CatalogError(500, "ASSET_FILE_CORRUPT", "原图位置与记录不符，请从备份恢复。");
    }
    let bytes: Buffer;
    try {
      const path = await this.checkedPath(asset.storageKey);
      const info = await lstat(path);
      if (!info.isFile() || info.size !== asset.sizeBytes || info.size > STORAGE_LIMITS.fileBytes) throw new CatalogError(500, "ASSET_FILE_CORRUPT", "原图文件与保存记录不一致，请从备份恢复。");
      bytes = await readFile(path);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw new CatalogError(500, "ASSET_FILE_MISSING", "原图文件缺失，记录仍保留，请从备份恢复。");
      throw error;
    }
    if (hashBytes(bytes) !== asset.sha256) throw new CatalogError(500, "ASSET_FILE_CORRUPT", "原图校验失败，请从备份恢复。");
    return bytes;
  }
  async recover(assets: StoredOriginalAsset[]) {
    const known = new Set(assets.map(asset => asset.storageKey));
    const records: { key: string; reason: string }[] = [];
    const walk = async (directory: string) => {
      for (const entry of await readdir(await this.checkedPath(directory), { withFileTypes: true })) {
        const key = posix.join(directory, entry.name);
        if (entry.isSymbolicLink()) { records.push({ key, reason: "unexpected-link" }); continue; }
        if (entry.isDirectory()) await walk(key);
        else if (directory === "tmp" || !known.has(key)) records.push({ key, reason: directory === "tmp" ? "interrupted-upload" : "unregistered-file" });
      }
    };
    await walk("tmp");
    await walk("originals");
    for (const asset of assets) {
      try { await this.read(asset); }
      catch (error) {
        if (!(error instanceof CatalogError) || !["ASSET_FILE_MISSING", "ASSET_FILE_CORRUPT"].includes(error.code)) throw error;
        records.push({ key: asset.storageKey, reason: error.code });
      }
    }
    if (records.length) await writeFile(await this.checkedPath(posix.join("recovery", randomUUID() + ".json")),
      JSON.stringify({ checkedAt: new Date().toISOString(), records }, null, 2), { flag: "wx" });
    return records.length;
  }
}
