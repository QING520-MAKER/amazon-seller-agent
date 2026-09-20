import type { MissingField, ProductRevision } from "../../../../src/schemas.js";
export const missingLabels: Record<MissingField, string> = {
  attributes: "属性 / 规格", features: "卖点事实", included: "包装清单", sourceNote: "来源说明", originalAssets: "原图",
};
export const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
export function MissingFields({ fields }: { fields: MissingField[] }) {
  return <span className="products-missing">{fields.length ? fields.map(field => missingLabels[field]).join("、") + "尚未填写或上传" : "暂无固定缺项；资料真实性仍需人工核实"}</span>;
}
export function RevisionFacts({ revision }: { revision: ProductRevision }) {
  return <dl className="products-facts">
    <dt>名称</dt><dd>{revision.brief.name}</dd><dt>品牌</dt><dd>{revision.brief.brand || "尚未填写"}</dd>
    {(["attributes", "features", "useCases", "included"] as const).map(key => <div className="products-fact-group" key={key}>
      <dt>{{ attributes: "属性 / 规格", features: "卖点事实", useCases: "使用场景", included: "包装清单" }[key]}</dt>
      <dd>{revision.brief[key].length ? <ul>{revision.brief[key].map((text, i) => <li key={i}>{text}</li>)}</ul> : "尚未填写"}</dd>
    </div>)}
    <dt>适用人群</dt><dd>{revision.brief.audience || "尚未填写"}</dd>
    <dt>写作偏好</dt><dd>{{ professional: "专业", friendly: "友好", urgent: "紧迫", luxury: "高端" }[revision.brief.tone]}（不是商品事实）</dd>
    <dt>来源 / 待确认说明</dt><dd>{revision.sourceNote || "尚未填写"}</dd>
  </dl>;
}
