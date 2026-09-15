// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeRequest } from "../apps/web/src/api.js";
import { createExampleRequest } from "../apps/web/src/intent.js";
import { useWorkbench } from "../apps/web/src/useWorkbench.js";
import { ListingResultSchema, type ListingResult } from "../src/schemas.js";

vi.mock("../apps/web/src/api.js", () => ({ executeRequest: vi.fn() }));

const execute = vi.mocked(executeRequest);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function listingResult(title: string): ListingResult {
  return ListingResultSchema.parse({
    listing: { title, bullets: ["A useful benefit"], description: "Product description", backendSearchTerms: [] },
    audit: null,
    coverage: { rows: [], coveragePct: 0, uncovered: [] },
  });
}

beforeEach(() => execute.mockReset());
afterEach(() => cleanup());

describe("workbench conversation state", () => {
  it("stores a successful graph result with the request and its example disclosures", async () => {
    const response = listingResult("Generated listing");
    execute.mockResolvedValueOnce(response);
    const request = createExampleRequest("listing-create");
    const { result } = renderHook(() => useWorkbench());

    await act(async () => { await result.current.submitRequest(request, "生成 Listing"); });

    expect(execute).toHaveBeenCalledWith(request, expect.any(AbortSignal));
    expect(result.current.active.messages).toHaveLength(2);
    expect(result.current.active.messages[0]).toMatchObject({ role: "user", text: "生成 Listing" });
    expect(result.current.active.messages[1]).toMatchObject({
      role: "assistant", state: "success", result: response,
      request: { exampleData: request.exampleData },
    });
    expect(result.current.active.lastRequest).toEqual(request);
    expect(result.current.busy).toBe(false);
  });

  it("offers the four task choices for unknown input without calling the API", () => {
    const { result } = renderHook(() => useWorkbench());
    act(() => result.current.submitText("你好，讲个笑话吧"));

    expect(execute).not.toHaveBeenCalled();
    expect(result.current.active.messages).toHaveLength(2);
    expect(result.current.active.messages[1]).toMatchObject({ role: "assistant", state: "choose" });
    expect(result.current.active.lastRequest).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it("does not leave a pending message when cancellation races with an already-resolved API promise", async () => {
    const api = deferred<ListingResult>();
    execute.mockReturnValueOnce(api.promise);
    const { result } = renderHook(() => useWorkbench());
    let completion!: Promise<void>;
    act(() => { completion = result.current.submitRequest(createExampleRequest("listing-create")); });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      api.resolve(listingResult("Must not appear"));
      // Promise resolution schedules the continuation; cancellation happens before it resumes.
      result.current.cancel();
      await completion;
    });

    expect(execute.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(result.current.busy).toBe(false);
    expect(result.current.active.messages[1]).toMatchObject({ state: "error", text: expect.stringContaining("已停止等待") });
    expect(result.current.active.messages[1]?.result).toBeUndefined();

    execute.mockResolvedValueOnce(listingResult("A new request works"));
    await act(async () => { await result.current.submitRequest(createExampleRequest("listing-create")); });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.current.active.messages[3]).toMatchObject({ state: "success" });
  });

  it("keeps simultaneous conversation results isolated while the active conversation changes", async () => {
    const firstApi = deferred<ListingResult>();
    const secondApi = deferred<ListingResult>();
    execute.mockReturnValueOnce(firstApi.promise).mockReturnValueOnce(secondApi.promise);
    const { result } = renderHook(() => useWorkbench());
    const firstId = result.current.activeId;
    let firstCompletion!: Promise<void>;
    let secondCompletion!: Promise<void>;

    act(() => { firstCompletion = result.current.submitRequest(createExampleRequest("listing-create", "us")); });
    act(() => result.current.createConversation());
    const secondId = result.current.activeId;
    act(() => { secondCompletion = result.current.submitRequest(createExampleRequest("listing-create", "uk")); });
    act(() => result.current.setActive(firstId));
    expect(result.current.busy).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);

    await act(async () => { secondApi.resolve(listingResult("UK listing")); await secondCompletion; });
    expect(result.current.activeId).toBe(firstId);
    expect(result.current.active.messages[1]?.state).toBe("pending");
    expect(result.current.conversations.find((item) => item.id === secondId)?.messages[1]).toMatchObject({
      state: "success", result: { listing: { title: "UK listing" } },
    });

    await act(async () => { firstApi.resolve(listingResult("US listing")); await firstCompletion; });
    expect(result.current.busy).toBe(false);
    expect(result.current.active.messages[1]).toMatchObject({ state: "success", result: { listing: { title: "US listing" } } });
    act(() => result.current.setActive(secondId));
    expect(result.current.active.marketplace).toBe("uk");
    expect(result.current.active.messages[1]).toMatchObject({ result: { listing: { title: "UK listing" } } });
  });

  it("sends only one request when the same conversation is submitted twice before React renders", async () => {
    const api = deferred<ListingResult>();
    execute.mockReturnValueOnce(api.promise);
    const { result } = renderHook(() => useWorkbench());
    const request = createExampleRequest("listing-create");
    let first!: Promise<void>;
    let duplicate!: Promise<void>;

    act(() => {
      first = result.current.submitRequest(request);
      duplicate = result.current.submitRequest(request);
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.current.active.messages).toHaveLength(2);
    await act(async () => { api.resolve(listingResult("One result")); await Promise.all([first, duplicate]); });
    expect(result.current.active.messages).toHaveLength(2);
    expect(result.current.busy).toBe(false);
  });

  it("prevents a deleted conversation's late response from changing a new conversation", async () => {
    const oldApi = deferred<ListingResult>();
    const newApi = deferred<ListingResult>();
    execute.mockReturnValueOnce(oldApi.promise).mockReturnValueOnce(newApi.promise);
    const { result } = renderHook(() => useWorkbench());
    const oldId = result.current.activeId;
    let oldCompletion!: Promise<void>;
    let newCompletion!: Promise<void>;
    act(() => { oldCompletion = result.current.submitRequest(createExampleRequest("listing-create", "us")); });
    act(() => result.current.removeConversation(oldId));

    const newId = result.current.activeId;
    expect(newId).not.toBe(oldId);
    expect(execute.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(result.current.active.messages).toEqual([]);
    act(() => { newCompletion = result.current.submitRequest(createExampleRequest("listing-create", "de")); });

    await act(async () => { oldApi.resolve(listingResult("Deleted result")); await oldCompletion; });
    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.activeId).toBe(newId);
    expect(result.current.active.messages).toHaveLength(2);
    expect(result.current.active.messages[1]).toMatchObject({ state: "pending" });
    expect(result.current.busy).toBe(true);

    await act(async () => { newApi.resolve(listingResult("New DE result")); await newCompletion; });
    expect(result.current.active.messages[1]).toMatchObject({ state: "success", result: { listing: { title: "New DE result" } } });
    expect(result.current.active.marketplace).toBe("de");
    expect(result.current.busy).toBe(false);
  });
});
