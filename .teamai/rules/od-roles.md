---
description: BA 做需求与高保；开发做方案设计与实现；测试做验收。
---

# 角色链

交接：`@需求(BA)` → `@高保(BA)` → `@方案设计(开发)` → `@实现(开发)` → `@测试`。

| id | 覆盖 | 成员命令 |
|----|------|----------|
| `ba` | 需求 + 高保。不写 design.md / OpenAPI | `teamai roles set ba` |
| `dev` | 方案设计 + 实现 | `teamai roles set dev` |
| `test` | 测试 | `teamai roles set test` |

- BA：`od-write-proposal`、`od-hi-fi`
- 开发：`od-solution-design`（先）再 `od-implement-proposal`
- 测试：`od-acceptance`

`common`：`od-rd-loop`、`od-local-verify`。规范：[process.md](../docs/process.md)。
