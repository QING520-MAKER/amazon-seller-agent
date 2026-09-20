// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useUploads } from "../apps/web/src/products/useUploads.js";
import * as api from "../apps/web/src/products/api.js";
import type { OriginalAsset } from "../src/schemas.js";
vi.mock("../apps/web/src/products/api.js", async original => ({
  ...await original(), uploadAsset: vi.fn(), listAssets: vi.fn(),
}));
const asset: OriginalAsset = { id: "10000000-0000-4000-8000-000000000001", productId: "A", kind: "original", originalName: "a.png",
  mimeType: "image/png", sizeBytes: 1, width: 1, height: 1, orientation: null, sha256: "a".repeat(64),
  createdAt: "2026-09-20T00:00:00.000Z", archivedAt: null, version: 1 };
beforeEach(() => { vi.mocked(api.uploadAsset).mockReset(); vi.mocked(api.listAssets).mockReset(); });
afterEach(cleanup);
it("captures product ownership, uploads sequentially and keeps successful items when another fails", async () => {
  let finish!: (value: { asset: OriginalAsset; reused: boolean }) => void;
  vi.mocked(api.uploadAsset).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockRejectedValueOnce(new api.CatalogApiError("图片损坏", 422, "INVALID_IMAGE"))
    .mockResolvedValueOnce({ asset: { ...asset, productId: "B" }, reused: false });
  const { result } = renderHook(useUploads);
  act(() => result.current.add("A", [new File(["a"], "a.png"), new File(["bad"], "bad.png")]));
  act(() => result.current.add("B", [new File(["b"], "b.png")]));
  expect(api.uploadAsset).toHaveBeenCalledTimes(1);
  await act(async () => finish({ asset, reused: false }));
  await waitFor(() => expect(api.uploadAsset).toHaveBeenCalledTimes(3));
  expect(vi.mocked(api.uploadAsset).mock.calls.map(call => call[0])).toEqual(["A", "A", "B"]);
  expect(result.current.items.map(item => [item.productId, item.state])).toEqual([["A", "saved"], ["A", "error"], ["B", "saved"]]);
  expect(result.current.items[1]?.message).toBe("图片损坏");
});
it("stopping the wait reports an uncertain save instead of claiming cancellation", async () => {
  vi.mocked(api.uploadAsset).mockImplementation((_id, _file, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new api.CatalogApiError("保存结果待确认", 0, "NETWORK_ERROR", undefined, undefined, true)));
  }));
  const { result } = renderHook(useUploads);
  act(() => result.current.add("A", [new File(["a"], "a.png")]));
  await act(async () => result.current.stopWaiting());
  expect(result.current.items[0]).toMatchObject({ state: "uncertain", reconcile: true });
});
