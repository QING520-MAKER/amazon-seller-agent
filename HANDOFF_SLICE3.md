# 切片 3 交接：商品资料与原图管理

日期：2026-09-20。项目：Amazon Seller Agent。任务书：`CODEX_SLICE3_TASKBOOK_20260920.md`；执行补充：`SLICE3_EXECUTION_REVIEW_20260920.md` 的 R1–R5。

**最新状态（2026-09-20）：切片 3 收尾包独立复验通过，F1–F3/N1 已关闭；真实样品及其他环境边界不变。** 最新放行结论及本地提交登记见文末。以下首轮命令、230 项测试及当时“待复审/未提交”的记录保留为历史证据；合成资料验收不代表真实卖家产品验收。切片 4 尚未开始。

## 基线和环境

- 开始与结束 HEAD 均为 `824b6442f21af3af19cd1672f1818b0cd0bc77a5`。开始前已有 README 修改，以及未跟踪的 PROJECT_BRIEF/ASTRA_COLLABORATION；已保留原内容，只补充有证据的状态。原任务书副本与准备评审报告保留为历史材料。
- 实际系统：Windows 11 家庭版中文版，10.0.26200，x64，PowerShell；Node 22.23.2、npm 11.17.0、Node ABI 127。任务书所写 Windows 10 不是本次实测系统。
- 锁定 `better-sqlite3@12.11.1`、`@types/better-sqlite3@9.6.0`、`sharp@0.35.4`；实际 SQLite 3.53.2、libvips 8.18.6。没有引入 Python 或编译工具链。
- engines 改为 `^20.19.0 || >=22.12.0`，与既有 Vite 门槛一致；影响此前宽泛 `>=20` 中的早期 Node 20、Node 21、早期 Node 22。仅 Node 22.23.2 获得本次实测证据。

## 已完成的行为和文件

| 范围 | 文件与行为 |
|---|---|
| 契约 | `src/schemas.ts` 追加独立商品、资料快照、素材、分页、错误契约；旧契约段不变。只填 SKU+名称可创建；保存完整快照不允许缺键，空值可明确清空 |
| 元数据 | `src/storage/{settings,database,migrations}.ts`、`src/catalog/repository.ts`：三张业务表和迁移表；SKU binary 唯一；资料不可变；head 同商品外键；CAS/no-op；素材状态独立版本 |
| 原图 | `src/storage/files.ts`、`src/catalog/service.ts`：实际字节计数、SHA-256、严格解码/APNG 检查、同商品去重、独占复制、fsync、归档恢复、受控原文件读取、启动恢复诊断 |
| HTTP | `src/http/catalog-routes.ts`、`routes.ts`、`src/catalog/errors.ts`：新 `/api/products` 路由；错误结构化且不泄漏底层路径；Origin 检查；旧 app 工厂不初始化存储 |
| 生命周期 | `src/http/lifecycle.ts`、`server.ts`、`serve.ts`：固定端口先绑定；未就绪/排空阶段 503；跟踪断连后的业务 Promise；关闭数据库后释放端口；IPC 正常停服；初始化完成前的 stop 也保留 |
| 页面 | `apps/web/src/products/*`：列表搜索分页、空表单、详情编辑、409 草稿保留/复制/最新资料核对、只读历史、当前/移除原图、逐项上传结果、网络失败待确认 |
| 导航 | `App.tsx` 持续挂载 useWorkbench/useUploads；旧 Workbench 保持挂载并按 active 控制弹层；JSON 草稿、聊天草稿、在途结果在导航后保留；商品未保存离开提示 |
| 配套 | `.env.example`、`.gitignore`、package/lock、`vitest.config.ts`、README、页面 favicon、限定 `.products-*` 样式；新增 TSX 测试进入 Vitest 发现范围 |

未改 `src/cli.ts`、`src/graph/`、`src/providers/`、`src/scoring/`、`src/copywriting.ts`、旧 examples、intent 规则及 useWorkbench 内部语义。旧四项 CLI/API/工作台链路仍使用原有业务实现。

