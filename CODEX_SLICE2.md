# Codex 切片 2 开工提示词

把下面「提示词正文」整段复制给 Codex。先打开 `E:\Develop\amazon-seller-agent`。

切片 1（Phase 1 CLI + LangGraph）已完成，不要回退、不要重写契约。

---

## 提示词正文

你在仓库 `E:\Develop\amazon-seller-agent` 做 **切片 2：Ant Design X 工作台 UI**。

切片 1 已完成：TypeScript + LangGraph.js + Zod + CLI `asa`。98 项测试、typecheck、build、四条业务命令都通过。现在只要加一层可运行的对话式前端，**复用现有 graph，不要重写业务**。

先读：`HANDOFF.md`、`src/schemas.ts`、`src/graph/index.ts`、`src/cli.ts`、`examples/*.json`。

### 目标

做一个本地卖家工作台：用户用对话触发 Phase 1 的四条能力。

1. research — 选品关键词研究
2. listing-create — 生成 Listing
3. listing-audit — 审计并改写 Listing
4. pipeline — 研究完直接生成 Listing

样式和交互必须用 **Ant Design X**，不要自己从零画聊天框。

文档：https://x.ant.design/components/introduce/  
包：`@ant-design/x`，并安装 peer：`antd`、`@ant-design/icons`、`react`、`react-dom`。

### 架构（必须遵守）

保持现有 `src/` CLI 和图不动。新增：

```
src/server.ts          # 薄 HTTP，调用 sellerGraph.invoke
apps/web/              # Vite + React + TypeScript + Ant Design X
```

推荐：

- 服务端用 Hono 或 Express，端口 `8787`
- 前端 Vite，端口 `5173`，proxy `/api` → `8787`
- 根目录 `package.json` 增加 `dev:web`、`dev:api`、`dev:ui`（concurrently 前后端）
- 不要改成 Next.js，不要上数据库，不要上登录

API 必须用现有 Zod schema 校验，返回 JSON 与 CLI 同一套类型：

```
POST /api/research        body: ResearchRequestSchema
POST /api/listing-create  body: ListingCreateRequestSchema
POST /api/listing-audit   body: ListingOptimizeRequestSchema
POST /api/pipeline        body: { keyword, marketplace, product }
GET  /api/health
```

全部内部调用 `sellerGraph.invoke`，禁止前端直接打 Amazon 补全接口。

### UI 必须用到的 Ant Design X 组件

用 `XProvider` 包一层（中文 locale + 主题）。页面是左侧会话 + 右侧聊天，不要做成普通后台表单站。

必用：

- `Conversations` 会话列表（研究 / 生成 / 审计 / 一键流水线 可多开）
- `Welcome` 空态欢迎
- `Prompts` 快捷开场，至少 4 条：
  - 研究 `portable blender`（Amazon US）
  - 用 `examples/listing_create.json` 生成 Listing
  - 用 `examples/listing_input.json` 审计 Listing
  - pipeline：研究 portable blender + `examples/product_brief.json`
- `Bubble.List` 展示用户/助手消息；助手气泡里渲染结构化结果，不要只丢一整段 JSON 字符串
- `Sender` 底部输入
- `Suggestion` 或 `Prompts` 给后续追问（换站点、deep 扩词、换语气）
- `Think` 或 `ThoughtChain` 在请求进行中显示步骤：路由意图 → 调 graph → 校验结果
- `Actions` 提供复制标题/五点/描述、下载 JSON

可用 antd 的 `Card`、`Table`、`Tag`、`Progress`、`Typography` 嵌在 Bubble 内容里，展示：

- 研究：机会分、关键词表（intent）、覆盖不编造搜索量
- Listing：标题、5 条 bullet、描述、backend terms、覆盖率
- 审计：8 维分数 + 覆盖率（生成约 100%、审计示例约 20% 是正常值，不要改评分公式去凑数）

不要把 `@ant-design/x-sdk` 的 OpenAI provider 当成主链路。主链路是你们自己的 `/api/*` → `sellerGraph`。SDK 可用，但只能当会话状态辅助，不能绕过 graph。

### 对话协议（做小、做死）

第一版不要做开放域闲聊。`Sender` 提交后按规则路由：

- 含「研究 / research / 选品 / 关键词」→ research
- 含「生成 / create / listing」且无「审计」→ listing-create
- 含「审计 / audit / 优化」→ listing-audit
- 含「pipeline / 一键 / 全流程」→ pipeline
- 点 Prompts 直接带结构化 payload
- 解析不出意图时，助手用 `Prompts` 让用户选，不要胡叫 LLM

缺字段时用 `examples/*.json` 补默认产品/审计样例，并在气泡里注明「使用了示例数据」。

站点默认 `us`，允许用户说 `uk` / `de` 等，走现有 `getMarketplace`。

### 硬限制

- 不要改 `src/schemas.ts` 字段名，不要改 graph 节点名
- 不要破坏现有 CLI；`npm test`、`npm run typecheck`、四条 `npx tsx src/cli.ts ...` 必须继续通过
- 不要引入 Python
- 不要登录 Seller Central，不要抓商品详情页，不要接 SP-API
- 不要做 PPC / FBA / 库存 / 账号体系
- 不要把 Amazon-Skills 整仓拷进来
- 禁止编造搜索量、BSR、竞品数
- 覆盖率继续用现有 `coverageReport`，不要前端重算一套不同规则

### 建议文件

```
src/server.ts
src/http/routes.ts
apps/web/package.json
apps/web/vite.config.ts
apps/web/index.html
apps/web/src/main.tsx
apps/web/src/App.tsx
apps/web/src/theme.tsx          # XProvider
apps/web/src/api.ts             # 调 /api/*
apps/web/src/intent.ts          # 规则路由
apps/web/src/components/Workbench.tsx
apps/web/src/components/ResearchCard.tsx
apps/web/src/components/ListingCard.tsx
apps/web/src/components/AuditCard.tsx
```

根 README 补 UI 启动方式。可新增 `HANDOFF_SLICE2.md`，不要覆盖 Phase 1 的 `HANDOFF.md`。

### 完成标准

```bash
npm test
npm run typecheck
npx tsx src/cli.ts research "portable blender" -m us
npm run dev:ui
```

浏览器打开工作台后人工可点 4 条 Prompts，每条都能在 Bubble 里看到结构化结果（不是报错页、不是纯 JSON 墙）。

实现完后：列出新增/改动文件，说明怎么启动，不要提交 git，除非我明确要求。
