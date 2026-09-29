# Skill mapping

Project skills live under `.agents/skills/` so their scope is visible in the
repository and they are not installed as global runtime knowledge. Load one
only when the order matches its description:

| Skill | Load for |
| --- | --- |
| `asa-engineering` | TypeScript implementation, debugging, contract checks, and bounded delivery |
| `asa-content-workflow` | Product facts, assets, listing versions, review, export, jobs, or publication boundaries |
| `asa-upstream-research` | Official upstream API/source/license research |

The existing React best-practices skill is for React or Next.js performance
work. The frontend-testing skill is for rendered UI or browser regressions.
`diagnose` is for evidence-led hard bugs or performance regressions. `tdd` is
for an order that explicitly needs a red-green-refactor or integration-test
loop. These are optional and should be loaded only when the order needs them;
do not force-load the complete catalog or wrap those skills as product runtime
documentation.
