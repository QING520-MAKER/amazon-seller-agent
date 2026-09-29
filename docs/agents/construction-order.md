# Construction order template

Copy this structure into a local task under `docs/tasks/` and fill every field
before dispatch. Keep the order narrow enough to accept independently.

```text
【Luna 施工单 #NNN】

目标
State one measurable result that can be accepted on its own.

依赖与背景证据
Name the current behavior, relevant files, prior task or ADR, and evidence.

允许文件
List exact files or directories Luna owns for this order.

禁止范围
List modules, contracts, dependencies, external writes, and scope expansions
that this order must not touch.

契约与业务不变量
State public schemas, compatibility rules, fact sources, version bindings,
and error or state behavior that must remain true.

实现要求
Describe the smallest implementation and required mock or fixture behavior.

验收标准
Give commands or observable checks, expected results, and scope checks.

需加载技能
Name only the project or general skills needed for this order.

风险与待办问题
Record known uncertainty and non-blocking follow-up work.

完成后汇报
修改文件；修改内容；实现逻辑；为什么这样改；测试结果；未验证内容；
潜在风险。
```

For rework, quote the failed evidence, name the exact correction, keep the
already accepted behavior, and define one objective passing condition. Do not
turn a rework order into an architecture rewrite.
