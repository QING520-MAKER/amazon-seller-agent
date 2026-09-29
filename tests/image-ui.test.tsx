// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductBriefSchema, type ImageDetail, type ImageRun, type ImageVersion, type OriginalAsset, type ProductDetail } from "../src/schemas.js";
import { ImageStudio } from "../apps/web/src/image/ImageStudio.js";

const mocks = vi.hoisted(() => ({
  listAssets: vi.fn(), listImages: vi.fn(), listImageRuns: vi.fn(), getImageDetail: vi.fn(), generateImage: vi.fn(), reviewImage: vi.fn(), randomRequestId: vi.fn(() => "30000000-0000-4000-8000-000000000001"),
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

  it("starts a new request key when the plan changes after an uncertain or failed result", async () => {
    const firstRequest = "30000000-0000-4000-8000-000000000001";
    const secondRequest = "30000000-0000-4000-8000-000000000002";
    mocks.randomRequestId.mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
    mocks.generateImage.mockResolvedValue({ run, image: null, reused: false });
    render(<ImageStudio product={product} />);
    await screen.findByText("图片工作台");
    fireEvent.click(screen.getByRole("button", { name: "生成本地卖点图" }));
    await waitFor(() => expect(mocks.generateImage).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("标题（≤80）"), { target: { value: "新的版式输入" } });
    fireEvent.click(screen.getByRole("button", { name: "生成本地卖点图" }));
    await waitFor(() => expect(mocks.generateImage).toHaveBeenCalledTimes(2));
    expect(mocks.generateImage.mock.calls[0]?.[1].requestId).toBe(firstRequest);
    expect(mocks.generateImage.mock.calls[1]?.[1].requestId).toBe(secondRequest);
  });

  it("requires an explicit new task for a known terminal failure", async () => {
    const firstRequest = "30000000-0000-4000-8000-000000000001";
    const secondRequest = "30000000-0000-4000-8000-000000000002";
    mocks.randomRequestId.mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
    mocks.generateImage.mockResolvedValue({ run, image: null, reused: false });
    render(<ImageStudio product={product} />);
    await screen.findByText("图片工作台");
    fireEvent.click(screen.getByRole("button", { name: "生成本地卖点图" }));
    await screen.findByRole("button", { name: "用相同输入新建任务" });
    fireEvent.click(screen.getByRole("button", { name: "生成本地卖点图" }));
    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "用相同输入新建任务" }));
    await waitFor(() => expect(mocks.generateImage).toHaveBeenCalledTimes(2));
    expect(mocks.generateImage.mock.calls[0]?.[1].requestId).toBe(firstRequest);
    expect(mocks.generateImage.mock.calls[1]?.[1].requestId).toBe(secondRequest);
  });

  it("keeps the successful request key until detail confirmation and reconciles without reposting", async () => {
    const succeededRun = { ...run, status: "succeeded" as const, imageVersionId: imageId, errorCode: null, errorMessage: null };
    mocks.listImageRuns.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    mocks.generateImage.mockResolvedValue({ run: succeededRun, image, reused: false });
    mocks.getImageDetail.mockRejectedValueOnce(new Error("详情暂不可用")).mockResolvedValue(detail);
    render(<ImageStudio product={product} />);
    await screen.findByText("图片工作台");
    fireEvent.click(screen.getByRole("button", { name: "生成本地卖点图" }));
    await screen.findByText(/详情读取未确认/);
    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /核对任务/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /核对任务/ }));
    await screen.findByText("已读取服务器任务记录与真实候选状态。");
    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.listImageRuns).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /核对任务/ })).toBeNull();
  });

  it("keeps an uncertain POST on the same request key for later reconciliation", async () => {
    const requestId = "30000000-0000-4000-8000-000000000001";
    mocks.generateImage.mockRejectedValueOnce(new Error("连接中断")).mockResolvedValue({ run, image: null, reused: false });
    render(<ImageStudio product={product} />);
    await screen.findByText("图片工作台");
    fireEvent.click(screen.getByRole("button", { name: "生成本地卖点图" }));
    await screen.findByText("连接中断");
    fireEvent.click(screen.getByRole("button", { name: /生成本地卖点图/ }));
    await waitFor(() => expect(mocks.generateImage).toHaveBeenCalledTimes(2));
    expect(mocks.generateImage.mock.calls[0]?.[1].requestId).toBe(requestId);
    expect(mocks.generateImage.mock.calls[1]?.[1].requestId).toBe(requestId);
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
    expect(screen.getByRole("link", { name: "下载 PNG" }).getAttribute("href")).toBe(`/api/products/${productId}/images/${imageId}/content?download=1`);
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

  it("pages assets and candidates independently while preserving drafts and selected review detail", async () => {
    const asset2 = { ...asset, id: "40000000-0000-4000-8000-000000000002", originalName: "second.png" };
    const image2 = { ...image, id: "50000000-0000-4000-8000-000000000002", versionNumber: 2, original: asset2 };
    const detail2 = { ...detail, image: image2, stale: false, staleReasons: [] };
    mocks.listAssets.mockImplementation((_id: string, _state: string, offset: number) => Promise.resolve({ items: [offset ? asset2 : asset], total: 21, limit: 20, offset }));
    mocks.listImages.mockImplementation((_id: string, offset: number) => Promise.resolve({ items: [offset ? image2 : image], total: 21, limit: 20, offset }));
    mocks.listImageRuns.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    mocks.getImageDetail.mockImplementation((_id: string, imageId: string) => Promise.resolve(imageId === image2.id ? detail2 : detail));
    render(<ImageStudio product={product} />);
    await screen.findByRole("button", { name: /候选 v1/ });
    fireEvent.change(screen.getByLabelText("标题（≤80）"), { target: { value: "未保存布局草稿" } });
    fireEvent.click(screen.getByRole("button", { name: /候选 v1/ }));
    await screen.findByText(/当前依据未发现过期原因|过期/);
    fireEvent.change(screen.getByLabelText("审核备注"), { target: { value: "保留这条审核备注" } });
    const nextButtons = screen.getAllByRole("button", { name: "下一页" });
    fireEvent.click(nextButtons[0]!);
    await waitFor(() => expect(mocks.listAssets).toHaveBeenCalledWith(productId, "active", 20, expect.anything()));
    expect((screen.getByLabelText("标题（≤80）") as HTMLInputElement).value).toBe("未保存布局草稿");
    expect((screen.getByLabelText("审核备注") as HTMLTextAreaElement).value).toBe("保留这条审核备注");
    fireEvent.click(screen.getAllByRole("button", { name: "下一页" })[1]!);
    await waitFor(() => expect(mocks.listImages).toHaveBeenCalledWith(productId, 20, 20, expect.anything()));
    await screen.findByRole("button", { name: /候选 v2/ });
    expect((screen.getByLabelText("标题（≤80）") as HTMLInputElement).value).toBe("未保存布局草稿");
    expect((screen.getByLabelText("审核备注") as HTMLTextAreaElement).value).toBe("保留这条审核备注");
  });
});
