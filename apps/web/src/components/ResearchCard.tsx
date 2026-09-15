import { Collapse, Progress, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import type { Keyword, ResearchReport } from "../../../../src/schemas";
import { ResultActions } from "./ResultActions";

const intents = {
  commercial: { color: "blue", label: "购买意图" },
  informational: { color: "cyan", label: "信息意图" },
  niche: { color: "default", label: "细分需求" },
} as const;
const nicheLabels = { low: "低", medium: "中", high: "高" } as const;

const columns: TableColumnsType<Keyword> = [
  { title: "关键词", dataIndex: "phrase", key: "phrase" },
  {
    title: "意图 / intent", dataIndex: "intent", key: "intent", width: 200,
    render: (intent: Keyword["intent"]) => <Tag color={intents[intent].color}>{intents[intent].label} · {intent}</Tag>,
  },
];

export function ResearchCard({ report }: { report: ResearchReport }) {
  return (
    <div className="result-card research-card">
      <div className="result-section-heading">
        <span className="section-label">关键词研究</span>
        <Tag color="blue">Amazon {report.marketplace.toUpperCase()}</Tag>
      </div>
      <h3 className="result-heading">{report.keyword}</h3>

      <div className="research-summary">
        <Progress
          type="circle"
          percent={report.opportunity.total * 10}
          size={82}
          strokeColor="#315efb"
          format={() => <span className="score-value">{report.opportunity.total}<small> / 10</small></span>}
          aria-label={`机会分 ${report.opportunity.total} / 10`}
        />
        <div>
          <strong>选词机会分</strong>
          <p className="muted">来自长尾数量与关键词意图，仅用于探索方向。</p>
          <div className="research-meta">
            <Tag>{report.keywords.length} 个关键词</Tag>
            <Tag>细分潜力：{nicheLabels[report.opportunity.nichePotential]}</Tag>
          </div>
        </div>
      </div>

      <section className="result-section">
        <div className="result-section-heading"><span className="section-label">关键词与意图</span><span className="muted">公开补全结果</span></div>
        <Table<Keyword>
          size="small"
          rowKey="phrase"
          columns={columns}
          dataSource={report.keywords}
          pagination={report.keywords.length > 8 ? { pageSize: 8, showSizeChanger: false, size: "small" } : false}
          scroll={{ x: 470 }}
          locale={{ emptyText: "补全接口未返回建议，请换一个关键词再试。" }}
        />
      </section>

      <section className="result-section signal-note">
        <span className="section-label">数据范围</span>
        <p className="muted">搜索量、BSR、竞品数、价格空间与需求趋势均未采集。机会分不代表实际销量或市场竞争强度。</p>
        <Collapse
          ghost
          size="small"
          items={[{
            key: "reasoning",
            label: "查看评分依据与建议",
            children: <div className="research-evidence">
              <p>{report.opportunity.reasoning}</p>
              <p><strong>下一步建议：</strong>{report.opportunity.recommendation}</p>
              {report.competition.notes ? <p className="muted">{report.competition.notes}</p> : null}
              {report.seasonality.summary ? <p className="muted">{report.seasonality.summary}</p> : null}
            </div>,
          }]}
        />
      </section>
      <ResultActions result={report} />
    </div>
  );
}
