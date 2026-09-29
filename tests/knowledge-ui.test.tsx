// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductBriefSchema, type KnowledgeRevision, type ProductDetail } from "../src/schemas.js";
import { KnowledgePanel } from "../apps/web/src/knowledge/KnowledgePanel.js";

const mocks = vi.hoisted(() => ({
  listKnowledge: vi.fn(), createKnowledge: vi.fn(), saveKnowledge: vi.fn(), listKnowledgeRevisions: vi.fn(), getKnowledgeRevision: vi.fn(),
}));
vi.mock("../apps/web/src/knowledge/api.js", async importOriginal => ({ ...await importOriginal<typeof import("../apps/web/src/knowledge/api.js")>(), ...mocks }));

const productId = "10000000-0000-4000-8000-000000000001";
const sourceRevisionId = "20000000-0000-4000-8000-000000000001";
const approvedId = "50000000-0000-4000-8000-000000000001";
const draftId = "50000000-0000-4000-8000-000000000002";
const approved: KnowledgeRevision = { id: approvedId, entryId: approvedId, productId, revisionNumber: 1, kind: "product_fact", title: "Confirmed capacity", content: "300 ml", source: "manual page 1", status: "approved", createdAt: "2026-09-20T00:00:00.000Z" };
const draft: KnowledgeRevision = { id: draftId, entryId: draftId, productId, revisionNumber: 1, kind: "reference", title: "Unconfirmed note", content: "Check packaging", source: "import.md", status: "draft", createdAt: "2026-09-20T00:00:00.000Z" };
const product: ProductDetail = { product: { id: productId, workspaceId: "local", sku: "SKU-A", currentRevisionId: sourceRevisionId, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" }, currentRevision: { id: sourceRevisionId, productId, revisionNumber: 1, brief: ProductBriefSchema.parse({ name: "真实商品" }), sourceNote: "manual", createdAt: "2026-09-20T00:00:00.000Z" }, missingFields: [] };
const renderPanel = (selected: string[] = [], onSelectionChange = vi.fn()) => render(<KnowledgePanel product={product} selectedRevisionIds={selected} onSelectionChange={onSelectionChange} />);

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listKnowledge.mockResolvedValue({ items: [approved, draft], total: 2, limit: 20, offset: 0 });
  mocks.listKnowledgeRevisions.mockResolvedValue({ items: [approved], total: 1, limit: 20, offset: 0 });
  mocks.createKnowledge.mockResolvedValue({ ...draft, id: "50000000-0000-4000-8000-000000000003", entryId: "50000000-0000-4000-8000-000000000003", revisionNumber: 1 });
  mocks.saveKnowledge.mockResolvedValue({ ...approved, revisionNumber: 2, id: "50000000-0000-4000-8000-000000000004" });
});
afterEach(cleanup);

