// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductBriefSchema, type ContentBatch, type ProductDetail, type ProductSummary } from "../src/schemas.js";
import { BatchStudio } from "../apps/web/src/batch/BatchStudio.js";

const productMocks = vi.hoisted(() => ({ listProducts: vi.fn(), getProduct: vi.fn() }));
const contentMocks = vi.hoisted(() => ({ listContent: vi.fn() }));
const batchMocks = vi.hoisted(() => ({ listBatches: vi.fn(), getBatch: vi.fn(), createBatch: vi.fn(), executeBatch: vi.fn(), importProducts: vi.fn(), randomRequestId: vi.fn(() => "80000000-0000-4000-8000-000000000001") }));
vi.mock("../apps/web/src/products/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/products/api.js")>(), ...productMocks }));
vi.mock("../apps/web/src/content/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/content/api.js")>(), ...contentMocks }));
vi.mock("../apps/web/src/batch/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/batch/api.js")>(), ...batchMocks }));

const productId = "10000000-0000-4000-8000-000000000001", sourceRevisionId = "20000000-0000-4000-8000-000000000001", headId = "30000000-0000-4000-8000-000000000001";
const summary: ProductSummary = { product: { id: productId, workspaceId: "local", sku: "SKU-A", currentRevisionId: sourceRevisionId, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" }, name: "真实商品", revisionNumber: 1, originalAssetCount: 0, missingFields: [] };
const detail: ProductDetail = { product: summary.product, currentRevision: { id: sourceRevisionId, productId, revisionNumber: 1, brief: ProductBriefSchema.parse({ name: "真实商品" }), sourceNote: "manual", createdAt: "2026-09-20T00:00:00.000Z" }, missingFields: [] };
const input = { requestId: "70000000-0000-4000-8000-000000000001", sourceRevisionId, baseContentVersionId: headId, marketplace: "us" as const, keywords: [], mode: "template" as const, knowledgeRevisionIds: [] };
const batch = (status: ContentBatch["status"] = "queued"): ContentBatch => ({ id: "90000000-0000-4000-8000-000000000001", requestId: "80000000-0000-4000-8000-000000000001", createdAt: "2026-09-20T00:00:00.000Z", finishedAt: status === "succeeded" ? "2026-09-20T00:01:00.000Z" : null, status, items: [{ id: "a0000000-0000-4000-8000-000000000001", productId, input, status: status === "succeeded" ? "succeeded" : "queued", runId: null, contentVersionId: null, errorCode: null, errorMessage: null }] });

beforeEach(() => { Object.values(productMocks).forEach(mock => mock.mockReset()); Object.values(contentMocks).forEach(mock => mock.mockReset()); Object.values(batchMocks).forEach(mock => mock.mockReset()); productMocks.listProducts.mockResolvedValue({ items: [summary], total: 1, limit: 20, offset: 0 }); productMocks.getProduct.mockResolvedValue(detail); contentMocks.listContent.mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0, headVersionId: headId }); batchMocks.listBatches.mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0 }); batchMocks.createBatch.mockResolvedValue(batch()); batchMocks.getBatch.mockResolvedValue(batch()); batchMocks.executeBatch.mockResolvedValue(batch("succeeded")); batchMocks.randomRequestId.mockReturnValue("80000000-0000-4000-8000-000000000001"); });
afterEach(cleanup);

