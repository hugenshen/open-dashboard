---
id: P020
title: Sevenonic 多邮箱监听与 monday 业务自动化
status: draft
milestone: v0.8
date: 2026-09-10
design: [.teamai/docs/proposals/P020-sevenonic-mail-monday-automation/design/design.md]
acceptance: .teamai/docs/proposals/P020-sevenonic-mail-monday-automation/test/acceptance.yaml
gates:
  proposal: draft
  hi-fi: none
  code: none
  acceptance: none
depends: []
---

# P020 · Sevenonic 多邮箱监听与 monday 业务自动化

> **状态** `draft`。本次只提交经讨论形成的业务与技术方案，不修改 Open Dashboard 产品代码，不把方案描述为已实现能力。

## 开发入口

| 你要 | 去看 |
|---|---|
| 业务流程、平台边界、组件和数据流 | [design.md](./design/design.md#21-先看完整业务流程业务人员会经历什么) |
| Graph Subscription、Webhook、Delta 和 ImmutableId | [design.md](./design/design.md#5-graph-subscription-怎么订阅) |
| 五层身份、跨邮箱归并和幂等 | [design.md](./design/design.md#11-正确的五层身份模型) |
| 数据库、中间件和对象存储 | [design.md](./design/design.md#12-数据库怎么存) |
| monday 查询、草稿写入与审核后自动化 | [design.md](./design/design.md#13-monday-写入前怎么查询) |
| 技术选型、LLM、评测与 PO 格式漂移 | [design.md](./design/design.md#17-技术栈白名单约束边界选型和替换成本) |
| 唯一验收清单 | [acceptance.yaml](./test/acceptance.yaml) |
| 不要做 | 未评审前改产品代码；让 LLM 持有 Graph/monday token；用 `create_item` 直接触发生产或财务动作；把未验收方案写入现行 architecture/requirements |

## 背景

Sevenonic 当前通过多个 Microsoft 365 邮箱接收 PO、报价、新款和评语类邮件，同一封邮件可能同时到达主 PO 邮箱、跟单员和负责人邮箱。现有“每小时按 Delta 查询”的设想缺少近实时唤醒、逐邮箱游标、跨邮箱归并、异常隔离和 monday 外部写入幂等的完整闭环。

本提案以客户 A 发送 `PO-7788 Revision 2` 到 `po@sevenonic.com`，并抄送 `merch.a@sevenonic.com` 与 `boss@sevenonic.com` 为贯穿案例，把业务人员操作和技术数据流放在同一条链路中说明。

## 目标

- 用 Microsoft Graph Webhook 近实时唤醒、Delta 增量对账，可靠监听少量受管邮箱。
- 保存原始 MIME 和附件，建立 `mail_copy → canonical_message → business_event → extraction_run → write_operation` 可追溯链。
- 对 PO 字段进行格式、证据、正文/PDF一致性、revision 和业务不变量校验。
- 以幂等方式在 monday 创建“AI待复核”隔离草稿，经人工确认后才进入正式自动化。
- 明确 Graph、monday、模型、我们平台、数据库/任务队列/对象存储和业务人员的责任边界。
- 建立可重放评测集、故障恢复、监控告警和格式漂移停写机制。

## 范围

**做**

- 受管邮箱注册、Exchange Application RBAC、Graph 应用身份与订阅生命周期。
- Subscription、Webhook、Delta、MIME 和附件接入的请求/响应与定时任务设计。
- 多邮箱抄送、邮件移动、重发、同 PO revision、规则升级重跑和 monday 超时的幂等处理。
- PostgreSQL 持久任务队列、业务状态、审计 ledger 和对象存储索引。
- 规则优先、模型只读候选、原文证据、人工审核和 monday 状态门。
- PO PDF 格式指纹、未知格式隔离、评测与上线门槛。

**不做**

- 本次不实现可运行 MVP、生产部署或 Entra/monday 真实授权。
- 不建设洗水唛生成器、条码打印链路、企微自建应用、正式生产板或面辅料库全量能力。
- 不允许模型直接执行 Graph/monday 写操作，不自动执行取消订单、修改银行账户或付款指令。
- 不假设目标 board 已存在文档中的示例 group/column ID；实施时必须读取真实 schema。
- 不把同一 mailbox 的 alias 当作多个 mailbox，不把 ImmutableId 当作跨邮箱唯一键。

## 用户流程

1. 客户向主 PO 邮箱发件并抄送跟单/负责人。
2. Graph 通知唤醒系统；定时 Delta 对账负责补漏。
3. 系统归档各邮箱物理副本，再归并为同一次客户发送。
4. 系统识别文档和 PO revision，抽取带原文位置的候选字段。
5. 规则检查正文/PDF冲突、格式漂移、金额数量和历史版本。
6. 通过技术安全门后，系统幂等创建 monday 隔离草稿。
7. 跟单员确认关键字段并提交审核结论。
8. 系统二次读取 monday 当前值并保存审核记录，之后才允许正式流转。

## 技术设计与数据流

详见 [design.md](./design/design.md)。核心决策：Webhook 是低延迟唤醒信号，Delta 是可靠变化账本；每个 `mailbox + folder` 独立维护订阅和游标；邮件物理身份、规范消息、业务版本、解析版本和外部副作用分别建模；PostgreSQL job/outbox 和对象存储形成可恢复底座；monday 的 `event_id`、本地 ledger 和 `Idempotency-Key` 共同保护外部写入。

## 波及

| 列 | 内容 |
|---|---|
| 依赖平台 | Microsoft Entra ID、Exchange Online、Microsoft Graph、monday Platform API、可选模型 API |
| 我们平台 | 新增 Webhook API、Scheduler、Graph adapter、持久 worker、parser/policy、monday adapter、审核回调和监控 |
| 数据 | 新增 mailbox/subscription/cursor/job、邮件与附件归档索引、五层身份、人工审核和写入 ledger |
| 部署 | 公网 HTTPS 回调、PostgreSQL、对象存储、Secret Store；首期不强制 Redis/Celery |
| OpenAPI | 只有未来把审核证据页或运维页并入 Open Dashboard 时才新增草案；本次不改现行 OpenAPI |
| FE/BE/Harness | 本次不改；评审后另行明确是独立服务还是接入现有模块 |
| 回归 | 多邮箱抄送、Delta 分页宕机、邮件移动、毒 PDF、重发/revision、monday 成功但超时、board schema 漂移 |
| 不要动 | 已实现 architecture、requirements、P019 在途工作、冻结原型和现有产品代码 |

## 待甲方确认

- 真实 mailbox/alias/分发组映射、监听文件夹和 Outlook 规则。
- 邮件量、峰值、附件范围和期望处理时效。
- 客户白名单、PO 与 revision 判定、正文/PDF冲突责任人。
- monday board 的真实 group、column、状态和现有 automation 触发条件。
- 草稿使用同 board 隔离 group 还是独立 board，批准后采用覆盖、revision item 或 subitem。
- 原件保存期限、查看权限、部署责任和告警责任。

## 验收标准

唯一验收定义见 [acceptance.yaml](./test/acceptance.yaml)。所有阻塞项通过前，P020 保持 draft/accepted/in-progress，不得标为 done 或回写已实现产品基线。

## 修订记录

| 日期 | 说明 |
|---|---|
| 2026-09-10 | 补充邮件完整归档边界，区分文件夹移动、删除、Outlook 撤回与业务取消；增加客户邮件、Graph、我方平台、monday/人工共 75 类边界与异常处理，以及相应数据状态和验收门禁。 |
| 2026-09-10 | 补充 deltaLink 对账书签、mailbox/folder 绑定、自定义文件夹枚举、移动/重置案例；逐层列出五层身份的能力边界，并对比每小时 Delta、首期影子交付与 L0～L4 治理框架。 |
| 2026-09-10 | 根据 Sevenonic 业务自动化技术需求、视频沟通问题和多轮方案细化，建立完整的多邮箱监听、五层身份、PO 校验、monday 隔离审核与自动化设计。 |
