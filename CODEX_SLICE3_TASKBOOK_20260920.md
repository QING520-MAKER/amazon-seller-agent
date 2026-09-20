# Amazon Seller Agent · 切片 3 执行任务书

日期：2026-09-20。交接方向：网页端方案评审 → 本地 Codex 实施。

**本轮目标：让用户保存真实商品资料和原图，关闭并重启应用后继续使用，同时保留原 CLI 与对话工作台。**

本文件是实施建议和验收契约，不是完成报告。请本地 Codex 核对真实工作区后，在本片范围内完成实现、测试、浏览器验收和交接，不必逐个询问普通技术选择。只有改变业务目标、扩大外部发布范围、删除真实数据或发现无法兼容的关键冲突，才提交具体问题供用户决定。

## 1. 依据、证据与判断边界

| 项目 | 本次核对结果 |
|---|---|
| 用户指定业务基线 | `824b644`，来自项目文档；上传包没有 `.git`，本轮未独立验证其与该提交逐字相同 |
| 实际读取材料 | 上传包中的 `PROJECT_BRIEF.md`、`AGENTS.md`、`HANDOFF.md`、`HANDOFF_SLICE2.md`、`README.md`，以及源码、测试和配置 |
| 附件 | `amazon-seller-agent-handoff-20260920-093805.zip` |
| 附件 SHA-256 | `624a0df65b355a7abe495c6f6a9431ad214be7a81cdf5c46a1ece655eea32c7f` |
| 本轮实际工作 | 解包、静态源码核对、并行独立审查、官方依赖文档核查、编写任务书 |
| 本轮没有执行 | 依赖安装、业务测试、构建、浏览器操作、Windows 原生依赖验证；没有修改业务源码 |
| 历史测试证据 | `HANDOFF_SLICE2.md` 记载过 177 项测试等验收通过；不得当作本轮重跑结果 |
| 本地实施环境 | 用户指定 `E:\Develop\amazon-seller-agent`，Windows 10 + PowerShell；网页会话不能直接访问该 E 盘 |
| 协作方式 | 用户传递任务书和回报；未建立自动连接本地 Codex 的通道，内部审查代理不代表用户的本地 Codex |

已核实的兼容点：

1. `src/schemas.ts` 的 `ProductBriefSchema` 只有 name 必填，其他字段有空值或语气默认值；`name.min(1)` 本身不拒绝全空格。`ListingCopy`、`ListingResult` 没有商品、版本或素材关系。
2. `src/http/routes.ts` 的 `createApp({ invoke })` 当前无磁盘初始化副作用，现有测试直接构建它；`src/server.ts` 单独负责启动和关闭服务。
3. `apps/web/src/intent.ts` 及 `components/Workbench.tsx` 有多处示例补全。不能让商品表单经过这些入口。
4. `useWorkbench()` 位于 Workbench 内部，卸载时会清空组件状态并 abort 前端等待。新增导航必须保留其生命周期。
5. `apps/web/src/api.ts` 把失败响应转换成普通 Error，丢失 status/code/issues；新商品 API 需要保留结构化错误。
6. `src/config.ts` 的 Settings 被旧测试构造；新增存储配置应独立，避免使 autocomplete/CLI 依赖数据库。
7. `vitest.config.ts` 当前只匹配 `tests/**/*.test.ts`。新增 `.test.tsx` 时必须改匹配规则，不能让新 UI 测试被静默漏跑。

## 2. 本片范围与完成标准

### 范围内

- 单人、单个本地工作空间的商品列表、搜索、新建、详情、资料编辑。
- 复用 ProductBrief 保存商品资料，允许资料尚不完整；显示实际缺项。
- 保存不可变资料版本，查看历史版本，处理多窗口编辑冲突。
- JPEG/PNG 原图上传、预览、原文件下载；错误有明确原因。
- 原图逻辑移除与恢复，用于整理误传图片；不物理删除原文件。
- SQLite 保存元数据，独立本地目录保存原图；支持重启、迁移和离线备份恢复。
- 原四条 CLI、四类工作台任务及其既有语义保持可用。

### 范围外

LLM 接入、图片生成、批量导入/任务、文案版本和审核中心、多语言、Amazon 写入、账号/权限平台、远程素材 URL 拉取、PDF/视频上传、自动提取图片事实、完整图库历史快照、永久删除商品和原图。

本片不增加“用这个商品生成”按钮，也不把聊天结果自动存入商品。切片 4 再显式绑定商品资料版本来生成文案。

### 端到端完成标准

创建 A、B 两个商品 → 分别上传原图 → 编辑 A → 查看 A 的旧资料版本 → 关闭 API 并重新启动、刷新页面 → 资料和原图仍正确 → 上传损坏图片获得具体错误 → 双窗口编辑冲突不覆盖数据 → 原有 CLI 和工作台仍工作。

完整性提示不是“事实已核验”“审核通过”或“可以上架”。本片只忠实保存用户资料，不自动判定资料真实，也不承诺识别任意文字矛盾。

## 3. 推荐数据关系：三张业务表足够

商品分别拥有资料版本和原图。资料版本只快照资料；当前原图库不是任何历史资料版本的自动组成部分。以后生成时，显式固定 `productId + revisionId + assetIds[]`，不依赖当时的“最新资料”或“当前全部图片”。

### 3.1 最小契约

以下是拟新增契约，不是现有源码。ID 由服务端生成 UUID；时间由服务端生成 UTC ISO 8601。

