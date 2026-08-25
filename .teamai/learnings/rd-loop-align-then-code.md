---
title: 研发循环：先对齐再写代码，一提案一验收
author: hugenshen
date: 2026-08-25
tags: [workflow, pattern, best-practice, 流程]
---

## 背景

早期会话是「帮我优化这个页面 / 帮我落地」。AI 直接改 Vue 或高保，用户下一句经常是：布局很奇怪、和文章差距很大、你改的是高保还是产品、我怎么看还是一样。后来明确要方案评审、高保对齐、按提案实施。

正式规范在 [process.md](../docs/process.md)。本文只记循环是怎么被逼出来的。

## 解决方案

实际有效的循环：

```text
讨论范围（先别写代码）
  → 挂 roadmap + 写/改 Pxxx（开发入口、波及、acceptance）
  → 高保对齐（用户说「可以，实现吧」）
  → 定稿则打 acceptance 快照
  → 跨端先 OpenAPI，再 FE / BE / harness
  → 浏览器走真实路径验证
  → 同提交更新 architecture.html
  → 阻塞项 pass 才回写 requirements；没做完保持 in-progress
```

判定口令（用户这样说时，禁止直接改产品代码）：

| 用户说 | 先做什么 |
|--------|----------|
| 先讨论 / 先方案 / 不要动代码 | 只出设计，写入提案 |
| 先输出原型 / 改高保我看看 | 只改 `hi-fi/`，告诉预览 URL |
| 帮我实施最新提案 / 一个个来 | 只做 `roadmap/in-progress/` 里当前那条 |
| 没有设计的再评审 | 缺 design 就先补提案，不开工 |

## 经验总结

- **一个提案做完再开下一个。** 并行 P004/P006/P007/P008 时，高保、Vue、harness 会互相覆盖，验收对不上。
- **「优化一下」不是范围。** 必须写成给谁、解决什么、不做（非目标）。否则 AI 会改完工作台又顺手改报告、权限、问数。
- **Plan 模式产出不是交付物。** Cursor 左侧一堆 plan md 不等于已写入 docs。问「这些更新到 docs 了吗」是真实事故。
- **部分交付不要标 done。** 代码存在 ≠ 产品验收。`acceptance.yaml` 才是唯一状态。
- **新决策替代旧方案时，改所有依赖提案。** 只改最新一篇，P004/P006/P011 会各说各话。
- 小型纯 UI、契约不变，可以不建提案；一旦改长期架构或已交付能力，仍要回写 4A / requirements。

## 相关 Skills

- od-rd-loop
- od-write-proposal
- od-implement-proposal
