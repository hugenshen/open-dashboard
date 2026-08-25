---
name: od-solution-design
description: 由开发写 Open Dashboard 提案的技术方案（design.md、跨端 OpenAPI 草案、开发入口代码落点）。用户说方案设计、怎么实现、模块边界、契约怎么变时使用。不要改需求范围，不要先写产品代码。
---

# 方案设计（开发做）

规范：[process.md](../../../docs/process.md)。BA 不懂技术细节；本棒由 `dev` 写，不由 `ba` 写。

前置：提案 README 已有范围 / 非目标 / yaml `criterion`；需要高保时已有 `prototype` 或 snapshot。

## 产出

- 提案 `design/`（主文 `design.md`，可拆 `*-design.md`）：流程、模型、模块边界、数据流、和现有代码怎么接
- 跨 FE/BE 时：`.teamai/docs/design/openapi.yaml` **草案**（实现时与代码同 PR 收口）
- README「开发入口」补全：代码路径、对照哪份原型、回归哪些 ID
- 「波及」表的技术列：改 FE / BE / harness / OpenAPI；**不要动**什么

## 不要

- 改 BA 的范围、非目标、`criterion`（有冲突先问 BA，回写需求棒）
- 把未实现方案写进 `architecture.html` / `requirements.md`
- 未写完方案就改 `open-dashboard-frontend/` / `backend` / `dsh` 产品代码
- 用高保 html 代替 `design/`

方案评审通过后，再走 [od-implement-proposal](../od-implement-proposal/SKILL.md)。
