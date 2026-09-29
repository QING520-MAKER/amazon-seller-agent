# 本地图文工作台交接

日期：2026-09-29。实现起点为 `ce20ea3`；本文件随 S4—S7 实现交付。提交与远端同步状态以 Git 历史为准。

用户授权为：先完成设计、Astra/Luna 规范和 skills，再按切片实现；文字及图片服务商稍后选择，先完成本地功能与适配接口。当前交付面向本地单人、US 英文普通单品。

## 当前功能

| 模块 | 实际能力 | 边界 |
| --- | --- | --- |
| 知识库 | 商品隔离、纯文本和 Markdown 导入、来源、搜索、不可变版本、确认与归档、生成时固定知识快照 | 没有 PDF/OCR、向量检索或跨商品品牌知识管理；确认是人工操作 |
| 文案 | 商品关联的关键词选择、模板生成、编辑、版本、批准/退回、JSON 导出 | AI 明确配置后才调用；本地模板使用商品字段，知识保存作审核依据；旧 CLI 契约保留 |
| 批量 | JSON 导入、最多 20 项固定输入、创建与执行分开、逐项失败隔离、明确新批次重试、重启恢复 | 不自动重放模型任务；不覆盖已有 SKU；没有常驻队列服务 |
| 图片 | 受控原图加独立文字层，真实生成 1600×1600 PNG，历史候选、原图对照、审核与下载 | 这是本地排版；没有模型生成的新场景或自动图像合规判断 |
| 内容包 | 固定文案和最多 9 张有序图片、草稿/正式 ZIP、不可变清单、审核和依据检查 | 本地批准不等于 Amazon 接受；正式包依据变化后拒绝下载 |
| 服务适配 | `ContentGenerator`、`ImageProvider` 可注入，未配置/失败/中断有明确记录 | 外部图片服务默认未配置；真实模型质量、计费、取消和提供方幂等没有联调证据 |

架构入口：[CONTENT_STUDIO.md](docs/architecture/CONTENT_STUDIO.md)；适配器要求：[PROVIDER_ADAPTERS.md](docs/architecture/PROVIDER_ADAPTERS.md)；路线状态：[IMPLEMENTATION_STATUS.md](docs/tasks/IMPLEMENTATION_STATUS.md)。

## 运行与存储

在仓库根运行 `npm run dev:ui`，打开 `http://127.0.0.1:5173/`。正式使用前设置独立 `ASA_DATA_DIR`；不要使用下面的合成 QA 目录作为真实商品库。非 watch API 的正常停服与整个数据目录备份步骤见 README。

数据库 schema v7，按 v1 商品、v2 文案、v3 知识、v4 批次、v5 图片、v6 内容包、v7 知识创建请求逐级迁移。已有迁移不重写，待执行迁移同一事务提交，失败整体回滚。备份整个目录：SQLite、`originals`、`derived`、`tmp`、`recovery`。只备份 SQLite 会丢失图片。

生成、编辑、审核和交付绑定具体版本；跨商品引用被拒绝。派生图发布前完整解码并校验大小/像素，发布不覆盖已有文件，读取再检查路径、哈希和内容。启动诊断保留孤立/缺失/损坏文件线索，不自动删除数据。模板、模型、图片和批次的失败不会冒充成功内容。

## 验证记录

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

下载限制：内置浏览器点击 ZIP 按钮后没有返回 download 完成事件，不能据此宣称浏览器下载已完整验收。下载 HTTP、Content-Disposition 和 ZIP 内容已有验证；在实际使用的桌面浏览器还需确认下载落盘。开发 HMR 期间曾出现临时代理连接失败及 hook 依赖变化提示；收尾改用编译后 API 与 Vite preview 的全新页面检查，知识/文案/图片/包历史正常，控制台 warn/error 为空，启动恢复诊断为 0。

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

当前应用仍是本地单用户工作台；没有多人权限、联网部署、自动 Amazon 发布、PDF/OCR 或完整语义 RAG。图片、包、批次页面当前读取近期记录，长历史浏览和检索可在真实使用量明确后补齐。
