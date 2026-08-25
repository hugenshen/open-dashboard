---
title: 用 Cursor 从 0 到 1 做出 Open Dashboard
author: hugenshen
date: 2026-08-25
tags: [cursor, workflow, best-practice, architecture, 架构]
---

## 背景

本仓从 2026-08 初到 08-25，主要靠 Cursor 多轮对话从空白做到可跑的 BI 产品（Vue + Java + dsh 对话 Agent）。大约 70 段项目相关会话。速度快，但若没有契约，下一轮 AI 会忘掉边界、把聊天当需求、把最新高保当已验收。

## 时间线（给人与 AI 定位，不是日记）

| 阶段 | 大约 | 发生了什么 |
|------|------|------------|
| 能跑起来 | 08-06 | 隔离部署、报告/仪表盘编辑、分享只读 |
| 对话立项 | 08-11 | 对标内测文章做对话能力；**先高保对齐再动工** |
| 高保与工作台 | 08-12～17 | 壳层、工作台、图表配置对标；抽出 shared 菜单 |
| 文档契约 | 08-11～17 | 聊天不够协同；沉淀 Pxxx / 高保快照 / 4A / acceptance |
| 脚手架落地 | P002/P003 | Vue+Java+PostgreSQL；报告插图走真 `chartQuery` |
| 对话与问数 | P004/P006 | 生成看板 vs 先问一句数，长期被混在一起 |
| Agent 换底座 | P011 | Python harness 换成 dsh Web；表面交互跟 dsh |
| 质量闸 | P012/P015 | 「生成成功但不敢用」→ 规划确认、真查、fail-closed |
| 权限与资产 | P008/P009 | 工作区、数据市场、新用户不该看见别人的板 |
| 分析报告 | P016 | 第三轨：报告文件，不是可刷新 Dashboard |
| 协同底座 | 08-25 | docs 收进 `.teamai/`，对外 Co-TeamAI |

## 解决方案

把「对话里做过什么」收成三层，而不是再开一套 wiki：

- **契约**在 `.teamai/docs/`（process / Pxxx / 高保 / 4A / OpenAPI）
- **怎么干活**在 `.teamai/skills/`
- **为什么这样、踩过什么**在 `.teamai/learnings/`（本目录）

## 经验总结

- 从 0 到 1 可以先对话、先高保、先能看见；一旦要给别人或下一轮 AI 接着做，必须有 Pxxx 主键，否则范围会漂。
- 用户原话反复出现：**先输出原型对齐再动工**；**完成一个我验收一个再做下一个**；**我还在讨论，你不要先实施**。违反这三条会返工最多。
- 对标 DataEase / SQLBot / JoyAgent / deer-flow / dsh 是学交互与能力语义，不是抄菜单、品牌或路径。
- 聊天、Cursor 左侧 Plan.md、最新 hi-fi 都不是长期真相。确认过的边界当轮回写对应提案。
- 不要在 learnings 里复制密钥、token、数据库密码；对话里出现过的凭证一律作废重签。

## 相关 Skills

- od-rd-loop
- od-write-proposal
- od-implement-proposal
- od-hi-fi
- od-local-verify
