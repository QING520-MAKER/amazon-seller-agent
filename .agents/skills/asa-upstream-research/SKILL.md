---
name: asa-upstream-research
description: Research upstream APIs, source patterns, and licenses for Amazon Seller Agent without scraping product pages or copying unverified code.
---

# ASA upstream research

Use this skill for a construction order that needs external API behavior,
upstream implementation ideas, dependency compatibility, or license review.
Prefer official documentation, primary source repositories, release notes, and
license files. Record each source URL, revision or access date, license, fact
used, and the boundary between verified fact and inference.

For Amazon research, keep Phase 1 to public autocomplete. Do not request or
scrape product detail pages, Seller Central pages, cookies, passwords, or
private APIs. Do not report search volume, BSR, competition, price room, or
trend data unless a source actually provides it; label a heuristic as a
heuristic.

Borrow a narrowly scoped idea only after checking its license and compatibility
with the repository's TypeScript contracts. Do not vendor an upstream tree,
copy large files, or turn a reference project's behavior into an unverified
product claim. Prefer an external service adapter with explicit error and
credential boundaries. Research is read-only unless a separate construction
order authorizes a documented change.

Return a concise evidence table and list open compatibility or licensing risks.
The primary agent decides whether the evidence changes architecture or scope.
