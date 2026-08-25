---
title: 出板和问数质量靠闸门与真查，不靠再写一版 prompt
author: hugenshen
date: 2026-08-25
tags: [quality, agent, testing, architecture, 质量]
---

## 背景

用商户订单表（`t_pay_order`）生成仪表盘是反复出现的真实案例：没有图表、SQL 出不来、工具很慢、绑定闸拒绝 MchId、规划离线降级、编辑后图表消失。根因很少是「模型不够聪明」，而是工具返回层、schema、fail-closed 闸和前端预览协议。

## 解决方案

质量闭环（P012 已部分落地，P015 仍在途）：

- 主写路径不要让模型自由拼 `od_emit_patch`；走 `od_generate_board` / `od_compose_board`，内置 review + layout
- Java 侧 last-resort 去业务词典，避免模型编字段
- 问数 schema 加厚；0 行要有 insight，不要空失败
- 规划确认、逐任务真查、受控修复；发布门用固定基准（`pnpm eval`），不要只看一次手工成功
- 工具对模型要可枚举：`od_list_datasets` 不能只返回一行摘要 `datasets(1)` 却不给 id/名称
- 有数据行却序列化校验失败时，问数轨不可用；不要静默改成「请走看板通道」而不修协议

绑定闸（例如维度 MchId 未通过）是**系统限制**。要么支持该分组，要么在对话里说清「这个维度当前不能绑」，不要让用户以为表没数据。

## 经验总结

- 「生成成功」不是验收。板要能进编辑器看见图，问数要有行或有解释。
- 本地 MySQL 有数、对话仍无 SQL：先查数据集是否选中、语义层字段角色、workspace 过滤、工具是否拿到 schema。
- 工具慢：先分清是 Java 查库、harness 代理，还是模型反复试探。不要一上来改 UI。
- 写死的业务规则堆在 Java 里会很快腐烂；新逻辑应进可测的 worker / eval 金标，而不是再加一段 if。
- 评测：确定性金标先绿，再谈盲评。没有 eval 的「我测过了」不可信。
- 前端 mock 清单必须清零才能说对接完成。工作台/数据市场假卡片会让权限和问数测假。

## 相关 Skills

- od-implement-proposal
- od-local-verify
