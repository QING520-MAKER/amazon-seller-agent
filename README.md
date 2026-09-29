# Amazon Seller Agent

TypeScript + **LangGraph.js** CLI for Amazon seller **keyword research** and **listing create/audit**.  
Phase 1 implements public autocomplete research and local template-based listing creation/auditing, with frozen Zod contracts.

项目业务介绍见 [PROJECT_BRIEF.md](PROJECT_BRIEF.md)。2026-09-29 已实现本地图文工作台 S4—S7：知识、文案、批量任务、本地卖点图和图文交付包；外部图片服务、多站点本地化、Amazon 发布仍待后续接入。最新验收和限制见 [HANDOFF_STUDIO.md](HANDOFF_STUDIO.md)。

## 本地图文工作台（S4—S7）

启动 `npm run dev:ui`，在商品详情中依次使用以下功能：

1. 录入商品事实、原图与知识。知识支持手动输入、UTF-8 `.txt` / `.md` 导入、搜索、版本历史和人工确认；每条知识限定当前商品，最多选择 20 条已确认版本作为依据。
2. 输入或从关键词研究选择真实关键词，生成 US 英文模板文案；编辑保存新版本，再人工批准或退回。标题、Item Highlights、五点、描述、后台词分别校验。AI 模式仅在服务端明确配置后调用。
3. 选择原图、标题和最多三条文字，使用左右分栏或上下堆叠 v2 模板生成真实 1600×1600 PNG 卖点图；查看 96px 安全区示意和溢出提示，再并排核对原图与候选、批准具体版本。本地排版等比保留原图，不生成新场景。场景模式提供适配接口，未配置时会记录失败原因。
4. 选择具体文案、图片版本和图片顺序，制作草稿或正式包。ZIP 含文案、PNG/JPEG、固定依据清单与审核快照。正式创建及下载都会重查审核和依据是否有效，旧包不会跟随最新文案变化。
5. “批量任务”支持最多 20 个商品的逐项模板/模型任务，以及 JSON 商品导入。创建和执行分开；失败项通过明确新建批次重试。重启不自动重放可能收费的请求。导入结构见 [examples/product_import.json](examples/product_import.json)，请替换占位资料。

本地模板和排版不需要生成服务 API。文字/图片适配说明见 [PROVIDER_ADAPTERS.md](docs/architecture/PROVIDER_ADAPTERS.md)。开发用 Astra/Luna 配置与产品运行时 API 相互独立；不可把 Codex 登录权限当作产品生成额度。

文案、图片、运行记录、批次及内容包均支持分页；翻页保留正在编辑的内容、审核备注和已选版本，内容包的文案/图片选择也支持跨页。JSON、PNG/JPEG 和 ZIP 使用浏览器原生附件下载，服务器在每次正式导出时仍核对具体版本。图片方案记录模板版本；历史方案不会自动改成 v2，修改文字或布局需生成新的待审候选。

工程设计见 [CONTENT_STUDIO.md](docs/architecture/CONTENT_STUDIO.md)，[协作规范](docs/agents/collaboration.md)和[项目 skills](docs/agents/skills.md)，[GitHub 固定提交与许可证核查](docs/research/OPEN_SOURCE_REFERENCES.md)。本轮借鉴结构和设计，没有复制上游源码或引入额外运行时。

## First-step summary

| Item | Decision |
|---|---|
| Path | `E:\Develop\amazon-seller-agent` |
| Stack | Node `^20.19.0 \|\| >=22.12.0`（实测 22.23.2）, TypeScript, Zod, `@langchain/langgraph` |
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

打开 **http://127.0.0.1:5173/**，在顶部选择“对话工作台”（默认进入商品库）。Vite 将 `/api` 代理到本地 Hono 服务 `127.0.0.1:8787`。两个端口必须空闲；`Ctrl+C` 同时停止开发前后端。也可分别运行 `npm run dev:api`、`npm run dev:web`。Windows 的 watch 重启可能强制结束子进程，备份应使用下面的正常停服流程。`npm run typecheck` 同时检查服务端与前端；`npm run build:web` 构建 UI，原有 `npm run build` 继续构建 CLI/API。

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

