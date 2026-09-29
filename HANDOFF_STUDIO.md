# 本地图文工作台交接

日期：2026-09-29。S4—S7 起点为 `ce20ea3`，本地试用完善起点为 `fbf29d7`。本文件同时记录两轮交付；提交与远端同步状态以 Git 历史为准。

用户授权为：先完成设计、Astra/Luna 规范和 skills，再按切片实现；文字及图片服务商稍后选择，先完成本地功能与适配接口。当前交付面向本地单人、US 英文普通单品。

## 当前功能

| 模块 | 实际能力 | 边界 |
| --- | --- | --- |
| 知识库 | 商品隔离、纯文本和 Markdown 导入、来源、搜索、不可变版本、确认与归档、生成时固定知识快照 | 没有 PDF/OCR、向量检索或跨商品品牌知识管理；确认是人工操作 |
| 文案 | 商品关联的关键词选择、模板生成、编辑、版本、批准/退回、JSON 导出 | AI 明确配置后才调用；本地模板使用商品字段，知识保存作审核依据；旧 CLI 契约保留 |
| 批量 | JSON 导入、最多 20 项固定输入、创建与执行分开、逐项失败隔离、明确新批次重试、重启恢复 | 不自动重放模型任务；不覆盖已有 SKU；没有常驻队列服务 |
| 图片 | 受控原图加独立文字层，两种 v2 布局，1600×1600 PNG、安全区/溢出示意、历史候选、原图对照、审核与下载 | 这是本地排版；保守换行不能替代最终图片目检，没有模型生成的新场景或自动图像合规判断 |
| 内容包 | 固定文案和最多 9 张有序图片、草稿/正式 ZIP、不可变清单、审核和依据检查 | 本地批准不等于 Amazon 接受；正式包依据变化后拒绝下载 |
| 服务适配 | `ContentGenerator`、`ImageProvider` 可注入，未配置/失败/中断有明确记录 | 外部图片服务默认未配置；真实模型质量、计费、取消和提供方幂等没有联调证据 |
| 历史与恢复 | 分页访问文案/运行/图片/批次/内容包，跨页保留草稿和具体选择；原生附件下载；带文件清单和哈希的停服备份、新目录恢复 | 不覆盖现有目录；须停止其他数据库写入工具；备份不提供签名或加密 |

架构入口：[CONTENT_STUDIO.md](docs/architecture/CONTENT_STUDIO.md)；适配器要求：[PROVIDER_ADAPTERS.md](docs/architecture/PROVIDER_ADAPTERS.md)；路线状态：[IMPLEMENTATION_STATUS.md](docs/tasks/IMPLEMENTATION_STATUS.md)。

## 运行与存储

在仓库根运行 `npm run dev:ui`，打开 `http://127.0.0.1:5173/`。正式使用前设置独立 `ASA_DATA_DIR`；不要使用下面的合成 QA 目录作为真实商品库。非 watch API 的正常停服与整个数据目录备份步骤见 README。

数据库 schema v7，按 v1 商品、v2 文案、v3 知识、v4 批次、v5 图片、v6 内容包、v7 知识创建请求逐级迁移。已有迁移不重写，待执行迁移同一事务提交，失败整体回滚。备份整个目录：SQLite、`originals`、`derived`、`tmp`、`recovery`。只备份 SQLite 会丢失图片。

生成、编辑、审核和交付绑定具体版本；跨商品引用被拒绝。派生图发布前完整解码并校验大小/像素，发布不覆盖已有文件，读取再检查路径、哈希和内容。启动诊断保留孤立/缺失/损坏文件线索，不自动删除数据。模板、模型、图片和批次的失败不会冒充成功内容。

## S4—S7 历史验证记录

全量 `npm test` 通过 37 个文件、320 项；随后独立审查发现两个 P2，修复后新增 3 项回归，图片 11 项和批次 8 项定向测试通过。未将此前的全量结果冒充最终 323 项全量重跑。两个 P2 已经独立复查关闭，未发现 P1。

`npm run typecheck`（API/web）、`npm run build` 和 `npm run build:web` 全部通过；类型检查和后端构建覆盖最后两处修复。前端主 JS 约 1.35 MB（gzip 423 KB），构建有大于 500 KB 的非阻塞提示，页面拆分留作后续性能工作。

