---
description: 文档真相分层。未验收不进 requirements / 4A。
---

# 文档真相

只写已发生的事实：

- `.teamai/docs/design/`：现行 4A HTML + OpenAPI；可有 `architecture.md` 供检索。**禁止**把未实现设计写进来。
- `.teamai/docs/product/requirements.md`：仅已验收能力。
- 未交付需求、详细设计、验收：只在 `.teamai/docs/proposals/Pxxx-name/`（根 README 是地图；`req/` · `design/` · `test/` 按角色分夹）。`.teamai/docs/design/` 只放已实现 4A，不要和提案 `design/` 混淆。

聊天记录不是长期真相。用户确认的范围、权限、交互或技术边界，必须在本轮回写对应 Pxxx。
