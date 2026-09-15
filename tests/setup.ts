import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  // Any HTTP call must be explicitly mocked by its test; never contact Amazon in CI.
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("Unexpected network request in test: mock fetch explicitly");
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
