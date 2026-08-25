# `@opendashboard/dsh-od-eval`

分段评测：独立于对话，驱动 `dsh-od-bi` 确定性模块（P012 E0 + P015 出板质量）。

详设：`.teamai/docs/proposals/P012-ask-gen-quality/design/eval-design.md` · 出板质量目录：[P015 quality-evaluation.md](../../../.teamai/docs/proposals/P015-board-task-realize/design/quality-evaluation.md)

## 跑默认门禁（CI）

```bash
cd opendashboard-dsh-harness
pnpm eval
pnpm eval -- --track board
pnpm eval -- --track analysis
pnpm eval -- --stage cockpit,realize,review,worker,analysis
```

## CLI

```bash
node packages/dsh-od-eval/src/cli.js
node packages/dsh-od-eval/src/cli.js --track board
node packages/dsh-od-eval/src/cli.js --track analysis
node packages/dsh-od-eval/src/cli.js --stage plan,bind,layout,realize,review,worker,analysis,cockpit
node packages/dsh-od-eval/src/cli.js --id BOARD-COCKPIT-S1-01
node packages/dsh-od-eval/src/cli.js --report ./tmp/od-eval-report.json
```

## 用例

`cases/**/*.json`

| stage | 含义 |
|-------|------|
| `plan` | 规则 Goal 枚举 |
| `bind` | goals→charts + measureKind 闸 |
| `layout` | 组装 / 不重叠 |
| `realize` | 有数后选图（JoyAgent checkChartType + 槽位） |
| `review` | 饼上限、同维去重 |
| `worker` | depth 闸；get_data 不收模型 chartType；data_trans |
| `analysis` | P016：purpose=analysis → insight → save → commit_report（无 dashboardId） |
| `cockpit` | 整页质量：realize→review→layout（KPI / 最多 1 饼 / compare≠pie / 单位分 / 空任务丢） |
| `guard` | sql-guard L0 |
| `ex` | 结果集 EX（夹具行比对） |
| `viz` | 问数 suggestChartType |

报告：stdout 摘要 + 可选 `--report` JSON。
