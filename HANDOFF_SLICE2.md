# 切片 2：Ant Design X 工作台

## 启动

在 `E:\Develop\amazon-seller-agent` 运行 `npm install` 和 `npm run dev:ui`，浏览器打开 `http://127.0.0.1:5173/`。UI 使用 Vite 7（Node 20.19+ / 22.12+），API 使用 Hono，绑定 `127.0.0.1:8787`。根目录为 npm workspace，统一安装依赖即可。

`npm run dev:api` / `npm run dev:web` 可单独启动；`npm run typecheck` 检查两端；`npm run build` 输出现有 CLI 和新增 API，`npm run build:web` 输出 `apps/web/dist`。

## 数据路径

```text
Ant Design X Prompts / Sender
  → 固定规则解析 + 现有示例补默认
  → POST /api/research | listing-create | listing-audit | pipeline
  → 现有请求 schema + getMarketplace
  → sellerGraph.invoke
  → 现有输出 schema
  → Bubble.List 中的结构化结果
```

没有新的业务 graph、评分公式、LLM 主链路、数据库或账号体系。原 `HANDOFF.md` 保留 Phase 1 交接内容。

## 新增文件

| 文件 | 职责 |
|---|---|
| `src/server.ts` | 本地 HTTP 服务入口 |
| `src/http/routes.ts` | 5 个接口、请求/结果校验与 JSON 错误 |
| `apps/web/package.json` | React / Ant Design X / Vite 依赖与脚本 |
| `apps/web/vite.config.ts` | 5173 固定端口与 `/api` 代理 |
| `apps/web/tsconfig.json` | 独立浏览器 TypeScript 配置 |
| `apps/web/index.html` | 中文页面入口 |
| `apps/web/src/main.tsx` | React 挂载 |
| `apps/web/src/App.tsx` | 工作台组合入口 |
| `apps/web/src/theme.tsx` | XProvider 中文 locale / 主题 / antd App |
| `apps/web/src/styles.css` | 桌面双栏、移动侧栏、结果与输入区样式 |
| `apps/web/src/intent.ts` | 四类规则路由、示例元数据、站点/语气/deep 跟进 |
| `apps/web/src/api.ts` | 同源 API 客户端、响应 Zod 校验 |
| `apps/web/src/useWorkbench.ts` | 会话隔离、消息状态、取消和重试 |
| `apps/web/src/components/Workbench.tsx` | Conversations / Bubble.List / Sender、JSON 编辑器 |
| `apps/web/src/components/StarterPrompts.tsx` | 四种可键盘操作的快捷开场 |
| `apps/web/src/components/RequestProgress.tsx` | ThoughtChain 执行步骤 |
| `apps/web/src/components/ResearchCard.tsx` | 关键词表、机会分与数据来源说明 |
| `apps/web/src/components/ListingCard.tsx` | 标题、五点、描述、backend 与覆盖率 |
| `apps/web/src/components/AuditCard.tsx` | 原文八维审计和 notes |
| `apps/web/src/components/CoverageDetails.tsx` | 直接呈现现有覆盖率及匹配明细 |
| `apps/web/src/components/ResultActions.tsx` | Ant Design X Actions 复制 / JSON 下载 |
| `tests/http.test.ts` | 真实 graph + mock fetch 的 HTTP 集成 |
| `tests/intent.test.ts` | 意图优先级、默认值、自有 JSON 与跟进 |
| `tests/web-api.test.ts` | API 路径、契约、错误与取消 |
| `tests/workbench-state.test.ts` | 会话并发、取消竞态与响应隔离 |
| `tests/result-actions.test.ts` | 剪贴板与下载 JSON 内容/文件名 |
| `HANDOFF_SLICE2.md` | 本文 |

改动既有文件：`package.json`（workspace、脚本、依赖）、`package-lock.json`、`README.md`。现有 CLI / schemas / graph / provider / scoring / copywriting / examples / contracts.test.ts 未改。

## 关键语义

- 四条 Prompts 直接带结构化 payload；Sender 仅做固定规则，不做开放聊天。
- 新意图优先级：pipeline → audit → research → create。纯跟进只在已有相应任务时执行。
- 站点与产品默认来源均可见；基于示例 JSON 编辑后仍保留来源提示。
- research 返回 ResearchReport；其余返回 ListingResult。pipeline 的研究报告仍在 graph state 内，HTTP 与 CLI 一样只返回最终 ListingResult。
- audit 未提供 product 时返回原文。提供 product 时保留 `audit` 和 `audit.coverage` 的原文评分，`listing` / 顶层 `coverage` 描述改写后的文案。
- 覆盖率一律读响应的 `coveragePct`，不在前端重算。Progress 圆环只将机会分与维度分换算为绘图比例。
- 缺失数据说明保持 Phase 1 语义；不展示虚构搜索量、BSR 或竞品数。
- 会话仅在页面内存中保存。取消只停止等待，不保证取消服务端已发出的补全请求。
- HTTP 集成测试及其他自动化测试不触达真实 Amazon。浏览器验收与显式 CLI 回归可以调用公开补全接口。

## 验收入口

从空会话分别点击研究 / 生成 / 审计 / 流水线，确认结构化卡片；再检查审计改写、站点/语气跟进、自有 JSON、错误提示和复制操作。参考样例覆盖率为生成 100%、原文审计 20%；研究补全随时间变化，pipeline 覆盖率不应写死。

## 本次验收结果

- `npm install`、`npm test`（11 个文件、177 项测试）、`npm run typecheck`、`npm run build`、`npm run build:web` 全部通过。
- 四条 CLI 业务命令均退出 0，输出可解析为 JSON。研究得到 23 个词；生成覆盖率 100%；审计总分 49、覆盖率 20%；pipeline 覆盖率 21.74%，均来自实际计算。
- `npm run dev:ui` 启动后，浏览器四条 Prompts 均完成并呈现结构化卡片。还验证了示例提示、原文审计与改写结果区分、未知意图选择、自有 JSON、语气跟进、UK 站点切换、复制标题/五点/描述。
- 桌面 1440×900 与移动 390×844 验收通过，移动端无横向溢出，侧栏抽屉可新建会话；浏览器控制台无警告或错误。
- 下载按钮已点击且无页面错误；内嵌浏览器未提供可确认的下载完成事件。8 项 Actions 测试验证了复制、完整 JSON Blob、文件名、下载触发和 URL 清理。
- UI 生产包约 1.24 MB（gzip 393 KB），Vite 提示超过 500 KB；构建成功。jsdom 中 Ant Design X 的 Notification API 提示为环境限制，测试通过。
- 现有业务源码哈希与切片 2 开始前一致；未执行 git 提交。
