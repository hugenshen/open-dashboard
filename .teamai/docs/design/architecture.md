---
title: Open Dashboard 4A 现行架构（检索索引）
tags: [architecture, 4A, design, technical]
domain: technical
---

# 4A 现行架构

人读完整页：[architecture.html](./architecture.html)。契约：[openapi.yaml](./openapi.yaml)。未实现方案在提案目录，不在本页。

## 代码根

`open-dashboard-frontend/` · `open-dashboard-backend/` · `opendashboard-dsh-harness/`（P011 对话 Agent）。

## 分层

| 视图 | 要点 |
|------|------|
| BA | 分析师接数建模出板；报告作者 Umo；分享读者只读 published |
| AA | Vue 壳 + 模块；Java COLA；对话走 dsh `od_*` → `/api/internal/bi` |
| DA | 看板绑数据集；`datasetQuery` / `chartQuery`；draft / published |
| TA | JDK 21 · Spring Boot 3 · Vue 3 · PostgreSQL 16 |

## 价值流

工作台 → 数据广场 → 数据源 → 数据集 → 仪表盘 → 问数 → 预览 / 分享 / 报告

## 不要写进本文件

未来设计、未验收交互、类名级实现。那些留在对应 Pxxx。
