---
company:
  name: Open Dashboard
  mission: 开源仪表盘 / BI 画布，分析师接数建模出板，业务读者打开即可看
team:
  name: Co-TeamAI
  mission: 用本仓 .teamai/docs 契约与同目录 harness，让人与 AI 走同一条演进链
  goals:
    - 当前开发只做 roadmap/in-progress
    - 交接走 需求(BA) → 高保(BA) → 方案设计(开发) → 实现(开发) → 测试
    - 聊天确认的边界当轮回写 Pxxx
    - 未验收不进 requirements / 4A
---

## 协同

对外叫 **Co-TeamAI**，命令与目录仍是 `teamai` / `.teamai/`（官方 CLI 约定）。

产品与工程契约只在 `.teamai/docs/`。人按 **需求(BA) → 高保(BA) → 方案设计(开发) → 实现(开发) → 测试** 交接；BA 不写技术方案。

## 编码与交付

- 实现只打开提案 README「开发入口」
- `hi-fi: accepted` 对照 snapshot，禁止改冻结快照
- Commit / PR 标题带 Pxxx；跨端 OpenAPI 与实现同 PR
- 先对齐（讨论 / 提案 / 高保）再写产品代码；一次一条 in-progress 提案
- 0→1 踩坑读 `.teamai/learnings/`；动手走 `.teamai/skills/`（`od-rd-loop` 起）
