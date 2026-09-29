import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { posix } from "node:path";
import { randomUUID } from "node:crypto";
import { CatalogError } from "../catalog/errors.js";
import { inspectImage, hashBytes, type OriginalFiles } from "../storage/files.js";
import { STORAGE_LIMITS } from "../storage/settings.js";
import type { ImageVersion } from "../schemas.js";

export interface DerivedImageFile {
  storageKey: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
}

/** Filesystem boundary for derived images; it shares the catalog path guard. */
export class ImageFiles {
  constructor(readonly originals: OriginalFiles) {}

  async init() {
    await mkdir(this.originals.root, { recursive: true });
    const derived = await this.originals.checkedPath("derived");
    await mkdir(derived, { recursive: true });
    const tmp = await this.originals.checkedPath("tmp");
    await mkdir(tmp, { recursive: true });
    await this.originals.checkedPath("derived");
  }

  async publish(productId: string, imageId: string, bytes: Buffer): Promise<DerivedImageFile> {
    if (!Buffer.isBuffer(bytes)) throw new CatalogError(422, "IMAGE_OUTPUT_INVALID", "图片服务必须返回完整图片字节。");
    if (bytes.length > STORAGE_LIMITS.fileBytes) {
      throw new CatalogError(413, "IMAGE_OUTPUT_TOO_LARGE", "派生图片不能超过 20 MiB。");
    }
    const metadata = await inspectImage(bytes).catch(error => {
      if (error instanceof CatalogError) throw new CatalogError(422, "IMAGE_OUTPUT_INVALID", "图片服务返回的内容不是有效的 JPEG/PNG。");
      throw error;
    });
    const extension = metadata.mimeType === "image/png" ? ".png" : ".jpg";
    const directory = posix.join("derived", productId);
    await mkdir(await this.originals.checkedPath(directory), { recursive: true });
    const storageKey = posix.join(directory, imageId + extension);
    const target = await this.originals.checkedPath(storageKey);
    const tempKey = posix.join("tmp", "image-" + randomUUID() + ".part");
    const temp = await this.originals.checkedPath(tempKey);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temp, "wx");
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      // COPYFILE_EXCL ensures an old candidate can never be overwritten.
      await copyFile(temp, target, constants.COPYFILE_EXCL);
      const targetHandle = await open(target, "r+");
      try { await targetHandle.sync(); } finally { await targetHandle.close(); }
      await unlink(temp).catch(() => {});
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      // Preserve an ambiguous destination for startup diagnostics; only the
      // owned temporary file is safe to remove after a failed copy.
      await unlink(temp).catch(() => {});
      throw error;
    }
    return {
      storageKey,
      mimeType: metadata.mimeType,
      width: metadata.width,
      height: metadata.height,
      sizeBytes: bytes.length,
      sha256: hashBytes(bytes),
    };
  }

  async read(image: ImageVersion & { storageKey: string }) {
    const expected = posix.join("derived", image.productId, image.id + (image.mimeType === "image/png" ? ".png" : ".jpg"));
    if (image.storageKey !== expected) throw new CatalogError(500, "IMAGE_FILE_CORRUPT", "派生图片位置与记录不符，请检查本地存储。");
    let bytes: Buffer;
    try {
      const path = await this.originals.checkedPath(image.storageKey);
      const info = await lstat(path);
      if (!info.isFile() || info.size !== image.sizeBytes || info.size > STORAGE_LIMITS.fileBytes) {
        throw new CatalogError(500, "IMAGE_FILE_CORRUPT", "派生图片与保存记录不一致，请从备份恢复。");
      }
      bytes = await readFile(path);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw new CatalogError(500, "IMAGE_FILE_MISSING", "派生图片文件缺失，记录仍保留，请从备份恢复。");
      }
      throw error;
    }
    if (hashBytes(bytes) !== image.sha256) throw new CatalogError(500, "IMAGE_FILE_CORRUPT", "派生图片校验失败，请从备份恢复。");
    try {
      const metadata = await inspectImage(bytes);
      if (metadata.mimeType !== image.mimeType || metadata.width !== image.width || metadata.height !== image.height) {
        throw new Error("metadata mismatch");
      }
    } catch {
      throw new CatalogError(500, "IMAGE_FILE_CORRUPT", "派生图片解码校验失败，请从备份恢复。");
    }
    return bytes;
  }

  async recover(images: (ImageVersion & { storageKey: string })[]) {
    const known = new Set(images.map(image => image.storageKey));
    const records: { key: string; reason: string }[] = [];
    const walk = async (directory: string) => {
      for (const entry of await readdir(await this.originals.checkedPath(directory), { withFileTypes: true })) {
        const key = posix.join(directory, entry.name);
        if (entry.isSymbolicLink()) { records.push({ key, reason: "unexpected-link" }); continue; }
        if (entry.isDirectory()) await walk(key);
        else if (!known.has(key)) records.push({ key, reason: "unregistered-derived-image" });
      }
    };
    await walk("derived");
    for (const image of images) {
      try { await this.read(image); }
      catch (error) {
        if (!(error instanceof CatalogError)) throw error;
        records.push({ key: image.storageKey, reason: error.code });
      }
    }
    if (records.length) await writeFile(await this.originals.checkedPath(posix.join("recovery", randomUUID() + ".json")),
      JSON.stringify({ checkedAt: new Date().toISOString(), records }, null, 2), { flag: "wx" });
    return records.length;
  }
}
