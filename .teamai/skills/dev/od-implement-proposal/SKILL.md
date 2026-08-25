---
name: od-implement-proposal
description: 按 Open Dashboard 提案「开发入口」实现 Pxxx。对照 acceptance、指定原型与 OpenAPI，不猜测范围。用户说实施提案、落地 Pxxx、按开发入口改代码时使用。
---

# 实现提案

规范正文：[process.md](../../../docs/process.md)。踩坑：[rd-loop-align-then-code.md](../../../learnings/rd-loop-align-then-code.md)。

方案设计（`design/`、该有的 OpenAPI 草案、开发入口代码落点）必须已经由开发写完。没有方案不要开工；先走 [od-solution-design](../od-solution-design/SKILL.md)。

1. 确认条目仍在 `.teamai/docs/product/roadmap/in-progress/`，且 README 写了「当前做到哪」。
2. 打开 `.teamai/docs/proposals/Pxxx-name/README.md` 的「开发入口」和「波及」。
3. 验收只以 `test/acceptance.yaml` 为准；README 只有 ID + 标题。
4. `hi-fi: accepted` 读 snapshot；否则才读 hi-fi。不要对照最新 hi-fi 覆盖已冻结交互。
5. 跨端：OpenAPI 与实现同 PR 收口（草案已在方案设计写出）。
6. 代码验证提交时同步 `.teamai/docs/design/architecture.html`（只写代码里能证实的事实）。
7. 不要改 `snapshots/`、不要把未 pass 的能力写入 `requirements.md`。
8. 一次只做当前这条；不要顺手做 P005（draft）或未列入开发入口的内容。
9. 用户确认的新**技术**边界当轮回写 `design/`；若冲击范围/验收，交回 BA 改 README / `criterion`。
10. 声称完成前走 [od-local-verify](../../common/od-local-verify/SKILL.md)：真实点击，不是单次截图。

对话三轨（问数 / 出板 / 分析报告）不要混，见 [ask-gen-report-do-not-mix.md](../../../learnings/ask-gen-report-do-not-mix.md)。
