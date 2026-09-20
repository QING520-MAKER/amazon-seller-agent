import { useEffect, useState } from "react";
import { Bubble, Conversations, Prompts, Sender, Welcome } from "@ant-design/x";
import {
  CheckCircleOutlined, CodeOutlined, CommentOutlined, CompassOutlined,
  DeleteOutlined, MenuOutlined, PlusOutlined, SendOutlined,
} from "@ant-design/icons";
import { Alert, Badge, Button, Drawer, Input, Modal, Select, Space, Typography } from "antd";
import { MARKETPLACES } from "../../../../src/marketplace.js";
import { ProductBriefSchema } from "../../../../src/schemas.js";
import productExample from "../../../../examples/product_brief.json";
import { checkHealth } from "../api.js";
import { createExampleRequest, parseIntent, REQUEST_LABELS, type RequestKind, type WorkbenchRequest } from "../intent.js";
import type { useWorkbench, ChatMessage } from "../useWorkbench.js";
import { StarterPrompts } from "./StarterPrompts.js";
import { ResearchCard } from "./ResearchCard.js";
import { ListingCard } from "./ListingCard.js";
import { RequestProgress } from "./RequestProgress.js";

const roles = {
  user: { placement: "end" as const, variant: "filled" as const, shape: "round" as const },
  assistant: { placement: "start" as const, variant: "borderless" as const,
    avatar: <span className="assistant-avatar"><CompassOutlined /></span> },
};

interface EditorState { kind: RequestKind; text: string; initial: string; examples: string[] }

