---
name: asa-engineering
description: Apply this repository's bounded TypeScript engineering workflow, contracts, testing, and review rules when implementing or debugging Amazon Seller Agent code.
---

# ASA engineering

Use this skill for implementation, debugging, refactoring, or verification in
this repository. It provides project decisions that affect engineering work;
it is not a runtime product knowledge base.

Before editing, read [PROJECT_BRIEF.md](../../../PROJECT_BRIEF.md), the relevant
part of [HANDOFF.md](../../../HANDOFF.md) when the Phase 1 path is involved,
and [CONTEXT.md](../../../CONTEXT.md) plus relevant ADRs. If the primary agent
has created `docs/architecture/CONTENT_STUDIO.md`, read that design for the
current order. Use the order in `docs/agents/construction-order.md` to confirm
file ownership and acceptance.

Keep TypeScript, Zod, LangGraph.js, Hono, and existing CLI/API contracts
compatible unless the order explicitly includes a migration. Validate inputs
and outputs at contract boundaries; preserve `src/schemas.ts` semantics and
`getMarketplace` errors. Mock all external HTTP and model/image providers.
Use PowerShell on Windows and put temporary material in `E:\CodexTemp`.

Phase 1 research remains public autocomplete only: no product-page scraping,
Seller Central login, SP-API, or PPC/FBA behavior in that historical path.
Later official API adapters follow the current architecture and their own
explicitly scoped orders; never auto-publish. Do not add Python, expose `.env`
secrets, or invent marketplace metrics. Product facts and
original assets stay traceable to revisions; changing reviewed input creates a
new content/review version rather than silently mutating an accepted result.

Load existing React best-practices, frontend-testing, diagnose, or TDD skills
only when the order actually needs that discipline. Do not load the whole skill
catalog or duplicate those skills as product documentation.

Finish with the construction report fields: modified files, change and logic,
rationale, tests, unverified areas, and risks. A worker report is not final
acceptance; an independent reviewer or the primary agent must inspect the diff.
