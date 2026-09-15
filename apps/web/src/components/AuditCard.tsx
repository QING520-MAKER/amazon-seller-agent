import { Collapse, Progress, Tag } from "antd";
import type { ListingAudit } from "../../../../src/schemas";
import { CoverageDetails } from "./CoverageDetails";

const dimensionLabels: Record<string, string> = {
  Title: "标题", Bullets: "五点", Images: "图片", "A+": "A+ 内容",
  Description: "描述", Pricing: "定价", Reviews: "评价", SEO: "SEO",
};

export function AuditCard({ audit }: { audit: ListingAudit }) {
  return (
    <div className="result-card audit-card">
      <div className="result-section-heading">
        <span className="section-label">原 Listing 审计</span>
        <Tag>8 个维度</Tag>
      </div>
      <div className="audit-summary">
        <Progress
          type="circle"
          percent={audit.total}
          size={82}
          strokeColor="#315efb"
          format={() => <span className="score-value">{audit.total}<small> / 100</small></span>}
          aria-label={`原 Listing 审计总分 ${audit.total} / 100`}
        />
        <div>
          <h3 className="result-heading">8 维质量评分</h3>
          <p className="muted">评分针对提交的原文与信息。缺失字段保守计分，展开各维度查看依据。</p>
        </div>
      </div>
      <Collapse
        className="audit-dimensions"
        size="small"
        items={audit.dimensions.map((dimension) => ({
          key: dimension.name,
          label: <div className="dimension-label">
            <span>{dimensionLabels[dimension.name] ?? dimension.name} <span className="muted">{dimension.name}</span></span>
            <strong>{dimension.score}<span className="muted"> / {dimension.maxScore}</span></strong>
          </div>,
          children: <div>
            <Progress percent={dimension.maxScore > 0 ? dimension.score / dimension.maxScore * 100 : 0} showInfo={false} strokeColor="#315efb" size="small" />
            <p className="muted">{dimension.notes || "此维度未提供额外说明。"}</p>
          </div>,
        }))}
      />
      <CoverageDetails coverage={audit.coverage} />
    </div>
  );
}
