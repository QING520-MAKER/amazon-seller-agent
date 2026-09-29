# S5–S7 本地图文交付施工单

用户已确认服务商稍后决定，先完成本地能力和适配接口。主代理 Astra 拥有公共契约、迁移顺序、运行时装配、导出整合与验收；worker 均显式采用 `gpt-5.6-luna / xhigh`。

## 数据与行为

- S5：JSON 批量导入最多 20 个商品，逐项结果保留；批量文案固定每个商品的资料/知识/基准版本及 requestId，顺序执行，逐项状态持久化。失败项通过新请求明确重试，成功产物不覆盖。意外重启未完成状态变中断，不自动重放模型请求。
- S6：选择同商品的有效原图和已确认知识；固定图片方案、输入版本和任务。真实本地 1600×1600 卖点图用 sharp 保留原图并独立排字。场景/模型生图走 `ImageProvider`，未配置返回明确失败；不得用 mock 图进入正式数据。派生图独立存储，不覆盖原图；全量解码校验、像素/大小/并发限制、哈希回读、不可覆盖发布。
- S7：审核绑定具体候选，资料/知识/原图状态变化需复核。内容包固定一份文案和有序图片，正式包创建与下载均核对批准和过期状态；旧包清单不可变，草稿明确标记。导出 ZIP 包含文本、JSON 清单与图片。

## 所有权

- Astra：`src/schemas.ts`、`src/image/provider.ts`、共享存储安全入口、`src/packages/*`、集成挂载与最终 migration。
- 图片 worker：`src/image/{migration,repository,files,service,routes}.ts`、`tests/image-*.test.ts`。
- 批次 worker：`src/batch/*`、`tests/batch-*.test.ts`。
- UI worker：`apps/web/src/{image,packages,batch}/*` 与指定页面挂载；不同时编辑其他 worker 正在使用的文件。

必须读取 `.agents/skills/asa-engineering/SKILL.md` 和 `asa-content-workflow/SKILL.md`；前端同时采用 React 最佳实践。每次分派补充精确接口。测试外部调用全部 mock，涵盖跨商品、幂等、失败隔离、重启、不可变和导出。真实服务/多语言/平台发布依赖后续配置，保持未启用，不宣称已联调。