## 契约与任务书的实施补充

没有新增业务范围。R1–R5 均已落实：

1. draining 期间保留端口互斥，等待业务操作结束后 checkpoint/close，最后释放监听。浏览器断连不会导致在途持久化被漏计。
2. Windows `tsx watch` 作为可能强制结束子进程的开发入口，验证异常恢复；另加 `npm run start:api` 编译运行监督进程，输入 `stop` 走 IPC 正常排空。两种保证分开表述。
3. 按 PNG chunk 边界检测 acTL；不依靠 sharp 的 pages 字段判断 APNG。
4. 实际计数的 bounded reader，先限制再 multipart 解析；不只相信 Content-Length。文件 20 MiB、请求 21 MiB、4000 万像素/12000 单边；同时最多 2 个上传。新增 JSON 请求上限 8 MiB。
5. useWorkbench 位于常驻 App，Workbench 自身也保持挂载；JSON 编辑器可“暂存并关闭”，切页后重新打开仍保留草稿。

HTTP 路径和请求格式已列在 README。资料 no-op 仅对当前 base 返回 changed=false，旧 base 即使正文一致仍冲突。原图移除/恢复不新增资料版本；重传已移除的同 hash 原图不自动恢复。历史资料与当前原图库明确分开显示。

## 数据目录、迁移、备份

`ASA_DATA_DIR` 指向本机磁盘目录，建议 `E:\AmazonSellerAgentData`；未设置时由源模块/编译模块位置解析同一个应用根 `data`。运行数据、数据库附属文件、原图和备份不进 Git。

schema 版本 1；业务表为 products、product_revisions、original_assets，另有 schema_migrations。SQLite foreign_keys=ON、journal_mode=WAL、synchronous=FULL、busy_timeout=3000。迁移事务化；未知版本启动失败，保留原数据。恢复记录写入 recovery，保留中断/孤立文件，不自动导入或删除。

运行：根目录 `npm ci` → `npm run build` → 设置 ASA_DATA_DIR → `npm run start:api`；另一个窗口 `npm run dev:web`，访问 `http://127.0.0.1:5173/`。

备份：输入 `stop` 回车，等待 `Storage closed; safe to back up the complete data directory.` 及进程退出，然后复制整个数据目录。恢复时指向另一个目录，核对资料、版本、素材状态和原文件 hash。README 有可复制的 PowerShell 命令。开发 watch 被强制结束后，先用正常入口重开并正常关闭，再备份；不要单独复制运行中的主库或删除 WAL。

## 实际命令和验证结果

通用日志目录：`E:\CodexTemp\asa-slice3-review-20260920`。以下均为已执行结果。

| 命令/验证 | 结果 | 证据 |
|---|---|---|
| 基线 npm test | 11 文件 / 177 项通过 | baseline-test.log |
| npm ci --registry=https://registry.npmjs.org --cache=E:\CodexTemp\npm-cache --no-audit --no-fund | 独立空安装目录，退出 0，449 包；随后加载两原生模块成功 | `E:\CodexTemp\asa-slice3-ci-20260920\npm-ci.log`；SQLite 查询与 sharp raw 解码工具输出 |
| npm test | **19 文件 / 230 项通过；0 失败、0 跳过** | slice3-test.log |
| npx vitest run tests/catalog-http.test.ts tests/catalog-storage.test.ts | 末轮补强相同 SKU 并发与显式清空字段断言，26 项通过 | slice3-final-storage-http.log |
| npm run typecheck | API/Web 均退出 0 | slice3-typecheck.log |
| npm run build | 退出 0 | slice3-build.log |
| npm run build:web | 退出 0 | slice3-build-web.log |
| node browser-qa.mjs | 退出 0；Edge/Playwright 真浏览器 | `E:\CodexTemp\asa-browser-7P268o\qa.json`、server.log、截图 |
| node watch-backup-qa.mjs | 退出 0；真实 watch、独立进程、正常停服、备份恢复 | `E:\CodexTemp\asa-watch-backup-QD0IgF\qa.json`、server.log |
| CLI listing-create，ASA_DATA_DIR 指向现有普通文件 | 退出 0；资料存储不可用不影响旧 CLI | cli-with-unusable-storage.json |
| git diff --check | 无空白错误；Git 提示下一次操作会转换 CRLF | 工具输出 |

