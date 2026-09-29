// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductBriefSchema, type ContentDetail, type ContentRun, type ContentVersion, type ProductDetail } from "../src/schemas.js";
import { CatalogApiError } from "../apps/web/src/products/api.js";
import { ContentStudio } from "../apps/web/src/content/ContentStudio.js";

const mocks = vi.hoisted(() => ({
  listContent: vi.fn(), getContentDetail: vi.fn(), generateContent: vi.fn(), saveContent: vi.fn(),
  listContentRuns: vi.fn(), reviewContent: vi.fn(), getContentExport: vi.fn(), randomRequestId: vi.fn(() => "30000000-0000-4000-8000-000000000001"),
}));
const requestMocks = vi.hoisted(() => ({ executeRequest: vi.fn() }));
vi.mock("../apps/web/src/content/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/content/api.js")>(), ...mocks }));
vi.mock("../apps/web/src/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/api.js")>(), ...requestMocks }));

const productId = "10000000-0000-4000-8000-000000000001";
const sourceRevisionId = "20000000-0000-4000-8000-000000000001";
const versionId = "30000000-0000-4000-8000-000000000002";
const runId = "40000000-0000-4000-8000-000000000001";
const copy = { title: "Acme travel mug", itemHighlights: "300 ml stainless steel", bullets: ["HEAT — Keeps drinks ready.", "SIZE — Fits a daily bag.", "LID — Helps reduce spills.", "CARE — Rinses clean.", "USE — Supports commutes."], description: "A factual travel mug description.", backendSearchTerms: ["travel mug"] };
const version = (): ContentVersion => ({ id: versionId, productId, sourceRevisionId, versionNumber: 1, parentVersionId: null, marketplace: "us", language: "en_US", keywords: ["travel mug"], copy, coverage: { rows: [], coveragePct: 100, uncovered: [] }, evidence: [], rulesVersion: "test", source: "template", model: null, generationRunId: runId, createdAt: "2026-09-20T00:00:00.000Z" });
const run = (status: ContentRun["status"] = "succeeded"): ContentRun => ({ id: runId, productId, requestId: "30000000-0000-4000-8000-000000000001", sourceRevisionId, mode: "template", status, contentVersionId: status === "succeeded" ? versionId : null, errorCode: status === "failed" ? "MODEL_NOT_CONFIGURED" : null, errorMessage: status === "failed" ? "文字模型尚未配置。" : null, startedAt: "2026-09-20T00:00:00.000Z", finishedAt: "2026-09-20T00:01:00.000Z" });
const product: ProductDetail = { product: { id: productId, workspaceId: "local", sku: "SKU-A", currentRevisionId: sourceRevisionId, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" }, currentRevision: { id: sourceRevisionId, productId, revisionNumber: 1, brief: ProductBriefSchema.parse({ name: "真实商品", brand: "Acme", attributes: ["300 ml"] }), sourceNote: "manual", createdAt: "2026-09-20T00:00:00.000Z" }, missingFields: [] };
const detail = (): ContentDetail => ({ content: version(), review: null, stale: false, staleReasons: [] });
const page = () => ({ items: [version()], total: 1, limit: 20, offset: 0, headVersionId: versionId });
const renderStudio = () => render(<ContentStudio product={product} onDirty={vi.fn()} />);

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  requestMocks.executeRequest.mockReset();
  mocks.randomRequestId.mockReturnValue("30000000-0000-4000-8000-000000000001");
  mocks.listContent.mockResolvedValue(page());
  mocks.listContentRuns.mockResolvedValue({ items: [run()], total: 1, limit: 20, offset: 0 });
  mocks.getContentDetail.mockResolvedValue(detail());
  mocks.saveContent.mockResolvedValue({ ...version(), id: "30000000-0000-4000-8000-000000000003", versionNumber: 2, parentVersionId: versionId, source: "manual" });
});
afterEach(cleanup);