export function Workbench({ chat, active = true }: { chat: ReturnType<typeof useWorkbench>; active?: boolean }) {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState("");

  useEffect(() => {
    let active = true;
    void checkHealth().then((result) => { if (active) setHealth(result.status === "ok" ? "online" : "offline"); })
      .catch(() => { if (active) setHealth("offline"); });
    return () => { active = false; };
  }, []);

  function retryHealth() {
    setHealth("checking");
    void checkHealth().then((result) => setHealth(result.status === "ok" ? "online" : "offline"))
      .catch(() => setHealth("offline"));
  }

  function openEditor(request?: WorkbenchRequest) {
    setEditorOpen(true);
    if (!request && editor) return;
    request ??= chat.active.lastRequest ?? createExampleRequest("listing-create", chat.active.marketplace);
    const text = JSON.stringify(request.payload, null, 2);
    setEditor({ kind: request.kind, text, initial: text, examples: request.exampleData });
    setEditorError("");
  }

  function submitEditor() {
    if (!editor) return;
    try {
      const request = parseIntent(`${editor.kind} ${editor.text}`, undefined, chat.active.marketplace);
      if (!request) throw new Error("请选择任务类型。");
      request.exampleData = [...new Set([...request.exampleData, ...editor.examples.map((source) =>
        editor.text === editor.initial ? source : `${source}（基于示例编辑）`)])];
      setEditor(undefined);
      setEditorOpen(false);
      void chat.submitRequest(request, `${REQUEST_LABELS[request.kind]} · 已提交结构化请求`);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "请检查 JSON 内容。");
    }
  }

  function followUp(message: ChatMessage, key: string) {
    const previous = message.request;
    if (!previous) return;
    if (key === "rewrite" && previous.kind === "listing-audit") {
      void chat.submitRequest({ ...previous,
        payload: { ...previous.payload, product: previous.payload.product ?? ProductBriefSchema.parse(productExample) },
        exampleData: previous.payload.product ? previous.exampleData : [...previous.exampleData, "examples/product_brief.json（改写产品）"],
      }, "使用产品 brief 改写这份 Listing，并保留原文审计");
      return;
    }
    if (key === "create" && message.result && "opportunity" in message.result) {
      const request = createExampleRequest("listing-create", previous.payload.marketplace);
      if (request.kind === "listing-create") {
        request.payload.keywords = message.result.keywords.map((item) => item.phrase);
        request.exampleData = request.exampleData.filter((item) => !item.includes("（关键词）"));
        void chat.submitRequest(request, "用本次研究的关键词生成 Listing");
      }
      return;
    }
    const text = key === "market" ? `换站点 ${previous.payload.marketplace === "uk" ? "us" : "uk"}`
      : key === "deep" ? "deep 扩词" : "换成专业语气";
    try {
      const request = parseIntent(text, previous);
      if (request) void chat.submitRequest(request, text);
    } catch (error) {
      chat.addNotice(error instanceof Error ? error.message : "无法执行后续任务。");
    }
  }

  function assistantContent(message: ChatMessage) {
    return <div className="assistant-content">
      {message.request?.exampleData.length ? <div className="example-note">
        <CodeOutlined /> <span>使用了示例数据：{message.request.exampleData.join("、")}</span>
      </div> : null}
      {message.state === "pending" && message.request ? <RequestProgress request={message.request} /> : null}
      {message.text ? <Alert type={message.state === "error" ? "error" : "info"} showIcon title={message.text}
        action={message.state === "error" && message.request ? <Button size="small" onClick={() => void chat.submitRequest(message.request!)} disabled={chat.busy}>重试</Button> : undefined} /> : null}
      {message.state === "choose" ? <StarterPrompts marketplace={chat.active.marketplace} disabled={chat.busy} onSelect={(request) => void chat.submitRequest(request)} /> : null}
      {message.result ? <>
        <div className="completion-label"><CheckCircleOutlined /> 已完成 · 结果校验通过</div>
        {"opportunity" in message.result ? <ResearchCard report={message.result} /> : <ListingCard result={message.result} />}
        <Prompts className="followup-prompts" wrap items={[
          { key: "market", label: `换到 ${message.request?.payload.marketplace === "uk" ? "US" : "UK"} 站点`, disabled: chat.busy },
          ...(message.request?.kind === "research"
            ? [{ key: "deep", label: "deep 扩词", disabled: chat.busy }, { key: "create", label: "用这些词生成 Listing", disabled: chat.busy }]
            : [{ key: "tone", label: "换成专业语气", disabled: chat.busy }]),
          ...(message.request?.kind === "listing-audit" && !message.request.payload.product
            ? [{ key: "rewrite", label: "用产品 brief 改写", disabled: chat.busy }] : []),
        ].map((item) => ({ ...item, label: <button type="button" className="prompt-label-button" disabled={chat.busy}>{item.label}</button> }))}
          onItemClick={({ data }) => followUp(message, data.key)} />
      </> : null}
    </div>;
  }

  const sidebar = <>
    <div className="brand"><span className="brand-mark">ASA</span><span>卖家工作台</span></div>
    <Conversations className="conversation-list" activeKey={chat.activeId}
      creation={{ label: "新建会话", icon: <PlusOutlined />, onClick: () => { chat.createConversation(); setSidebarOpen(false); } }}
      groupable={{ label: "会话" }}
      items={chat.conversations.map((item) => ({ key: item.id, label: item.title, group: "会话", icon: <CommentOutlined />, title: item.title }))}
      onActiveChange={(id) => { chat.setActive(id); setSidebarOpen(false); }}
      menu={(item) => ({ items: [{ key: "delete", label: "删除会话", icon: <DeleteOutlined />, danger: true }],
        onClick: () => chat.removeConversation(item.key) })} />
    <Button type="text" className="workspace-status" onClick={retryHealth} title="检查本地 API 连接">
      <Badge status={health === "online" ? "success" : health === "checking" ? "processing" : "error"} />
      {health === "offline" ? "连接失败 · 点击重试" : health === "checking" ? "正在连接工作空间" : "本地工作空间"}
    </Button>
  </>;

  return <div className="workbench">
    <aside className="sidebar" aria-label="会话列表">{sidebar}</aside>
    <Drawer open={active && sidebarOpen} onClose={() => setSidebarOpen(false)} placement="left" size={280}
      title="会话" className="mobile-sidebar" styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}>{sidebar}</Drawer>
    <main className="chat-panel">
      <header className="chat-header">
        <Button className="sidebar-toggle" type="text" icon={<MenuOutlined />} aria-label="打开会话列表" onClick={() => setSidebarOpen(true)} />
        <Typography.Text strong className="conversation-title" title={chat.active.title}>{chat.active.title}</Typography.Text>
        <Select aria-label="Amazon 站点" className="marketplace-select" value={chat.active.marketplace} disabled={chat.busy}
          options={Object.values(MARKETPLACES).map((market) => ({ value: market.code, label: `Amazon ${market.code.toUpperCase()}` }))}
          onChange={chat.setMarketplace} />
      </header>
      {chat.active.messages.length === 0 ? <div className="welcome-region">
        <div className="welcome-inner">
          <Welcome className="workbench-welcome" variant="borderless" icon={<span className="welcome-icon"><CompassOutlined /></span>}
            title="今天，想让产品更进一步？" description="从关键词研究到 Listing 文案，在对话里完成。" />
          <StarterPrompts marketplace={chat.active.marketplace} onSelect={(request) => void chat.submitRequest(request)} />
        </div>
      </div> : <section className="chat-history" aria-label="对话消息">
        <Bubble.List key={chat.activeId} className="chat-bubbles" autoScroll role={roles}
          items={chat.active.messages.map((message) => ({
            key: message.id,
            role: message.role,
            loading: false,
            content: message.role === "user" ? message.text : assistantContent(message),
          }))} />
      </section>}
      <div className="composer-region">
        {health === "offline" ? <Alert className="connection-alert" showIcon type="warning" title="无法连接本地服务，请运行 npm run dev:ui。" /> : null}
        <Sender value={chat.active.draft} onChange={chat.setDraft} onSubmit={chat.submitText} onCancel={chat.cancel}
          loading={chat.busy} autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder="输入任务，例如：研究 portable blender，站点 us" suffix={false}
          footer={(_, { components: { SendButton, LoadingButton } }) => <div className="sender-footer">
            <Button size="small" icon={<CodeOutlined />} disabled={chat.busy} onClick={() => openEditor()}>编辑请求 JSON</Button>
            {chat.busy ? <LoadingButton aria-label="停止等待" /> : <SendButton type="primary" shape="circle" icon={<SendOutlined />} aria-label="发送任务" />}
          </div>} />
        <div className="composer-hint">提示：支持研究、生成、审计和一键流水线</div>
      </div>
    </main>
    <Modal open={active && editorOpen} title="编辑结构化请求" onCancel={() => setEditorOpen(false)} onOk={submitEditor}
      okText="发送请求" cancelText="暂存并关闭" width={720} destroyOnHidden>
      <Space orientation="vertical" style={{ width: "100%" }} size={14}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>可替换示例中的产品、关键词或 Listing。字段与 CLI 输入相同。</Typography.Paragraph>
        <Select aria-label="任务类型" style={{ width: "100%" }} value={editor?.kind}
          options={Object.entries(REQUEST_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(kind: RequestKind) => openEditor(createExampleRequest(kind, chat.active.marketplace))} />
        <Input.TextArea aria-label="请求 JSON" className="json-editor" value={editor?.text} rows={15}
          onChange={(event) => { setEditor((current) => current ? { ...current, text: event.target.value } : current); setEditorError(""); }} />
        {editorError ? <Alert type="error" showIcon title={editorError} /> : null}
      </Space>
    </Modal>
  </div>;
}
