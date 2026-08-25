---
name: od-acceptance
description: 按提案 acceptance.yaml 做产品验收。用户说验收、过验收、改 yaml 状态、手验、阻塞 done 时使用。不要改需求判据，不要改产品代码。
---

# 验收

规范：[process.md](../../../docs/process.md)。

测试只改 `acceptance.yaml` 的 `status` / `evidence`。`criterion` 是 BA 的；`command_or_path` 是开发的。

## 怎么验

1. 确认提案仍在 `roadmap/in-progress/`，打开 `test/acceptance.yaml`。
2. `gate: hi-fi` 对照 `prototype-snapshot`，不要对照最新 hi-fi。
3. `gate: code` 确认开发入口列出的代码存在，不是「有 PR 就算过」。
4. `gate: acceptance` 按判据在真实环境走一遍（产品 5173 / 高保 8765 / dsh），启动用 [od-local-verify](../../common/od-local-verify/SKILL.md)。
5. 通过写 `status: pass` 和可复核证据；失败写 `fail` 与复现步骤。不要用「代码已合」替代产品验收。

## 不要

- 改 README 范围或 yaml `criterion`
- 把未 pass 的 ID 写入 `requirements.md`
- 全部阻塞项未 pass 就把提案标 `done`
