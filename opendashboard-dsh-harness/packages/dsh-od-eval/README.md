# `@opendashboard/dsh-od-eval`

P012 分段评测（E0）：独立于对话，驱动 `dsh-od-bi` 确定性模块。

详设：`docs/proposals/P012-ask-gen-quality/eval-design.md`

## 跑默认门禁（CI）

```bash
cd opendashboard-dsh-harness
pnpm eval
# 或
pnpm --filter @opendashboard/dsh-od-eval eval
```

## CLI

```bash
node packages/dsh-od-eval/src/cli.js
node packages/dsh-od-eval/src/cli.js --track board
node packages/dsh-od-eval/src/cli.js --stage plan,bind,layout,guard
node packages/dsh-od-eval/src/cli.js --id BOARD-PLAN-S1-01
node packages/dsh-od-eval/src/cli.js --report ./tmp/od-eval-report.json
```

## 用例

`cases/**/*.json`（与 eval-design YAML 壳同形；起步用 JSON 零依赖）。

| stage | 含义 |
|-------|------|
| `plan` | 规则 Goal 枚举（fallback） |
| `bind` | goals→charts + measureKind 闸 |
| `layout` | 组装 / 不重叠 |
| `guard` | sql-guard L0 |
| `ex` | 结果集 EX（夹具行比对；真连 BI 另开） |
| `viz` | suggestChartType |

报告：stdout 摘要 + 可选 `--report` JSON。