```ts
type ProductRecord = {
  id: string;
  workspaceId: string;          // 服务端固定为 local，客户端不可选择
  sku: string;
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
};

type ProductRevision = {
  id: string;
  productId: string;
  revisionNumber: number;        // 每商品从 1 递增
  brief: ProductBrief;           // 既有结构，解析后的完整值
  sourceNote: string;            // 用户填写的资料来源/待确认说明，允许空
  createdAt: string;
};

type OriginalAsset = {
  id: string;
  productId: string;
  kind: "original";
  originalName: string;          // 仅供展示，不用于磁盘路径
  mimeType: "image/jpeg" | "image/png";
  sizeBytes: number;
  width: number;                 // 原始编码尺寸；方向信息另存
  height: number;
  orientation: number | null;    // EXIF 方向，未知为 null
  sha256: string;                // 原始上传字节的 SHA-256
  createdAt: string;
  archivedAt: string | null;     // 逻辑移除，字节仍保留
  version: number;               // 素材状态乐观锁，从 1 开始
};

// 以下仅服务端持久化，不进入浏览器 DTO：
type StoredOriginalAsset = OriginalAsset & { storageKey: string };
```

`original_assets` 可以是 SQL 表名，公开类型沿用 OriginalAsset，暂不做未来所有素材类型的大统一模型。

### 3.2 约束与默认选择

| 项目 | 本片明确规则 |
|---|---|
| SKU | 新建时必填；trim，长度 1–128，拒绝控制字符；保留大小写与其他原字符 |
| 唯一性 | `UNIQUE(workspace_id, sku)`，采用明确的二进制、区分大小写比较；`ABC` 和 `abc` 在本地视为不同 SKU，UI 给可见说明；这不是 Amazon SKU 规则声明 |
| SKU 编辑 | 本片新建后只读，避免引入标识变更及历史映射；业务资料可正常编辑。此项是推荐范围选择，非已有约束 |
| 商品名称 | 新接口 trim 后非空，最长 300 字符；不修改旧 ProductBriefSchema 的行为 |
| 其他资料 | brand/audience 上限 500 字符；资料数组每组最多 100 条、每条最多 2000 字符；sourceNote 最多 10000 字符；均为本地容量限制 |
| 空资料 | 空串/空数组表示尚无记录，不等于“无品牌”“无配件”；tone 是写作偏好，不是商品事实 |
| 工作空间 | 服务端固定 local，不做租户管理；SKU 只在该工作空间内唯一，不声称跨店铺唯一 |
| ASIN/站点 | 本片不新增映射，也不把 SKU 当 ASIN；商品资料不绑定 marketplace |
| 资料版本 | 只追加，禁止改写或删除历史记录；内容未变化时返回当前版本，不制造空版本 |
| 素材核心字段 | 字节、归属、hash、格式、尺寸、初始文件名、createdAt 不改写；仅归档状态及 version 可变 |
| 相同文件 | 同一商品按原始字节 hash 去重；同名不同字节产生独立 ID；跨商品分别登记独立素材和文件 |
| 归档/恢复 | 只改变可选状态，不删除文件；重复目标状态在版本匹配时为 no-op；并发旧版本返回 409 |
| 上传和资料编辑 | 相互独立；上传/归档不生成资料版本，不改变 currentRevisionId；可更新商品 updatedAt |
| 图片数量 | 列表显示未归档原图数量；不得写入旧 ListingInput.imageCount 或宣称完成图像审计 |

数组中的空白行可在新接口统一清理；不自动重排、翻译、补词或生成新事实。保存与 no-op 比较使用相同规范化逻辑。日期、ID、hash、尺寸、版本号等服务端字段不接受客户端指定。

### 3.3 数据库约束与事务

最少三张业务表：`products`、`product_revisions`、`original_assets`，另有技术用途的 schema_migrations。

- revisions 对 `(product_id, revision_number)` 唯一；若使用下述同商品复合外键，另加 `UNIQUE(product_id, id)`，使 SQLite 父键精确匹配。assets 对 `(product_id, sha256)` 唯一，**包括已归档记录**。
- 启用外键。商品 head 必须指向属于自身的 revision；用同商品复合外键及延迟检查，或等效数据库约束实现，不能只检查 revision UUID 存在。
- 创建商品、revision 1 和 head 在同一事务完成，不能留无初始资料的半成品商品。
- 编辑资料使用短事务：检查当前 head 等于 baseRevisionId → 判断是否变化 → 插入新 revision → CAS 更新 head → commit。两个请求以同一基线提交实际变更，只能一个写入成功；两个均无变化的请求可以都返回 no-op。
- CAS 检查和写入不能拆成无保护的两次数据库操作；发生冲突时整笔回滚，不留下孤立 revision。
- SKU 唯一由数据库最终裁决，前端预检查不是并发保证。
- 原图只能归属一个商品；所有版本/素材读取和状态更新均校验 productId，不接受移动素材归属。
- 本片不建 Listing/Job/Review/Publication 等未来表，也不把商品 CRUD 加进 LangGraph。

### 3.4 Zod 与旧契约兼容

保留旧 ProductBrief、ListingCopy、ListingResult 的字段、默认值及含义。新商品写入契约可以收紧空白、容量及未知字段要求，但不影响旧 CLI/API。

