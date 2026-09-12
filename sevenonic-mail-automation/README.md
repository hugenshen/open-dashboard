# Sevenonic Mail Automation

P020 的独立可运行服务：通过 Microsoft Graph 订阅和 Delta 获取受管邮箱邮件，归档 MIME/附件，解析正文、PO PDF 和服装技术包 Excel，并以本地写入账本、远端 `event_id` 和 monday `Idempotency-Key` 三层保护创建待复核任务。

## 当前实现状态

已实现并可用自动化测试验证：

- Graph OAuth client credentials、Subscription 创建/续订、Webhook challenge、通知入队。
- Outlook message subscription 申请 6 天、提前 24 小时续租；生命周期 `missed`、`reauthorizationRequired`、`subscriptionRemoved` 分别进入补账、续授权或重建任务。
- 每个 `mailbox_id + folder_id` 独立 Delta、`Prefer: IdType="ImmutableId"`、分页及最终 deltaLink 提交。
- Graph `$value` MIME 下载；正文、HTML 和附件解析；原始 MIME 与附件 hash 归档。
- 邮箱副本、规范消息、业务事件、解析运行和 monday 写操作分层去重。
- PO PDF 基础字段解析。
- XLSX/XLSM OOXML 安全检查、工作表 manifest、服装量度表/放码表/PP comments/图片样/全码实测识别、版本差异。
- monday board schema 查询、按 `event_id` 查询、幂等创建 AI 待复核 item。
- FastAPI 运维接口、常驻 worker、15分钟 Delta sweep、订阅到期续租、SQLite 本地模式、PostgreSQL 容器模式。

尚未声称完成：真实 Entra/Exchange RBAC、真实邮箱 Subscription 回调、真实 monday board 列映射和多角色 UAT。这些必须等甲方凭据和 board schema 到位后执行 live smoke test。

## 本地启动

```bash
cd sevenonic-mail-automation
cp .env.example .env
uv sync --extra dev
uv run sevenonic-mail init-db
uv run sevenonic-mail serve --port 8091
```

打开 `http://127.0.0.1:8091/docs` 查看 OpenAPI，健康检查：

```bash
curl http://127.0.0.1:8091/healthz
```

未配置真实密钥时服务仍可启动，但 Graph/monday 显示为未配置，不能执行真实外部调用。

## 自动化测试

```bash
uv run --extra dev pytest -q
uv run --extra dev ruff check .
```

测试使用本地 SQLite、临时对象目录和 `httpx.MockTransport` 模拟真实 Graph/monday HTTP 契约，不需要也不会读取生产密钥。

当前基线为 23 项测试全部通过。

## Docker + PostgreSQL

```bash
cp .env.example .env
# 修改 POSTGRES_PASSWORD、ADMIN_TOKEN；真实联调时再填写 Graph/monday 配置。
docker compose up --build
```

## 获得凭据后的真实联调顺序

1. 复制 `.env.example` 为 `.env`，填写 Entra、Graph callback 和 monday 配置；禁止提交 `.env`。
2. 在 Exchange Online 用 Application RBAC 将应用限制到测试邮箱。
3. 在 monday 建测试 board/隔离 group，创建 `event_id`、`style_id`、`tech_pack_revision`、`review_status` 列。
4. 先查询 monday schema，确认真实 board/group/column ID，不使用截图文字当 ID。
5. 先做只读连接和最小权限检查；输出不含 token：

   ```bash
   uv run sevenonic-mail check-connections
   ```

   该命令会按 `GRAPH_MAILBOXES_JSON` 读取每个邮箱的目标文件夹，并返回 Graph 解析出的真实 `folder_id`、名称、邮件数；同时读取 monday 的真实 board/group/column ID 与类型。某个邮箱不在 Exchange Application RBAC 范围内时应在这里明确报 403。

6. 暴露 HTTPS 回调后创建 Graph subscriptions：

   ```bash
   uv run sevenonic-mail bootstrap-subscriptions
   ```

