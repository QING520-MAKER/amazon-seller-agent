import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../src/config.js";
import { getMarketplace } from "../src/marketplace.js";
import { AutocompleteClient } from "../src/providers/autocomplete.js";

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    amazonMarketplace: "us",
    autocompleteTimeoutMs: 1_000,
    autocompleteDelayMs: 0,
    openaiApiKey: "",
    openaiBaseUrl: "",
    openaiModel: "unused-in-autocomplete-tests",
    ...overrides,
  };
}

function completion(values: string[] = []): Response {
  return new Response(JSON.stringify({ suggestions: values.map((value) => ({ value })) }), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("public autocomplete", () => {
  it("queries the four public prefixes with encoded input and deduplicates normalized phrases", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(["  Portable   Blender  ", "", "   ", "Café & blender"]))
      .mockResolvedValueOnce(completion(["PORTABLE BLENDER", " best portable blender "]))
      .mockResolvedValueOnce(completion(["Café & blender", "cheap portable blender"]))
      .mockResolvedValueOnce(completion(["top portable blender"]));
    vi.stubGlobal("fetch", fetchMock);

    const phrases = await new AutocompleteClient(settings()).suggestions("  café   & blender  ", getMarketplace("uk"));

    expect(phrases).toEqual([
      "Portable Blender", "Café & blender", "best portable blender", "cheap portable blender", "top portable blender",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const requests = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(requests.map((url) => url.searchParams.get("prefix"))).toEqual([
      "café & blender", "best café & blender", "cheap café & blender", "top café & blender",
    ]);
    for (const url of requests) {
      expect(url.origin).toBe("https://completion.amazon.co.uk");
      expect(url.pathname).toBe("/api/2017/suggestions");
      expect(url.searchParams.get("mid")).toBe("A1F83G8C2ARO7P");
      expect(url.searchParams.get("alias")).toBe("aps");
      expect([...url.searchParams.keys()].sort()).toEqual(["alias", "mid", "prefix"]);
      expect(url.search).toContain("%C3%A9");
      expect(url.search).toContain("%26");
    }
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ credentials: "omit", redirect: "error" });
      expect(new Headers(init?.headers).get("User-Agent")).toContain("Mozilla/5.0");
      expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("adds all 26 alphabet expansions only in deep mode", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => completion(["same phrase"]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new AutocompleteClient(settings()).suggestions("portable blender", getMarketplace("us"), { deep: true });

    expect(result).toEqual(["same phrase"]);
    expect(fetchMock).toHaveBeenCalledTimes(30);
    const prefixes = fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("prefix"));
    expect(prefixes.slice(4)).toEqual([..."abcdefghijklmnopqrstuvwxyz"].map((letter) => `portable blender ${letter}`));
  });

  it("keeps the configured delay between requests and successive suggestions calls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const startedAt: number[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      startedAt.push(Date.now());
      return completion();
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AutocompleteClient(settings({ autocompleteDelayMs: 50 }));

    const first = client.suggestions("first seed", getMarketplace("us"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    await first;

    const second = client.suggestions("second seed", getMarketplace("us"));
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await vi.runAllTimersAsync();
    await second;
    expect(startedAt).toEqual([0, 50, 100, 150, 200, 250, 300, 350]);
  });

  it("serializes concurrent calls and delays after each response completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let inFlight = 0;
    let maxInFlight = 0;
    const startedAt: number[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      startedAt.push(Date.now());
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return completion();
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AutocompleteClient(settings({ autocompleteDelayMs: 50 }));

    const both = Promise.all([
      client.suggestions("first seed", getMarketplace("us")),
      client.suggestions("second seed", getMarketplace("us")),
    ]);
    await vi.runAllTimersAsync();
    await both;

    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(maxInFlight).toBe(1);
    expect(startedAt).toEqual([0, 70, 140, 210, 280, 350, 420, 490]);
  });

  it("rejects HTTP errors with query context and allows a later call to recover", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockImplementation(async () => completion());
    vi.stubGlobal("fetch", fetchMock);
    const client = new AutocompleteClient(settings());

    await expect(client.suggestions("portable blender", getMarketplace("us")))
      .rejects.toThrow(/Amazon autocomplete failed for "portable blender": HTTP 429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(client.suggestions("recovered seed", getMarketplace("us"))).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it.each([
    ["missing suggestions", {}],
    ["non-array suggestions", { suggestions: "portable blender" }],
    ["non-string value", { suggestions: [{ value: 123 }] }],
  ])("rejects malformed JSON response structure: %s", async (_label, payload) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new AutocompleteClient(settings()).suggestions("portable blender", getMarketplace("us")))
      .rejects.toThrow(/Amazon autocomplete failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response that is not JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>blocked</html>"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new AutocompleteClient(settings()).suggestions("portable blender", getMarketplace("us")))
      .rejects.toThrow(/Amazon autocomplete failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled fetch at the configured timeout", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      requestSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!requestSignal) {
          reject(new Error("Request did not provide a timeout signal"));
          return;
        }
        requestSignal.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new AutocompleteClient(settings({ autocompleteTimeoutMs: 10 })).suggestions("portable blender", getMarketplace("us")))
      .rejects.toThrow(/Amazon autocomplete failed.*timeout/i);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects blank input before HTTP", async () => {
    await expect(new AutocompleteClient(settings()).suggestions("  \t\n ", getMarketplace("us")))
      .rejects.toThrow(/keyword must not be blank/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an unsupported marketplace before HTTP", async () => {
    const market = { ...getMarketplace("us"), code: "xx" };
    await expect(new AutocompleteClient(settings()).suggestions("portable blender", market))
      .rejects.toThrow(/Unknown marketplace/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid timeout %s before HTTP", async (timeout) => {
    await expect(new AutocompleteClient(settings({ autocompleteTimeoutMs: timeout })).suggestions("portable blender", getMarketplace("us")))
      .rejects.toThrow(/autocompleteTimeoutMs must be a positive integer/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid delay %s before HTTP", async (delay) => {
    await expect(new AutocompleteClient(settings({ autocompleteDelayMs: delay })).suggestions("portable blender", getMarketplace("us")))
      .rejects.toThrow(/autocompleteDelayMs must be a non-negative number/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves public endpoint details from the validated marketplace code", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => completion());
    vi.stubGlobal("fetch", fetchMock);
    const market = { ...getMarketplace("us"), code: "US", domain: "untrusted.invalid", marketplaceId: "untrusted" };

    await new AutocompleteClient(settings()).suggestions("portable blender", market);

    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://completion.amazon.com");
      expect(url.searchParams.get("mid")).toBe("ATVPDKIKX0DER");
    }
  });
});
