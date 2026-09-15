import { Prompts } from "@ant-design/x";
import { AuditOutlined, EditOutlined, SearchOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { createExampleRequest, type RequestKind, type WorkbenchRequest } from "../intent.js";

export function StarterPrompts({ onSelect, marketplace = "us", disabled = false }: {
  onSelect: (request: WorkbenchRequest) => void;
  marketplace?: string;
  disabled?: boolean;
}) {
  return <Prompts className="starter-prompts" wrap items={[
    { key: "research", icon: <SearchOutlined />, label: "研究关键词", description: `portable blender · Amazon ${marketplace.toUpperCase()}`, disabled },
    { key: "listing-create", icon: <EditOutlined />, label: "生成 Listing", description: "使用示例产品，生成完整文案", disabled },
    { key: "listing-audit", icon: <AuditOutlined />, label: "审计 Listing", description: "查看八维评分与关键词覆盖", disabled },
    { key: "pipeline", icon: <ThunderboltOutlined />, label: "一键流水线", description: "先研究，再生成 Listing", disabled },
  ].map((item) => ({ ...item, label: <button type="button" className="prompt-label-button" disabled={disabled}>{item.label}</button> }))}
    onItemClick={({ data }) => onSelect(createExampleRequest(data.key as RequestKind, marketplace))} />;
}