本机日志：`E:\CodexTemp\asa-final-tests-20260929.log`、`asa-final-typecheck-20260929.log`、`asa-final-api-build-20260929.log`、`asa-final-web-build-20260929.log`、`asa-batch-final-fix-20260929.log`。子代理图片定向测试及最后类型检查结果亦保留在本会话工具记录。

本轮真实浏览器使用隔离目录 `E:\CodexTemp\asa-studio-qa-20260929`，商品 `QA-CUP-20260929` 和 `QA-BATCH-IMPORT-20260929` 均为合成 QA 数据。已实际操作：

- 创建商品、上传合成杯子原图、创建并确认知识、选择知识、模板生成、人工编辑保存新文案及批准。
- 未保存文案时禁止批准/正式导出，保留原保存基准；图片生成出真实 PNG，并排核对和批准。
- 创建正式内容包；API 下载 `E:\CodexTemp\asa-approved-qa.zip` 后使用 .NET ZIP 解析器打开，确认 manifest、listing、README 与 PNG 条目。
- 创建/执行批次、失败项明确新建重试批次；JSON 导入逐项结果显示一个新建成功、一个重复 SKU 拒绝且未覆盖旧商品。
- 文字模型和图片场景模式未配置时返回真实失败信息；未调用真实提供方。
- 桌面和 390 像素窄屏检查，窄屏文档宽度与视口均为 390，没有横向溢出。

截图：`E:\CodexTemp\asa-studio-desktop-20260929.png`、`E:\CodexTemp\asa-studio-mobile-20260929.png`、`E:\CodexTemp\asa-studio-production-20260929.png`。合成图和 QA 库不纳入 Git。

该轮下载限制：内置浏览器点击 Blob ZIP 按钮没有返回 download 完成事件，当时只完成 HTTP 和 ZIP 内容验证。此问题已在下面的本地试用完善中通过原生附件链接解决。开发 HMR 期间曾出现临时代理连接失败及 hook 依赖变化提示；该轮收尾使用编译后 API 与 Vite preview 的全新页面，控制台 warn/error 为空，启动恢复诊断为 0。

## 本地试用完善的实际验收

施工单：[LOCAL_TRIAL_QUALITY.md](docs/tasks/LOCAL_TRIAL_QUALITY.md)。共享 schema 仅增加可选的显式模板 v2 字段；无默认值，不修改旧请求 hash，不新增数据库迁移。历史记录、原始文件和审核版本保留。源码全部 TypeScript，无新增依赖或真实模型调用。

- 下载：先复现 Blob 下载超时和正式 JSON 的 `draft=0` 参数错误，再改用受控原生附件 URL。浏览器实际返回 JSON、PNG、ZIP 磁盘路径，文件随即移动到 `E:\CodexTemp\asa trial downloads 20260929`。JSON 为已批准文案 v34；ZIP 包 v1 仍固定文案 v2 和原图片 v1。ZIP 内 PNG 与单独下载 PNG 的 SHA-256 均为 `06c5f26e589a536c3034133855f7ef53c2296e702c0629b321c83ef5fd3caa94`，与清单一致。
- 恢复：运行中备份返回 `SERVICE_RUNNING`，未创建目标；输入 `stop` 正常停服后，在含空格路径完成备份、verify、新目录恢复。最终备份含 37 个文件、schema v7；路径为 `E:\CodexTemp\asa trial recovery 20260929\final backup` 和 `final restored`。逐文件内容及数据库检查通过。检查数据库使用私有副本，源目录不因 readonly SQLite 连接增加 WAL/SHM。
- 分页：合成库包含 34 个文案、35 张图片，以及各 33 条批次和内容包。浏览器访问第二页的旧版本与失败运行记录；文案草稿、图片方案、审核备注、已选详情保持；内容包跨页保留文案 v34 及有序图片 v33、v1；查看批次历史不自动执行任务。更多原图与异步回包隔离另有自动化测试。
- 图片：浏览器实际生成 v34 左右分栏和 v35 上下堆叠，二者均记录模板 v2、待人工审核。重新渲染并目检中英混排；真实 PNG 测试覆盖长英文/中文、透明横竖图和安全区域像素。旧无模板请求重放及重启审核状态保持通过存储回归。
- 界面：桌面图与原图对照见 `E:\CodexTemp\asa-trial-image-desktop-20260929.png`；窄屏文档宽度和视口均为 390px，无横向溢出。窄屏截图 `asa-trial-image-mobile-20260929.png`。这些为合成 QA，不是商品图片或真实使用质量证明。

