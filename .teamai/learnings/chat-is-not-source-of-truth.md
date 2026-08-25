---
title: 聊天记录不是需求真相，确认过的边界必须回写 Pxxx
author: hugenshen
date: 2026-08-25
tags: [docs, workflow, pattern, 文档]
---

## 背景

多人（含下一轮 AI）协同时，需要知道：产品是什么、做到哪、对照哪份原型、怎么验收、改哪些代码。只靠聊天做不到。用户曾要求 docs 让 BA / 开发 / 测试 / 规划 / AI 都能找到功能边界和波及。

曾经的失败形态：

- 把未实现设计写进 `design/`，把未验收能力写进 `requirements.md`
- 实现对照最新 hi-fi，而提案已经 `hi-fi: accepted`（应以快照为准）
- 对话里确认了「问数不要直接出整页看板」，但没写回 P006，下一轮又混回去

## 解决方案

分层，不复制：

| 问什么 | 去哪 |
|--------|------|
| 产品是什么、给谁 | `product/README.md`（不要写仓库路径） |
| 正在做哪条 | `roadmap/in-progress/` |
| 未交付怎么做 | `proposals/Pxxx-name/` 开发入口 |
| 怎样算完 | `test/acceptance.yaml`（README 只留 ID + 标题） |
| 现在系统怎么实现的 | `design/architecture.html`（只写代码事实） |
| FE↔BE 请求长什么样 | `design/openapi.yaml` |
| 已上线能力 | `product/requirements.md` |

当轮用户确认了范围、非目标、权限、交互或技术边界 → **本轮结束前**写进该 Pxxx 的 README / design / acceptance。不要说「记在聊天里了」。

## 经验总结

- `product/` 只讲业务产品，不讲 git 仓怎么拆。部署跟着前后端 `deploy.md`。
- `acceptance.yaml` 好维护的前提是：BA 改 criterion，测试改 status/evidence，开发改 command_or_path；禁止三处复制同一段判据。
- 过程产物不要平行繁殖：不要另开 ADR 树、不要仓库根再放 `docs/`、不要符号链接。
- Pxxx 目录永不搬家；状态改文首，并把该行挪到 `roadmap/<新状态>/`。
- `done` 提案只追溯。新变化新建 Pxxx（下一号见 `proposals/README.md`）。
- P005 洞察报告是 draft，**不要实现**。

## 相关 Skills

- od-write-proposal
- od-implement-proposal
- od-rd-loop
