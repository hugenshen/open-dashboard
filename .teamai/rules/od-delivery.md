---
description: 交付顺序与 PR 约定。部分交付保持 in-progress。
---

# 交付

- Commit / PR 标题带 Pxxx。
- 跨端同一 PR：OpenAPI 与实现一起合。
- 模块边界、数据流、技术栈或部署变化：`architecture.html` 必须同 commit。
- `done` 前全部阻塞验收项 `pass`；部分交付只回写已 pass 的 ID，提案保持 `in-progress`。
- 顺序：OpenAPI → 实现与验证 → architecture 同步 → requirements 回写 → 该行挪到 `roadmap/done/` → proposal `done`。

不要跑 `teamai uninstall` 清 docs：`.teamai/docs/` 就是本仓契约树。
