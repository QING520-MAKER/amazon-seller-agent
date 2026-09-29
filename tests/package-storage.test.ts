import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import type { ContentService } from "../src/content/service.js";
import { CreateProductSchema, GenerateContentSchema, CreateContentPackageSchema, type ContentPackage } from "../src/schemas.js";
import { ImageService } from "../src/image/service.js";
import { KnowledgeRepository } from "../src/knowledge/repository.js";
import { PackageService } from "../src/packages/service.js";
import { png } from "./fixtures/catalog-images.js";

interface Fixture {
  catalog: CatalogService;
  dataDir: string;
  content: NonNullable<CatalogService["contentService"]>;
  images: ImageService;
  packages: PackageService;
  product: ReturnType<CatalogService["repository"]["create"]>;
  asset: { id: string; version: number };
  contentVersion: Awaited<ReturnType<ContentService["generate"]>>["content"];
  imageVersions: { id: string }[];
}

const open = async (dataDir?: string) => {
  await mkdir("E:\\CodexTemp", { recursive: true });
  const dir = dataDir ?? await mkdtemp("E:\\CodexTemp\\asa-package-");
  const catalog = (await openCatalog({ dataDir: dir })).catalog;
  expect(catalog.contentService).toBeDefined();
  expect(catalog.imageService).toBeDefined();
  expect(catalog.packageService).toBeDefined();
  const content = catalog.contentService!;
  const images = catalog.imageService!;
  const packages = catalog.packageService!;
  return { catalog, dataDir: dir, content, images, packages };
};

async function fixture(sku = "PACKAGE-A", dataDir?: string): Promise<Fixture> {
  const opened = await open(dataDir);
  const { catalog, content, images, packages } = opened;
  const product = catalog.repository.create(CreateProductSchema.parse({
    sku,
    brief: { name: "Travel Mug", brand: "Acme", attributes: ["300 ml"], features: ["Steel body"], included: ["Lid"] },
    sourceNote: "manual source",
  }));
  const uploaded = await catalog.upload(product.product.id, new File([await png(40, 32)], "original.png", { type: "image/png" }));
  const contentResult = await content.generate(product.product.id, GenerateContentSchema.parse({
    requestId: randomUUID(), sourceRevisionId: product.currentRevision.id, baseContentVersionId: null,
    marketplace: "us", keywords: ["travel mug"], mode: "template",
  }));
  const contentVersion = contentResult.content!;
  content.review(product.product.id, contentVersion.id, "approved", "fact checked");
  const imageVersions: { id: string }[] = [];
  for (const headline of ["Lightweight steel mug", "Easy daily carry"]) {
    const result = await images.generate(product.product.id, {
      requestId: randomUUID(), sourceRevisionId: product.currentRevision.id,
      originalAssetId: uploaded.asset.id, originalAssetVersion: uploaded.asset.version,
      knowledgeRevisionIds: [], mode: "local",
      plan: { purpose: "feature", headline, captions: ["Steel body"], prompt: "" },
    });
    const image = result.image!;
    images.review(product.product.id, image.id, "approved", "asset checked");
    imageVersions.push(image);
  }
  return { ...opened, product, asset: uploaded.asset, contentVersion, imageVersions };
}

function close(fixture: { catalog: CatalogService }) { fixture.catalog.close(); }

