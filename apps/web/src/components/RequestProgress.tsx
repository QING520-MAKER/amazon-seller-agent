import { ThoughtChain } from "@ant-design/x";
import { ClockCircleOutlined } from "@ant-design/icons";
import { REQUEST_LABELS, type WorkbenchRequest } from "../intent.js";

export function RequestProgress({ request }: { request: WorkbenchRequest }) {
  return <div role="status" aria-live="polite" className="request-progress">
    <ThoughtChain items={[
      { key: "route", title: "路由意图", description: REQUEST_LABELS[request.kind], status: "success" },
      { key: "graph", title: "调用 graph", description: request.kind === "pipeline" ? "正在依次完成关键词研究与 Listing 生成" : "正在执行任务，请稍候", status: "loading" },
      { key: "validate", title: "校验结果", description: "收到结果后，按现有契约校验", icon: <ClockCircleOutlined /> },
    ]} />
  </div>;
}