## 切片 3：商品资料与原图

商品库支持搜索、新建、完整资料编辑、不可变历史版本，以及 JPEG/PNG 原图上传、预览、下载、移除与恢复。仅 SKU 和名称必填；空事实保持为空。SKU 去除首尾空白、区分大小写，新建后只读。资料保存不代表事实已经核实；历史资料版本展示的是当时快照，原图库始终展示当前素材状态。

两个窗口修改同一版本时，后保存者收到冲突；页面保留草稿，可查看服务器最新资料、复制本地草稿或明确放弃后重新载入。相同正文保存不追加版本。上传按商品与原始 SHA-256 去重，移除后的相同文件重传仍保持移除状态，需要显式恢复。网络中断时显示“保存结果待确认”，重试前核对服务器记录。

### 安装与运行

本机验收：Windows 11 x64（10.0.26200）、Node 22.23.2、npm 11.17.0；没有验证 Windows 10 或 Node 20。根 engines 从宽泛的 `>=20` 改为与已有 Vite 工具链一致的 `^20.19.0 || >=22.12.0`，不代表这些版本均已实测。推荐采用本次实测的 Node 22 环境。

```powershell
Set-Location E:\Develop\amazon-seller-agent
npm ci
npm run build
$env:ASA_DATA_DIR = 'E:\AmazonSellerAgentData'
npm run start:api
```

另一个 PowerShell 窗口执行 `npm run dev:web`，打开 **http://127.0.0.1:5173/**。`start:api` 使用编译产物，不自动监视源码；修改 API 后需要重新构建并重启。需要同时监视源码时使用 `npm run dev:ui`。

依赖固定为 `better-sqlite3@12.11.1`、`sharp@0.35.4`；实测 SQLite 3.53.2。干净目录 `npm ci` 和原生模块加载均已通过。npm 11.17 可能提示安装脚本尚未登记 allowScripts；本机实际仍成功安装。若所在环境禁用了依赖安装脚本，应按日志处理原生预编译安装，再验证模块能加载；不要回退到内存数据或另加 Python 编译链。镜像下载失败时可命令级使用 `npm ci --registry=https://registry.npmjs.org --cache=E:\CodexTemp\npm-cache`，无需改全局设置。

### 数据目录与停服备份

`ASA_DATA_DIR` 可放在 `.env` 或进程环境变量，推荐本机 E 盘普通目录。未配置时使用应用根目录的 `data`，与启动 cwd 无关。启动日志显示实际路径。目录包含 `catalog.sqlite`、`originals/<productId>/<assetId>.jpg|png`、`derived/<productId>/<imageId>.jpg|png`、`tmp`、`recovery`，不能作为静态网站暴露，也不要放到网络共享或同步目录。知识、文案、任务、审核、内容包清单在 SQLite 内；备份必须包含整个目录及派生图片。当前数据库 schema v7；旧库依次事务升级，未知版本拒绝，升级失败保留原数据。升级前按下面步骤备份；新库不能交给只认识旧 schema 的旧版本程序。

正常停服：在 `npm run start:api` 的窗口输入 **`stop` 后回车**。等待 `Storage closed; safe to back up the complete data directory.` 和进程退出。应用会拒绝新业务请求、等待在途操作、checkpoint/关闭数据库，最后释放端口。

确认服务已退出后，使用下面的数据工具备份整个目录。恢复后核对商品、版本和原图下载 SHA-256，再决定使用哪个目录。不要只复制正在运行的 SQLite 主文件，不要手工删除 WAL。若此前强制关闭开发 watch，先以 `start:api` 打开同一目录完成恢复检查，再输入 `stop` 正常关闭后备份。

### 带清单校验的备份与恢复

使用随 API 构建的 TypeScript 数据工具。先执行 `npm run build`，按上文输入 `stop` 正常停服；目标父目录要已存在，目标目录本身必须不存在。以下命令支持路径含空格：

