// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DownloadLink } from "../apps/web/src/shared/DownloadLink.js";

afterEach(cleanup);
describe("native attachment links", () => {
  it("withholds the endpoint while disabled and preserves the editor in a separate target", () => {
    const view = render(<DownloadLink href="/api/download" disabled>下载正式 JSON</DownloadLink>);
    const link = screen.getByRole("link", { name: "下载正式 JSON" });
    expect(link.getAttribute("href")).toBeNull();
    expect(link.getAttribute("aria-disabled")).toBe("true");
    view.rerender(<DownloadLink href="/api/download">下载正式 JSON</DownloadLink>);
    expect(link.getAttribute("href")).toBe("/api/download");
    expect(link.hasAttribute("download")).toBe(true);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
