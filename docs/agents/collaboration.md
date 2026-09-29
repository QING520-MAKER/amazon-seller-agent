# Agent collaboration standard

The repository follows one bounded Astra Ultra × Luna xhigh loop:

`Astra investigates → Astra dispatches → Luna implements → Luna reports → Astra or an independent reviewer verifies → rework or continue`

Astra owns the user goal, shared contracts, architecture, migration decisions,
scope, and final acceptance. Luna receives one independently acceptable order,
edits only its owned files, and reports evidence. A reviewer inspects the
actual diff and relevant behavior independently. No two agents edit the same
file concurrently; unrelated working-tree changes belong to the user and must
be preserved.

Every order records its goal, dependencies, allowed files, prohibited scope,
contracts and invariants, acceptance checks, skills to load, and known risks.
The author does not self-accept production behavior. Changes to product facts,
content versions, or review bindings must preserve traceability and cause the
appropriate new version/re-review behavior.

Workers may use the repository's project skills and only the existing general
skills needed for the order. They must report `待办问题` for non-blocking
findings instead of expanding scope. The primary agent must review the final
filesystem diff, not only the worker's narrative.

The active-session model cannot be proven from repository files. The repository
`.codex/config.toml` records trusted defaults for future project sessions; an
explicit model argument at dispatch is the evidence for the current worker.
