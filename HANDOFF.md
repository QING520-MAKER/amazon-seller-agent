# HANDOFF — Phase 1 for Codex

Work in `E:\Develop\amazon-seller-agent`.  
Stack is **TypeScript + LangGraph.js + Zod**. Do not add Python. Do not expand scope.

## Goal

A local CLI (`asa`) that runs one LangGraph:

1. Research a seed keyword via Amazon **public autocomplete**
2. Create or audit listing copy from **user JSON**
3. Chain `research → listingCreate` when `intent === "pipeline"`

Inspired by MIT [Amazon-Skills](https://github.com/nexscope-ai/Amazon-Skills), not a fork of that repo.

## Already done (do not rewrite)

- `src/marketplace.ts` — 12 marketplace domain / marketplaceId / language
- `src/schemas.ts` — Zod contracts and exported types
- `src/config.ts` / `.env.example`
- `src/scoring/keywords.ts` — commercial / informational / niche
- `src/graph/state.ts` + `src/graph/index.ts` — compiled StateGraph
- `src/cli.ts` — `research`, `listing-create`, `listing-audit`, `pipeline`
- `examples/*.json` (camelCase, matches Zod)
- `tests/contracts.test.ts`

## Graph to keep

```
START --routeIntent--> runResearch | createListing | auditListing
runResearch --afterResearch--> createListing | END
createListing --> END
auditListing --> END
```

`pipeline` enters `runResearch`, then `createListing`.  
Do not name nodes the same as state channels (`researchReport`, `listingResult`, `keywords`, ...).

## Implement in this order

1. `AutocompleteClient.suggestions` in `src/providers/autocomplete.ts`
   - GET `https://completion.{domain}/api/2017/suggestions?mid={marketplaceId}&alias=aps&prefix={encoded}`
   - Prefixes: `""`, `"best "`, `"cheap "`, `"top "`
   - `deep=true`: also `{keyword} a` … `{keyword} z`
   - Deduplicate, trim, delay `settings.autocompleteDelayMs`
   - Browser-like User-Agent; timeout from settings
   - Tests: mock `fetch`, no live Amazon in CI

2. `scoreOpportunity` in `src/scoring/opportunity.ts`
   - Integer 1–10 from long-tail count + intent mix
   - Never output fake search volume

3. `coverageReport` in `src/scoring/coverage.ts`
   - Case-insensitive substring match
   - `covered` = title+bullets+description; `partial` = some; `missing` = none

4. `auditListing` in `src/scoring/listing.ts`
   - 8 dimensions totaling 100, per file comment
   - Missing image/price/review: score conservatively and explain in `notes`

5. `generateListing` in `src/copywriting.ts`
   - Templates first (no API key)
   - Title: Brand + primary keyword + 1–2 attributes + differentiator
   - 5 bullets: `BENEFIT HEADER — body` with one keyword each
   - Leftover phrases → backend search terms, ≤ 249 bytes
   - Optional `@langchain/openai` rewrite only if `OPENAI_API_KEY` is set

6. Graph nodes in `src/graph/nodes.ts`
   - `researchNode` → `state.researchReport` + `state.keywords`
   - `listingCreateNode` / `listingAuditNode` → `state.listingResult`
   - Validate outputs with Zod before returning

## Hard constraints

- TypeScript only. No Python, no Pydantic
- No Seller Central login, cookies, or password flows
- No Amazon product HTML scrape in phase 1
- No SP-API until a later phase (`amazon-sp-api` is the planned SDK)
- No PPC / FBA / inventory modules
- Do not vendor the Amazon-Skills git tree
- Do not invent marketplace stats
- Return typed objects that pass the Zod schemas

## Done when

```bash
npm install
npm test
npm run typecheck
npx tsx src/cli.ts --help
npx tsx src/cli.ts research "portable blender" -m us --out reports/research.json
npx tsx src/cli.ts listing-create -i examples/listing_create.json
npx tsx src/cli.ts listing-audit -i examples/listing_input.json
```

All three commands return JSON matching `src/schemas.ts`.  
Title length ≤ 200. Coverage % is computed, not hardcoded.

## Reference

- LangGraph.js: https://github.com/langchain-ai/langgraphjs
- Docs: https://docs.langchain.com/oss/javascript/langgraph/
- Amazon-Skills keyword autocomplete + 8-dimension listing audit
