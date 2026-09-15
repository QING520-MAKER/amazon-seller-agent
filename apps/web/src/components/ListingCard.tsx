import { Tag } from "antd";
import type { ListingResult } from "../../../../src/schemas";
import { AuditCard } from "./AuditCard";
import { CoverageDetails } from "./CoverageDetails";
import { ResultActions } from "./ResultActions";

function BulletText({ text }: { text: string }) {
  const separator = text.indexOf(" — ");
  return separator === -1 ? <>{text}</> : <><strong>{text.slice(0, separator)}</strong> — {text.slice(separator + 3)}</>;
}

export function ListingCard({ result }: { result: ListingResult }) {
  const { listing } = result;
  return (
    <div className="result-card listing-card">
      {result.audit ? <AuditCard audit={result.audit} /> : null}
      <div className="result-section-heading">
        <span className="section-label">{result.audit ? "返回的 Listing 文案" : "Listing 文案"}</span>
        <Tag color="blue">{listing.bullets.length} 条 bullet</Tag>
      </div>
      {result.audit ? <p className="muted">提供产品资料时，文案会按资料改写；上方审计分数保留原文评估，下方为返回文案的覆盖率。</p> : null}
      <section className="result-section listing-title-section">
        <div className="result-section-heading"><span className="section-label">标题 / Title</span><span className="muted">{listing.title.length} / 200</span></div>
        <h3 className="result-heading listing-title">{listing.title || "未提供标题"}</h3>
      </section>
      <section className="result-section">
        <span className="section-label">五点 / Bullet points</span>
        {listing.bullets.length > 0 ? <ol className="listing-bullets">
          {listing.bullets.map((bullet, index) => <li key={index}><BulletText text={bullet} /></li>)}
        </ol> : <p className="muted">未提供五点文案。</p>}
      </section>
      <section className="result-section">
        <div className="result-section-heading"><span className="section-label">描述 / Description</span><span className="muted">{listing.description.length} / 2000</span></div>
        <p className="listing-description">{listing.description || "未提供描述。"}</p>
      </section>
      <section className="result-section">
        <div className="result-section-heading"><span className="section-label">后台搜索词 / Backend terms</span><span className="muted">{new TextEncoder().encode(listing.backendSearchTerms.join(" ")).byteLength} / 249 bytes</span></div>
        <div className="backend-terms">
          {listing.backendSearchTerms.length > 0
            ? listing.backendSearchTerms.map((term, index) => <Tag key={`${term}-${index}`}>{term}</Tag>)
            : <span className="muted">无剩余后台搜索词。</span>}
        </div>
      </section>
      <CoverageDetails coverage={result.coverage} />
      <ResultActions result={result} />
    </div>
  );
}
