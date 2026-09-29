# ADR-0001: Local modular content studio baseline

- Status: Accepted planning baseline
- Date: 2026-09-29
- Scope: Product facts, assets, listing content, review, packages, and future publication records

## Context

The project is moving from a Phase 1 research/listing CLI and local workbench
toward a content studio. The existing TypeScript, Hono, React, LangGraph, Zod,
CLI, and public contracts must remain usable while later slices add durable
product facts, assets, versions, review, and delivery. The current repository
does not prove that every planned business object or platform integration is
implemented.

## Decision

Use a modular monolith for the local studio. Keep domain modules separated by
their contracts and ownership while they share one local application process.
Use SQLite for durable metadata and a filesystem directory for original and
derived assets, with explicit identifiers and provenance. Keep the existing CLI
and public contracts stable; add outer records or versioned adapters when new
workflow data is needed, and document a migration before changing an existing
field's meaning.

Treat product facts and original assets as versioned sources. Listing content,
image selections, reviews, and content packages reference exact revisions.
Represent external model, image, and future platform integrations as adapters
with explicit configuration, errors, and result records. Publication remains a
later, explicitly authorized capability and is never an implicit side effect of
generation or approval.

## Consequences

The local workflow can preserve history and recover after restart without
requiring a distributed service. SQLite transactions and filesystem lifecycle
handling must be tested together; an asset path alone is not a business
reference. Stable CLI/API compatibility constrains migrations but lets newer
records compose around existing `ProductBrief`, `ListingCopy`, and
`ListingResult` contracts. Provider adapters make mocks and provider changes
isolated, but each adapter needs its own timeout, credential, and failure
policy.

This decision does not claim that the database, every module, image provider, or
Amazon publication path is complete. Each later slice must add its own
implementation evidence, tests, and handoff.

## Revisit triggers

Reopen this ADR if multi-user isolation, deployment topology, asset volume,
transactional requirements, or platform authorization makes a modular local
monolith insufficient. Record the replacement decision rather than silently
overwriting this history.
