---
name: asa-content-workflow
description: Preserve Amazon Seller Agent product, asset, listing, review, package, and publication invariants when changing the content workflow.
---

# ASA content workflow

Use this skill when an order touches product facts, original or generated
images, listing copy, content versions, batch jobs, review, export packages, or
future publication adapters. Read [CONTEXT.md](../../../CONTEXT.md) and
[ADR-0001](../../../docs/adr/0001-local-content-studio.md) first.

Treat confirmed product facts and original assets as traceable source material.
Every generated listing or image records the product revision, target site,
and language it used. A review refers to the exact content version; editing
copy, images, ordering, or the relevant product facts creates a new version and
requires review again. Do not overwrite originals or silently rebind an old
review to the latest data.

An official content package contains only approved versions whose source facts
are still valid. Draft exports must say that they are drafts. Retrying a job
must not overwrite a successful artifact or create an invisible duplicate;
state must distinguish waiting for review, completed, failed, cancellation
requested, and cancellation actually completed. A model service that cannot
cancel must not be described as cancelled.

Keep text contracts such as `ProductBrief`, `ListingCopy`, and `ListingResult`
compatible while composing new records around them. Keep image references
separate from copy. `imageCount` in existing audit semantics is user-supplied
image quantity, not proof that images were inspected; future image findings
need their own result.

Do not claim a business workflow is complete merely because a graph node,
provider adapter, or UI control exists. Record missing credentials, provider
behavior, and human approval in the result or handoff. Platform publication is
an explicitly authorized later adapter and never an implicit side effect.
