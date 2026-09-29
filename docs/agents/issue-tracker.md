# Issue tracker

This repository uses local markdown task records under `docs/tasks/`. The
GitHub remote is useful for source control, but agents do not create GitHub
issues, comments, or messages unless the user explicitly asks for publication.

Use one file per bounded task, with a stable filename such as
`docs/tasks/SLICE4-001-listing-version.md`. Put a `Status:` line near the top,
link the relevant construction order, and append evidence or comments under a
`## Updates` heading. Keep temporary notes out of production source files.

When another skill says to publish an issue, create or update the appropriate
local markdown task under `docs/tasks/` and report that publication stayed
local. Do not infer permission to publish remotely from the presence of a
GitHub remote.
