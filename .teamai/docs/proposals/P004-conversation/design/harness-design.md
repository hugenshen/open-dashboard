# AI Harness（历史 · FE→Python SSE）

> **状态：superseded by [P011](../../P011-dsh-conversation-surface)**（2026-08-21 M4）。  
> 现行实现：[`opendashboard-dsh-harness/`](../../../../../opendashboard-dsh-harness/)；Python `opendashboard-harness/` **已删除**；FE 无 `/harness/v1`。  
> 下文为 P004 时期对照摘要，**不再驱动开发**。完整历史正文见 git。

## 历史默认决策

| 层 | 做什么 |
|----|--------|
| OD Vue | 对话 UI；直连 `/harness/v1/*` SSE |
| `opendashboard-harness`（Python） | Agent loop、工具、SSE |
| Java | 会话 CRUD；`/api/internal/bi/*` |

写看板唯一入口语义（由 P011 继承）：`od_emit_patch` → Java `apply-patch`。

---

*Archived 2026-08-21 · see P011 design / migration.*
