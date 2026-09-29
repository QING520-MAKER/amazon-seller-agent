// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductBriefSchema, type ContentDetail, type ContentPackage, type ContentVersion, type ImageDetail, type ImageVersion, type OriginalAsset, type ProductDetail } from "../src/schemas.js";
import { PackageStudio } from "../apps/web/src/packages/PackageStudio.js";
import { CatalogApiError } from "../apps/web/src/products/api.js";

const contentMocks = vi.hoisted(() => ({ listContent: vi.fn(), getContentDetail: vi.fn() }));
const imageMocks = vi.hoisted(() => ({ listImages: vi.fn(), getImageDetail: vi.fn() }));
const packageMocks = vi.hoisted(() => ({ listPackages: vi.fn(), getPackage: vi.fn(), createPackage: vi.fn(), downloadPackage: vi.fn(), randomRequestId: vi.fn(() => "80000000-0000-4000-8000-000000000001") }));
vi.mock("../apps/web/src/content/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/content/api.js")>(), ...contentMocks }));
vi.mock("../apps/web/src/image/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/image/api.js")>(), ...imageMocks }));
vi.mock("../apps/web/src/packages/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/packages/api.js")>(), ...packageMocks }));

const productId = "10000000-0000-4000-8000-000000000001", sourceRevisionId = "20000000-0000-4000-8000-000000000001", contentId = "30000000-0000-4000-8000-000000000001", imageId = "40000000-0000-4000-8000-000000000001";
const asset: OriginalAsset = { id: "50000000-0000-4000-8000-000000000001", productId, kind: "original", originalName: "real.jpg", mimeType: "image/jpeg", sizeBytes: 1000, width: 800, height: 800, orientation: 1, sha256: "a".repeat(64), createdAt: "2026-09-20T00:00:00.000Z", archivedAt: null, version: 1 };
const product: ProductDetail = { product: { id: productId, workspaceId: "local", sku: "SKU-A", currentRevisionId: sourceRevisionId, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" }, currentRevision: { id: sourceRevisionId, productId, revisionNumber: 1, brief: ProductBriefSchema.parse({ name: "真实商品" }), sourceNote: "manual", createdAt: "2026-09-20T00:00:00.000Z" }, missingFields: [] };
const content: ContentVersion = { id: contentId, productId, sourceRevisionId, versionNumber: 1, parentVersionId: null, marketplace: "us", language: "en_US", keywords: ["real"], copy: { title: "Real product", itemHighlights: "Real highlight", bullets: ["One", "Two", "Three", "Four", "Five"], description: "Real description", backendSearchTerms: ["real"] }, coverage: { rows: [], coveragePct: 100, uncovered: [] }, evidence: [], rulesVersion: "test", source: "template", model: null, generationRunId: null, createdAt: "2026-09-20T00:00:00.000Z" };
const image: ImageVersion = { id: imageId, productId, sourceRevisionId, versionNumber: 1, original: asset, plan: { purpose: "feature", headline: "Real product", captions: [], prompt: "" }, evidence: [], mode: "local", provider: "local", model: null, mimeType: "image/png", width: 1600, height: 1600, sizeBytes: 1000, sha256: "b".repeat(64), generationRunId: "60000000-0000-4000-8000-000000000001", createdAt: "2026-09-20T00:00:00.000Z" };
const image2: ImageVersion = { ...image, id: "40000000-0000-4000-8000-000000000002", versionNumber: 2, plan: { ...image.plan, headline: "Second product view" } };
const contentDetail: ContentDetail = { content, review: null, stale: false, staleReasons: [] };
const imageDetail: ImageDetail = { image, review: null, stale: false, staleReasons: [] };
const pack = (status: "draft" | "approved" = "draft"): ContentPackage => ({ id: "90000000-0000-4000-8000-000000000001", productId, requestId: "80000000-0000-4000-8000-000000000001", versionNumber: 1, createdAt: "2026-09-20T00:00:00.000Z", manifest: { schemaVersion: 1, sku: "SKU-A", status, content: contentDetail, images: [imageDetail] } });

beforeEach(() => { Object.values(contentMocks).forEach(mock => mock.mockReset()); Object.values(imageMocks).forEach(mock => mock.mockReset()); Object.values(packageMocks).forEach(mock => mock.mockReset()); contentMocks.listContent.mockResolvedValue({ items: [content], total: 1, limit: 30, offset: 0, headVersionId: contentId }); contentMocks.getContentDetail.mockResolvedValue(contentDetail); imageMocks.listImages.mockResolvedValue({ items: [image], total: 1, limit: 30, offset: 0 }); imageMocks.getImageDetail.mockResolvedValue(imageDetail); packageMocks.listPackages.mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0 }); packageMocks.createPackage.mockResolvedValue(pack()); packageMocks.getPackage.mockResolvedValue(pack()); packageMocks.randomRequestId.mockReturnValue("80000000-0000-4000-8000-000000000001"); });
afterEach(cleanup);

