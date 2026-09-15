# Amazon Seller Agent

TypeScript + **LangGraph.js** CLI for Amazon seller **keyword research** and **listing create/audit**.  
Phase 1 implements public autocomplete research and local template-based listing creation/auditing, with frozen Zod contracts.

## First-step summary

| Item | Decision |
|---|---|
| Path | `E:\Develop\amazon-seller-agent` |
| Stack | Node 20+, TypeScript, Zod, `@langchain/langgraph` |
| Phase 1 | Research + Listing only (no PPC, no FBA ops) |
| Data | Public Amazon autocomplete + user-supplied listing JSON |
| Not in phase 1 | Seller Central login, product-page scrape, SP-API writes |
| Reference | [Amazon-Skills](https://github.com/nexscope-ai/Amazon-Skills) (MIT) |
| Later API | [amz-tools/amazon-sp-api](https://github.com/amz-tools/amazon-sp-api) |

Codex handoff: [`HANDOFF.md`](HANDOFF.md)

## Graph

```
START
  ├─ runResearch ───────► END
  ├─ createListing ─────► END
  ├─ auditListing ──────► END
  └─ pipeline → runResearch → createListing → END
```

## Commands

```powershell
npm install
npm test
npm run typecheck
npx tsx src/cli.ts --help
npx tsx src/cli.ts research "portable blender" -m us --out reports/research.json
npx tsx src/cli.ts listing-create -i examples/listing_create.json
npx tsx src/cli.ts listing-audit -i examples/listing_input.json
npx tsx src/cli.ts pipeline "portable blender" -p examples/product_brief.json
```

Use `npm run asa -- <command>` for the local CLI, or `npm run build` to emit `dist/cli.js` (the `asa` package entry point).

## 切片 2：Ant Design X 对话工作台

在仓库根目录启动（UI 工具链需要 Node 20.19+ 或 Node 22.12+）：

```powershell
npm install
npm run dev:ui
```

打开 **http://127.0.0.1:5173/**。Vite 将 `/api` 代理到本地 Hono 服务 `127.0.0.1:8787`。两个端口必须空闲；`Ctrl+C` 同时停止前后端。也可分别运行 `npm run dev:api`、`npm run dev:web`。`npm run typecheck` 同时检查服务端与前端；`npm run build:web` 构建 UI，原有 `npm run build` 继续构建 CLI/API。

工作台使用 [Ant Design X](https://x.ant.design/components/introduce/) 的 XProvider、Conversations、Welcome、Prompts、Bubble.List、Sender、ThoughtChain 和 Actions。会话保存在当前页面内存中，刷新会清空；可以新建、切换和删除多个会话，各会话请求互不覆盖。

- 点四条快捷开场即可研究、生成、审计或运行流水线。示例来源在助手气泡内显示，评分和覆盖率直接展示现有 graph 的输出。
- Sender 示例：`研究 portable blender，站点 us`、`research "travel mug" uk deep`、`生成 Listing`、`审计 Listing`、`pipeline portable blender`。无法识别的输入会返回任务选择，不调用开放域 LLM。
- 后续可输入 `换站点 uk`、研究后 `deep 扩词` / `关闭 deep`、生成或审计后 `换成专业语气`。研究结果还可以直接用于生成；审计后选择“用产品 brief 改写”保留原文审计并返回新文案。
- “编辑请求 JSON”可提交自有产品或 Listing；也支持 `listing-create { ... }` 等命令加完整 JSON。缺失顶层产品/关键词/审计数据才使用示例补齐；字段类型错误会明确提示。显式站点优先于会话默认站点。
- Actions 支持复制标题、五点、描述、关键词和下载原始 JSON。停止按钮停止前端等待；已发出的 graph 任务可能仍在服务端完成。

| API | 请求契约 | 成功响应 |
|---|---|---|
| `GET /api/health` | 无 | `{ "status": "ok" }` |
| `POST /api/research` | `ResearchRequestSchema` | `ResearchReport` |
| `POST /api/listing-create` | `ListingCreateRequestSchema` | `ListingResult` |
| `POST /api/listing-audit` | `ListingOptimizeRequestSchema` | `ListingResult` |
| `POST /api/pipeline` | `{ keyword, marketplace, product }`，组合现有 schema | `ListingResult` |

POST 需 `Content-Type: application/json`。错误统一返回 `{ error: { code, message, issues? } }`；请求 JSON/字段/站点错误不会调用 graph。前端只访问 `/api`，补全请求由既有 graph 完成。图、CLI、评分公式和契约保持切片 1 实现。切片 2 文件清单见 [HANDOFF_SLICE2.md](HANDOFF_SLICE2.md)。

## Output and scoring

- Research requests the seed, `best `, `cheap ` and `top ` prefixes. `--deep` adds 26 alphabet extensions; `--compare` pools suggestions from additional seeds. Requests are serialized with the configured delay and timeout. HTTP or response errors fail the command; no synthetic suggestions are substituted.
- Research outputs `ResearchReport`; create/audit/pipeline output `ListingResult`. Pipeline retains the research report in graph state and uses its keyword phrases for generation.
- Coverage is a case-insensitive substring check of title, individual bullets and description. `covered` means all three areas; `partial` means some; `missing` means none. `coveragePct` counts unique, nonblank keywords appearing in **at least one** area, rounded to two decimals. An empty keyword set returns 0. Backend terms do not contribute to visible coverage; `uncovered` lists missing phrases.
- Opportunity is an integer 1–10 heuristic: `round(1 + min(5, longTailCount / 4) + 4 * (commercialRatio + 0.5 * nicheRatio))`. Long tails contain the seed and have at least three words and more words than the seed. Competition, pricing and historical demand data are unavailable. The frozen `competitionDensity` enum has no `unknown`: `medium` is a documented neutral placeholder, not an observed density.
- Audit weights are Title 15, Bullets 15, Images 15, A+ 10, Description 10, Pricing 10, Reviews 15 and SEO 10. Each dimension explains its rubric in `notes`; missing information earns no evidence-based credit. Pricing earns at most 5 without comparison/cost data. Image count and A+ presence are user-reported; their quality is not inspected.
- Audit without `product` returns the supplied copy and its audit. With a `product` brief it also generates a replacement: `audit` (including `audit.coverage`) still describes the original input, while top-level `coverage` describes the returned copy.

## Generation

Templates use supplied product facts and keywords. They produce a title ≤200 characters, exactly five `BENEFIT HEADER — body` bullets ≤500 each, and a description ≤2000. The brand and primary keyword must fit the title together; otherwise generation reports an input error. Remaining phrases go into backend terms as complete phrases, up to 249 UTF-8 bytes **including joining spaces**; phrases that cannot fit are omitted. If no keywords are supplied, the product name is used in the copy and target-keyword coverage remains 0.

The CLI always uses local templates. Programmatic callers can request polishing with `generateListing(product, keywords, { useLlm: true })`; this also requires `OPENAI_API_KEY`. Optional `OPENAI_BASE_URL` and `OPENAI_MODEL` come from settings. Failed or invalid rewrites fall back to the template. Research suggestions are candidate search phrases; their relevance to a product is not independently verified.

## Tests

`npm test` blocks unmocked fetch calls by default. Provider and graph tests mock autocomplete; CLI subprocess tests preload a TypeScript fetch fixture. Optional LLM tests mock `@langchain/openai`. CI never needs an Amazon connection or API key. The CLI tests parse stdout with the frozen Zod schemas and check that `--out` matches stdout.

切片 2 新增真实 graph 的 HTTP 路由测试、对话规则/API 客户端测试、React 会话状态测试，以及复制/下载动作的 DOM 测试；外部请求全部 mock。浏览器中的手工验收使用本地 API，可访问公开补全接口。

## Constraints

- Do not invent search volume, BSR, or competitor counts.
- Default listing copy is template-based; LLM requires explicit programmatic opt-in and an API key.
- Title ≤ 200, bullets ≤ 500 each, description ≤ 2000.