npm 的 prebuild-install/whatwg-encoding 弃用和 allowScripts 提示未阻断本次安装，实际原生模块可加载；未修改全局 npm 配置。jsdom 有原有 Notification API 不支持提示，故障测试有预期 INSUFFICIENT_STORAGE 日志。Web 包 1,266.52 kB（gzip 401.57 kB），仍有既有大型 chunk 提示，未为此重构工作台。

首次浏览器脚本因带图标按钮的精确 accessible name 选择器失败，调整选择器；第二次完成流程后发现 favicon 404，已补 favicon，最终完整重跑通过。首次 watch 临时入口使用 .ts 被按 CommonJS 解析，改为明确 ESM 的 .mts 后通过；仓库入口没有这个问题。早期探针失败不计为验收通过。

## A1–A20 证据映射

| 场景 | 实际证据 |
|---|---|
| A1 空库/最小输入 | catalog-contracts、catalog-storage、products-ui；浏览器空库创建 |
| A2 同 SKU 竞争 | catalog-http 两个并发请求一 201、一 409，版本总数无孤立；storage 大小写/trim |
| A3 完整快照/显式清空 | contracts 缺键拒绝；HTTP 422 不清空；storage 改名称/清品牌后规格与来源保留 |
| A4 并发编辑 | HTTP 200/409、storage 历史触发器/同商品 head；浏览器两个窗口保留草稿并核对最新 |
| A5 no-op | storage/HTTP changed=false、不加版本、旧 base 冲突 |
| A6 A/B 原图隔离 | storage/HTTP 不同商品同名不同字节与跨商品 ID 拒绝；浏览器 SHA 对照 |
| A7 重复/并发上传 | storage 并发同字节仅一条/一份文件；after-register 响应失败重试复用同 ID |
| A8 移除/重传/恢复 | storage/HTTP 归档状态保留、旧 version 冲突；浏览器下载/移除/恢复 |
| A9 无效图片 | HTTP 零字节、HTML、SVG、APNG、截断、metadata 成功但像素损坏均拒绝；错 MIME 正常图接受；storage JPEG EXIF/字节不变 |
| A10 限额 | HTTP 20 MiB 成功/+1 失败、12000 单边成功/超边超像素拒绝；有界读流低报长度/取消；lifecycle 实际 chunked HTTP |
| A11 故障一致性 | storage 临时写/复制前注入 ENOSPC、独占目标存在、登记前失败、登记后响应丢失；HTTP 507 不泄路径 |
| A12 跨进程重开 | lifecycle 子进程退出/重开；watch-backup 新进程验证资料版本、归档 version 和 SHA |
| A13 异常恢复/文件缺失 | lifecycle 在 temporary-written/file-copied/after-register 退出码 77 后重启；storage 缺失/同大小坏文件报错并保留记录 |
| A14 启动互斥 | lifecycle 初始化/排空 503、端口保留、断连后完成写入；watch-backup 第二进程 EADDRINUSE 且目录未创建 |
| A15 迁移/备份 | storage 未知 schema 不清库、重复重开；watch-backup 正常停服后整目录复制，另一进程读回 |
| A16 Windows 路径/watch | storage 中文空格目录；真实 tsx watch 修改临时入口后重启；结束后目录可改名，编译入口可重开 |
| A17 前端异步隔离 | products-ui A/B 乱序、网络错误不当空库；products-uploads 捕获 productId/顺序上传/混合成功失败；浏览器混合文件提示 |
| A18 旧工作台 | app-navigation/workbench-state 保留草稿和后台请求；result-actions 复制下载 DOM 回归；浏览器 JSON 草稿保留及四任务成功 |
| A19 CLI/API | 原有 177 项全部通过；旧业务文件 diff 为空；业务外部 HTTP mock |
| A20 真实浏览器 | 1440×960 与 390×844；创建、编辑、409 修正、上传预览、历史、下载、重启回读；无横向溢出/框架错误层/非预期控制台错误 |