- 新建允许 `{ sku, brief: { name } }`，其他值由旧 ProductBrief 的空值默认规范化；这是保存缺资料商品，不是补示例。
- 编辑使用**完整快照**：`{ baseRevisionId, brief, sourceNote }`。brief 的 name、brand、attributes、features、audience、useCases、included、tone 全部显式提交。
- 保存契约必须检查这些键存在；只用 `ProductBriefSchema.required()` 不会去掉字段内的 default。建议在新 schema 检查原始对象键后，再复用旧 schema 解析。
- 禁止 `ProductBriefSchema.parse(patch)` 后与旧对象合并；默认空值可能静默清空没有提交的品牌、规格等字段。
- 明确区分输入类型 `z.input` 与解析后类型 `z.infer`。锁文件目前是 Zod 3.25.76，不能套用 Zod 4 假设。
- 新请求拒绝未知字段，包括放错层级的 sku/assetIds；旧 API 的未知字段处理保持不变。
- 新契约建议直接追加在 `src/schemas.ts` 的独立区块，保持它为公共契约入口；不要让共享 schema import 数据库、fs 或其他服务端依赖。

## 4. 页面与交互

### 4.1 应用导航与老工作台

新增“商品”“对话工作台”两个一级入口。默认进入商品列表；详情使用可刷新定位的 URL，例如 `#/products/:id`，工作台 `#/workbench`。本片不需要引入复杂路由/状态框架。

推荐将 `useWorkbench()` 提升到始终挂载的 App，由 Workbench 接收其返回值。切换到商品再回来，聊天消息、输入框草稿、等待中的请求和结果均保留；页面刷新后聊天仍可按旧语义清空。不要持久化聊天或改造任务调度。

原示例来源提示继续显示。商品页面不得导入 `examples/*.json`、`parseIntent` 或示例请求工厂。不要为了商品功能删除已有、可见提示的示例工作流。

### 4.2 商品列表

- 列：名称、SKU、资料版本、当前原图数、待补充项、最近更新时间。
- 搜索名称/SKU；默认每页 20，最多 100。服务端排序 `updatedAt DESC, id DESC`；搜索使用参数化查询，并转义 LIKE 通配符。
- 空库、搜索无结果、加载中、服务故障分别显示。故障不能显示成“暂无商品”。
- 新建入口打开空表单，不自动创建示例商品。
- 待补充项固定为 attributes、features、included、sourceNote、originalAssets：对应资料数组为空、来源说明 trim 后为空、未归档原图数量为零时列出。这里只提示“尚未填写/上传”；品牌、人群、场景可以显示空值，不要求所有品类都填写。
- 不做完整性百分比或“已完成”绿标；schema 合法不表示具备切片 4 的全部生成依据。

### 4.3 新建、详情与编辑

- 新建必填 SKU、名称；先保存商品，再启用上传，防止无归属文件。
- ProductBrief 数组用可增删行编辑；字段明确区分属性/规格、卖点事实、场景、包装清单。不要把 placeholder 作为提交数据。
- 来源说明为普通文本，允许填“包装标注”“供应商规格表”“某参数待核实”等用户信息；系统不虚构来源。
- 详情展示当前版本、更新时间、资料、原图库；历史版本列表可打开只读快照，不做差异合并或版本回滚。
- 查看历史版本时标注“历史资料”；若旁边仍展示原图，明确“当前原图库”，不得暗示图片集合被该历史版本固定。
- 编辑成功后刷新服务端详情；失败保留完整草稿，不能清空表单或显示“已保存”。
- 409 时保留本地草稿，提供查看最新资料、复制本地草稿、明确放弃后重载；不自动覆盖或盲目重试，不做复杂自动合并。
- 普通页面离开、浏览器返回和关闭时对未保存编辑作合理提示；正常保存不新增确认步骤。
- 商品 A/B 快速切换时，旧请求晚到不能覆盖新详情。用 AbortController 加请求身份检查；abort 本身不代表服务端未提交。

### 4.4 上传、预览、移除与恢复

- 接受 JPEG/PNG。允许多选，但每个文件一个请求，前端顺序上传并逐项显示状态，不引入批量任务系统。
- 客户端 accept/大小提示只作提前反馈，后端必须再次验证。
- 上传中显示“正在上传/校验”；只有服务器完成文件和元数据登记后才显示已保存。object URL 预览不是持久化成功证据。
- 卡片显示原文件名、尺寸、大小、上传时间和预览/下载入口；原图不压缩、不转码、不自动剥除 EXIF。
- EXIF 方向用于正确显示；原始尺寸与显示方向分开处理。JPEG/PNG 可在浏览器直接预览，本片不必先做缩略图生成服务。
- 上传时捕获 productId，切换到 B 不得把 A 的上传结果插入 B。保存中的请求可在后台完成，切回后重新读取。
- 同商品重复字节返回已有素材并提示“原图已存在”；若已归档，提示进入“已移除”区域恢复，不悄悄恢复、不显示为新上传成功。
- “移除”含义明确为“从当前原图库移除，原文件保留”；可在已移除区域恢复。历史原文件仍可读取。
- 网络中断/用户停止等待后显示“保存结果待确认”，先重新读取素材清单再重试；不得声称服务端已经取消。
- 一张失败不影响其他成功素材；失败项有原因和单项重试。释放不用的 object URL。

## 5. 最小 HTTP 契约

新接口沿用 `/api`。JSON 请求需要 `application/json`；上传为 `multipart/form-data`，浏览器 FormData 自行设置 boundary，前端不要手写 Content-Type。

### 5.1 返回类型