7. 给测试邮箱发送一封带 `HMV071-Tech-Pack-Rev4.xlsx` 的邮件。
8. Webhook 产生 `SYNC_MAILBOX`；运行 worker：

   ```bash
   uv run sevenonic-mail run-jobs
   # 第一次执行邮件同步并产生 WRITE_MONDAY；再执行一次完成 monday 写入。
   uv run sevenonic-mail run-jobs
   ```

9. 检查原始 `.eml`、附件 hash、数据库 event、monday AI 待复核 item。
10. 原邮件重放 10 次，确认只有一个业务事件和一个 monday item。

生产环境使用独立常驻 worker：

```bash
uv run sevenonic-mail run-worker
```

worker 默认每 15 分钟为每个 mailbox/folder 入队一次 Delta 补账，并每小时检查需要在 24 小时内续订的 subscription。Webhook 和定时 sweep 进入同一种 `SYNC_MAILBOX` 任务；`run-jobs` 保留为联调单轮入口。

普通 Outlook message 基础通知的微软当前上限是 10,080 分钟（不足 7 天），不是部分旧材料写的 4,230 分钟。本服务申请 6 天并留出 24 小时恢复窗口；Subscription 只是低延迟“门铃”，最终变化仍由对应 mailbox/folder 的 Delta 对账确认。

## 关键 API

| API | 用途 |
|---|---|
| `POST /webhooks/graph?validationToken=...` | Graph 回调 URL 验证 |
| `POST /webhooks/graph` | 接收变化通知并持久入队 |
| `POST /webhooks/graph/lifecycle` | 接收 subscription 生命周期通知 |
| `POST /webhooks/monday` | monday challenge/事件入队 |
| `POST /operations/subscriptions/bootstrap` | 为配置的 mailbox/folder 创建订阅 |
| `POST /operations/mailboxes/{mailbox}/folders/{folder}/sync` | 手动执行一次 Delta |
| `POST /operations/jobs/run-once` | 联调时执行一批任务 |
| `GET /events/{event_id}` | 查询结构化业务事件 |
| `GET /operations/counts` | 查看接收和写入对象数量 |

所有 `/operations/*` 和 `/events/*` 请求都必须携带 `X-Admin-Token`。Webhook 不使用管理员 token；Graph 用 `clientState`，monday 在真实接入前还需结合签名/来源及二次读取策略完成安全评审。

## monday 数据粒度

monday 只保存款号/PO、技术包 revision、sample round、负责人、状态、关键异常和证据链接。完整 Measurement/Graded Specs 矩阵保存在数据库和对象存储，避免把数百个尺码/量度单元格扩成 board 顶层列。

## 密钥清单

真实联调需要：

- `GRAPH_TENANT_ID`
- `GRAPH_CLIENT_ID`
- `GRAPH_CLIENT_SECRET`（生产建议后续改证书）
- `GRAPH_CLIENT_STATE`（独立随机值）
- 公网 HTTPS notification/lifecycle URL
- 受管 mailbox/folder 清单和 Exchange Application RBAC
- `MONDAY_API_TOKEN`
- monday board/group/column 的真实 ID、API 版本和现有 automations

不要通过聊天、截图、日志或 Git 提交真实 token。建议使用一次性安全渠道和 Secret Manager。

## 官方契约依据

- [Microsoft Graph 创建 Subscription](https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0)
- [Outlook Subscription 生命周期上限](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0)
- [Webhook 验证和投递时限](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)
- [生命周期 missed/removed/reauthorizationRequired](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events)
- [Message Delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
- [Outlook Immutable ID](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)
- [monday API Versioning](https://developer.monday.com/api-reference/docs/api-versioning)
- [monday items_page_by_column_values](https://developer.monday.com/api-reference/reference/items-page-by-column-values)
- [monday Idempotency-Key](https://developer.monday.com/api-reference/docs/idempotency)