describe("batch studio", () => {
  it("creates without auto execution, then executes only after an explicit action", async () => {
    render(<BatchStudio />);
    await screen.findByText("批量任务");
    expect(batchMocks.executeBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    await screen.findByText(/资料 20000000/);
    fireEvent.click(screen.getByRole("button", { name: "只创建批次" }));
    await waitFor(() => expect(batchMocks.createBatch).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ productId, input: expect.objectContaining({ sourceRevisionId, baseContentVersionId: headId, mode: "template" }) })] })));
    expect(batchMocks.executeBatch).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "明确执行" }));
    await waitFor(() => expect(batchMocks.executeBatch).toHaveBeenCalledWith(batch().id), { timeout: 3000 });
  });

  it("ignores a stale product preparation after canceling and reselecting the same product", async () => {
    const refreshedRevisionId = "21000000-0000-4000-8000-000000000002";
    const firstContent = { items: [], total: 0, limit: 30, offset: 0, headVersionId: "31000000-0000-4000-8000-000000000001" };
    const secondContent = { ...firstContent, headVersionId: "31000000-0000-4000-8000-000000000002" };
    let releaseFirst: (value: ProductDetail) => void = () => undefined;
    const firstDetail = detail;
    const secondDetail = { ...detail, currentRevision: { ...detail.currentRevision, id: refreshedRevisionId } };
    productMocks.getProduct.mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve; })).mockResolvedValueOnce(secondDetail);
    contentMocks.listContent.mockImplementationOnce(async () => firstContent).mockResolvedValueOnce(secondContent);
    render(<BatchStudio />);
    const checkbox = await screen.findByRole("checkbox");
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    await screen.findByText(new RegExp(`资料 ${refreshedRevisionId.slice(0, 8)}`));
    releaseFirst(firstDetail);
    await waitFor(() => expect(screen.getByText(new RegExp(`资料 ${refreshedRevisionId.slice(0, 8)}`))).toBeTruthy());
    expect(screen.queryByText(new RegExp(`资料 ${sourceRevisionId.slice(0, 8)}`))).toBeNull();
  });

  it("shows each import result and keeps existing product ids visible", async () => {
    batchMocks.importProducts.mockResolvedValue({ items: [{ index: 0, sku: "SKU-A", productId, status: "failed", errorCode: "SKU_EXISTS", errorMessage: "已有 SKU" }] });
    render(<BatchStudio />);
    const file = new File([JSON.stringify({ items: [{ sku: "SKU-A", brief: { name: "真实商品" }, sourceNote: "manual" }] })], "products.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("选择 JSON"), { target: { files: [file] } });
    await waitFor(() => expect(batchMocks.importProducts).toHaveBeenCalled());
    await screen.findByText(/已有商品/);
    expect(batchMocks.importProducts).toHaveBeenCalled();
  });

  it("allocates a new batch and item request key when keywords change", async () => {
    const ids = [
      "80000000-0000-4000-8000-000000000010",
      "80000000-0000-4000-8000-000000000011",
      "80000000-0000-4000-8000-000000000012",
      "80000000-0000-4000-8000-000000000013",
      "80000000-0000-4000-8000-000000000014",
    ];
    batchMocks.randomRequestId.mockImplementation(() => ids.shift() ?? "80000000-0000-4000-8000-000000000099");
    render(<BatchStudio />);
    fireEvent.click(await screen.findByRole("checkbox"));
    await screen.findByText(/资料 20000000/);
    fireEvent.click(screen.getByRole("button", { name: "只创建批次" }));
    await waitFor(() => expect(batchMocks.createBatch).toHaveBeenCalledTimes(1));
    const first = batchMocks.createBatch.mock.calls[0]![0] as { requestId: string; items: Array<{ input: { requestId: string } }> };

    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "portable blender" } });
    fireEvent.click(screen.getByRole("button", { name: "只创建批次" }));
    await waitFor(() => expect(batchMocks.createBatch).toHaveBeenCalledTimes(2));
    const second = batchMocks.createBatch.mock.calls[1]![0] as { requestId: string; items: Array<{ input: { requestId: string; keywords: string[] } }> };
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.items[0]!.input.requestId).not.toBe(first.items[0]!.input.requestId);
    expect(second.items[0]!.input.keywords).toEqual(["portable blender"]);
  });

  it("replays the same batch and item keys after an unknown create result", async () => {
    batchMocks.createBatch.mockRejectedValueOnce(new Error("保存结果待确认。"));
    render(<BatchStudio />);
    fireEvent.click(await screen.findByRole("checkbox"));
    await screen.findByText(/资料 20000000/);
    fireEvent.click(screen.getByRole("button", { name: "只创建批次" }));
    await waitFor(() => expect(batchMocks.createBatch).toHaveBeenCalledTimes(1));
    const first = batchMocks.createBatch.mock.calls[0]![0];
    const randomCalls = batchMocks.randomRequestId.mock.calls.length;
    await screen.findByRole("button", { name: /核对批次/ });

    fireEvent.click(screen.getByRole("button", { name: "只创建批次" }));
    await waitFor(() => expect(batchMocks.createBatch).toHaveBeenCalledTimes(2));
    const second = batchMocks.createBatch.mock.calls[1]![0];
    expect(second).toEqual(first);
    expect(batchMocks.randomRequestId.mock.calls.length).toBe(randomCalls);
  });

  it("paginates batch history while retaining the current batch detail", async () => {
    const first = batch();
    const second = { ...batch(), id: "91000000-0000-4000-8000-000000000002" };
    batchMocks.listBatches.mockImplementation(async (offset: number) => offset === 1
      ? { items: [second], total: 2, limit: 1, offset: 1 }
      : { items: [first], total: 2, limit: 1, offset: 0 });
    batchMocks.getBatch.mockResolvedValue(first);
    render(<BatchStudio />);
    await screen.findByText("批量任务");
    await screen.findByRole("button", { name: /90000000/ });
    fireEvent.click(screen.getByRole("button", { name: "下一页批次" }));
    await waitFor(() => expect(batchMocks.listBatches).toHaveBeenCalledWith(1, 30, expect.any(AbortSignal)));
    await screen.findByRole("button", { name: /91000000/ });
  });

  it("retries a failed batch history page at the requested offset", async () => {
    const first = batch();
    const second = { ...batch(), id: "91000000-0000-4000-8000-000000000002" };
    batchMocks.listBatches.mockImplementationOnce(async () => ({ items: [first], total: 2, limit: 1, offset: 0 }))
      .mockRejectedValueOnce(new Error("batch history unavailable"))
      .mockResolvedValue({ items: [second], total: 2, limit: 1, offset: 1 });
    render(<BatchStudio />);
    await screen.findByText("批量任务");
    fireEvent.click(screen.getByRole("button", { name: "下一页批次" }));
    await screen.findByText("batch history unavailable");
    fireEvent.click(screen.getByRole("button", { name: "重试读取批次" }));
    await waitFor(() => expect(batchMocks.listBatches).toHaveBeenLastCalledWith(1, 30, expect.any(AbortSignal)));
  });
});
