# 切片 3 任务书评审与执行准备

日期：2026-09-20。结论：**方案可实施；执行时合并下列补充，不能把本报告当作切片 3 已完成。**

本轮用户请求是“评审任务书准备执行”。已完成当前仓库核对、原有验证重跑、Windows 原生依赖试装及针对性复现；业务实现尚未开始。

评审对象：[原任务书](CODEX_SLICE3_TASKBOOK_20260920.md)。该文件从 Downloads 原样复制，SHA-256 为 `00363B882E48F958106F4932C2C4D389F3063896337F9FA753DF8F22321E750D`。原文保留，本文记录实施补充与新证据。附件中要求“完成全部实现”的文字属于待执行方案，本轮未据此扩大用户请求。

## 1. 基线与兼容性结论

| 项目 | 本次实查 |
| --- | --- |
| 工作区 | `E:\Develop\amazon-seller-agent` |
| HEAD | `824b6442f21af3af19cd1672f1818b0cd0bc77a5`，与任务书指定基线一致 |
| 开始前未提交状态 | `README.md` 已修改；`PROJECT_BRIEF.md`、`ASTRA_COLLABORATION.md` 未跟踪。均保留，本轮未改动 |
| 实际系统 | Microsoft Windows 11 家庭版 中文版，10.0.26200，x64；任务书中的 Windows 10 不是实测系统 |
| Runtime | Node 22.23.2、npm 11.17.0、Node 模块 ABI 127 |
| 既有锁定版本 | Hono 4.13.7、@hono/node-server 2.1.1、Zod 3.25.76、tsx 4.23.13、Vite 7.3.6、React 19.3.0 |
| 临时目录 | `E:\CodexTemp\asa-slice3-review-20260920`；TEMP/TMP 均指向 E 盘 |

任务书对现有源码的七项兼容判断成立。三张业务表、不可变资料版本、商品 head 归属约束、SKU 数据库唯一约束、资料与素材分别做乐观锁、原始字节去重以及受控文件读取，均与当前架构兼容。商品接口独立于 LangGraph、存储配置独立于旧 Settings 的划分适合本片。

继续保留的业务选择：仅本地单工作空间；SKU 新建后只读且区分大小写；不补示例事实；资料版本不固定原图库；不加入 LLM、生图、批量导入、Amazon 写入或永久删除。没有需要用户另作业务取舍的冲突。

## 2. 必须落实的实施补充

### R1 · P1：关机期间必须继续持有端口互斥

对应原文 §6.5，第 357、364 行；现有入口 `src/server.ts`。

“先停止接收，再等待在途操作”不能直接实现成先调用 `server.close()`。本机复现：第一个服务有未结束的请求时，调用 close 后，第二个服务已经能够绑定相同端口，而第一个 close 回调尚未运行。此时第二个实例若开始恢复扫描，会和旧实例尚在进行的上传/登记重叠。

实施顺序明确为：

1. 切换到 draining，继续持有监听端口；所有新业务请求返回结构化 503。
2. 等待已登记的持久化操作完成，包括浏览器断开后仍在运行的操作；不能只计算活跃 TCP 连接。
3. 关闭相关文件句柄，完成 checkpoint 和数据库 close。
4. 最后关闭监听、释放端口并退出。初始化失败也按已取得资源的逆序收尾。

