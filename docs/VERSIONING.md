# 文档版本规范

本仓库会持续迭代。文档按 **稳定规格 / 演进提案 / 变更记录** 三分，避免根目录文件名越堆越乱、也避免「改了一处不知影响哪一版」。

## 1. 目录约定

```
docs/
├── README.md                 # 总索引（必更新）
├── VERSIONING.md             # 本规范
├── CHANGELOG.md              # 面向发布的文档与原型变更摘要
├── architecture/             # 相对稳定的架构真相（可小改，重大变更走提案）
├── specs/                    # 已采纳的阶段性规格（带语义化版本）
│   └── v0.x.y-*.md
└── proposals/                # 未落地或讨论中的方案（提案号递增）
    ├── README.md
    └── P00N-short-slug.md
```

| 类型 | 何时用 | 命名 |
|------|--------|------|
| **architecture/** | 领域、表结构、API、取数链路等「当前实现/目标架构」 | 稳定短名，如 `domain.md`；迁移时可从根目录逐步迁入 |
| **specs/** | 里程碑冻结后的能力规格 | `vMAJOR.MINOR.PATCH-slug.md` |
| **proposals/** | 设计中、待实现、待评审 | `P00N-slug.md`（N 三位递增） |

根目录下既有文件（如 `commercial-mvp-spec.md`、`domain.md`）**暂保留**，新内容优先进 `proposals/` / `specs/`；迁移时在 `README.md` 标注旧→新路径，不搞一次性大搬家。

## 2. 语义化版本（specs）

与产品/原型里程碑对齐，**不要求**与 npm 包版本一一对应：

- **MAJOR**：不兼容的信息架构或交互范式变化（例如布局模型重做）
- **MINOR**：向后兼容的能力增量（例如移动端 C 档、透视表样式增强）
- **PATCH**：澄清、勘误、示例修正，不改变约定行为

每个 `specs/vX.Y.Z-*.md` 文首必须含：

```yaml
---
version: 0.2.0
status: accepted   # draft | accepted | deprecated | replaced
supersedes: null   # 或上一版路径
date: 2026-08-03
---
```

## 3. 提案（proposals）生命周期

1. **draft** — 讨论与设计（可改）
2. **accepted** — 评审通过，进入实现；实现完成后沉淀为 `specs/vX.Y.Z-*.md`，提案文首改为 `status: accepted` 并写 `implemented_in`
3. **superseded** — 被更新提案替代，保留文件不删，文首 `replaced_by`

提案文首模板：

```yaml
---
id: P001
title: 移动端布局与样式（DataEase C 档）
status: draft          # draft | accepted | superseded
target_spec: v0.2.0    # 计划落入的规格版本
date: 2026-08-03
authors: []
---
```

## 4. CHANGELOG

[`CHANGELOG.md`](./CHANGELOG.md) 只记「对读者有意义」的条目：新提案、规格采纳、高保原型可见行为变化。格式用 Keep a Changelog 风格的 `## [Unreleased]` / `## [0.2.0] - YYYY-MM-DD`。

## 5. 高保原型对应关系

| 规格 / 提案 | 原型入口 |
|-------------|----------|
| 商用 Phase A/B/C（既有） | `prototypes/hi-fi/dashboard-commercial.html` |
| P001 移动端 C 档 | 同上，Phase B+ · 移动布局 |
| P003 报告 Umo 插图 | `prototypes/hi-fi/dashboard-commercial.html` 顶栏「报告」· `#/report/...`；产品 Vue `/reports` |

实现提案时：先改原型验证，再把结论回写提案「实现备注」，最后晋升 `specs/`。