```ts
type MissingField = "attributes" | "features" | "included" | "sourceNote" | "originalAssets";

type ProductSummary = {
  product: ProductRecord;
  name: string;
  revisionNumber: number;
  originalAssetCount: number;   // 未归档数量
  missingFields: MissingField[];
};

type ProductDetail = {
  product: ProductRecord;
  currentRevision: ProductRevision;
  missingFields: MissingField[];
};

type Page<T> = { items: T[]; total: number; limit: number; offset: number };

type ApiFailure = {
  error: {
    code: string;
    message: string;
    issues?: { path: string; message: string }[];
    details?: {
      currentRevisionId?: string;
      currentAssetVersion?: number;
      existingProductId?: string;
    };
  };
};
```

素材 DTO 不返回 storageKey/绝对路径；客户端用 productId、assetId 拼接受控接口地址。新客户端用 Zod 校验成功响应，并保留失败的 status、code、issues、details。

### 5.2 路由清单

| 接口 | 请求/查询 | 成功响应与行为 |
|---|---|---|
| `GET /api/products` | q 可选，limit=20，offset=0 | 200 `Page<ProductSummary>`；q 最长 200，limit 1–100，offset 非负整数 |
| `POST /api/products` | `{sku, brief, sourceNote?}` | 201 `ProductDetail`；创建商品及 revision 1，sourceNote 缺省为空 |
| `GET /api/products/:productId` | 无 | 200 `ProductDetail` |
| `PUT /api/products/:productId/brief` | `{baseRevisionId, brief, sourceNote}` 完整快照 | 200 `{product, revision, changed}`；有变化新增版本，无变化不增版本 |
| `GET /api/products/:productId/revisions` | limit=20、offset=0 | 200 `Page<{id,revisionNumber,createdAt}>`；版本号倒序 |
| `GET /api/products/:productId/revisions/:revisionId` | 无 | 200 `ProductRevision`；同商品归属校验 |
| `GET /api/products/:productId/assets` | state=active/archived，默认 active；limit=20、offset=0 | 200 `Page<OriginalAsset>`；createdAt DESC、id DESC |
| `POST /api/products/:productId/assets` | multipart，仅一个 file 字段 | 201 `{asset, reused:false}`；同商品相同字节 200 `{asset, reused:true}`，状态保持原样 |
| `PATCH /api/products/:productId/assets/:assetId` | `{expectedVersion, archived:boolean}` | 200 `{asset, changed}`；状态变化 version+1，恢复时清空 archivedAt |
| `GET /api/products/:productId/assets/:assetId/content` | download=1 可选 | 200 原字节；默认 inline，下载时 attachment；归档素材也可读取 |

列表查询和分页参数不合法返回 422。历史版本/素材接口中的合法但不属于本商品的 ID 返回 404。所有路由按归属查询，不先查任意素材再拼路径。

编辑基线先检查再判断 no-op：旧 baseRevisionId 即使碰巧正文相同，也返回 409，避免静默掩盖编辑冲突。响应丢失时，客户端获取最新版本并让用户核对，不无限重发旧请求。

新建重复点击由按钮状态和 SKU 唯一共同防护；重复上传由 hash 唯一防护。本片不需要通用任务幂等系统。

### 5.3 错误语义

| HTTP | code | 条件与用户动作 |
|---|---|---|
| 400 | INVALID_JSON / INVALID_MULTIPART | 正文无法解析，修正请求 |
| 415 | UNSUPPORTED_MEDIA_TYPE | JSON/上传请求 Content-Type 不符合约定 |
| 422 | INVALID_REQUEST | 空白 SKU/name、字段类型/数量/长度/ID/分页不合法；issues 定位字段 |
| 404 | PRODUCT_NOT_FOUND / REVISION_NOT_FOUND / ASSET_NOT_FOUND | 不存在或归属不匹配，返回列表或重新加载 |
| 409 | SKU_CONFLICT | 同工作空间 SKU 已存在，可在 details 返回已有商品 ID |
| 409 | REVISION_CONFLICT | head 与 baseRevisionId 不同，details 返回 currentRevisionId，保留草稿 |
| 409 | ASSET_VERSION_CONFLICT | 归档状态已被另一窗口更新，返回 currentAssetVersion |
| 413 | UPLOAD_TOO_LARGE | 实际请求体或文件超过容量上限，减小文件 |
| 415 | UNSUPPORTED_IMAGE_TYPE | 实际格式不是单帧 JPEG/PNG |
| 422 | INVALID_IMAGE / IMAGE_LIMIT_EXCEEDED | 空文件、损坏、无法完整解码、像素/边长超限 |
| 403 | ORIGIN_NOT_ALLOWED | 新写接口收到非允许网页 Origin；不给任意站点开放跨域写入 |
| 503 | STORAGE_BUSY / STORAGE_UNAVAILABLE | 数据库忙、不可写或存储服务未初始化；保持输入，稍后重试 |
| 507 | INSUFFICIENT_STORAGE | 文件/数据库写入遇磁盘满，清理空间或更换配置目录 |
| 500 | ASSET_FILE_MISSING / ASSET_FILE_CORRUPT | 记录存在但文件缺失/已知 hash 不符；提示从备份恢复，不当作空图库 |
| 500 | INTERNAL_ERROR / INVALID_RESULT | 未预期错误或返回契约不合法；显示诊断提示，不泄露 SQL/路径 |

原有 GRAPH_FAILED、INVALID_MARKETPLACE 等错误语义保持不变。新接口不得把底层错误 message 原样暴露给网页；服务端保留必要诊断，但不记录真实资料全文、文件字节或密钥。