原生确认框的自动化在一个内置浏览器页上发生超时；未把该页取消操作计作已通过的手工验收。换新页继续完成上述操作；取消/保护分支有 UI 自动化回归。备份和分页不依赖这个浏览器工具行为。

最终代码检查（包含收尾修复）：

- `npm test`：40 个文件、356 项全部通过，47.10 秒。日志 `E:\CodexTemp\asa-trial-final-tests-20260929.log`。
- `npm run typecheck`、`npm run build`、`npm run build:web` 全部通过。日志分别为 `asa-trial-final-typecheck-20260929.log`、`asa-trial-api-build-20260929.log`、`asa-trial-web-build-20260929.log`，均在 E:\CodexTemp。
- 前端主 JS 1,361.48 kB（gzip 426.57 kB），仍有非阻塞的大包提示。测试环境的 Ant Design X Notification 不支持提示不影响结果。
- 独立 reviewer 已复查关闭 L1/L2 的四个 P2；主代理另外复核最新版本标签、真实下载和图片四边像素，未留未关闭的 P1/P2。
- 最后以编译 API + Vite preview 启动 `final restored`，恢复诊断 0。生产页二页历史仍显示最新 v34，v2 图片和审核状态重读一致；未配置图片服务时普通提交不重放终态，只有明确新建任务才生成新的请求号，没有外部服务调用。
- 最终生产页控制台 warn/error 为空，390px 窄屏无横向溢出。截图 `E:\CodexTemp\asa-trial-production-20260929.png`、`asa-trial-production-mobile-20260929.png`；验收 API 已输入 `stop` 正常退出，preview 已停止。

## 开发智能体

`.codex/config.toml` 设定主智能体 `gpt-6-astra / ultra`，子智能体 `gpt-5.6-luna / xhigh`。worker、reviewer、researcher 各有边界化角色文件。本轮子任务按显式模型/推理参数分派；仓库配置不证明正在运行的主会话已经热切换模型。

Codex 0.154.0 `app-server --strict-config` 加 `config/read` 实际读取上述模型配置；`skills/list` 实读发现三项 repo scope skills 均 enabled 且 errors 为空：

- [asa-engineering](.agents/skills/asa-engineering/SKILL.md)：施工、契约、测试与独立验收。
- [asa-content-workflow](.agents/skills/asa-content-workflow/SKILL.md)：事实、版本、审核和导出不变量。
- [asa-upstream-research](.agents/skills/asa-upstream-research/SKILL.md)：官方 API、源码路径、固定提交和许可证证据。

施工单与协作规范位于 `docs/agents`、`docs/tasks`。这些是开发规范，不是产品运行时知识库，也不是模型 API 密钥。

## GitHub 借鉴

已核查 AnythingLLM、Dify、InvokeAI、Vendure 的固定提交、核心源码路径及许可证；Flowise 的归档状态单列。借鉴来源/版本管理、任务快照、资产和交付关系；本轮未复制上游源码，未引入 Python 或整套上游运行时。不同许可证与模型权重许可不能混为一谈，细节见 [OPEN_SOURCE_REFERENCES.md](docs/research/OPEN_SOURCE_REFERENCES.md)。

## 后续实施

本地试用与后续开发的优先级、依赖和验收门槛见 [NEXT_STEPS.md](docs/tasks/NEXT_STEPS.md)。服务商尚未选定时，先推进可独立验收的试用完善切片。

1. 选定文字/图片服务，按适配器要求完成超时、认证、错误、取消能力和实际用量验证。
2. 用 5—10 个用户选定的真实商品试用，人工记录事实错误、原图一致性、修订次数与内容质量；合成 QA 不能替代这一步。
3. 按目标站点/类目落实 S8 本地化；S9 在真实账户与应用授权后实施官方接口预检、提交和回读。现有 12 个 marketplace 配置不等于 12 站点图文制作已经验收。

当前应用仍是本地单用户工作台；没有多人权限、联网部署、自动 Amazon 发布、PDF/OCR 或完整语义 RAG。历史分页已补齐，按状态/日期检索和前端分包可作为后续独立切片。