浏览器标题 `ASA · 卖家工作台`，入口 `http://127.0.0.1:5173/`。合成的 409 冲突和 415 图片拒绝会形成预期的 HTTP 错误日志，已与脚本/渲染异常区分。全部验收进程已停止，未启动永久数据目录。

截图位于 `E:\CodexTemp\asa-browser-7P268o`：01-upload-result、02-edit-conflict、03-history、04-workbench、05-desktop-list、06-mobile-list、07-mobile-detail（均为 .png）。测试脚本也保存在通用日志目录，可供本机复现。

## 外部依赖与未验证范围

- 自动化测试拦截未 mock 的 fetch；CLI 子进程和浏览器旧 research/pipeline 使用 autocomplete-preload；LLM 测试 mock 模块。新商品持久化使用真实临时 SQLite/文件系统/合成图。没有依赖真实 Amazon 或 LLM 响应。
- 本片没有接通保存商品到 LLM/Listing 生成、文案版本、图片生成、批量任务、多人认证或平台发布；没有导入真实产品/客户照片。
- Windows 10、Node 20、其他系统/Node 版本、实际断电和网络共享均未验收。进程故障恢复不等于承诺 OS/硬件掉电绝对无损。
- 使用 offset 分页；并发插入时列表可能移动，最终写操作依赖服务端版本/hash 约束。上传结果待确认会遍历当前/归档分页核对并允许幂等重试；刷新页面会丢失尚在内存中的草稿/上传队列。
- 启动恢复逐一检查已登记原图 hash，大图库的启动耗时没有做性能基准；有界解码允许高分辨率图片，容量与性能仍应在真实使用量下评估。

## 首轮独立评审建议（历史记录）

首轮建议独立核对：Windows 目标部署环境的安装/正常停服；CAS 与文件/数据库失败一致性；页面资料不自动填示例、历史不固定原图库的语义；真实样品录入时的缺项提示。首轮测试未发现阻塞；随后独立评审发现的缺口及本轮修正如下。

先独立验收本片，再细化切片 4。交接只传白名单源码、配置、文档、测试与合成证据；不要传 .env、整个数据目录、凭据或客户原图。没有自动向网页端会话发送材料，也没有编造会话链接。

## 2026-09-20 收尾修复：独立评审 F1–F3、N1

用户请求为“收尾切片3”。已核对附件评审与本地实现，按现有切片边界修复四项问题。原评审已原样保存为 [ASA_SLICE3_INDEPENDENT_REVIEW_20260920.md](ASA_SLICE3_INDEPENDENT_REVIEW_20260920.md)。没有开始切片 4，没有提交或向外部会话发送代码。

### 本轮基线

- Git HEAD 仍为 `824b6442f21af3af19cd1672f1818b0cd0bc77a5`；修复基线是首轮未提交实现包，不能把本轮 delta 当作直接适用该 HEAD 的完整切片补丁。
- 首轮 ZIP SHA-256：`0a755eabfcabc3ea27375daccaada8787e958763c41981e005ef836b570b106c`，与独立评审所列完全一致。
- 独立评审 Markdown SHA-256：`3c41d032e01fdeb234dbab78b8a27066d38b7a1b4fede8e92c24270ac1a24a1e`。
- 本轮仍在 Windows 11 x64 / Node 22.23.2 / npm 11.17.0 执行，未改依赖、数据库模型、HTTP 契约或旧 graph/CLI/生成语义。新增 9 项风险回归，没有把原测试总数简单视为本轮全量执行结果。

### 修正与证据

