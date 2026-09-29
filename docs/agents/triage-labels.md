# Local triage labels

These strings are local mappings for task records under `docs/tasks/`; they are
not configured on the remote GitHub repository.

| Canonical role | Local label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer must evaluate the task |
| `needs-info` | `needs-info` | Waiting for a reporter or project decision |
| `ready-for-agent` | `ready-for-agent` | Bounded and ready for an AFK worker |
| `ready-for-human` | `ready-for-human` | Requires a human implementation or decision |
| `wontfix` | `wontfix` | Deliberately will not be actioned |

Use one current status label in the task record. Changing it is a local
documentation update and does not create or edit a remote issue label.