describe("knowledge panel", () => {
  it("only offers approved revisions to content and saves a new entry as draft", async () => {
    const selected = vi.fn();
    renderPanel([], selected);
    await screen.findByText("Confirmed capacity");
    expect(screen.queryByLabelText("选择知识 Unconfirmed note")).toBeNull();
    fireEvent.click(screen.getByLabelText("选择知识 Confirmed capacity"));
    expect(selected).toHaveBeenCalledWith([approved.id]);
    fireEvent.click(screen.getByRole("button", { name: "新建知识" }));
    fireEvent.change(screen.getByLabelText("知识标题"), { target: { value: "New fact" } });
    fireEvent.change(screen.getByLabelText("知识来源"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("知识正文"), { target: { value: "A factual note" } });
    fireEvent.click(screen.getByRole("button", { name: "保存知识版本" }));
    await waitFor(() => expect(mocks.createKnowledge).toHaveBeenCalledWith(productId, expect.objectContaining({ title: "New fact", status: "draft" }), expect.any(String)));
  });

  it("reuses the pending request id when a create result is uncertain, and rotates it after input changes", async () => {
    mocks.createKnowledge.mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce({ ...draft, title: "New fact", content: "A factual note" });
    renderPanel();
    await screen.findByText("Confirmed capacity");
    fireEvent.click(screen.getByRole("button", { name: "新建知识" }));
    fireEvent.change(screen.getByLabelText("知识标题"), { target: { value: "New fact" } });
    fireEvent.change(screen.getByLabelText("知识来源"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("知识正文"), { target: { value: "A factual note" } });
    fireEvent.click(screen.getByRole("button", { name: "保存知识版本" }));
    await waitFor(() => expect(mocks.createKnowledge).toHaveBeenCalledTimes(1));
    const firstRequestId = mocks.createKnowledge.mock.calls[0]?.[2];
    expect(screen.getByRole("status").textContent).toContain("结果待确认");

    fireEvent.click(screen.getByRole("button", { name: "保存知识版本" }));
    await waitFor(() => expect(mocks.createKnowledge).toHaveBeenCalledTimes(2));
    expect(mocks.createKnowledge.mock.calls[1]?.[2]).toBe(firstRequestId);

    await waitFor(() => expect((screen.getByRole("button", { name: "新建知识" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "新建知识" }));
    fireEvent.change(screen.getByLabelText("知识标题"), { target: { value: "Another fact" } });
    fireEvent.change(screen.getByLabelText("知识来源"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("知识正文"), { target: { value: "A different note" } });
    fireEvent.click(screen.getByRole("button", { name: "保存知识版本" }));
    await waitFor(() => expect(mocks.createKnowledge).toHaveBeenCalledTimes(3));
    expect(mocks.createKnowledge.mock.calls[2]?.[2]).not.toBe(firstRequestId);
  });

  it("does not present a committed create as failed when the follow-up list refresh fails", async () => {
    mocks.listKnowledge.mockResolvedValueOnce({ items: [approved, draft], total: 2, limit: 20, offset: 0 })
      .mockRejectedValueOnce(new Error("refresh unavailable"));
    mocks.createKnowledge.mockResolvedValueOnce({ ...draft, title: "New fact", content: "A factual note" });
    renderPanel();
    await screen.findByText("Confirmed capacity");
    fireEvent.click(screen.getByRole("button", { name: "新建知识" }));
    fireEvent.change(screen.getByLabelText("知识标题"), { target: { value: "New fact" } });
    fireEvent.change(screen.getByLabelText("知识来源"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("知识正文"), { target: { value: "A factual note" } });
    fireEvent.click(screen.getByRole("button", { name: "保存知识版本" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("知识已保存，但列表刷新失败"));
    expect(screen.getByRole("alert").textContent).not.toContain("保存失败");
    expect(mocks.createKnowledge).toHaveBeenCalledTimes(1);
  });

  it("moves an approved entry back to draft when editing and keeps history read-only", async () => {
    renderPanel();
    await screen.findByText("Confirmed capacity");
    fireEvent.click(screen.getAllByRole("button", { name: "编辑并回到草稿" })[0]!);
    expect((screen.getByLabelText("知识状态编辑") as HTMLSelectElement).value).toBe("draft");
    fireEvent.click(screen.getByRole("button", { name: "保存知识版本" }));
    await waitFor(() => expect(mocks.saveKnowledge).toHaveBeenCalledWith(productId, approved.entryId, expect.objectContaining({ baseRevisionId: approved.id, status: "draft" })));
    fireEvent.click(screen.getAllByRole("button", { name: "查看历史" })[0]!);
    await screen.findByText("历史版本（只读快照）");
    fireEvent.click(screen.getByRole("button", { name: /v1 · 已确认/ }));
    expect(screen.getAllByText("300 ml").length).toBeGreaterThan(1);
  });

  it("syncs a clean editor after confirming its entry", async () => {
    const updated: KnowledgeRevision = { ...draft, id: "50000000-0000-4000-8000-000000000005", revisionNumber: 2, status: "approved" };
    mocks.saveKnowledge.mockResolvedValueOnce(updated);
    renderPanel();
    await screen.findByText("Unconfirmed note");
    fireEvent.click(screen.getAllByRole("button", { name: "编辑并回到草稿" })[1]!);
    expect((screen.getByLabelText("知识状态编辑") as HTMLSelectElement).value).toBe("draft");
    fireEvent.click(screen.getByRole("button", { name: "确认知识" }));
    await waitFor(() => expect(screen.queryByText("编辑知识 · v2")).not.toBeNull());
    expect((screen.getByLabelText("知识状态编辑") as HTMLSelectElement).value).toBe("approved");
    expect((screen.getByLabelText("知识标题") as HTMLInputElement).value).toBe("Unconfirmed note");
  });

  it("syncs a clean editor opened from an approved entry after archiving", async () => {
    const archived: KnowledgeRevision = { ...approved, id: "50000000-0000-4000-8000-000000000007", revisionNumber: 2, status: "archived" };
    mocks.saveKnowledge.mockResolvedValueOnce(archived);
    renderPanel();
    await screen.findByText("Confirmed capacity");
    fireEvent.click(screen.getAllByRole("button", { name: "编辑并回到草稿" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "归档知识" }));
    await waitFor(() => expect(screen.queryByText("编辑知识 · v2")).not.toBeNull());
    expect((screen.getByLabelText("知识状态编辑") as HTMLSelectElement).value).toBe("archived");
    expect((screen.getByLabelText("知识正文") as HTMLTextAreaElement).value).toBe("300 ml");
    expect(screen.getByRole("status").textContent).not.toContain("仍基于");
  });

  it("keeps a dirty editor on its old base when the list entry is archived", async () => {
    const archived: KnowledgeRevision = { ...approved, id: "50000000-0000-4000-8000-000000000006", revisionNumber: 2, status: "archived" };
    mocks.saveKnowledge.mockResolvedValueOnce(archived);
    renderPanel();
    await screen.findByText("Confirmed capacity");
    fireEvent.click(screen.getAllByRole("button", { name: "编辑并回到草稿" })[0]!);
    fireEvent.change(screen.getByLabelText("知识正文"), { target: { value: "Unpublished local edit" } });
    fireEvent.click(screen.getByRole("button", { name: "归档知识" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("仍基于 v1"));
    expect(screen.queryByText("编辑知识 · v1")).not.toBeNull();
    expect((screen.getByLabelText("知识正文") as HTMLTextAreaElement).value).toBe("Unpublished local edit");
    expect((screen.getByLabelText("知识状态编辑") as HTMLSelectElement).value).toBe("draft");
  });

  it("does not show English validation for a blank new form and shows Chinese hints after editing", async () => {
    renderPanel();
    await screen.findByText("Confirmed capacity");
    fireEvent.click(screen.getByRole("button", { name: "新建知识" }));
    expect(screen.queryByText(/不能为空|不能超过|String must contain/)).toBeNull();
    fireEvent.change(screen.getByLabelText("知识标题"), { target: { value: " " } });
    expect(screen.getByText("标题不能为空")).toBeTruthy();
    expect(screen.getByText("正文不能为空")).toBeTruthy();
    expect(screen.getByText("来源不能为空")).toBeTruthy();
    expect(screen.queryByText(/String must contain/)).toBeNull();
  });

  it("removes a stale selected revision after reload while preserving selections from another page", async () => {
    const otherPageEntry: KnowledgeRevision = { ...draft, id: "50000000-0000-0000-8000-000000000008", entryId: "50000000-0000-0000-8000-000000000009", title: "Other page fact", status: "approved" };
    const replacementDraft: KnowledgeRevision = { ...approved, id: "50000000-0000-0000-8000-000000000010", revisionNumber: 2, status: "draft" };
    mocks.listKnowledge.mockResolvedValueOnce({ items: [approved], total: 21, limit: 20, offset: 0 })
      .mockResolvedValueOnce({ items: [otherPageEntry], total: 21, limit: 20, offset: 20 })
      .mockResolvedValueOnce({ items: [replacementDraft], total: 21, limit: 20, offset: 0 });
    const selected = vi.fn();
    renderPanel([approved.id, otherPageEntry.id], selected);
    await screen.findByText("Confirmed capacity");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("Other page fact");
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await screen.findByText("Confirmed capacity");
    expect(selected).toHaveBeenLastCalledWith([otherPageEntry.id]);
    expect(selected.mock.lastCall?.[0]).not.toContain(approved.id);
  });

  it("requires explicit reselection even when a replacement revision is approved", async () => {
    const replacementApproved: KnowledgeRevision = { ...approved, id: "50000000-0000-0000-8000-000000000011", revisionNumber: 2, status: "approved" };
    mocks.listKnowledge.mockResolvedValueOnce({ items: [approved], total: 1, limit: 20, offset: 0 })
      .mockResolvedValueOnce({ items: [replacementApproved], total: 1, limit: 20, offset: 0 });
    const selected = vi.fn();
    renderPanel([approved.id], selected);
    await screen.findByText("Confirmed capacity");
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(selected).toHaveBeenLastCalledWith([]));
    expect(screen.getByRole("status").textContent).toContain("重新勾选");
    expect(selected.mock.lastCall?.[0]).not.toContain(approved.id);
  });
});
