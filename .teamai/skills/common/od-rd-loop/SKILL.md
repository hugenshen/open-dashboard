---
name: od-rd-loop
description: Open Dashboard 从需求到交付的研发循环。用户说先讨论、先方案、先高保、落地、一个个验收、优化页面、实施最新提案时使用。禁止在未对齐时直接改产品代码。
---

# 研发循环

完整规范：[process.md](../../../docs/process.md)。为什么这样走：[rd-loop-align-then-code.md](../../../learnings/rd-loop-align-then-code.md)。

## 先分类，再动手

| 用户意图 | 做法 |
|----------|------|
| 「先讨论 / 先方案 / 不要动代码」 | 需求用 BA 的 [od-write-proposal](../../ba/od-write-proposal/SKILL.md)；技术方案用开发的 [od-solution-design](../../dev/od-solution-design/SKILL.md)，仍不改产品代码 |
| 「先高保 / 改原型我看看」 | BA：只用 [od-hi-fi](../../ba/od-hi-fi/SKILL.md) |
| 「实施提案 / 按开发入口做」 | 开发：方案写完再用 [od-implement-proposal](../../dev/od-implement-proposal/SKILL.md) |
| 「启动 / 验证 / 访问不了」 | 只用 [od-local-verify](../od-local-verify/SKILL.md) |
| 新能力但还没有 Pxxx | BA：先 [od-write-proposal](../../ba/od-write-proposal/SKILL.md) |
| 小型纯 UI、契约不变 | 可直接改；若改变长期能力再回写 4A / requirements |

## 硬停止

- 用户还在对齐交互或范围时，**不要先实施**。
- 不在 `roadmap/in-progress/` 的条目不要当当前任务。
- 一次一条提案；完成并让用户能验收后，再问下一条。
- Cursor 左侧 plan 文件不是文档真相；有价值的结论写进 Pxxx。
- 对标 DataEase / SQLBot / JoyAgent / dsh 只学能力语义与交互，不抄品牌和菜单。

## 交付顺序

OpenAPI → 实现与验证 → `architecture.html` 同提交 → pass 的 ID 回写 requirements → 全部阻塞项 pass 才把该行挪到 `roadmap/done/` → 提案 `done`。

部分完成：提案保持 `in-progress`，只回写已 pass 的 ID。