| 问题 | 改动 | 验证 |
|---|---|---|
| F1 初始化失败悬挂 | server 初始化异常清理完成后设置 exitCode=1 并主动 disconnect IPC，让子进程自然退出并刷新日志；监督器随后返回非零 | 测试从当前源码编译到临时目录，运行真实 serve.js；端口占用、数据路径为普通文件均在失败日志后 4 秒内退出 1，失败实例不创建/改写数据。正常 ready→stop 退出 0，提前 stop 回归保留。另实际执行 npm run start:api 验证 EEXIST 自动退出 1 |
| F2-A 旧 GET 覆盖保存结果 | ProductDetail 统一接受详情快照，同时提升请求序号并取消较早 GET | 延迟上传触发的 v1 GET，先完成保存并显示 v2，再释放旧响应，标题、版本、事实和再次编辑均保留 v2；React 与浏览器均通过 |
| F2-B 重新载入未同步父级 | ProductForm 增加独立 onReloaded，更新父级详情而保持编辑状态；不冒充保存成功 | 409→载入最新→取消→再编辑，详情及输入保持最新；后续保存使用新的 baseRevisionId。React 精确验证 v2；浏览器连续验证 v3→v4 |
| F3 载入覆盖新草稿 | 保存、查看最新、放弃并载入共用操作锁；等待期间禁用字段、保存、取消与重复读取，显示载入状态；失败仅报告错误并解锁 | 成功/失败两条延迟 Promise 回归；重复点击只确认/GET 一次；程序触发 submit 也不并发保存。浏览器注入 503 后旧草稿和未保存状态保留，能继续编辑及重新载入 |
| N1 更新时间倒退 | 登记事务使用当前时间更新商品，并以 MAX 保证不低于已有 updated_at；原图 createdAt 不变 | before-register 控制“图片暂存→资料保存→图片登记”，分别验证正常时间推进和时钟回退；商品时间不倒退、资料 v2/原图 SHA 不变 |

生产代码仅修改 `src/server.ts`、`src/catalog/repository.ts`、`apps/web/src/products/ProductDetail.tsx` 和 `ProductForm.tsx`。回归测试扩充 `tests/catalog-lifecycle.test.ts`、`tests/catalog-storage.test.ts`、`tests/products-ui.test.tsx`。`serve.ts` 无需修改，未引入重试定时器、迁移或新依赖。

### 实际执行结果

本轮日志目录：`E:\CodexTemp\asa-slice3-closeout-20260920`。先在未修复实现上确认缺陷，再修改生产代码。

| 命令/检查 | 本轮结果 | 日志 |
|---|---|---|
| 修复前 UI/storage 定向测试 | 6 项新增断言失败，15 项通过，明确复现 F2/F3/N1 | regressions-before.log |
| 修复前 compiled supervisor 定向测试 | 端口占用/普通文件两项超时失败；正常启动退出通过；6 项非目标用例被筛除 | supervisor-before.log |
| npx vitest run tests/catalog-lifecycle.test.ts tests/catalog-storage.test.ts tests/catalog-http.test.ts tests/products-ui.test.tsx tests/app-navigation.test.tsx tests/products-uploads.test.ts | **6 文件、50 项全部通过，0 失败、0 跳过** | targeted-tests.log |
| npm run typecheck | API/Web 均退出 0 | typecheck.log |
| npm run build | 退出 0 | build.log |
| npm run build:web | 退出 0；仍有既有大 chunk 提示，1,267.04 kB/gzip 401.73 kB | build-web.log |
| npm run start:api，数据目录指向普通文件 | 自行退出 1；无需 stop/kill；验证脚本断言通过退出 0 | start-api-failure.log |
| 'stop' 管道输入 npm run start:api | 提前停服请求保留；打印安全备份提示；退出 0 | start-api-early-stop.log |
| node closeout-browser-qa.mjs | 退出 0；见下方浏览器验收 | browser qa.json/server.log |
| git diff --check | 无空白错误 | 本轮工具输出 |

没有重复未受影响的全量 230 项验收；首轮全量日志仍是历史证据。本轮持久化使用真实临时 SQLite/文件与合成图，外部业务 HTTP 仍为 mock/禁止未 mock 请求。编译监督器测试使用当前源码与相同 node_modules，不依赖旧 dist；临时目录位于 E 盘。