describe("content studio", () => {
  it("preserves unsubmitted review notes across refresh and submits them without blocking review", async () => {
    const onDirty = vi.fn();
    mocks.reviewContent.mockResolvedValue({ id: "50000000-0000-4000-8000-000000000001", contentVersionId: versionId, decision: "approved", notes: "Facts verified", createdAt: "2026-09-20T00:00:00.000Z" });
    render(<ContentStudio product={product} onDirty={onDirty} />);
    await screen.findByLabelText("审核备注");
    fireEvent.change(screen.getByLabelText("审核备注"), { target: { value: "Facts verified" } });
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByRole("button", { name: "刷新记录" }));
    await screen.findByText(/已刷新服务端记录/);
    expect((screen.getByLabelText("审核备注") as HTMLTextAreaElement).value).toBe("Facts verified");
    expect((screen.getByRole("button", { name: "人工批准" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "人工批准" }));
    await waitFor(() => expect(mocks.reviewContent).toHaveBeenCalledWith(productId, versionId, { decision: "approved", notes: "Facts verified" }));
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(false));
  });

  it("generates from selected keywords, edits, and saves a new version", async () => {
    const generated = { ...version(), id: "30000000-0000-4000-8000-000000000004", versionNumber: 2, copy: { ...copy, title: "Generated travel mug" } };
    mocks.getContentDetail.mockImplementation(async (_productId, id) => ({ ...detail(), content: id === generated.id ? generated : version() }));
    mocks.generateContent.mockResolvedValue({ run: { ...run(), id: "40000000-0000-4000-8000-000000000002", contentVersionId: generated.id }, content: generated, reused: false });
    renderStudio();
    await screen.findByText("文案版本历史");
    fireEvent.change(screen.getByLabelText("文案关键词"), { target: { value: "travel mug\ncommuter mug" } });
    fireEvent.click(screen.getByRole("button", { name: "生成文案" }));
    await waitFor(() => expect(mocks.generateContent).toHaveBeenCalledWith(productId, expect.objectContaining({ sourceRevisionId, baseContentVersionId: versionId, keywords: ["travel mug", "commuter mug"], mode: "template" })));
    fireEvent.change(await screen.findByLabelText("英文标题"), { target: { value: "Edited travel mug" } });
    fireEvent.click(screen.getByRole("button", { name: "保存新版本" }));
    await waitFor(() => expect(mocks.saveContent).toHaveBeenCalledWith(productId, expect.objectContaining({ baseContentVersionId: generated.id, copy: expect.objectContaining({ title: "Edited travel mug" }) })));
  });

  it("shows a failed run and preserves the request for reconciliation", async () => {
    mocks.generateContent.mockResolvedValue({ run: run("failed"), content: null, reused: false });
    renderStudio();
    await screen.findByText("文案版本历史");
    fireEvent.change(screen.getByLabelText("文案关键词"), { target: { value: "travel mug" } });
    fireEvent.click(screen.getByRole("button", { name: "生成文案" }));
    await screen.findByText("文字模型尚未配置。");
    expect(screen.getByRole("button", { name: "核对生成记录" })).toBeTruthy();
  });

  it("keeps the edited copy after a head conflict and offers an explicit reload", async () => {
    mocks.saveContent.mockRejectedValue(new CatalogApiError("文案 head 已变化", 409, "CONTENT_HEAD_CONFLICT"));
    renderStudio();
    await screen.findByText("文案版本历史");
    fireEvent.click(screen.getByRole("button", { name: "编辑当前版本" }));
    fireEvent.change(screen.getByLabelText("英文标题"), { target: { value: "Local draft kept" } });
    fireEvent.click(screen.getByRole("button", { name: "保存新版本" }));
    await screen.findByText("文案 head 已变化");
    expect((screen.getByLabelText("英文标题") as HTMLInputElement).value).toBe("Local draft kept");
    expect(screen.getByRole("button", { name: "重载最新版本" })).toBeTruthy();
  });

  it("cannot approve or export an unsaved draft and keeps its original base when the server head changes", async () => {
    renderStudio();
    await screen.findByText("文案版本历史");
    fireEvent.click(screen.getByRole("button", { name: "编辑当前版本" }));
    fireEvent.change(screen.getByLabelText("英文标题"), { target: { value: "Unsaved local changes" } });
    expect((screen.getByRole("button", { name: "人工批准" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "下载草稿 JSON" }) as HTMLButtonElement).disabled).toBe(true);
    const next = { ...version(), id: "30000000-0000-4000-8000-000000000099", versionNumber: 2 };
    mocks.listContent.mockResolvedValue({ ...page(), headVersionId: next.id, items: [next, version()], total: 2 });
    fireEvent.click(screen.getByRole("button", { name: "刷新记录" }));
    await screen.findByText(/已刷新服务端记录/);
    fireEvent.click(screen.getByRole("button", { name: "保存新版本" }));
    await waitFor(() => expect(mocks.saveContent).toHaveBeenCalledWith(productId, expect.objectContaining({ baseContentVersionId: versionId, copy: expect.objectContaining({ title: "Unsaved local changes" }) })));
  });

  it("retains a dirty draft when switching versions is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderStudio();
    await screen.findByText("文案版本历史");
    fireEvent.click(screen.getByRole("button", { name: "编辑当前版本" }));
    fireEvent.change(screen.getByLabelText("英文标题"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "查看版本" }));
    expect(confirm).toHaveBeenCalled();
    expect((screen.getByLabelText("英文标题") as HTMLInputElement).value).toBe("Keep this draft");
    confirm.mockRestore();
  });
});
