import { CheckOutlined, MinusOutlined } from "@ant-design/icons";
import { Collapse, Progress, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import type { CoverageReport, CoverageRow } from "../../../../src/schemas";

const statuses = {
  covered: { color: "success", label: "全字段 · covered" },
  partial: { color: "processing", label: "部分字段 · partial" },
  missing: { color: "default", label: "未覆盖 · missing" },
} as const;

function MatchIndicator({ matched }: { matched: boolean }) {
  return matched ? <CheckOutlined aria-label="已匹配" /> : <MinusOutlined aria-label="未匹配" />;
}

const columns: TableColumnsType<CoverageRow> = [
  { title: "关键词", dataIndex: "keyword", key: "keyword", width: 230 },
  { title: "标题", dataIndex: "inTitle", key: "title", width: 65, align: "center", render: (value: boolean) => <MatchIndicator matched={value} /> },
  { title: "五点", dataIndex: "inBullets", key: "bullets", width: 65, align: "center", render: (value: boolean) => <MatchIndicator matched={value} /> },
  { title: "描述", dataIndex: "inDescription", key: "description", width: 65, align: "center", render: (value: boolean) => <MatchIndicator matched={value} /> },
  {
    title: "状态", dataIndex: "status", key: "status", width: 165,
    render: (status: CoverageRow["status"]) => <Tag color={statuses[status].color}>{statuses[status].label}</Tag>,
  },
];

export function CoverageDetails({ coverage }: { coverage: CoverageReport }) {
  return (
    <section className="result-section coverage-details" aria-label="关键词覆盖率">
      <div className="result-section-heading">
        <span className="section-label">关键词覆盖率</span>
        <span className="muted">{coverage.rows.length} 个目标词 · {coverage.uncovered.length} 个未覆盖</span>
      </div>
      <Progress
        percent={coverage.coveragePct}
        format={() => `${coverage.coveragePct}%`}
        strokeColor="#315efb"
        aria-label={`关键词覆盖率 ${coverage.coveragePct}%`}
      />
      <p className="muted coverage-note">
        {coverage.rows.length === 0
          ? "未提供目标关键词，暂无法评估覆盖情况。"
          : "标题、五点或描述中出现即计入覆盖率；partial 表示仅部分字段出现。后台搜索词不计入。"}
      </p>
      <Collapse
        ghost
        size="small"
        items={[{
          key: "coverage",
          label: "查看关键词覆盖明细",
          children: <Table<CoverageRow>
            size="small"
            rowKey="keyword"
            columns={columns}
            dataSource={coverage.rows}
            scroll={{ x: 590 }}
            pagination={coverage.rows.length > 10 ? { pageSize: 10, showSizeChanger: false, size: "small" } : false}
            locale={{ emptyText: "暂无目标关键词" }}
          />,
        }]}
      />
    </section>
  );
}