describe("package studio", () => {
  it("keeps an ordered image selection and creates an immutable draft snapshot", async () => {
    render(<PackageStudio product={product} />);
    await screen.findByText("内容包工作台");
    await screen.findByText(/v1 · 本地模板/);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "制作草稿包" }));
    await waitFor(() => expect(packageMocks.createPackage).toHaveBeenCalledWith(productId, expect.objectContaining({ contentVersionId: contentId, imageVersionIds: [imageId], status: "draft" })));
    expect(packageMocks.getPackage).toHaveBeenCalled();
  });

  it("does not enable formal creation without exact approvals", async () => {
    render(<PackageStudio product={product} />);
    await screen.findByText("内容包工作台");
    expect((screen.getByRole("button", { name: "制作正式包" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the POST DTO and request key when snapshot GET fails, then only rereads", async () => {
    packageMocks.getPackage.mockRejectedValueOnce(new Error("快照读取暂时失败")).mockResolvedValue(pack());
    render(<PackageStudio product={product} />);
    await screen.findByText(/v1 · 本地模板/);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "制作草稿包" }));
    await screen.findByText(/内容包已创建，但快照读取失败/);
    expect(screen.getByText(/包 v1 快照/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "制作草稿包" }));
    await waitFor(() => expect(packageMocks.getPackage).toHaveBeenCalledTimes(2));
    expect(packageMocks.createPackage).toHaveBeenCalledTimes(1);
  });

  it("replays the same requestId after an unknown POST result", async () => {
    packageMocks.randomRequestId.mockReturnValueOnce("80000000-0000-4000-8000-000000000002").mockReturnValueOnce("80000000-0000-4000-8000-000000000003");
    packageMocks.createPackage.mockRejectedValueOnce(new CatalogApiError("保存结果待确认", 0, "NETWORK_ERROR", undefined, undefined, true)).mockResolvedValueOnce(pack());
    render(<PackageStudio product={product} />);
    await screen.findByText(/v1 · 本地模板/);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "制作草稿包" }));
    await screen.findByText("保存结果待确认");
    fireEvent.click(screen.getByRole("button", { name: "制作草稿包" }));
    await waitFor(() => expect(packageMocks.createPackage).toHaveBeenCalledTimes(2));
    expect(packageMocks.createPackage.mock.calls[0]?.[1].requestId).toBe("80000000-0000-4000-8000-000000000002");
    expect(packageMocks.createPackage.mock.calls[1]?.[1].requestId).toBe("80000000-0000-4000-8000-000000000002");
  });

  it("keeps an ordered image selection when paging image candidates", async () => {
    imageMocks.listImages.mockImplementation(async (_id: string, offset: number) => offset === 30
      ? { items: [image2], total: 31, limit: 30, offset: 30 }
      : { items: [image], total: 31, limit: 30, offset: 0 });
    imageMocks.getImageDetail.mockImplementation(async (_id: string, id: string) => ({ image: id === image2.id ? image2 : image, review: null, stale: false, staleReasons: [] }));
    render(<PackageStudio product={product} />);
    await screen.findByText(/v1 · 本地模板/);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "下一页图片候选" }));
    await waitFor(() => expect(imageMocks.listImages).toHaveBeenCalledWith(productId, 30, 30, expect.any(AbortSignal)));
    await screen.findByText(/v2 · Second product view/);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("图片 v1")).toBeTruthy();
    expect(screen.getByText("图片 v2")).toBeTruthy();
  });

  it("paginates package history while preserving the selected snapshot detail", async () => {
    const first = pack();
    const second = { ...pack(), id: "90000000-0000-4000-8000-000000000002", versionNumber: 2 };
    packageMocks.listPackages.mockImplementation(async (_id: string, offset: number) => offset === 1
      ? { items: [second], total: 2, limit: 1, offset: 1 }
      : { items: [first], total: 2, limit: 1, offset: 0 });
    packageMocks.getPackage.mockImplementation(async (_id: string, id: string) => id === second.id ? second : first);
    render(<PackageStudio product={product} />);
    await screen.findByText("内容包工作台");
    await waitFor(() => expect(packageMocks.listPackages).toHaveBeenCalledWith(productId, 0, 30, expect.any(AbortSignal)));
    const downloadLink = await screen.findByRole("link", { name: "下载 ZIP" });
    expect(downloadLink.getAttribute("href")).toBe(`/api/products/${productId}/packages/${first.id}/download`);
    fireEvent.click(screen.getByRole("button", { name: "下一页内容包" }));
    await waitFor(() => expect(packageMocks.listPackages).toHaveBeenCalledWith(productId, 1, 30, expect.any(AbortSignal)));
    await screen.findByRole("button", { name: "包 v2" });
    fireEvent.click(screen.getByRole("button", { name: "包 v2" }));
    await screen.findByText(/包 v2 快照/);
  });
});