```powershell
New-Item -ItemType Directory -Path 'E:\AmazonSellerAgentBackups' -Force | Out-Null
node dist/data-cli.js backup --source 'E:\AmazonSellerAgentData' --destination 'E:\AmazonSellerAgentBackups\backup-20260929'
node dist/data-cli.js verify --source 'E:\AmazonSellerAgentBackups\backup-20260929'
node dist/data-cli.js restore --source 'E:\AmazonSellerAgentBackups\backup-20260929' --destination 'E:\AmazonSellerAgentRestored'
$env:ASA_DATA_DIR = 'E:\AmazonSellerAgentRestored'
npm run start:api
```

备份目录包含 `manifest.json` 与完整 `data` 子目录。工具检查 SQLite 完整性和已知迁移版本，为每个文件保存大小及 SHA-256，恢复到新目录后再次校验。操作期间占用本地 API 的 8787 端口：运行中的 API 会使操作拒绝，操作期间也不能启动新 API。目录联接/符号链接、相互嵌套的源目标、已有目标和未清空 WAL 均拒绝。数据库检查使用临时副本，避免只读连接也生成 WAL/SHM 而改变源目录；本机临时目录应保持为 `E:\CodexTemp`。

工具不删除或覆盖原库。失败时可能留下未完成的新目录；保留它用于排查并换一个新目标重试，未完成备份不能恢复。备份清单用于发现损坏，不提供签名、防篡改认证或加密。请让其他数据库编辑工具也保持关闭，确保目标磁盘能容纳整库和验证临时副本。

应用启动先绑定固定 `127.0.0.1:8787`，绑定失败的第二实例不会打开存储。初始化期间统一返回 503；未知迁移版本会启动失败并保留原库。SQLite 使用外键、WAL、FULL 和 3000ms busy timeout。恢复扫描保留孤立/中断文件并记录到 `recovery`；已登记原图丢失或损坏会明确报错，不自动删记录或补图。

### 新增 API 与容量

全部接口位于 `/api/products`，完整契约见 `src/schemas.ts`。列表默认 20 条，支持 `limit=1..100`、非负 `offset`；商品搜索用 `q`，素材用 `state=active|archived`。

| 方法/路径（相对 `/api/products`） | 用途 |
|---|---|
| `GET /`、`POST /` | 商品分页、新建 `{sku, brief, sourceNote?}` |
| `GET /:productId` | 当前资料与固定缺项 |
| `PUT /:productId/brief` | `{baseRevisionId, brief, sourceNote}` 完整快照；缺键拒绝 |
| `GET /:productId/revisions`、`GET /:productId/revisions/:revisionId` | 历史列表与只读快照 |
| `GET /:productId/assets`、`POST /:productId/assets` | 原图列表；上传每请求一个 multipart `file` |
| `PATCH /:productId/assets/:assetId` | `{expectedVersion, archived}` 移除/恢复 |
| `GET /:productId/assets/:assetId/content` | 受控原文件；`?download=1` 下载 |

图片按实际内容识别，严格完整解码，拒绝 APNG、损坏及截断文件；保存上传的原始字节（包括 EXIF），不重编码。单文件 20 MiB、multipart 21 MiB、4000 万像素、单边 12000 像素；服务同时处理最多 2 个上传，超额返回忙状态。新增 JSON 写请求最多 8 MiB。这些是本应用容量限制。

错误包含 `error.code/message/issues?/details?`。常见结果：422 字段或图片无效、409 SKU/资料版本/素材版本冲突、413 超容量、415 类型不支持、503 未就绪或存储忙、507 空间不足。新写接口只接受本机 UI/API 的确切 Origin；无 Origin 的本地脚本可用。服务仅用于本机单工作空间，没有远程多用户认证。

历史切片 3 当时尚未接通商品到生成工作流；后续 S4—S7 能力见本页顶部。旧对话工作台会话仍保存在页面内存中；导航保留状态，整页刷新会清空。切片 3 的实现范围、A1–A20 证据及截图见 [HANDOFF_SLICE3.md](HANDOFF_SLICE3.md)。

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
