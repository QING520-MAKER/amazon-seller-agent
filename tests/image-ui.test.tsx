// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductBriefSchema, type ImageDetail, type ImageRun, type ImageVersion, type OriginalAsset, type ProductDetail } from "../src/schemas.js";
import { ImageStudio } from "../apps/web/src/image/ImageStudio.js";

const mocks = vi.hoisted(() => ({
  listAssets: vi.fn(), listImages: vi.fn(), listImageRuns: vi.fn(), getImageDetail: vi.fn(), generateImage: vi.fn(), reviewImage: vi.fn(), getImageBlob: vi.fn(), randomRequestId: vi.fn(() => "30000000-0000-4000-8000-000000000001"),
}));
vi.mock("../apps/web/src/products/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/products/api.js")>(), listAssets: mocks.listAssets }));
vi.mock("../apps/web/src/image/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/image/api.js")>(), ...mocks }));

const productId = "10000000-0000-4000-8000-000000000001", sourceRevisionId = "20000000-0000-4000-8000-000000000001", assetId = "40000000-0000-4000-8000-000000000001", imageId = "50000000-0000-4000-8000-000000000001";
const asset: OriginalAsset = { id: assetId, productId, kind: "original", originalName: "real.jpg", mimeType: "image/jpeg", sizeBytes: 1200, width: 800, height: 800, orientation: 1, sha256: "a".repeat(64), createdAt: "2026-09-20T00:00:00.000Z", archivedAt: null, version: 2 };
const product: ProductDetail = { product: { id: productId, workspaceId: "local", sku: "SKU-A", currentRevisionId: sourceRevisionId, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" }, currentRevision: { id: sourceRevisionId, productId, revisionNumber: 1, brief: ProductBriefSchema.parse({ name: "真实商品", features: ["真实卖点"] }), sourceNote: "manual", createdAt: "2026-09-20T00:00:00.000Z" }, missingFields: [] };
const image: ImageVersion = { id: imageId, productId, sourceRevisionId, versionNumber: 1, original: asset, plan: { purpose: "feature", headline: "真实商品", captions: ["真实卖点"], prompt: "" }, evidence: [], mode: "local", provider: "local", model: null, mimeType: "image/png", width: 1600, height: 1600, sizeBytes: 2400, sha256: "b".repeat(64), generationRunId: "60000000-0000-4000-8000-000000000001", createdAt: "2026-09-20T00:00:00.000Z" };
const run: ImageRun = { id: "60000000-0000-4000-8000-000000000001", productId, requestId: "30000000-0000-4000-8000-000000000001", sourceRevisionId, mode: "local", status: "failed", imageVersionId: null, errorCode: "PROVIDER_NOT_CONFIGURED", errorMessage: "模型服务尚未配置。", startedAt: "2026-09-20T00:00:00.000Z", finishedAt: "2026-09-20T00:01:00.000Z" };
const detail: ImageDetail = { image, review: null, stale: true, staleReasons: ["SOURCE_REVISION_CHANGED"] };

beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); mocks.randomRequestId.mockReturnValue("30000000-0000-4000-8000-000000000001"); mocks.listAssets.mockResolvedValue({ items: [asset], total: 1, limit: 20, offset: 0 }); mocks.listImages.mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0 }); mocks.listImageRuns.mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0 }); mocks.getImageDetail.mockResolvedValue(detail); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("image studio", () => {
  it("submits the selected real asset and preserves a failed request for reconciliation", async () => {
    mocks.generateImage.mockResolvedValue({ run, image: null, reused: false });
    render(<ImageStudio product={product} knowledgeRevisionIds={["70000000-0000-4000-8000-000000000001"]} />);
    await screen.findByText("图片工作台");
    fireEvent.change(screen.getByLabelText("标题（≤80）"), { target: { value: "真实商品卖点" } });
    fireEvent.click(screen.getByRole("button", { name: "生成本地卖点图" }));
    await waitFor(() => expect(mocks.generateImage).toHaveBeenCalledWith(productId, expect.objectContaining({ originalAssetId: assetId, originalAssetVersion: 2, sourceRevisionId, knowledgeRevisionIds: ["70000000-0000-4000-8000-000000000001"], mode: "local", plan: expect.objectContaining({ headline: "真实商品卖点" }) })));
    await screen.findByText(/模型服务尚未配置/);
    expect(screen.getByRole("button", { name: /核对任务/ })).toBeTruthy();
  });

  it("reads real stale detail after a successful candidate and disables approval", async () => {
    mocks.listImages.mockResolvedValue({ items: [image], total: 1, limit: 30, offset: 0 });
    mocks.getImageDetail.mockResolvedValue(detail);
    mocks.generateImage.mockResolvedValue({ run: { ...run, status: "succeeded", imageVersionId: imageId, errorCode: null, errorMessage: null }, image, reused: false });
    render(<ImageStudio product={product} />);
    await screen.findByRole("button", { name: /候选 v1/ });
    fireEvent.click(screen.getByRole("button", { name: /候选 v1/ }));
    await screen.findByText(/过期：SOURCE_REVISION_CHANGED/);
    expect((screen.getByRole("button", { name: "批准此候选" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("allows rejecting a stale candidate and keeps review notes while refreshing", async () => {
    mocks.listImages.mockResolvedValue({ items: [image], total: 1, limit: 30, offset: 0 });
    mocks.getImageDetail.mockResolvedValue(detail);
    mocks.reviewImage.mockResolvedValue({ id: "61000000-0000-4000-8000-000000000001", productId, imageVersionId: imageId, decision: "rejected", notes: "资料已更新", createdAt: "2026-09-20T00:01:00.000Z" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ImageStudio product={product} />);
    await screen.findByRole("button", { name: /候选 v1/ });
    fireEvent.click(screen.getByRole("button", { name: /候选 v1/ }));
    await screen.findByText(/过期：SOURCE_REVISION_CHANGED/);
    const notes = screen.getByLabelText("审核备注");
    fireEvent.change(notes, { target: { value: "资料已更新" } });
    expect((screen.getByRole("button", { name: "批准此候选" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "退回此候选" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "刷新图片依据" }));
    expect(confirm).toHaveBeenCalledWith("审核备注尚未保存，确定放弃并继续吗？");
    expect((notes as HTMLTextAreaElement).value).toBe("资料已更新");
    fireEvent.click(screen.getByRole("button", { name: "退回此候选" }));
    await waitFor(() => expect(mocks.reviewImage).toHaveBeenCalledWith(productId, imageId, { decision: "rejected", notes: "资料已更新" }));
  });

  it("does not disable approval just because a review note is being typed", async () => {
    const current = { ...detail, stale: false, staleReasons: [] };
    mocks.listImages.mockResolvedValue({ items: [image], total: 1, limit: 30, offset: 0 });
    mocks.getImageDetail.mockResolvedValue(current);
    render(<ImageStudio product={product} />);
    await screen.findByRole("button", { name: /候选 v1/ });
    fireEvent.click(screen.getByRole("button", { name: /候选 v1/ }));
    await screen.findByText(/当前依据未发现过期原因/);
    fireEvent.change(screen.getByLabelText("审核备注"), { target: { value: "已核对实物" } });
    expect((screen.getByRole("button", { name: "批准此候选" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
