# Agent notes

Read [HANDOFF.md](HANDOFF.md) before changing the Phase 1 path. It records the
historical Phase 1 implementation order and constraints; it is not a permanent
ban on the later product workflow described in [PROJECT_BRIEF.md](PROJECT_BRIEF.md).
Use the route in `PROJECT_BRIEF.md` for current product scope. The primary agent
owns the new architecture document at `docs/architecture/CONTENT_STUDIO.md`;
agents working before that document exists must record the assumption in their
construction report instead of inventing a competing architecture file.

## Repository constraints

- Node 20+, TypeScript, Zod, and `@langchain/langgraph` remain the baseline.
- Public contracts live in `src/schemas.ts`; preserve their meaning and throw
  on bad marketplace codes through `getMarketplace`.
- Use Amazon public autocomplete only in the Phase 1 research path. Do not
  scrape product pages, use Seller Central credentials, or add SP-API/PPC/FBA
  behavior to this phase.
- Tests must mock external HTTP and model/image providers. Never use live
  Amazon or provider calls in automated tests.
- TypeScript only. Do not reintroduce Python or commit `.env`, credentials,
  customer data, or product media.
- On Windows use PowerShell. Put temporary test material and one-off work in
  `E:\CodexTemp`; keep runtime data out of Git.
- Do not auto-publish to Amazon or another platform. External services are
  adapters with explicit configuration and reviewable results.

## Shared workspace and delivery

The primary agent (Astra Ultra) owns shared contracts, architecture, migration choices,
scope, and final acceptance. A worker (Luna) owns one bounded construction
order at a time. Before editing, the order must name its goal, dependencies,
allowed files, prohibited scope, contracts, acceptance checks, skills, and
risks; see [the task form](docs/agents/construction-order.md).

Agents must claim non-overlapping file ownership in the order and preserve
unrelated working-tree changes. The author does not self-accept production
behavior: Astra or an independent reviewer checks the diff, logic, and evidence.
Any change to production facts must preserve their source and revision history.
Any change to content or images requires a new version when the reviewed input
changes, and review must remain bound to the exact version under review.

Use local markdown tasks under `docs/tasks/`. A GitHub remote exists, but do not
publish issues or messages there unless the user explicitly requests it. The
local triage labels are mappings only; they are not remote GitHub configuration.

## Agent skills

### Issue tracker

Tasks live as local markdown files under `docs/tasks/`; no remote issue is
published by default. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Use the five local triage strings documented in
[docs/agents/triage-labels.md](docs/agents/triage-labels.md); they are not
configured on GitHub.

### Domain docs

This is a single-context repository. Read [CONTEXT.md](CONTEXT.md) and relevant
ADRs in [docs/adr](docs/adr/) before making domain or architecture decisions.
See [docs/agents/domain.md](docs/agents/domain.md).

### Project skills

The project-only skills under `.agents/skills/` are discoverable workflow
guidance, not a product runtime knowledge base. Load only the skill relevant to
the current order. Existing React best-practices, frontend testing, diagnose,
and TDD skills are optional and should be loaded only when the order needs
them; do not force-load the whole catalog. See
[docs/agents/skills.md](docs/agents/skills.md).