## 6. 本地持久化、文件存储与 Windows 兼容

### 6.1 推荐方案

采用 **SQLite + better-sqlite3 + 独立原图目录**，图片验证采用 **sharp**；不用 ORM、Redis、对象存储或数据库 BLOB 保存原图。同步 SQLite 操作仅处理短小元数据事务，文件读取/解码不放进事务。

better-sqlite3 官方提供主要平台预编译二进制并说明 Node 支持要求，但具体版本和 Windows 10 实机安装仍需本地验证；sharp 官方列出 Windows x64 预编译支持。这是选型依据，不是本项目已经安装成功的证据。[better-sqlite3 官方说明](https://github.com/WiseLibs/better-sqlite3)、[sharp 安装说明](https://sharp.pixelplumbing.com/install/)

`node:sqlite` 从 Node 22.5 才加入，不能直接作为当前声明 Node 20+ 项目的通用方案。本片不以强制切换内置 SQLite 为前提。[Node SQLite 文档](https://nodejs.org/api/sqlite.html)

实施开始先做小范围兼容性验证：

1. 记录本机 Windows 版本、Node/npm/CPU 架构；项目为 ESM + TypeScript Node16 模块解析。
2. 选定匹配实际 Node engines 的受维护依赖版本，锁进 package-lock；验证 ESM import、磁盘建库/事务/重开、JPEG/PNG 完整解码。
3. 优先在受支持的 Node 22 维护版本上统一开发；满足现有 Vite 22.12+ 要求只是最低条件，不代表任意依赖都自动兼容。不要根据网页环境的 Node 版本推断本机版本。
4. 若目标仍是 Node 20，逐项核实选定驱动 engines 与预编译包；不能宣称未经验证的支持。若无法保留该运行时，明确说明影响并更新运行要求，不偷偷把支持范围缩窄。
5. 不为原生编译引入 Python 开发链，不把安装失败变成自动改用内存库/JSON 文件。先检查兼容版本、预编译包和安装日志；无法解决时反馈具体阻塞及兼容方案。
6. 记录 `SELECT sqlite_version()`。若启用 WAL，选择包含已知 WAL-reset 修复的 SQLite 版本（如 3.51.3+ 或官方注明的修复回移版本）；不只看 npm 包版本。[SQLite WAL 官方说明](https://www.sqlite.org/wal.html)

### 6.2 目录与配置

新增独立 `loadStorageSettings()`，使用环境变量 `ASA_DATA_DIR`。用户本地推荐明确设置为 `E:\AmazonSellerAgentData`；临时测试目录用 `E:\CodexTemp` 下本片专用子目录。

未设置时默认使用应用根目录的 `data`，路径从模块位置确定，不能依赖启动时 cwd；tsx 与编译后 dist 必须解析到同一默认目录。启动日志明确本机解析后的目录，网页不显示绝对路径。

目录职责：

| 相对路径 | 用途 |
|---|---|
| `catalog.sqlite` | 商品、资料版本、素材元数据与迁移版本 |
| `originals/<productId>/<assetId>.jpg` 或 `.png` | 不可变原图，扩展名由实际格式确定 |
| `tmp/<uploadId>.part` | 同盘上传暂存 |
| `recovery/` | 应用自有孤立文件的诊断记录，必要时隔离；不是用户正常原图库 |

数据库只存相对 storageKey，移动整个数据目录并改配置后仍可使用。所有路径使用 Node path/fileURLToPath 正确处理 Windows 盘符、空格和中文；不手工拼 `/`、不把 URL pathname 当 Windows 路径。

文件名完全由服务端 ID 生成。原始名只作展示并安全设置 Content-Disposition，不能让 `../`、盘符、反斜杠、保留设备名或百分号编码参与磁盘定位。数据根目录不作为静态目录暴露。文件读取由资产 ID 查表后执行，并验证路径仍在根目录内。

数据存本机本地磁盘，不使用网络共享/同步中的目录承载运行数据库。WAL 需要同机协调，且 WAL 文件属于数据库持久状态的一部分。[SQLite WAL 官方说明](https://www.sqlite.org/wal.html)

### 6.3 上传容量和验证

默认限额是本应用容量保护，**不是 Amazon 图片规范**：

- 单文件最多 20 MiB；单 multipart 请求最多 21 MiB。
- 图片最多 40,000,000 像素，单边最多 12,000 像素；仅单帧 JPEG/PNG，拒绝动画 PNG。
- 先对实际输入流/请求体限流，再解析 multipart；不能先把任意大 body 读进内存才检查 file.size。缺失 Content-Length 也必须限流。
- 先检查 JPEG/PNG 签名、实际解码格式和尺寸，再执行一次完整像素解码；不能仅依赖文件后缀、浏览器 MIME 或 metadata()。
- 后缀和浏览器 MIME 仅作提示，最终 MIME/扩展名使用实际检测格式；伪装为 jpg 的 HTML/SVG 必须拒绝。
- sharp 采用严格错误策略和像素上限；完整解码只为验证，丢弃解码产物，保存最初字节。对解码并发作小上限，避免多窗口大图同时消耗大量内存。
- 请求体读取、校验、落盘均有可测试的失败路径；原始图片不能被压缩结果替换。

sharp 明确说明 metadata 只读取头部，不解码压缩像素；完整可解码性必须另做实际解码操作。[sharp metadata 文档](https://sharp.pixelplumbing.com/api-input/)。严格错误和像素上限可使用其公开选项，但仍须用损坏图样本测试。[sharp 构造参数](https://sharp.pixelplumbing.com/api-constructor/)

Hono 有请求体大小中间件，可作为实现入口；检查锁定版本实际行为，并补没有 Content-Length 的测试，不能只相信客户端声明长度。[Hono Body Limit](https://hono.dev/docs/middleware/builtin/body-limit)

### 6.4 文件与数据库失败一致性

SQLite 事务不能覆盖文件系统。采用以下顺序，不宣称跨两者原子事务：

1. 确认商品存在；限流读取，计算原始 hash，写入同数据盘的独占临时文件。
2. 验证格式、完整解码、容量和尺寸；失败只清理本请求创建的临时文件。
3. 查同商品 hash；若已存在且文件健全，清理本次临时文件并返回 reused，保留原归档状态。命中记录但原文件缺失/损坏时返回对应存储错误，不静默替换或自动修复。
4. 关闭临时文件句柄、刷新数据，再用服务端新 ID 定位最终路径。推荐 `copyFile(..., COPYFILE_EXCL)` 独占复制，完成后刷新并关闭目标文件；不使用 `exists → rename` 来承诺不覆盖。若目标已存在，绝不改写或删除那个既有文件。复制中断留下的未登记产物按孤立文件处理；临时文件在安全完成后清理。
5. 短数据库事务登记素材并更新商品 updatedAt；唯一约束处理两个并发相同上传。只有 commit 成功后才能返回 201。
6. 普通失败尽力删除自己新建且未登记的文件；若提交结果不确定，先按 assetId/hash 查清数据库，不可直接删可能已成功登记的原图。
7. 回包丢失不是数据库失败，不做“断连即删除”。重传通过 hash 去重，返回同一素材 ID。

启动恢复在接受请求前执行：识别 tmp 中断产物和没有元数据的应用自有文件，写恢复记录；不把它们自动导入成成功素材。本片默认保留/隔离供排查，不自动批量删除。数据库已登记文件若丢失，保留记录并明确报错，不生成示例图、不悄悄删除行。

恢复检查在独占启动阶段进行；本片按下一节的固定端口启动门禁保证只运行一个服务实例，避免把另一个实例尚在上传的文件判成孤立文件。短事务的原子性不等于应用级文件恢复互斥。

承诺进程退出、普通重启及可注入故障的可恢复性；突然断电下的整个文件系统耐久性仍受 OS/硬件影响，不宣称绝对无损。

### 6.5 服务启动、迁移、关闭和备份

- server 启动时解析配置 → 先独占绑定固定 `127.0.0.1:8787` → 初始化存储 → 顺序迁移 → 恢复检查 → 注入 catalog service → 切换为 ready。初始化期间所有请求统一返回 503，完成前不报告健康；ready 后原 `/api/health` 成功结构保持不变。
- 端口绑定失败的实例不得打开/迁移存储。进程退出后由 OS 释放端口，避免永久哨兵锁阻塞重启。本片不提供可变端口或第二套写入服务；未来若放开多端口，须另加目录级互斥。迁移失败时关闭监听并以非零状态退出。
- `createApp({invoke, catalog})` 保持同步工厂；导入 schemas/routes/config 不创建目录或连接数据库。旧 `createApp()` 仍支持原接口；缺 catalog 的新接口返回 503，不回退成内存成功。
- CLI/import graph 不初始化存储；即使 ASA_DATA_DIR 无权限，旧 CLI JSON 工作流仍能独立运行。
- 新增写接口校验显式 Origin，允许本地 UI/API 的确切 Origin；没有 Origin 的本地脚本/测试可用。不要使用 `Access-Control-Allow-Origin: *` 开放本地数据写入；本片不引入登录系统。
- SQLite 启用 foreign_keys；推荐 WAL、synchronous=FULL、有限 busy_timeout，例如 3000ms；数据库忙转明确错误，不无限等待。图片解码不占写事务。
- 迁移用有序版本和事务，重复启动不重复改结构；无法迁移/不认识更高 schema 版本时启动失败，保留原文件，不重建空库。新库才执行初始化，绝不自动播种商品。
- SQL 迁移建议存 TypeScript 字符串模块，随 tsc 编译，避免生产 dist 漏拷 .sql 文件。
- 退出时先停止接收、等待在途持久化操作完成，再 checkpoint/close SQLite 和释放互斥；tsx watch 重启也要验证句柄释放。
- 首版只提供**停服备份流程**：停止所有写进程、完成 checkpoint/关闭 → 复制整个 ASA_DATA_DIR 到备份目录 → 以另一个目录启动并核对记录/原图 hash。不要只复制正在写入的 catalog.sqlite，也不要手工删除 WAL。
- `.gitignore` 增加默认数据目录、临时目录和 SQLite 附属文件规则；原图、备份、运行数据、真实产品资料、.env 不进 Git。上传白名单只含开发必需文件和合成测试图片。

## 7. 拟改文件与实施顺序

文件名可随现有风格小幅调整；职责和兼容边界必须保留。不要一次写完全部模块后才检查原生驱动能否在本机工作。

| 顺序 | 文件范围 | 交付与检查 |
|---|---|---|
| 0 基线/驱动验证 | 只读当前仓库；依赖试装与合成样本放临时目录 | 确认提交、未提交改动、Node/npm/架构；记录原测试基线；SQLite/图片解码 Windows smoke 验证 |
| 1 契约 | `src/schemas.ts` 追加新契约；`tests/catalog-contracts.test.ts` | 旧契约不变；新建/完整快照/错误/DTO；验证不把缺失字段解释为清空 |
| 2 持久化 | 新增 `src/storage/settings.ts`、`database.ts`、`migrations.ts`、`files.ts`；`src/catalog/repository.ts`、`service.ts` | 三表、事务、CAS、文件不可变、hash 去重、归档、重启/失败恢复 |
| 3 API | 新增 `src/http/catalog-routes.ts`；修改 `src/http/routes.ts`、`src/server.ts` | 注入存储服务、上传限流、受控读取、结构化错误；旧 API 不依赖真实磁盘 |
| 4 页面 | `apps/web/src/App.tsx`、`components/Workbench.tsx`，必要时 `useWorkbench.ts`；新增 `products/{api,ProductList,ProductDetail,ProductForm,OriginalAssets}` | 页面壳层、工作台生命周期、新商品独立输入、冲突/上传错误、历史只读 |
| 5 样式/验证 | `apps/web/src/styles.css`；必要时 `vitest.config.ts`；新增 API/存储/UI/导航测试 | 样式限定 `.products-*`；桌面/窄屏，新增 .tsx 测试被实际执行 |
| 6 配置/交接 | `package.json`、`package-lock.json`、`.gitignore`、`.env.example`（核对是否已有）、`README.md`、新增 `HANDOFF_SLICE3.md` | 依赖与安装要求、目录与备份、实际验证证据、完成/未完成清单 |

常规范围内不修改 `src/cli.ts`、`src/graph/`、`src/copywriting.ts`、`src/scoring/`、`src/providers/`、旧示例 JSON 和旧 intent 规则。如必须修改，先给出具体兼容理由并增加对应回归，不能顺手重写。

更新 `PROJECT_BRIEF.md`/`ASTRA_COLLABORATION.md` 时，只把有实际证据的实现记为完成；可以记录本任务书已交付到用户当前网页会话，但不编造会话 ID/链接，也不声称自动连接了本地 Codex。

## 8. 必要测试与验收场景

测试使用临时 SQLite 文件和合成图片，外部 HTTP 必须 mock。需要真实文件系统和实际 SQLite 来验证持久化，不可把所有 repository 测试都换成内存 Map。新增行为测试应覆盖风险，不要求为每个 getter 写形式化测试。

| 编号 | 场景 | 必须证明 |
|---|---|---|
| A1 | 空库启动；只填 SKU+名称 | 无自动示例商品；保存后空事实仍为空；缺项可见 |
| A2 | 相同 SKU 两个创建请求 | 只建一个商品，另一个 409；没有孤立初始版本；大小写/trim 规则符合契约 |
| A3 | 修改名称，保留品牌与规格；明确清空一个字段 | 无意省略被 422 拒绝；显式空值被保存；其他资料不变 |
| A4 | 两个窗口以同 base 提交实际变更 | 仅一次成功；另一次 409；前端草稿保留；历史版本未修改；无变化请求按 A5 验证 |
| A5 | 相同正文再次保存 | 返回 changed=false，不追加空版本；旧 base 仍报冲突 |
| A6 | 创建 A/B，分别上传同名不同字节图片 | 不串图、不覆盖；猜其他商品 assetId/revisionId 不能跨商品读取 |
| A7 | 同商品重复/并发上传相同字节 | 返回同一素材 ID；仅一条记录和一份有效原图；回包丢失重试也不重复 |
| A8 | 原图移除、重传、恢复 | 原始字节/hash 不变；重传提示已归档；显式恢复；旧 expectedVersion 409 |
| A9 | 损坏、截断、HTML/SVG 改 jpg、零字节、APNG；有效图声明错误 MIME | 前者均拒绝且无成功素材；metadata 通过但像素损坏也拒绝；有效 JPEG/PNG 即使声明 MIME 错误仍按实际格式接受 |
| A10 | 超文件大小、超像素/边长、无 Content-Length | 正确限流和错误；不是全部读入后才检查；正常限额边界可通过 |
| A11 | 临时写失败、独占复制失败/目标已存在、DB 登记失败、响应丢失 | 不误报成功；已有目标字节不变且不被清理；最终文件孤立/临时文件可诊断；不删已登记文件 |
| A12 | 关闭数据库/进程后用相同目录重开 | 商品、版本、归档状态、原图 metadata 与 SHA-256 一致；仅同进程重新查询不算重启测试 |
| A13 | 故障点停进程后重开；丢失一个合成原图 | 恢复检查不自动导入半成品；已登记缺失文件明确报错而非删除记录 |
| A14 | 固定端口启动两实例；首实例被终止后重启 | 第二实例绑定失败且未接触存储；新启动可接管已释放端口；初始化时 503、完成后 ready；不并发恢复 |
| A15 | 迁移重复启动、更高未知 schema、停服备份换目录 | 不清库；未知版本失败且原数据保留；相对 storageKey 仍能读取 |
| A16 | Windows 中文/空格路径及 watch 重启 | 导入、落盘、重开、关闭无路径错误/句柄锁；Node 版本有实际记录 |
| A17 | A/B 详情乱序、上传途中换商品、一成功一失败 | 响应隔离；成功项不丢；失败具体提示；网络失败不当空列表 |
| A18 | 工作台有草稿/请求时切商品再返回 | 会话及请求结果保留；原示例提示/四任务/复制下载仍正常 |
| A19 | 旧 CLI/API 回归 | 原契约/语义不变；CLI 不依赖数据目录；外部补全/LLM 全部 mock |
| A20 | 真实浏览器桌面和窄屏 | 完成创建、编辑、冲突修正、上传、预览、历史查看和重启回读；无横向溢出/控制台错误 |

故障注入只操作本片临时目录，不删除或破坏用户数据。进程恢复测试可由测试子进程+受控故障钩子完成，不需要让真实工作区异常断电。

推荐测试文件：`catalog-contracts.test.ts`、`catalog-storage.test.ts`、`catalog-http.test.ts`、`asset-storage.test.ts`、`products-api.test.ts`、`products-ui.test.tsx`、`app-navigation.test.tsx`。可合并文件，不能遗漏对应行为。纯数据库测试不要依赖真实网络；浏览器回归旧 research/pipeline 也使用本地 mock fixture，不把外部网络可达性作为切片 3 门槛。

### 本地执行命令（PowerShell）

以下是交给本地执行的命令，不是网页端已经执行的结果。若工作区有未提交改动，保留并识别归属，不 reset/覆盖。

```powershell
Set-Location E:\Develop\amazon-seller-agent
git status --short
git rev-parse HEAD
git rev-parse --verify '824b644^{commit}'
node --version
npm --version

# 先验证原基线；之后新增依赖时使用 npm install 并提交锁文件变更。
npm ci
npm test
npm run typecheck
npm run build
npm run build:web

# 业务变更完成后再次运行上述测试、类型检查和两端构建。
# 本片所有自动化外部 HTTP 均使用 mock。
$env:ASA_DATA_DIR = 'E:\AmazonSellerAgentData'
npm run dev:ui
```

故障与备份测试改用 `E:\CodexTemp` 下独立目录，不对上面的永久数据目录做破坏性操作。既有 `tests/cli.test.ts` 已使用 mock preload，优先复用，避免手动运行研究命令触达真实 Amazon。

## 9. 风险、待验证假设与默认决策

| 风险/假设 | 具体后果 | 本片处理/验证 |
|---|---|---|
| 上传包无法证明等于本地 HEAD | 按旧文件实施可能覆盖新进展 | 本地先比对基线与现状；优先适配当前代码，回报偏差 |
| Windows native 依赖尚未实测 | 功能写完后才发现无法安装/启动 | 驱动和图片解码 smoke 放实施第一步；锁版本、记录 engines/架构 |
| 当前根 engines 为 Node20+，UI 要求更高 | 宣称兼容但实际无法运行 | 区分旧文档声明和已测支持范围，不隐藏运行时变更 |
| 旧默认值与示例链路 | 未提供事实被清空或补成示例 | 商品独立输入；完整快照；新 schema 边界测试 |
| 新导航卸载 Workbench | 聊天丢失、请求停止等待 | hook 生命周期提升及导航回归 |
| 文件落盘与 DB 非同一事务 | 孤立文件、登记成功但文件缺失 | 文件先完成、DB 后登记、启动诊断、回包丢失去重 |
| 本地多窗口不等于无并发 | 后保存覆盖前保存 | 资料 revision CAS；素材状态独立 version CAS |
| hash 去重只识别完全相同字节 | 同一照片重新编码仍占一条新素材 | 本片接受，不做视觉相似度/跨商品去重 |
| 原图保留 EXIF | 原始位置信息等元数据也保留 | 本地原样保存；后续对外交付时单独制定导出处理，不改写原件 |
| JPEG/PNG 首版限制 | 手机 HEIC/WebP 不能直接上传 | 明确提示用户另存兼容副本；不静默转换原件 |
| 资料“保存”被误当“已确认” | 后续内容可能引用未经核实信息 | 显示来源/缺项；不加自动审核状态；切片4再定义生成所需事实门槛 |
| 数据目录被外部手动改动 | DB 元数据与实际文件不一致 | ID 读取检查；备份恢复可用；不自动补示例、删记录或重建库 |
| 测试文件后缀未纳入 Vitest | UI 回归从未执行却显示全绿 | 明确检查测试发现列表和新测试结果 |

上述方案默认单工作空间、普通单品、当前用户本机使用；未实现多人远程访问安全边界。没有真实样品也可用合成资料验证流程，但不得称为真实卖家产品验收。

## 10. 本地 Codex 完成后的回报格式

```text
项目：Amazon Seller Agent
任务书版本：CODEX_SLICE3_TASKBOOK_20260920.md
基线与当前 HEAD、未提交改动：
实际 Node/npm/Windows/架构、数据库驱动与 SQLite 版本：
本片已完成：
变更文件与关键行为：
接口/契约与本文偏差（逐项写理由）：
数据目录、迁移和停服备份/恢复方式：
实际执行的命令、退出结果、测试数量与失败/跳过项：
Windows 原生依赖与文件句柄验证：
浏览器证据（桌面/窄屏、重启回读、冲突、上传失败、原工作台）：
外部 HTTP mock 范围：
未完成/未验证：
需要网页端独立评审的问题：
下一步：修复本片阻塞；通过独立验收后再细化切片4。
```

交接材料给增量 diff、相关完整文件、测试日志和必要截图，不附 .env、凭据、整个数据目录、客户原图或未经筛选的真实资料。

本任务书的交接状态：**已核对上传快照并完成切片 3 设计；切片 3 实现和运行验收尚未开始。下一个具体动作是本地核对仓库并完成 Windows 存储依赖验证，然后依次实施。**
