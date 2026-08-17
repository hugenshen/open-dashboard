---
id: P002
title: Vue3 + JDK21 Spring Boot + PostgreSQL 核心工程落地
status: done
milestone: v0.3.0
implemented_in: v0.3.0
date: 2026-08-03
done: 2026-08-03
acceptance: docs/proposals/P002-vue-java-scaffold/acceptance.yaml
gates:
  proposal: accepted
  hi-fi: none
  code: merged
  acceptance: passed
architecture: docs/design/architecture.html
contract: docs/design/openapi.yaml
requirements: [NFR-05]
implementation: [open-dashboard-frontend/, open-dashboard-backend/]
---

# P002 · Vue3 + Spring Boot 核心脚手架

> **状态** `done` · 路线图 [已完成](../../product/roadmap/done/) · 高保 none · 代码 merged · 验收 passed

## 开发入口

已交付，只追溯。开箱与模块边界以 [architecture.html](../../design/architecture.html) 和 `NFR-05` 为准。

## 背景

高保 HTML 已验证编辑器 / 取数理念 / 移动端 C 档，但无法承载真产品。采用路径 **C**：文档定稿 → 脚手架 → 高保迁出作参照。

## 决策

| 项 | 选择 |
|----|------|
| 前端 | Vue 3 + Vite + TS + Pinia + Vue Router + ECharts |
| 后端 | JDK 21 + Spring Boot 3 + Spring JDBC + Flyway |
| DB | PostgreSQL 16；`mobile_json JSONB` |
| 范围 | 编辑器 + chartQuery/datasetQuery + 移动端（窄） |

## 交付

- [requirements.md](../../product/requirements.md) NFR-05
- [architecture.html](../../design/architecture.html) · [openapi.yaml](../../design/openapi.yaml)
- [tech-stack.md](../../tech-stack.md)
- `docs/prototypes/hi-fi/`、`open-dashboard-frontend/`、`open-dashboard-backend/`

## 验收

本提案以 `NFR-05` 为交付门：`./scripts/up.sh` 可启动 PostgreSQL、Java API 与 Vue Web，后端 COLA 多模块可编译测试。可复现命令、期望与证据见 [acceptance.yaml](./acceptance.yaml)。

## 修订

| 日期 | 说明 |
|------|------|
| 2026-08-03 | accepted → v0.3.0 |
