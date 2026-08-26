---
title: 分析报告要对齐 JoyAgent AutoAnalysis，不能套模板洞察
author: hugenshen
date: 2026-08-26
tags: [conversation, report, joyagent, analysis]
---

## 背景

P016 第一刀把 JoyAgent AutoAnalysis 收成 JS 确定性模板：一次 `get_data` 后无条件吐 OutstandingFirst/Last、Attribution、Evenness、Trend、ChangePoint。用户手验看到「最高约占 50%」套话、甚至 PayOrderId 明细表进报告，认为没按 JoyAgent 流程实现。

JoyAgent 实际是 CodeAgent：`PythonInterpreter`（pandas/numpy/scipy/sklearn）+ `get_data` → `data_trans` → `insight_analysis(method)` → `save_insight` → `final_answer`。洞察有形态/显著性门控，无结论禁止保存。

## 解决方案

在 dsh 工具调用形态下对齐同一条链，不替换运行时：

- worker 增加 `od_python`（只跑缓存聚合 frame）
- `od_insight` 一次一个方法，门控失败返回空
- 主键/高基数 ID 拒绝洞察
- 报告结构：分析过程 / 数据 / 分析结果 / 总结

取数上限仍严于 JoyAgent（200 行 / 15s），不引入 smolagents 整仓。

## 经验总结

- 对标开源要对齐「Agent 怎么分析」，不是只对齐工具名和右侧文件栏。
- 洞察套模板全量输出 = 用户觉得「效果不行」，和出板规则凑图是同一类质量事故。
