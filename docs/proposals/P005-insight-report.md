---
id: P005
title: 洞察报告（看板解读 → Umo）
status: draft
milestone: v0.6
date: 2026-08-12
design: docs/design/conversation.md
depends: P004
---

# P005 · 洞察报告（草案）

## 定位

在**已有看板 / 数据集**上生成「数据解读」报告：统计洞察（JoyAgent InsightFactory 类）+ LLM 叙事，写入 **Umo 报告块**，图表通过 live `reportChart` 引用，**禁止内嵌查询结果行**。

与 P004 配置写入轨分离：本提案不自动改 Dashboard 布局；可从对话「生成解读报告」或看板「一键解读」进入。

## 范围（v0.6）

- 洞察算法服务（可先 Java，后可选 Python tool 服）
- 「从看板生成解读报告」→ 新建/追加 Umo 文档块 + 引用图
- 与现有报告模块（P003）复用编辑 / 预览 / 发布
- SOP/Skills 灰显能力按需打开

## 非目标

- DataEase「定时报告」推送改名
- 把结果表截图当报告正文真相
- 替代 chartQuery 运行时取数

## 验收要点（草案）

| ID | 要点 |
|----|------|
| PR-INS-01 | 从已发布/草稿看板触发 → 生成报告 draft |
| PR-INS-02 | 叙事块引用 live 图；无内嵌结果行 |
| PR-INS-03 | 洞察条目可溯源到字段 / 图表 encode |
| PR-INS-04 | 失败可降级为模板叙事 + 手动编辑 |

## 关联

- 前置：[P004](./P004-conversation.md) · [ai-harness.md](../design/ai-harness.md)
- 报告基线：[P003](./P003-report-umo-charts.md)
- Roadmap：v0.6+
