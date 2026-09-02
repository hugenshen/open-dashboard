# P016 订单报告 golden path 复测

时间：2026-09-02

## 结论

本轮补齐 `ds_012eb19e · t_pay_order` 的本地/demo 可验证链路：

- Java 内存 seed 与 Flyway `V21__demo_payment_order_dataset.sql` 均注册 `ds_012eb19e · t_pay_order`。
- DSH 在 Java 目录缺失或未迁移时，仅对订单报告语义提供 `demo-fallback` 同名订单 schema/聚合样例，避免退回 `ds_sales`。
- 函数级 golden path 已跑通：规划 3 个任务，生成 3 个中间 MD，最终生成 HTML/MD。
- 最终报告包含商户与数值证据：`M10004`、`M10001`、`1207000`、`570000`、`19950` 等。
- `report-progress` 新增服务端快照文件回放，内存态丢失后仍可恢复最终过程与文件。

## 验证命令

```bash
cd opendashboard-dsh-harness
node --test packages/dsh-od-bi/src/report-route.test.js \
  packages/dsh-od-bi/src/report-progress.test.js \
  packages/dsh-od-bi/src/board-worker.test.js \
  packages/dsh-od-bi/src/analysis-worker.test.js \
  packages/dsh-od-bi/src/semantic-readiness.test.js \
  packages/dsh-od-bi/src/answer-meta.test.js
```

结果：`61/61 pass`

```bash
cd opendashboard-dsh-harness
pnpm eval -- --track analysis --report /tmp/od-analysis-eval-2026-09-02-order-fallback-2.json
```

结果：`2/2 passed`

```bash
cd open-dashboard-backend
mvn -q -pl open-dashboard-app,open-dashboard-start -am test -DskipTests
```

结果：编译通过。

```bash
cd open-dashboard-frontend
npm run build
```

结果：构建通过，仅存在既有 chunk size warning。

## 仍未改成 pass 的原因

`PR-ANR-02 / PR-ANR-10` 仍保持 `wip`：函数级与本地 demo 订单链路已闭环，但还需要在浏览器真实 worker 长链路里手验动态规划、右侧实时跟随、文件页和 transcript 回放全部一致，才能从商用角度判定通过。
