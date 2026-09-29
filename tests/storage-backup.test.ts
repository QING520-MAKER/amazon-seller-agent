import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openCatalog } from "../src/catalog/service.js";
import { CreateProductSchema } from "../src/schemas.js";
import { backupData, restoreData, verifyBackup } from "../src/storage/backup.js";

const offline = { guard: async () => async () => {} };
async function fixture() {
  const parent = await mkdtemp("E:\\CodexTemp\\asa-backup-test-");
  const source = join(parent, "source with spaces");
  const { catalog } = await openCatalog({ dataDir: source });
  const product = catalog.repository.create(CreateProductSchema.parse({ sku: "BACKUP-QA", brief: { name: "Synthetic fixture" } }));
  catalog.close();
  await mkdir(join(source, "originals", "fixture"));
  await mkdir(join(source, "derived", "fixture"));
  await writeFile(join(source, "originals", "fixture", "sample.bin"), Buffer.from([1, 5, 9, 255]));
  await writeFile(join(source, "derived", "fixture", "sample.bin"), Buffer.from([3, 4, 128]));
  return { parent, source, backup: join(parent, "backup with spaces"), restored: join(parent, "restored with spaces"), product };
}
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");

describe("offline data backup and restore", () => {
  it("round trips a real database and every asset byte without rewriting the source", async () => {
    const f = await fixture();
    const before = hash(await readFile(join(f.source, "catalog.sqlite")));
    const sourceFiles = await readdir(f.source);
    const made = await backupData(f.source, f.backup, offline);
    expect(made.schemaVersion).toBe(7);
    expect(made.files).toBeGreaterThanOrEqual(3);
    expect(await verifyBackup(f.backup, offline)).toMatchObject({ files: made.files });
    await restoreData(f.backup, f.restored, offline);
    for (const path of ["catalog.sqlite", "originals/fixture/sample.bin", "derived/fixture/sample.bin"]) {
      expect(await readFile(join(f.restored, path))).toEqual(await readFile(join(f.source, path)));
    }
    expect(hash(await readFile(join(f.source, "catalog.sqlite")))).toBe(before);
    expect(await readdir(f.source)).toEqual(sourceFiles);
    const db = new Database(join(f.restored, "catalog.sqlite"), { readonly: true });
    try { expect(db.prepare("SELECT id,sku FROM products").get()).toEqual({ id: f.product.product.id, sku: "BACKUP-QA" }); }
    finally { db.close(); }
  });
  it("rejects existing or nested destinations without overwriting files", async () => {
    const f = await fixture();
    const marker = join(f.parent, "keep.txt"); await writeFile(marker, "keep");
    await expect(backupData(f.source, f.parent, offline)).rejects.toMatchObject({ code: "DESTINATION_EXISTS" });
    await expect(backupData(f.source, join(f.source, "nested"), offline)).rejects.toMatchObject({ code: "NESTED_PATHS" });
    await backupData(f.source, f.backup, offline);
    await expect(restoreData(f.backup, f.source, offline)).rejects.toMatchObject({ code: "DESTINATION_EXISTS" });
    expect(await readFile(marker, "utf8")).toBe("keep");
  });
  it("refuses tampered files before creating the restore directory", async () => {
    const f = await fixture(); await backupData(f.source, f.backup, offline);
    await writeFile(join(f.backup, "data", "derived", "fixture", "sample.bin"), "tampered");
    await expect(restoreData(f.backup, f.restored, offline)).rejects.toMatchObject({ code: "BACKUP_MISMATCH" });
    expect(await readdir(f.parent)).not.toContain("restored with spaces");
  });
  it.each(["../outside", "C:/outside", "derived\\outside", "derived/CON", "derived/evil:stream"])("rejects unsafe manifest path %s", async path => {
    const f = await fixture(); await backupData(f.source, f.backup, offline);
    const file = join(f.backup, "manifest.json"), manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.files[0].path = path; await writeFile(file, JSON.stringify(manifest));
    await expect(restoreData(f.backup, f.restored, offline)).rejects.toMatchObject({ code: "INVALID_MANIFEST_PATH" });
    expect(await readdir(f.parent)).not.toContain("restored with spaces");
  });
  it("rejects duplicate manifest entries and an incomplete backup", async () => {
    const f = await fixture(); await backupData(f.source, f.backup, offline);
    const file = join(f.backup, "manifest.json"), manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.files.push(manifest.files[0]); await writeFile(file, JSON.stringify(manifest));
    await expect(verifyBackup(f.backup, offline)).rejects.toMatchObject({ code: "INVALID_MANIFEST" });
    await writeFile(file, "{partial");
    await expect(restoreData(f.backup, f.restored, offline)).rejects.toMatchObject({ code: "INVALID_MANIFEST" });
  });
  it("rejects unclean WAL and does not create a backup destination", async () => {
    const f = await fixture(); await writeFile(join(f.source, "catalog.sqlite-wal"), "uncheckpointed");
    await expect(backupData(f.source, f.backup, offline)).rejects.toMatchObject({ code: "UNCLEAN_DATABASE" });
    expect(await readdir(f.parent)).not.toContain("backup with spaces");
  });
  it("rejects directory junctions without copying the linked contents", async () => {
    const f = await fixture(); const external = join(f.parent, "external"); await mkdir(external);
    await writeFile(join(external, "secret.txt"), "unrelated");
    await symlink(external, join(f.source, "linked"), "junction");
    await expect(backupData(f.source, f.backup, offline)).rejects.toMatchObject({ code: "LINK_NOT_ALLOWED" });
    expect(await readdir(f.parent)).not.toContain("backup with spaces");
  });
  it("stops before touching paths when the offline guard refuses", async () => {
    const f = await fixture();
    await expect(backupData(f.source, f.backup, { guard: async () => { throw new Error("service active"); } })).rejects.toThrow("service active");
    expect(await readdir(f.parent)).not.toContain("backup with spaces");
  });
  it("releases the offline guard when source validation fails", async () => {
    const f = await fixture(), release = vi.fn(async () => {});
    await writeFile(join(f.source, "catalog.sqlite"), "invalid database");
    await expect(backupData(f.source, f.backup, { guard: async () => release })).rejects.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
    expect(await readdir(f.parent)).not.toContain("backup with spaces");
  });
});
