# Design

现行设计说明与 **FE↔BE 硬契约**。协作规则见 [../process.md](../process.md)。

| 文档 | 内容 |
|------|------|
| [openapi.yaml](./openapi.yaml) | OpenAPI 契约（冲突时以已上线行为为准并尽快修） |
| [rest.md](./rest.md) | REST 人读总览 |
| [domain.md](./domain.md) | 实体与发布态 |
| [backend.md](./backend.md) | 后端 / COLA |
| [frontend.md](./frontend.md) | 前端模块 |
| [data-query.md](./data-query.md) | 取数链路 |
| [auth.md](./auth.md) | Auth SPI |
| [conversation.md](./conversation.md) | 对话分析（对齐 [P004](../proposals/P004-conversation.md)） |
| [ai-architecture.md](./ai-architecture.md) | AI 能力总架构（三开源对照 · **问数优先** · 采纳/生成看板） |
| [dashboard-generation.md](./dashboard-generation.md) | 仪表盘生成流程（Patch → draft → chartQuery） |
| [ai-harness.md](./ai-harness.md) | DeerFlow / `opendashboard-harness` 唯一 Agent；Java 零 AI + 内部 BI API |
