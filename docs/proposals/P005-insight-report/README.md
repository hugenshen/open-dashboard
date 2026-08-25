---
id: P005
title: 洞察报告（看板解读 → Umo）
status: draft
milestone: v0.6
date: 2026-08-12
acceptance: docs/proposals/P005-insight-report/acceptance.yaml
gates:
  proposal: draft
  hi-fi: none
  code: none
  acceptance: none
depends: P004
---

# P005 · 洞察报告（草案）

> **状态** `draft` · 路线图 [计划中](../../product/roadmap/planned/) · 高保 none · 代码 none · 验收 none

## 开发入口

未接受，**不要实现**。读本文只为了解后续边界；当前开发请回到 [P004](../P004-conversation/) / [P006](../P006-ask-data/)。

## 定位

在**已有看板 / 数据集**上生成「数据解读」报告：统计洞察（JoyAgent InsightFactory 类）+ LLM 叙事，写入 **Umo 报告块**，图表通过 live `reportChart` 引用，**禁止内嵌查询结果行**。

与 P004 配置写入轨分离：本提案不自动改 Dashboard 布局；可从对话「生成解读报告」或看板「一键解读」进入。

**与 [P016 对话分析报告](../P016-conversation-analysis-report/) 对照**：P016 是对话里直接产出的**会话快照 HTML/MD 文件**（可内嵌聚合结果行，页脚标明静态快照，不是可刷新看板）。P005 是从**已有看板**生成 Umo 解读稿，图表走 live 引用，**禁止内嵌结果行**。不要把 P016 实现成 P005，也不要在本提案落地前实现 Umo 解读。

## 范围（v0.6）

- 洞察算法服务（可先 Java，后可选 Python tool 服）
- 「从看板生成解读报告」→ 新建/追加 Umo 文档块 + 引用图
- 与现有报告模块（P003）复用编辑 / 预览 / 发布
- SOP/Skills 灰显能力按需打开

## 非目标

- DataEase「定时报告」推送改名
- 把结果表截图当报告正文真相
- 替代 chartQuery 运行时取数
- 由报告查看权反向授予底层数据集问数权

## 验收 ID

判据只在 [acceptance.yaml](./acceptance.yaml)。

| ID | 标题 |
|----|------|
| PR-INS-01 | 从看板生成报告草稿 |
| PR-INS-02 | 叙事块不内嵌结果行 |
| PR-INS-03 | 洞察可追溯 |
| PR-INS-04 | 失败可降级 |
| PR-INS-05 | 洞察须校验 dataset:use |

## 关联

- 前置：[P004](../P004-conversation/README.md) · [Harness 设计](../P004-conversation/harness-design.md)
- 报告基线：[P003](../P003-report-umo-charts/README.md)
- Roadmap：v0.6+
