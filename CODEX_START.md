# Codex 开工提示词

把下面「提示词正文」整段复制给 Codex。先用 File → Open Folder 打开 `E:\Develop\amazon-seller-agent`。

---

## 提示词正文

你在仓库 `E:\Develop\amazon-seller-agent` 里做 **Phase 1 实现**，不要重建项目。

这是一个 TypeScript + LangGraph.js + Zod 的亚马逊卖家智能体骨架。目标：让本地 CLI `asa` 真正跑通选品研究和 Listing 生成/审计。先读 `HANDOFF.md`、`AGENTS.md`、`src/schemas.ts`、`src/graph/`，再按顺序改代码。

### 已经写好，不要重写

- `src/marketplace.ts`、`src/schemas.ts`、`src/config.ts`
- `src/scoring/keywords.ts`
- `src/graph/state.ts`、`src/graph/index.ts` 的图结构
- `src/cli.ts` 的命令面
- `examples/*.json`（camelCase）
- `tests/contracts.test.ts`

### 图必须保持

```
START --routeIntent--> runResearch | createListing | auditListing
runResearch --afterResearch--> createListing | END
createListing --> END
auditListing --> END
```

`intent === "pipeline"` 时先 `runResearch` 再 `createListing`。  
节点名不能和 state 字段同名（不要再用 `research` 当节点名，研究报告字段是 `researchReport`）。

### 按这个顺序实现抛错的桩

1. `src/providers/autocomplete.ts` → `AutocompleteClient.suggestions`
   - 只允许公开补全接口：`https://completion.{domain}/api/2017/suggestions?mid={marketplaceId}&alias=aps&prefix=`
   - 前缀：`""`、`"best "`、`"cheap "`、`"top "`
   - `deep=true` 再扩 `{keyword} a` … `z`
   - 去重、trim、按 `autocompleteDelayMs` 限速
   - 测试必须 mock `fetch`，CI 禁止打真实 Amazon

2. `src/scoring/opportunity.ts` → `scoreOpportunity`
   - 只根据长尾数量和意图比例打 1–10 分
   - 禁止编造搜索量、BSR、竞品数量

3. `src/scoring/coverage.ts` → `coverageReport`
   - 标题/五点/描述不区分大小写匹配
   - `covered` / `partial` / `missing`

4. `src/scoring/listing.ts` → `auditListing`
   - 8 维总分 100：Title 15、Bullets 15、Images 15、A+ 10、Description 10、Pricing 10、Reviews 15、SEO 10
   - 缺字段就保守打分，并在 `notes` 说明

5. `src/copywriting.ts` → `generateListing`
   - 默认模板生成，不依赖 API Key
   - 标题：Brand + 主词 + 1–2 属性 + 差异点，≤200
   - 5 条 bullet：`BENEFIT HEADER — body`，每条带一个关键词，各 ≤500
   - 描述 ≤2000；剩余词进 backend search terms，≤249 bytes
   - 只有设置了 `OPENAI_API_KEY` 才可用 `@langchain/openai` 润色

6. `src/graph/nodes.ts`
   - `researchNode` 写入 `state.researchReport` 和 `state.keywords`
   - `listingCreateNode` / `listingAuditNode` 写入 `state.listingResult`
   - 返回前用 Zod schema 校验

### 硬限制

- 只用 TypeScript，不要引入 Python
- 不要登录 Seller Central，不要 cookie/密码，不要抓商品详情页
- 第一期不要接 SP-API，不要做 PPC/FBA/库存
- 不要把 Amazon-Skills 整仓拷进来
- 输出必须符合 `src/schemas.ts`

### 完成标准

```bash
npm install
npm test
npm run typecheck
npx tsx src/cli.ts --help
npx tsx src/cli.ts research "portable blender" -m us --out reports/research.json
npx tsx src/cli.ts listing-create -i examples/listing_create.json
npx tsx src/cli.ts listing-audit -i examples/listing_input.json
npx tsx src/cli.ts pipeline "portable blender" -p examples/product_brief.json
```

三条命令都要吐出合法 JSON。覆盖率必须算出来，不能写死。实现完后补测试，简要说明改了哪些文件。
