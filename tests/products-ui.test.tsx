// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductForm } from "../apps/web/src/products/ProductForm.js";
import { ProductList } from "../apps/web/src/products/ProductList.js";
import { ProductDetail } from "../apps/web/src/products/ProductDetail.js";
import { ProductBriefSchema, type ProductDetail as Detail } from "../src/schemas.js";
import * as api from "../apps/web/src/products/api.js";
import type { Uploads } from "../apps/web/src/products/useUploads.js";

vi.mock("../apps/web/src/products/api.js", async importOriginal => ({
  ...await importOriginal<typeof api>(),
  createProduct: vi.fn(), saveProduct: vi.fn(), getProduct: vi.fn(), listProducts: vi.fn(),
  listRevisions: vi.fn(), listAssets: vi.fn(), getRevision: vi.fn(),
}));
const id = "10000000-0000-4000-8000-000000000001", rev = "20000000-0000-4000-8000-000000000001";
const initial: Detail = {
  product: { id, workspaceId: "local", sku: "SKU-A", currentRevisionId: rev, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" },
  currentRevision: { id: rev, productId: id, revisionNumber: 1, brief: ProductBriefSchema.parse({ name: "真实商品", brand: "真实品牌", attributes: ["500ml"] }), sourceNote: "包装说明", createdAt: "2026-09-20T00:00:00.000Z" },
  missingFields: ["features", "included", "originalAssets"],
};
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; return { promise: new Promise<T>((r, j) => { resolve = r; reject = j; }), resolve, reject }; }
const props = () => ({ onSaved: vi.fn(), onReloaded: vi.fn(), onCancel: vi.fn(), onDirty: vi.fn(), navigate: vi.fn() });
const latest: Detail = { ...initial,
  product: { ...initial.product, currentRevisionId: "20000000-0000-4000-8000-000000000002" },
  currentRevision: { ...initial.currentRevision, id: "20000000-0000-4000-8000-000000000002", revisionNumber: 2,
    brief: { ...initial.currentRevision.brief, name: "最新商品", brand: "最新品牌", attributes: ["750ml"] } },
};
const uploads: Uploads = { items: [], versions: {}, add: vi.fn(), retry: vi.fn(), stopWaiting: vi.fn() };
beforeEach(() => {
  vi.mocked(api.createProduct).mockReset(); vi.mocked(api.saveProduct).mockReset(); vi.mocked(api.getProduct).mockReset(); vi.mocked(api.listProducts).mockReset();
  vi.mocked(api.listRevisions).mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  vi.mocked(api.listAssets).mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
});
afterEach(cleanup);
describe("product forms and asynchronous pages", () => {
  it("keeps a saved v2 snapshot when an earlier upload-triggered v1 GET arrives late", async () => {
    const oldRead = deferred<Detail>();
    vi.mocked(api.getProduct).mockResolvedValueOnce(initial).mockReturnValueOnce(oldRead.promise).mockResolvedValue(latest);
    vi.mocked(api.saveProduct).mockResolvedValue({ product: latest.product, revision: latest.currentRevision, changed: true });
    const callbacks = props();
    const { rerender } = render(<ProductDetail productId={id} uploads={uploads} {...callbacks} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑资料" }));
    fireEvent.change(screen.getByLabelText("商品名称"), { target: { value: "最新商品" } });
    rerender(<ProductDetail productId={id} uploads={{ ...uploads, versions: { [id]: 1 } }} {...callbacks} />);
    await waitFor(() => expect(api.getProduct).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
    await screen.findByRole("button", { name: "编辑资料" });
    expect(screen.getByRole("heading", { name: "最新商品" })).toBeTruthy();
    await act(async () => oldRead.resolve(initial));
    expect(screen.getByRole("heading", { name: "最新商品" })).toBeTruthy();
    expect(screen.getByText(/资料 v2/)).toBeTruthy();
    expect(screen.getByText("最新品牌")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    expect((screen.getByLabelText("商品名称") as HTMLInputElement).value).toBe("最新商品");
  });
  it("keeps reloaded v2 in the parent after cancelling and reopening the editor", async () => {
    vi.mocked(api.getProduct).mockResolvedValueOnce(initial).mockResolvedValue(latest);
    vi.mocked(api.saveProduct).mockRejectedValueOnce(new api.CatalogApiError("资料冲突", 409, "REVISION_CONFLICT"))
      .mockResolvedValue({ product: latest.product, revision: latest.currentRevision, changed: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProductDetail productId={id} uploads={uploads} {...props()} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑资料" }));
    fireEvent.change(screen.getByLabelText("商品名称"), { target: { value: "本地编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
    fireEvent.click(await screen.findByRole("button", { name: "放弃本地草稿并载入最新" }));
    await waitFor(() => expect((screen.getByLabelText("商品名称") as HTMLInputElement).value).toBe("最新商品"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("heading", { name: "最新商品" })).toBeTruthy();
    expect(screen.getByText(/资料 v2/)).toBeTruthy();
    expect(screen.getByText("750ml")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    expect((screen.getByLabelText("品牌") as HTMLInputElement).value).toBe("最新品牌");
    fireEvent.change(screen.getByLabelText("商品名称"), { target: { value: "再次编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
    await waitFor(() => expect(api.saveProduct).toHaveBeenLastCalledWith(id, expect.objectContaining({ baseRevisionId: latest.currentRevision.id })));
  });
  it.each(["success", "failure"])("locks reload against edits/repeated clicks and retains the correct draft on %s", async outcome => {
    const read = deferred<Detail>(), callbacks = props();
    vi.mocked(api.getProduct).mockReturnValue(read.promise);
    vi.mocked(api.saveProduct).mockRejectedValue(new api.CatalogApiError("资料冲突", 409, "REVISION_CONFLICT"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProductForm product={initial} {...callbacks} />);
    fireEvent.change(screen.getByLabelText("商品名称"), { target: { value: "本地草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
    const reload = await screen.findByRole("button", { name: "放弃本地草稿并载入最新" });
    fireEvent.click(reload); fireEvent.click(reload);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.getProduct).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("商品名称").matches(":disabled")).toBe(true);
    expect((reload as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "查看最新资料" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText("商品名称").closest("form")!);
    expect(api.saveProduct).toHaveBeenCalledTimes(1);
    if (outcome === "success") {
      await act(async () => read.resolve(latest));
      expect((screen.getByLabelText("商品名称") as HTMLInputElement).value).toBe("最新商品");
      expect(callbacks.onReloaded).toHaveBeenCalledWith(latest);
      expect(callbacks.onSaved).not.toHaveBeenCalled();
      expect(callbacks.onDirty).toHaveBeenLastCalledWith(false);
    } else {
      await act(async () => read.reject(new Error("重新载入失败")));
      expect(screen.getByText("重新载入失败")).toBeTruthy();
      expect((screen.getByLabelText("商品名称") as HTMLInputElement).value).toBe("本地草稿");
      expect(callbacks.onDirty).toHaveBeenLastCalledWith(true);
      expect(callbacks.onReloaded).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("品牌"), { target: { value: "失败后继续编辑" } });
      expect((screen.getByLabelText("品牌") as HTMLInputElement).value).toBe("失败后继续编辑");
    }
    expect(screen.getByLabelText("商品名称").matches(":disabled")).toBe(false);
  });
  it("starts empty and submits actual facts only", async () => {
    const callbacks = props();
    vi.mocked(api.createProduct).mockResolvedValue(initial);
    render(<ProductForm {...callbacks} />);
    expect((screen.getByLabelText("商品名称") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "SKU-A" } });
    fireEvent.change(screen.getByLabelText("商品名称"), { target: { value: "真实商品" } });
    fireEvent.click(screen.getByRole("button", { name: "创建商品" }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce());
    expect(api.createProduct).toHaveBeenCalledWith({ sku: "SKU-A", brief: ProductBriefSchema.parse({ name: "真实商品" }), sourceNote: "" });
  });
  it("preserves full drafts after conflicts, and fetching the latest does not overwrite", async () => {
    const callbacks = props();
    vi.mocked(api.saveProduct).mockRejectedValue(new api.CatalogApiError("资料冲突", 409, "REVISION_CONFLICT", { currentRevisionId: rev }));
    vi.mocked(api.getProduct).mockResolvedValue({ ...initial, currentRevision: { ...initial.currentRevision, brief: { ...initial.currentRevision.brief, name: "另一窗口" } } });
    render(<ProductForm product={initial} {...callbacks} />);
    fireEvent.change(screen.getByLabelText("商品名称"), { target: { value: "本地编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
    await screen.findByText("资料冲突");
    expect((screen.getByLabelText("品牌") as HTMLInputElement).value).toBe("真实品牌");
    expect((screen.getByLabelText("属性 / 规格 1") as HTMLInputElement).value).toBe("500ml");
    expect(callbacks.onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看最新资料" }));
    await screen.findByText("另一窗口");
    expect((screen.getByLabelText("商品名称") as HTMLInputElement).value).toBe("本地编辑");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "放弃本地草稿并载入最新" }));
    await waitFor(() => expect((screen.getByLabelText("商品名称") as HTMLInputElement).value).toBe("另一窗口"));
  });
  it("does not claim a lost response is a cancelled or failed save", async () => {
    vi.mocked(api.createProduct).mockRejectedValue(new api.CatalogApiError("保存结果待确认", 0, "NETWORK_ERROR", undefined, undefined, true));
    render(<ProductForm {...props()} />);
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("商品名称"), { target: { value: "商品" } });
    fireEvent.click(screen.getByRole("button", { name: "创建商品" }));
    await screen.findByText("保存结果待确认");
    expect((screen.getByRole("button", { name: "创建商品" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("商品名称") as HTMLInputElement).value).toBe("商品");
  });
  it("reports a list failure instead of an empty library", async () => {
    vi.mocked(api.listProducts).mockRejectedValue(new Error("存储不可用"));
    render(<ProductList navigate={vi.fn()} />);
    await screen.findByText("存储不可用");
    expect(screen.queryByText("还没有保存商品")).toBeNull();
  });
  it("ignores a late product response after switching to another product", async () => {
    const first = deferred<Detail>(), second = deferred<Detail>();
    vi.mocked(api.getProduct).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const callbacks = { onDirty: vi.fn(), navigate: vi.fn() };
    const { rerender } = render(<ProductDetail key="A" productId="A" uploads={uploads} {...callbacks} />);
    rerender(<ProductDetail key="B" productId="B" uploads={uploads} {...callbacks} />);
    await act(async () => second.resolve({ ...initial, currentRevision: { ...initial.currentRevision, brief: { ...initial.currentRevision.brief, name: "商品B" } } }));
    await screen.findByRole("heading", { name: "商品B" });
    await act(async () => first.resolve(initial));
    expect(screen.queryByRole("heading", { name: "真实商品" })).toBeNull();
    expect(screen.getByRole("heading", { name: "商品B" })).toBeTruthy();
  });
});
