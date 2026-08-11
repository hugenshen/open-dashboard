# P002 · Vue3 + Spring Boot 核心脚手架

---
id: P002
title: Vue3 + JDK21 Spring Boot + PostgreSQL 核心工程落地
status: done
milestone: v0.3.0
implemented_in: v0.3.0
date: 2026-08-03
done: 2026-08-03
---

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

- [requirements/v0.3.0-core.md](../requirements/v0.3.0-core.md)
- [specs/v0.3.0-core.md](../specs/v0.3.0-core.md)
- [tech-stack.md](../tech-stack.md)
- `prototypes/hi-fi/`、`frontend/`、`backend/`（Spring）

## 修订

| 日期 | 说明 |
|------|------|
| 2026-08-03 | accepted → v0.3.0 |