/** Reads the store-only ZIP emitted by createZip without depending on an unzip package. */
function readStoredZip(bytes: Buffer) {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("ZIP end record missing");
  const count = bytes.readUInt16LE(eocd + 8);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  expect(centralOffset + centralSize).toBe(eocd);
  const entries = new Map<string, Buffer>();
  let cursor = centralOffset;
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    expect(bytes.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, bytes.subarray(dataStart, dataStart + compressedSize));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe("durable content packages", () => {
  const opened: CatalogService[] = [];
  afterEach(() => { for (const catalog of opened.splice(0)) catalog.close(); });

  it("stores an approved package and emits ordered real PNG bytes plus a fixed manifest", async () => {
    const f = await fixture(); opened.push(f.catalog);
    const input = CreateContentPackageSchema.parse({ requestId: randomUUID(), contentVersionId: f.contentVersion!.id,
      imageVersionIds: f.imageVersions.map(image => image.id), status: "approved" });
    const pack = f.packages.create(f.product.product.id, input);
    const downloaded = await f.packages.download(f.product.product.id, pack.id);
    expect(downloaded.pack.id).toBe(pack.id);
    const entries = readStoredZip(downloaded.bytes);
    expect([...entries.keys()]).toEqual([
      "manifest.json", "listing.txt", "README.txt",
      `images/01-${f.imageVersions[0]!.id}.png`, `images/02-${f.imageVersions[1]!.id}.png`,
    ]);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as ContentPackage;
    expect(manifest.manifest.status).toBe("approved");
    expect(manifest.manifest.images.map(image => image.image.id)).toEqual(f.imageVersions.map(image => image.id));
    expect(entries.get("images/01-" + f.imageVersions[0]!.id + ".png")).toEqual((await f.images.content(f.product.product.id, f.imageVersions[0]!.id)).bytes);
    expect(entries.get("images/02-" + f.imageVersions[1]!.id + ".png")).toEqual((await f.images.content(f.product.product.id, f.imageVersions[1]!.id)).bytes);
    expect(entries.get("README.txt")!.toString("utf8")).toContain("APPROVED LOCAL CONTENT PACKAGE");
  });

  it("requires approval for formal packages, marks drafts, and protects request keys and rows", async () => {
    const f = await fixture("PACKAGE-B"); opened.push(f.catalog);
    const secondContent = await f.content.generate(f.product.product.id, GenerateContentSchema.parse({
      requestId: randomUUID(), sourceRevisionId: f.product.currentRevision.id, baseContentVersionId: f.contentVersion!.id,
      marketplace: "us", keywords: ["travel mug", "steel"], mode: "template",
    }));
    const unapproved = { requestId: randomUUID(), contentVersionId: secondContent.content!.id, imageVersionIds: f.imageVersions.map(image => image.id), status: "approved" as const };
    expect(() => f.packages.create(f.product.product.id, unapproved)).toThrowError(expect.objectContaining({ code: "PACKAGE_NOT_APPROVED" }));
    const draft = f.packages.create(f.product.product.id, { ...unapproved, requestId: randomUUID(), status: "draft" });
    const draftZip = readStoredZip((await f.packages.download(f.product.product.id, draft.id)).bytes);
    expect(draftZip.get("README.txt")!.toString("utf8")).toContain("DRAFT - NOT APPROVED");
    const replay = f.packages.create(f.product.product.id, { ...unapproved, requestId: draft.requestId, status: "draft" });
    expect(replay.id).toBe(draft.id);
    expect(() => f.packages.create(f.product.product.id, { ...unapproved, requestId: draft.requestId, status: "approved" })).toThrowError(expect.objectContaining({ status: 409 }));
    expect(() => f.catalog.repository.db.prepare("UPDATE content_packages SET input_hash='bad' WHERE id=?").run(draft.id)).toThrow("immutable");
    expect(() => f.catalog.repository.db.prepare("DELETE FROM content_packages WHERE id=?").run(draft.id)).toThrow("immutable");
  });

  it("rejects cross-product records and keeps snapshots while formal downloads become stale", async () => {
    const f = await fixture("PACKAGE-C"); opened.push(f.catalog);
    const approved = f.packages.create(f.product.product.id, { requestId: randomUUID(), contentVersionId: f.contentVersion!.id,
      imageVersionIds: f.imageVersions.map(image => image.id), status: "approved" });
    const otherProduct = f.catalog.repository.create(CreateProductSchema.parse({ sku: "PACKAGE-C-OTHER", brief: { name: "Other Mug" } }));
    const otherContentResult = await f.content.generate(otherProduct.product.id, GenerateContentSchema.parse({
      requestId: randomUUID(), sourceRevisionId: otherProduct.currentRevision.id, baseContentVersionId: null,
      marketplace: "us", keywords: ["other mug"], mode: "template",
    }));
    expect(() => f.packages.create(f.product.product.id, { requestId: randomUUID(), contentVersionId: otherContentResult.content!.id,
      imageVersionIds: f.imageVersions.map(image => image.id), status: "approved" })).toThrowError(expect.objectContaining({ status: 404 }));
    f.catalog.repository.save(f.product.product.id, { baseRevisionId: f.product.product.currentRevisionId,
      brief: { ...f.product.currentRevision.brief, brand: "Changed" }, sourceNote: "new source" });
    await expect(f.packages.download(f.product.product.id, approved.id)).rejects.toMatchObject({ code: "PACKAGE_STALE" });
    const saved = f.packages.get(f.product.product.id, approved.id);
    expect(saved.manifest.content.content.copy.title).toBe(approved.manifest.content.content.copy.title);
    expect(saved.manifest.images[0]!.image.sha256).toBe(approved.manifest.images[0]!.image.sha256);
  });

  it("rejects formal download after original archival or review revocation", async () => {
    const f = await fixture("PACKAGE-D"); opened.push(f.catalog);
    const archivedPack = f.packages.create(f.product.product.id, { requestId: randomUUID(), contentVersionId: f.contentVersion!.id,
      imageVersionIds: f.imageVersions.map(image => image.id), status: "approved" });
    f.catalog.repository.setAssetState(f.product.product.id, f.asset.id, f.asset.version, true);
    await expect(f.packages.download(f.product.product.id, archivedPack.id)).rejects.toMatchObject({ code: "PACKAGE_STALE" });

    const revoked = await fixture("PACKAGE-E"); opened.push(revoked.catalog);
    const pack = revoked.packages.create(revoked.product.product.id, { requestId: randomUUID(), contentVersionId: revoked.contentVersion!.id,
      imageVersionIds: revoked.imageVersions.map(image => image.id), status: "approved" });
    revoked.content.review(revoked.product.product.id, revoked.contentVersion!.id, "rejected", "needs edits");
    revoked.images.review(revoked.product.product.id, revoked.imageVersions[0]!.id, "rejected", "replace image");
    await expect(revoked.packages.download(revoked.product.product.id, pack.id)).rejects.toMatchObject({ code: "PACKAGE_STALE" });
  });

  it("keeps knowledge evidence fixed and rejects formal download after knowledge changes", async () => {
    const f = await fixture("PACKAGE-K"); opened.push(f.catalog);
    const knowledge = new KnowledgeRepository(f.catalog.repository);
    const draft = knowledge.create(f.product.product.id, { kind: "product_fact", title: "Capacity", content: "300 ml", source: "manual", status: "draft" });
    const approved = knowledge.save(f.product.product.id, draft.entryId, { kind: draft.kind, title: draft.title, content: draft.content,
      source: draft.source, status: "approved", baseRevisionId: draft.id });
    const contentResult = await f.content.generate(f.product.product.id, GenerateContentSchema.parse({
      requestId: randomUUID(), sourceRevisionId: f.product.currentRevision.id, baseContentVersionId: f.contentVersion!.id,
      marketplace: "us", keywords: ["travel mug"], mode: "template", knowledgeRevisionIds: [approved.id],
    }));
    const content = contentResult.content!;
    f.content.review(f.product.product.id, content.id, "approved", "checked");
    const imageResult = await f.images.generate(f.product.product.id, {
      requestId: randomUUID(), sourceRevisionId: f.product.currentRevision.id, originalAssetId: f.asset.id,
      originalAssetVersion: f.asset.version, knowledgeRevisionIds: [approved.id], mode: "local",
      plan: { purpose: "feature", headline: "Capacity confirmed", captions: ["300 ml"], prompt: "" },
    });
    f.images.review(f.product.product.id, imageResult.image!.id, "approved", "checked");
    const pack = f.packages.create(f.product.product.id, { requestId: randomUUID(), contentVersionId: content.id,
      imageVersionIds: [imageResult.image!.id], status: "approved" });
    knowledge.save(f.product.product.id, approved.entryId, { kind: approved.kind, title: approved.title, content: "500 ml",
      source: approved.source, status: "draft", baseRevisionId: approved.id });
    await expect(f.packages.download(f.product.product.id, pack.id)).rejects.toMatchObject({ code: "PACKAGE_STALE" });
    expect(f.packages.get(f.product.product.id, pack.id).manifest.content.content.evidence[0]!.content).toBe("300 ml");
  });

  it("rechecks freshness after asynchronous image reads", async () => {
    const f = await fixture("PACKAGE-F"); opened.push(f.catalog);
    const pack = f.packages.create(f.product.product.id, { requestId: randomUUID(), contentVersionId: f.contentVersion!.id,
      imageVersionIds: f.imageVersions.map(image => image.id), status: "approved" });
    let entered!: () => void;
    let release!: () => void;
    const readStarted = new Promise<void>(resolve => { entered = resolve; });
    const allowRead = new Promise<void>(resolve => { release = resolve; });
    const reader = {
      detail: f.images.detail.bind(f.images),
      async content(productId: string, id: string) {
        entered();
        await allowRead;
        return f.images.content(productId, id);
      },
    };
    const delayed = new PackageService(f.catalog, f.content, reader);
    const download = delayed.download(f.product.product.id, pack.id);
    await readStarted;
    f.catalog.repository.save(f.product.product.id, { baseRevisionId: f.product.product.currentRevisionId,
      brief: { ...f.product.currentRevision.brief, brand: "Changed during export" }, sourceNote: "changed during read" });
    release();
    await expect(download).rejects.toMatchObject({ code: "PACKAGE_STALE" });
  });

  it("reopens package records from the same SQLite database", async () => {
    const f = await fixture("PACKAGE-G");
    const pack = f.packages.create(f.product.product.id, { requestId: randomUUID(), contentVersionId: f.contentVersion!.id,
      imageVersionIds: f.imageVersions.map(image => image.id), status: "approved" });
    const dataDir = f.dataDir;
    f.catalog.close();
    const reopened = await open(dataDir);
    opened.push(reopened.catalog);
    const found = reopened.packages.get(f.product.product.id, pack.id);
    expect(found.manifest.images).toHaveLength(2);
    expect((await reopened.packages.download(f.product.product.id, pack.id)).bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
});
