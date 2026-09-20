// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import App from "../apps/web/src/App.js";
import * as api from "../apps/web/src/api.js";
import { ProductBriefSchema, ListingResultSchema } from "../src/schemas.js";
import type { useWorkbench } from "../apps/web/src/useWorkbench.js";

vi.mock("../apps/web/src/api.js", () => ({ executeRequest: vi.fn() }));
// Lightweight view exercises the real persistent hook and App navigation.
vi.mock("../apps/web/src/components/Workbench.js", () => ({
  Workbench: ({ chat }: { chat: ReturnType<typeof useWorkbench> }) => {
    const [json, setJson] = useState("");
    return <div><label>聊天草稿<input value={chat.active.draft} onChange={e => chat.setDraft(e.target.value)} /></label>
      <label>JSON 草稿<input value={json} onChange={e => setJson(e.target.value)} /></label>
      <button onClick={() => void chat.submitRequest({ kind: "listing-create", payload: { product: ProductBriefSchema.parse({ name: "N" }), marketplace: "us", keywords: [] }, exampleData: [] })}>运行测试请求</button>
      {chat.active.messages.map(m => <p key={m.id}>{m.state === "success" ? "请求已完成" : m.state}</p>)}</div>;
  },
}));
vi.mock("../apps/web/src/products/api.js", async original => ({
  ...await original(), listProducts: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
}));
beforeEach(() => { window.history.replaceState(null, "", "#/workbench"); vi.mocked(api.executeRequest).mockReset(); });
afterEach(cleanup);
describe("application navigation", () => {
  it("preserves chat/JSON drafts and completes pending work while viewing products", async () => {
    let finish!: (value: ReturnType<typeof ListingResultSchema.parse>) => void;
    vi.mocked(api.executeRequest).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<App />);
    fireEvent.change(screen.getByLabelText("JSON 草稿"), { target: { value: "未提交JSON" } });
    fireEvent.click(screen.getByRole("button", { name: "运行测试请求" }));
    fireEvent.change(screen.getByLabelText("聊天草稿"), { target: { value: "下一条草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "商品", exact: true }));
    await screen.findByText("还没有保存商品");
    expect(vi.mocked(api.executeRequest).mock.calls[0]?.[1]?.aborted).toBe(false);
    await act(async () => finish(ListingResultSchema.parse({ listing: { title: "N", bullets: [], description: "", backendSearchTerms: [] }, coverage: { rows: [], coveragePct: 0, uncovered: [] } })));
    fireEvent.click(screen.getByRole("button", { name: "对话工作台" }));
    expect((screen.getByLabelText("聊天草稿") as HTMLInputElement).value).toBe("下一条草稿");
    expect((screen.getByLabelText("JSON 草稿") as HTMLInputElement).value).toBe("未提交JSON");
    expect(screen.getByText("请求已完成")).toBeTruthy();
  });
  it("guards navigation, hash/back changes and page close when a product draft is dirty", async () => {
    window.history.replaceState(null, "", "#/products/new");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByLabelText("商品名称"), { target: { value: "未保存商品" } });
    fireEvent.click(screen.getByRole("button", { name: "对话工作台" }));
    expect(window.location.hash).toBe("#/products/new");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await act(async () => { window.location.hash = "#/products"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await waitFor(() => expect(window.location.hash).toBe("#/products/new"));
    expect((screen.getByLabelText("商品名称") as HTMLInputElement).value).toBe("未保存商品");
  });
});
