import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, writeFile, unlink, cp } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { CreateProductSchema, SaveProductBriefSchema } from "../src/schemas.js";
import { hashBytes } from "../src/storage/files.js";
import type { FileFaults } from "../src/storage/files.js";

const page = { limit: 20, offset: 0 };
const opened = new Set<CatalogService>();
async function temp() {
  await mkdir("E:\\CodexTemp", { recursive: true });
  return mkdtemp("E:\\CodexTemp\\asa-storage-中文 空格-");
}
async function setup(faults: FileFaults = {}, dataDir?: string) {
  const settings = { dataDir: dataDir ?? await temp() };
  const result = await openCatalog(settings, faults);
  opened.add(result.catalog);
  return { ...result, settings, repo: result.catalog.repository };
}
function close(catalog: CatalogService) { catalog.close(); opened.delete(catalog); }
afterEach(() => { for (const c of opened) c.close(); opened.clear(); });
const create = (sku = "A", name = "商品") => CreateProductSchema.parse({ sku, brief: { name } });
async function image(color = "#cc2233", name = "原图.png") {
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).png().toBuffer();
  return new File([bytes], name, { type: "text/plain" });
}

describe("SQLite catalog with real disk originals", () => {
  it.each([false, true])("timestamps registration after an interleaved edit without changing asset createdAt (clock rollback: %s)", async rollback => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const stagedAt = "2026-09-20T03:20:47.000Z", editedAt = "2026-09-20T03:20:48.000Z";
    const registeredAt = rollback ? "2026-09-20T03:20:47.500Z" : "2026-09-20T03:20:49.000Z";
    vi.setSystemTime(new Date(stagedAt));
    const { catalog, repo } = await setup({ point: point => {
      if (point !== "before-register") return;
      vi.setSystemTime(new Date(editedAt));
      repo.save(a.product.id, { baseRevisionId: a.currentRevision.id, brief: { ...a.currentRevision.brief, name: "编辑后" }, sourceNote: "交错测试" });
      vi.setSystemTime(new Date(registeredAt));
    } });
    const a = repo.create(create());
    const result = await catalog.upload(a.product.id, await image());
    expect(result.asset.createdAt).toBe(stagedAt);
    expect(repo.product(a.product.id).updatedAt).toBe(rollback ? editedAt : registeredAt);
    expect(repo.detail(a.product.id).currentRevision.revisionNumber).toBe(2);
    expect(hashBytes((await catalog.content(a.product.id, result.asset.id)).bytes)).toBe(result.asset.sha256);
  });
  it("starts empty, treats SKU case literally and escapes search wildcards", async () => {
    const { repo } = await setup();
    expect(repo.list("", page).total).toBe(0);
    const a = repo.create(create(" A%_ ", "真商品"));
    expect(a.missingFields).toEqual(["attributes", "features", "included", "sourceNote", "originalAssets"]);
    expect(() => repo.create(create("A%_"))).toThrowError(expect.objectContaining({ code: "SKU_CONFLICT" }));
    repo.create(create("a%_")); repo.create(create("other"));
    expect(repo.list("%_", page).total).toBe(2);
    expect(repo.list("A%", page).total).toBe(2); // search is insensitive; SKU uniqueness is binary.
    expect(repo.db.prepare("SELECT COUNT(*) AS n FROM product_revisions").get()).toEqual({ n: 3 });
  });
  it("CAS, no-op, immutable history and same-product head are enforced", async () => {
    const { repo } = await setup();
    const a = repo.create(create()), b = repo.create(create("B"));
    const base = { baseRevisionId: a.currentRevision.id, brief: { ...a.currentRevision.brief, brand: "真品牌", attributes: ["500ml"] }, sourceNote: "包装" };
    const updated = repo.save(a.product.id, SaveProductBriefSchema.parse(base));
    expect(updated.revision.revisionNumber).toBe(2);
    expect(() => repo.save(a.product.id, base)).toThrowError(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    expect(repo.save(a.product.id, { ...base, baseRevisionId: updated.revision.id }).changed).toBe(false);
    expect(repo.revisions(a.product.id, page).total).toBe(2);
    expect(repo.revision(a.product.id, a.currentRevision.id).brief.brand).toBe("");
    expect(() => repo.revision(a.product.id, b.currentRevision.id)).toThrowError(expect.objectContaining({ code: "REVISION_NOT_FOUND" }));
    expect(() => repo.db.prepare("UPDATE product_revisions SET source_note='x' WHERE id=?").run(a.currentRevision.id)).toThrow("immutable");
    expect(() => repo.db.prepare("UPDATE products SET current_revision_id=? WHERE id=?").run(b.currentRevision.id, a.product.id)).toThrow();
    expect(repo.product(a.product.id).currentRevisionId).toBe(updated.revision.id);
    const cleared = repo.save(a.product.id, { ...base, baseRevisionId: updated.revision.id,
      brief: { ...base.brief, name: "新名称", brand: "" } });
    expect(cleared.revision.brief).toMatchObject({ name: "新名称", brand: "", attributes: ["500ml"] });
    expect(cleared.revision.sourceNote).toBe("包装");
  });
  it("isolates products, deduplicates concurrent bytes, archives and restores without changing the head", async () => {
    const { catalog, repo } = await setup();
    const a = repo.create(create()), b = repo.create(create("B"));
    const file = await image();
    const results = await Promise.all([catalog.upload(a.product.id, file), catalog.upload(a.product.id, file)]);
    expect(results[0]!.asset.id).toBe(results[1]!.asset.id);
    expect(results.filter(x => !x.reused)).toHaveLength(1);
    const other = await catalog.upload(b.product.id, await image("#3344dd"));
    expect(other.asset.id).not.toBe(results[0]!.asset.id);
    await expect(catalog.content(b.product.id, results[0]!.asset.id)).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    const asset = results[0]!.asset;
    const archived = repo.setAssetState(a.product.id, asset.id, 1, true);
    expect(archived.asset.version).toBe(2);
    expect(repo.setAssetState(a.product.id, asset.id, 2, true).changed).toBe(false);
    expect((await catalog.upload(a.product.id, file)).asset.archivedAt).not.toBeNull();
    expect(() => repo.setAssetState(a.product.id, asset.id, 1, false)).toThrowError(expect.objectContaining({ code: "ASSET_VERSION_CONFLICT" }));
    const restored = repo.setAssetState(a.product.id, asset.id, 2, false);
    expect(restored.asset.version).toBe(3);
    expect(hashBytes((await catalog.content(a.product.id, asset.id)).bytes)).toBe(asset.sha256);
    expect(repo.product(a.product.id).currentRevisionId).toBe(a.currentRevision.id);
    expect(await readdir(join(catalog.files.root, "originals", a.product.id))).toHaveLength(1);
  });
  it("rolls back failed registration; retains a committed asset even if the response fails", async () => {
    let failAt: string = "before-register";
    const { catalog, repo, settings } = await setup({ point: (point) => { if (point === failAt) throw new Error("injected"); } });
    const a = repo.create(create()), file = await image();
    await expect(catalog.upload(a.product.id, file)).rejects.toThrow("injected");
    expect(repo.assets(a.product.id, "active", page).total).toBe(0);
    expect(await readdir(join(settings.dataDir, "originals", a.product.id))).toHaveLength(0);
    failAt = "after-register";
    await expect(catalog.upload(a.product.id, file)).rejects.toThrow("injected");
    const saved = repo.assets(a.product.id, "active", page).items[0]!;
    expect((await catalog.content(a.product.id, saved.id)).bytes.length).toBe(saved.sizeBytes);
    failAt = "";
    expect((await catalog.upload(a.product.id, file)).asset.id).toBe(saved.id);
  });
  it("never overwrites or removes a pre-existing exclusive-copy target", async () => {
    const assetId = randomUUID();
    const { catalog, repo, settings } = await setup({ assetId: () => assetId });
    const a = repo.create(create()), directory = join(settings.dataDir, "originals", a.product.id);
    await mkdir(directory);
    const path = join(directory, assetId + ".png");
    await writeFile(path, "pre-existing bytes");
    await expect(catalog.upload(a.product.id, await image())).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path, "utf8")).toBe("pre-existing bytes");
    expect(repo.assets(a.product.id, "active", page).total).toBe(0);
  });
  it.each(["temporary-write", "before-copy"])("cleans owned temporary bytes when %s fails", async failAt => {
    const { catalog, repo, settings } = await setup({ point: point => {
      if (point === failAt) throw Object.assign(new Error("injected disk failure"), { code: "ENOSPC" });
    } });
    const a = repo.create(create());
    await expect(catalog.upload(a.product.id, await image())).rejects.toMatchObject({ code: "ENOSPC" });
    expect(repo.assets(a.product.id, "active", page).total).toBe(0);
    expect(await readdir(join(settings.dataDir, "tmp"))).toHaveLength(0);
    expect(await readdir(join(settings.dataDir, "originals"))).toHaveLength(0);
  });
  it("keeps JPEG EXIF and original dimensions/bytes, and detects changed file contents", async () => {
    const { catalog, repo, settings } = await setup();
    const a = repo.create(create());
    const bytes = await sharp({ create: { width: 24, height: 32, channels: 3, background: "#aa3355" } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const saved = await catalog.upload(a.product.id, new File([bytes], "原图.png", { type: "text/html" }));
    expect(saved.asset).toMatchObject({ mimeType: "image/jpeg", width: 24, height: 32, orientation: 6 });
    expect((await catalog.content(a.product.id, saved.asset.id)).bytes).toEqual(bytes);
    const corrupted = Buffer.from(bytes); corrupted[corrupted.length - 1] ^= 1;
    await writeFile(join(settings.dataDir, repo.asset(a.product.id, saved.asset.id).storageKey), corrupted);
    await expect(catalog.content(a.product.id, saved.asset.id)).rejects.toMatchObject({ code: "ASSET_FILE_CORRUPT" });
    expect(repo.assets(a.product.id, "active", page).total).toBe(1);
  });
  it("reopens, diagnoses orphans/missing originals, and restores an offline backup at another location", async () => {
    const first = await setup();
    const a = first.repo.create(create());
    const saved = await first.catalog.upload(a.product.id, await image());
    first.repo.setAssetState(a.product.id, saved.asset.id, 1, true);
    await writeFile(join(first.settings.dataDir, "tmp", "interrupted.part"), "incomplete");
    await writeFile(join(first.settings.dataDir, "originals", "orphan.png"), "unregistered");
    close(first.catalog);
    const backupDir = join(await temp(), "backup");
    await cp(first.settings.dataDir, backupDir, { recursive: true });
    const second = await setup({}, backupDir);
    expect(second.recoveryRecords).toBe(2);
    expect(second.repo.detail(a.product.id).currentRevision).toEqual(a.currentRevision);
    expect(second.repo.assets(a.product.id, "archived", page).total).toBe(1);
    expect(hashBytes((await second.catalog.content(a.product.id, saved.asset.id)).bytes)).toBe(saved.asset.sha256);
    const stored = second.repo.asset(a.product.id, saved.asset.id);
    await unlink(join(backupDir, stored.storageKey));
    await expect(second.catalog.content(a.product.id, saved.asset.id)).rejects.toMatchObject({ code: "ASSET_FILE_MISSING" });
    await expect(second.catalog.upload(a.product.id, await image())).rejects.toMatchObject({ code: "ASSET_FILE_MISSING" });
    close(second.catalog);
    const third = await setup({}, backupDir);
    expect(third.recoveryRecords).toBe(3);
    expect(third.repo.assets(a.product.id, "archived", page).total).toBe(1);
  });
  it("rejects unknown migration versions without resetting data", async () => {
    const { catalog, repo, settings } = await setup();
    const a = repo.create(create());
    close(catalog);
    const db = new Database(join(settings.dataDir, "catalog.sqlite"));
    db.prepare("INSERT INTO schema_migrations VALUES (99, ?)").run(new Date().toISOString());
    db.close();
    await expect(openCatalog(settings)).rejects.toThrow("迁移版本");
    const check = new Database(join(settings.dataDir, "catalog.sqlite"));
    expect(check.prepare("SELECT id FROM products").get()).toEqual({ id: a.product.id });
    check.close();
  });
});
