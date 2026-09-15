// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultActions } from "../apps/web/src/components/ResultActions";
import { ListingResultSchema, ResearchReportSchema, type ListingResult, type ResearchReport } from "../src/schemas.js";

const listingResult = ListingResultSchema.parse({
  listing: {
    title: "Acme Portable Blender — USB-C, 380ml",
    bullets: [
      "BLEND ON THE GO — A portable blender for your routine.",
      "A PERSONAL FIT — A personal blender with a 380ml cup.",
      "PACK LIGHT — A travel blender for the office.",
      "CHARGE SIMPLY — USB rechargeable blender with a USB-C cable.",
      "MAKE IT YOURS — A smoothie maker for café-style drinks.",
    ],
    description: "Meet your portable blender.\nBring café-style smoothies to your daily routine.",
    backendSearchTerms: ["compact blender", "smoothie cup"],
  },
  audit: null,
  coverage: { rows: [], coveragePct: 0, uncovered: [] },
});

const auditResult = ListingResultSchema.parse({
  ...listingResult,
  audit: {
    total: 0,
    dimensions: [],
    coverage: { rows: [], coveragePct: 0, uncovered: [] },
  },
});

const researchResult = ResearchReportSchema.parse({
  keyword: "portable blender",
  marketplace: "uk",
  keywords: [
    { phrase: "portable blender", intent: "niche" },
    { phrase: "best portable blender", intent: "commercial" },
    { phrase: "portable blender for café", intent: "niche" },
  ],
  competition: {},
  seasonality: {},
  opportunity: {
    total: 1,
    competitionDensity: "medium",
    nichePotential: "low",
    reasoning: "Test fixture; no market measurements.",
    recommendation: "Validate independently.",
  },
});

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText = vi.fn<(text: string) => Promise<void>>();
const blobUrl = "blob:http://localhost/asa-test-result";
const createObjectURL = vi.fn((_blob: unknown) => blobUrl);
const revokeObjectURL = vi.fn();

function renderActions(result: ListingResult | ResearchReport = listingResult) {
  return render(createElement(App, null, createElement(ResultActions, { result })));
}

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("result copy actions", () => {
  it.each([
    { label: "复制标题", text: listingResult.listing.title, confirmation: "标题已复制" },
    { label: "复制五点", text: listingResult.listing.bullets.join("\n\n"), confirmation: "五点已复制" },
    { label: "复制描述", text: listingResult.listing.description, confirmation: "描述已复制" },
  ])("copies the exact text for $label and confirms success", async ({ label, text, confirmation }) => {
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`${label}$`) }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(text);
    expect(await screen.findByText(confirmation)).toBeTruthy();
  });

  it("copies research keywords as separate lines without metadata", async () => {
    renderActions(researchResult);

    fireEvent.click(screen.getByRole("button", { name: /复制关键词$/ }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("portable blender\nbest portable blender\nportable blender for café");
    expect(await screen.findByText("关键词已复制")).toBeTruthy();
  });

  it("shows a failure message when the browser rejects clipboard access", async () => {
    writeText.mockRejectedValueOnce(new Error("Clipboard permission denied"));
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: /复制标题$/ }));

    expect(await screen.findByText("复制失败，请允许浏览器访问剪贴板，或下载 JSON 保存结果。")).toBeTruthy();
    expect(screen.queryByText("标题已复制")).toBeNull();
  });
});

describe("result JSON download", () => {
  it.each([
    { result: listingResult, filename: "asa-listing.json" },
    { result: auditResult, filename: "asa-listing-audit.json" },
    { result: researchResult, filename: "asa-research-uk.json" },
  ])("downloads the complete result as $filename and releases its URL after 1 second", async ({ result, filename }) => {
    vi.useFakeTimers();
    const downloads: Array<{ href: string; filename: string; connected: boolean }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.href, filename: this.download, connected: this.isConnected });
    });
    renderActions(result);

    fireEvent.click(screen.getByRole("button", { name: /下载 JSON$/ }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(NodeBlob);
    if (!(blob instanceof NodeBlob)) throw new Error("Expected a JSON Blob");
    expect(blob.type).toBe("application/json;charset=utf-8");
    expect(await blob.text()).toBe(JSON.stringify(result, null, 2));
    expect(JSON.parse(await blob.text())).toEqual(result);
    expect(click).toHaveBeenCalledTimes(1);
    expect(downloads).toEqual([{ href: blobUrl, filename, connected: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(999));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(blobUrl);
  });
});
