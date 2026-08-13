# 提案索引（proposals）

进行中与已交付的功能规格都放这里。现行产品契约以 [`../product/requirements.md`](../product/requirements.md) + [`../design/`](../design/)（含 OpenAPI）为准；`status: done` 仅供追溯，不驱动新开发。

协作规则见 [`../process.md`](../process.md) · 使用说明（HTML）[`../guide.html`](../guide.html)。

## 进行中

| ID | 标题 | 状态 | 里程碑 | 文档 |
|----|------|------|--------|------|
| [P004](./P004-conversation.md) | 对话分析（内测一期） | in-progress | v0.5 | [design/conversation.md](../design/conversation.md) · [ai-architecture.md](../design/ai-architecture.md) |
| [P006](./P006-ask-data.md) | 对话问数（Ask-data） | in-progress | v0.5 | [design/ai-architecture.md](../design/ai-architecture.md) |
| [P005](./P005-insight-report.md) | 洞察报告（看板解读 → Umo） | draft | v0.6 | [design/conversation.md](../design/conversation.md) |

## 已交付（done）

| ID | 标题 | 里程碑 | 文档 |
|----|------|--------|------|
| [P001](./P001-mobile-layout-c.md) | 移动端布局与样式 | v0.2 | — |
| [P002](./P002-vue-java-scaffold.md) | Vue3 + Spring Boot 脚手架 | v0.3 | — |
| [P003](./P003-report-umo-charts.md) | 在线报告 Umo 插图 | v0.4 | — |

下一号：`P007`。

## 文首元数据

```yaml
status: draft | accepted | in-progress | done
milestone: v0.x
done: YYYY-MM-DD   # status=done 时填写
```
