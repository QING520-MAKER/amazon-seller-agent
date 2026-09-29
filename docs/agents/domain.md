# Domain documentation

This is a single-context repository. Before making a domain or architecture
decision, read the root [CONTEXT.md](../../CONTEXT.md), then the relevant ADRs
under [docs/adr](../adr/). Read the current product route in
[PROJECT_BRIEF.md](../../PROJECT_BRIEF.md). Treat [HANDOFF.md](../../HANDOFF.md)
as historical Phase 1 scope and implementation evidence; do not use it to
override later decisions in the brief or an accepted ADR.

The primary agent owns the evolving design at
`docs/architecture/CONTENT_STUDIO.md` when that file is created. A worker may
record assumptions in its task report but must not create a competing
architecture document.

Use the canonical terms and definitions in `CONTEXT.md` in task titles, code
comments, tests, and review reports. If a needed term is absent or conflicts
with an existing one, record the ambiguity for the primary agent instead of
silently introducing a synonym.

When a change conflicts with an ADR, call out the conflict and propose a new
decision record. Do not rewrite an accepted decision as a side effect of an
implementation order.
