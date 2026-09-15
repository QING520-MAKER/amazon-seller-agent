import { CopyOutlined, DownloadOutlined } from "@ant-design/icons";
import { Actions } from "@ant-design/x";
import { App, Button } from "antd";
import type { ListingResult, ResearchReport } from "../../../../src/schemas";

export function ResultActions({ result }: { result: ResearchReport | ListingResult }) {
  const { message } = App.useApp();

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      void message.success(`${label}已复制`);
    } catch {
      void message.error("复制失败，请允许浏览器访问剪贴板，或下载 JSON 保存结果。");
    }
  }

  function downloadJson() {
    const filename = "listing" in result
      ? `asa-${result.audit ? "listing-audit" : "listing"}.json`
      : `asa-research-${result.marketplace}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Let the browser start the download before releasing its backing Blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const copyItems = "listing" in result ? [
    { key: "title", label: "复制标题", text: result.listing.title },
    { key: "bullets", label: "复制五点", text: result.listing.bullets.join("\n\n") },
    { key: "description", label: "复制描述", text: result.listing.description },
  ] : [{ key: "keywords", label: "复制关键词", text: result.keywords.map((keyword) => keyword.phrase).join("\n") }];

  return (
    <Actions
      className="result-actions"
      aria-label="结果操作"
      items={[
        ...copyItems.map((item) => ({
          key: item.key,
          label: item.label,
          actionRender: <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => void copyText(item.text, item.label.replace("复制", ""))}>{item.label}</Button>,
        })),
        {
          key: "download",
          label: "下载 JSON",
          actionRender: <Button type="text" size="small" icon={<DownloadOutlined />} onClick={downloadJson}>下载 JSON</Button>,
        },
      ]}
    />
  );
}