扩充 A14：旧实例进入 draining 且仍有上传时，第二实例必须绑定失败且不触碰存储；旧实例完全结束后，新实例才允许初始化。Node 的 close 语义见[官方文档](https://nodejs.org/api/net.html#serverclosecallback)。

### R2 · P1：Windows watch 重启不等于优雅退出

对应原文 §6.5 与 A16；现有 `dev:api` 使用 `tsx watch`。

本机子进程注册 SIGTERM 后，父进程调用 `child.kill('SIGTERM')`，子进程被终止但 handler 没有执行。锁定的 tsx 4.23.13 watch 实现使用子进程 kill 重启。因此仅注册 SIGINT/SIGTERM 不能证明开发重启会等待上传、checkpoint 或关闭句柄。该判断来自本机信号探针和已安装 tsx 源码；尚未跑完整 watch + 应用存储验收。Windows 的 kill 语义也有[官方说明](https://nodejs.org/api/child_process.html#subprocesskillsignal)。

执行默认：保留 watch 作为开发入口，将其强制重启纳入 A13/A16 的异常恢复测试；补一个不带 watch 的正常运行入口，并为备份提供可等待完成的应用级关闭通道，优先本机父子进程 IPC。关机入口调用 R1 的同一关闭逻辑。不要新增未经约束的 HTTP 管理接口。

若最终要求 watch 也保证排空操作，应使用先发送 IPC 关闭请求、等待退出、超时才强制终止的监督器。交接中必须分别报告“正常停服已排空”和“强制结束后可恢复”，不能用其中一个替代另一个。

### R3 · P1：拒绝 APNG 需要独立检查动画块

对应原文 §6.3、A9。这是实现方法的补充，原文已经要求拒绝 APNG。

sharp 0.35.4 / libvips 8.18.6 对本轮带有效 CRC 的双帧合成 APNG 返回 `format=png`、`pages=undefined`；即使 `failOn: 'warning'` 后执行完整 raw 解码也成功。只检查格式、pages 和完整解码，会误收任务书明确排除的动画文件。

实施时按 PNG chunk 边界和长度扫描，发现 `acTL` 就拒绝；不能对任意字节做字符串搜索。畸形 chunk 长度/截断也要拒绝。普通 JPEG/PNG 仍执行签名、metadata、尺寸与严格完整解码验证，保存上传原字节。对 acTL 帧数为 1 的文件也采用拒绝策略，避免浏览器/解码器行为分歧。PNG 动画标志的定义见[W3C PNG 规范](https://www.w3.org/TR/png-3/#acTL-chunk)。

扩充 A9：真实具有 acTL/fcTL/fdAT 的合成样本，不能只测试改名文件或把 pages mock 为 2。

### R4 · P2：上传限额不能仅套用 Hono bodyLimit

对应原文 §6.3，第 334 行。原文“不能只相信 Content-Length”的要求正确，选用中间件时要保留这一要求。

Hono 4.13.7 的 bodyLimit 在存在 Content-Length 且没有 Transfer-Encoding 时直接依据声明值放行，不再计算真实字节。本轮在 `app.request()` 中设置限额 8 字节：无长度头的 16 字节 body 得到 413；声明长度为 1 的同一 body 得到 200。这是内存 Request 层的复现，**不等于已经证明 Node HTTP 线上协议可以用短长度头绕过分帧**。

实施使用实际字节计数的 bounded reader，再解析受限 multipart；长度头仅用于提前拒绝。总请求 21 MiB、单文件 20 MiB，严格验证只有一个 file 且无未知字段。适配器真实 HTTP 的 chunked/no-length 请求和内存 Request 都要测；超限后取消 reader、释放本次临时资源。

此外，为新商品 JSON 写请求明确 8 MiB 总正文上限，超限用 `413 REQUEST_TOO_LARGE`，不复用上传提示。该上限能容纳任务书中全部字段即使使用 JSON Unicode 转义时的合法最大快照。仅限制新增接口，旧 API 语义不变。采用业务层有界上传准入（建议同时 2 个），避免已读入的多个请求无限排队等待解码；进程级 sharp 并发参数不能替代请求数量控制。Hono 中间件的头部优先行为见[官方说明](https://hono.dev/docs/middleware/builtin/body-limit)。

### R5 · P2：工作台还需保留 JSON 编辑草稿

对应原文 §4.1，第 158 行；`apps/web/src/components/Workbench.tsx` 第 28–32 行。

提升 useWorkbench 可保留聊天输入、消息与请求，但 JSON 编辑器 `editor` 和 `editorError` 是 Workbench 自身状态。条件卸载页面会丢掉尚未提交的结构化请求编辑。

执行默认：useWorkbench 与 JSON 编辑草稿状态提升到始终挂载的 App 或其持久 controller，由 Workbench 接收；切换页面可关闭弹窗，但再次打开时恢复草稿。A18 加入“编辑 JSON 未提交 → 商品 → 工作台”的回归。

不要把未提升的 useWorkbench 简单包进隐藏 Activity 来解决生命周期：React 会清理隐藏 Activity 子树的 Effect，这会触发现有 hook 的 abort 清理。若采用 Activity，管理请求的 hook 必须在边界外。参见[React 官方说明](https://react.dev/reference/react/Activity)。

## 3. 已选定的执行默认值

- 依赖候选：`better-sqlite3@12.11.1`、`sharp@0.35.4`；实施时增加适配的 TypeScript 类型依赖，并精确锁版本。未改项目 package.json/package-lock.json。
- 本机实测开发环境为 Node 22.23.2。npm 当次查询的 better-sqlite3 最新版 13.0.3 要求 Node >=22，不能不加说明直接升级；12.11.1 的 engines 包含 20.x，但本轮没有验证 Node 20。sharp 候选要求 >=20.9，Vite 当前要求 ^20.19 或 >=22.12，根包现有 `>=20` 本就不足以描述整个 UI 工作区。
- Node 20 已被[官方发布表](https://nodejs.org/en/about/previous-releases)标为 EOL。下一步文档明确 Node 22 的实测环境，任何 engines 收紧都要记录影响，不宣称 Windows 10、Node 20 或其他 Node 版本已验收。
- SQLite 实测 3.53.2；满足任务书要求的 WAL-reset 修复版本门槛，仍需按实际 SELECT 结果验收。修复范围见[SQLite 官方说明](https://www.sqlite.org/wal.html#walreset)。
- 写接口 Origin 明确枚举 `http://127.0.0.1:5173`、`http://localhost:5173`、`http://127.0.0.1:8787`、`http://localhost:8787`；缺省允许本地脚本，字符串 `null` 或其他 Origin 拒绝。UI 通过现有 Vite 同源代理，不需要通配 CORS。
- 数据目录沿用任务书：正常用户目录建议 `E:\AmazonSellerAgentData`，未设置时解析模块位置确定的仓库根 data；本轮未创建或操作永久数据目录。
- 路由仍用简单 hash，SKU 仍只读，完整资料快照仍严格检查键存在。新建和保存共用同一规范化规则，旧 ProductBriefSchema 原样保留。
- 安装时默认镜像曾发生 ECONNRESET；仅本次临时试装用命令级官方 registry 成功，没有改全局 npm 配置，也没有引入 Python/C++ 编译链。

## 4. 本轮实际验证证据

日志及独立探针保存在 `E:\CodexTemp\asa-slice3-review-20260920`。

| 命令/验证 | 实际结果 | 日志 |
| --- | --- | --- |
| git status/rev-parse、Node/npm、系统信息 | 基线、已有改动和环境已核实 | 本轮工具输出；上表记录 |
| npm test | 退出 0；11 个文件、177 项通过；无失败/跳过 | baseline-test.log |
| npm run typecheck | 退出 0；API 与 Web 都通过 | baseline-typecheck.log |
| npm run build | 退出 0 | baseline-build.log |
| npm run build:web | 退出 0 | baseline-build-web.log |
| 临时目录 npm install --ignore-scripts，默认镜像 | 退出 1，下载 ECONNRESET | install.log |
| 同一临时目录，命令级官方源安装 | 退出 0，添加 41 个包 | install-official.log |
| 手动运行 prebuild-install，仅获取预编译包 | 退出 0，Windows x64 / ABI 127 二进制加载成功；无编译回退 | prebuild.log |
| node native-smoke.mjs | 退出 0；ESM import、磁盘 SQLite、WAL、事务回滚、JPEG/PNG 完整解码、截断拒绝通过 | native-smoke.log |
| 子进程重开原数据库/原图 | 关闭并重命名中文空格目录后，另一 Node 进程成功重开；integrity_check=ok；两文件 hash 一致 | native-smoke.log |
| 合成 APNG | 复现 pages 缺失且完整解码接受，形成 R3 | native-smoke.log |
| node http-probes.mjs | 退出 0；复现 R1、R4 | http-probes.log |
| node signal-probe.mjs | 退出 0；Windows kill 不执行已注册 SIGTERM handler，形成 R2 | signal-probe.log |

HTTP 探针最初因 Windows ESM 绝对路径用法错误退出 1，改成 pathToFileURL 后复跑成功；该失败属于探针，不是仓库缺陷。上述 SQLite/图片探针验证依赖可行性，**没有验证尚不存在的商品存储实现**。

基线测试使用仓库现有 node_modules，未重新运行 npm ci。测试 setup 拦截未 mock 的 fetch；CLI 子进程使用既有 autocomplete preload；LLM 模块由测试 mock。基线业务测试没有依赖真实 Amazon/LLM 网络。依赖下载和公开官方文档核查属于独立的准备工作。

已有非阻塞提示：jsdom 不支持 Notification API；Web 包约 1.24 MB，Vite 提示 chunk 超过 500 kB。这两项均未导致基线检查失败，也不作为本片重写工作台的理由。临时依赖安装另有 prebuild-install 上游弃用提示，预编译下载实际成功。

## 5. 实施顺序与通过条件

| 步骤 | 交付 | 本步通过条件 |
| --- | --- | --- |
| 0 · 已完成准备 | 基线证据、候选依赖和本文补充 | 原有 177 项回归及本机 native smoke 已通过 |
| 1 · 契约 | schemas 独立新段、contracts 测试、依赖锁 | 最小新建可保存；完整快照缺键被拒；未知字段拒绝；旧契约不变 |
| 2 · 元数据 | 独立 settings、迁移、SQLite repository/service | 同商品 head 外键、创建事务、SKU 竞争、revision CAS/no-op、未知迁移版本失败；跨进程重开 |
| 3 · 原图 | 原字节存储、受限读流、APNG 检查、hash 去重、逻辑归档 | A6–A13；独占目标不覆盖，失败仅清理自有文件，提交不确定时查库再处理，隔离临时/孤立文件 |
| 4 · API 与生命周期 | 注入 catalog、结构化错误、Origin、受控内容读取、启动/关闭 | 旧 app 工厂仍无磁盘副作用；新缺服务返回 503；R1/R2/R4 通过；双实例与备份恢复验证 |
| 5 · 页面 | 商品列表/详情/版本/表单/原图；导航保留工作台状态 | A17/A18 与 R5；失败保留草稿；409 可核对与放弃；跨商品异步响应不串写；新 .tsx 被 Vitest 发现 |
| 6 · 全量验收/交接 | 两端构建、真实浏览器、README/配置、HANDOFF_SLICE3 | A1–A20 都有证据；桌面/窄屏、重启回读、冲突、失败上传和旧工作台；停服备份换目录 hash 一致 |

每步先验证关键行为再进入下一步。新增依赖锁定后补跑 npm ci 验证可复现安装；存储与 API 完成前可使用合成数据，不导入真实产品或图片。任何应用内测试服务和失败钩子仅用于临时目录，不开放第二套生产写入口。

退出/故障测试需要显式操作句柄和 Promise 注册表；浏览器断连后继续提交的操作不能失去追踪。上传结果待确认时，重读含分页的素材清单后仍无法确认，应保留“待确认”并允许 hash 幂等重试，不能因第一页没找到就判定未保存。

## 6. 尚未完成与下一个动作

尚未实现商品契约、数据库迁移、商品 API、图片存储或新页面；未运行切片 3 的 A1–A20，也未做本轮真实浏览器或真实商品验收。尚未验证 Windows 10、Node 20、完整 watch 重启、应用级停服备份及异常进程恢复。原有基线检查与依赖探针不能替代这些验收。

本轮仓库仅新增原任务书副本与本评审文件；未修改业务源码、依赖清单或锁文件，未提交 Git。既有三项文档改动保持原样。执行准备已经完成：后续从步骤 1 开始，按原任务书加 R1–R5 实施；不需要重新讨论三表模型或扩大到切片 4。