### 浏览器验收

Browser plugin not available，使用既有临时 Playwright + Edge，无新增项目依赖。地址 `http://127.0.0.1:5173/#/products/<id>`，标题 `ASA · 卖家工作台`；桌面 1440×960，窄屏 390×844。

目标路径：详情编辑 → 延迟上传刷新 → 保存 → 冲突载入最新 → 取消/再次编辑；以及延迟载入时重复操作、载入失败后继续编辑与重试。

| 检查 | 结果 |
|---|---|
| 页面身份、非空内容 | 通过 |
| F2 两条交互路径 | 通过，最新详情与再次编辑的基线一致 |
| F3 等待/失败/重复操作 | 通过，等待期间锁定，失败保留草稿并恢复操作 |
| 框架错误层、布局 | 无错误层，桌面/窄屏无横向溢出 |
| 控制台 | 仅两次故意制造的 409 和一次注入的 503；无非预期脚本/渲染错误 |
| 截图 | 已查看锁定表单与窄屏最终详情，相关截图全部随包提供 |

证据：`E:\CodexTemp\asa-closeout-browser-jlx58T\qa.json`、server.log、01-reload-locked.png、02-reloaded-detail.png、03-reload-failure-keeps-draft.png、04-mobile-final-detail.png。脚本位于 `E:\CodexTemp\asa-slice3-review-20260920\closeout-browser-qa.mjs`。验收进程已全部停止。

### 收尾结论与剩余边界

F1–F3 和 N1 均已修复并通过本机定向复验，可回传增量供评审方确认。独立评审方尚未对修复包作二次放行，不将本机复验冒称独立复审通过。

Windows 10、Node 20、其他浏览器、真实卖家样品、大图库性能、实际断电仍未验证；保持原范围，不新增门槛。修复包包含相对于首轮实现的 delta、完整修改文件、测试源码、日志与合成截图，不含运行数据库、.env、密钥或客户原图。

## 2026-09-20 收尾包独立复验通过

依据原样归档的 [ASA_SLICE3_CLOSEOUT_REVIEW_20260920.md](ASA_SLICE3_CLOSEOUT_REVIEW_20260920.md)，切片 3 在约定范围内已放行，F1–F3 和 N1 全部关闭，没有本轮新增阻塞。此前“待评审方复核”的段落反映修复包提交评审时的状态，最新状态以本节为准。

- 复审报告 SHA-256：`eeac313c37afe4533ae5d1a7cd23405cad6bca4e7a227fa07b7e82313ff880f5`。
- 被复审收尾 ZIP SHA-256：`fa3fda4c2b3964e5e4cf64a4363a7c47b61b7d8a75a83b28e805566cc2038254`，本地已核对一致。
- 评审方在 Linux x64 / Node 24.19.0 独立运行 5 文件、41 项定向测试，类型检查、API 构建及 4 个真实监督器进程场景，均通过；delta 实际应用结果与 11 个交付文件一致。
- 评审方核阅了本地 Windows 50 项定向测试及 Edge 桌面/窄屏证据，没有冒称在 Windows 重跑或独立进行真实浏览器/Web 打包。独立 41 项与 4 个进程场景不混算。
- 本次提交准备核对当前 46 个交付文件，全部与已评审清单 SHA-256 一致；本轮仅更新三份状态文档、归档复审报告并提交既定切片范围，不重复未受影响的业务测试。
- Windows 10、Node 20、真实卖家样品、其他浏览器、大图库性能、网络共享及实际断电的未验证边界保持不变。下一步可以细化切片 4，本轮没有新开任务或开始其实现。

### 本地提交登记

用户已明确授权更新文档并提交切片 3。实际提交号将在 Git 提交成功后登记；`824b644` 仅为实现前基线，不是切片 3 完成提交。提交范围包括已评审实现、收尾修复、对应测试、配置及交接材料，排除运行数据、.env、凭据、客户原图和临时验收产物。
