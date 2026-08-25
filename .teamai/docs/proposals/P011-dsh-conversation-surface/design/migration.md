# P011 · 对话 / Agent 迁到 DeepSeek Harness — 迁移方案

> 状态：`done`（P011 已交付）。对照：`refs/deepseek-harness`（可选）、归档 [`harness-design.md`](../../P004-conversation/design/harness-design.md)。  
> 架构切分见 [design.md](./design.md)；本文回答 **怎么迁、按什么顺序、迁完什么算稳**。

---

## 0. 一句话结论

**保留 OD 产品壳 + Java BI 真相；对话 UI + Agent 整段换成 dsh。**  
本仓新建 **`opendashboard-dsh-harness/`**（npm 锁版本依赖 `@deepseek-ai/dsh-*` + OD 薄插件）。  
**直接按长期方案：删除 `opendashboard-harness/`（Python）**——不设 sidecar 过渡；sqlbot / 质检 / layout / deterministic 一并迁到 TS（或必要闸门进 Java）。

不迁：仪表盘编辑器、数据集管理、报告、登录/工作区、`apply-patch` 写闸门。

---

## 0.1 仓库与技术栈（已拍板）

### 依赖与目录

| 决策 | 结论 |
|------|------|
| dsh 源码 | **不**整仓 vendor；**不**进产品构建的 submodule |
| 运行时 | **`package.json` + lockfile 锁定 `@deepseek-ai/dsh-*`** |
| OD 自有包目录 | **`opendashboard-dsh-harness/`**（profile、Host 工具、Client Node、auth、context） |
| 对照仓 | `refs/deepseek-harness` 仅本地对照，不进发布 |
| Python `opendashboard-harness/` | **删除**（实现切流时同波次下线；不保留 sidecar） |

```text
open-dashboard/
  open-dashboard-frontend/       # Vue 壳（对话路由 embed dsh）
  open-dashboard-backend/        # Java BI
  opendashboard-dsh-harness/     # ★ 新建：OD dsh profile + TS 插件
  refs/deepseek-harness/         # 可选对照，不进发布
  # opendashboard-harness/       # ✕ 删除（原 Python Agent）
```

### 语言分工（终态）

| 层 | 语言 | 说明 |
|----|------|------|
| 对话 UI | dsh Web（React 客户端插件） | 不再维护平行 Vue 对话壳 |
| Agent loop / Session / `od_*` | **TypeScript**（`opendashboard-dsh-harness`） | Cordis 插件；含原 sqlbot/质检/layout |
| 产品壳 / 编辑器 / 数据管理 | **Vue** | 不变 |
| BI 真相 / 权限 / patch | **Java** | 不变 |
| 只读 SQL 语法闸 | **TS**（迁 sqlglot 能力或等价校验）或 **Java** 侧增强 | **不**再跑独立 Python 服务 |

注意：dsh Python SDK 只是 JSON-RPC 壳，**不能**代替 Host 上的 TS 工具；本方案不采用该 SDK 作为 Agent 主路径。

### 已否决

- Python harness 收缩为 sidecar 再删  
- 目录名 `opendashboard-dsh/`（统一用 **`opendashboard-dsh-harness`**）

---

## 1. 现状 → 目标

| 层 | 现状（P004/P006） | 目标（P011） |
|----|-------------------|--------------|
| 对话 UI | Vue `ConversationWorkspace` + SSE | dsh Web（思考/工具卡/Plan/审批/steer/轨迹） |
| Agent | Python `opendashboard-harness` | **`opendashboard-dsh-harness`** + dsh agent-loop |
| 工具 | Python 定义 → Java internal | TS `od_*` → 同 Java；厚逻辑在 TS 内重写 |
| 会话真相（交互） | harness `events[]` | dsh Session 日志 |
| 会话真相（产品） | Java `de_conversation*` | **仍 Java** |
| FE 入口 | `/conversations` → Vue → `/harness/v1` | OD 壳 embed → dsh；**无** `/harness/v1` |
| 记忆/知识 | Python `context.py` | dsh context 插件 `agent.inject` |

```text
【现状】
  Vue ──SSE──▶ Python opendashboard-harness ──▶ LLM
                         │
                         └──▶ Java internal BI

【目标】
  OD AppShell ──embed──▶ opendashboard-dsh-harness（dsh Web+Agent）──▶ LLM
                                      │
                         ┌────────────┼────────────┐
                         ▼            ▼            ▼
                   Java BI      Session 持久化   （无 Python Agent）
                (查询/patch)   (jsonl/sqlite)
```

---

## 2. 原则（不可破）

1. **写看板只经** `od_emit_patch` → Java `apply-patch`。  
2. **任意 SQL 不进浏览器**；只读 SQL 在 TS/Java 闸内校验。  
3. **默认关掉** dsh coding bash / 任意写业务路径。  
4. **双写映射**：`dsh.sessionId ↔ java.conversationId`。  
5. **交互可回放 ≡ SessionEvent**；轨迹不另建库。  
6. 切流前可用 flag 对照 hi-fi；**切流完成即删除 Python harness**，不以「legacy SSE」长期并存。  
7. **锁定 `@deepseek-ai/dsh-*` 版本** + OD 插件契约测试。

---

## 3. 组件迁移清单

### 3.1 直接由 dsh / 新包替代

| 现行 | 落点 |
|------|------|
| Composer / 思考 / 步骤 UI | dsh Web |
| Lead 工具循环 / SSE | agent-loop + SessionEvent |
| `sqlbot/`、质检、`od_layout_board`、deterministic | **`opendashboard-dsh-harness` 内 TS 重写**（可对照旧 Python，不保留进程） |
| skills / 知识拼 prompt | context / skills 插件 |

### 3.2 `opendashboard-dsh-harness` 内插件

| 包/模块 | 内容 |
|---------|------|
| Host `od-bi` | `od_list_datasets` · `od_get_schema` · `od_run_query` · `od_run_sql` · `od_profile_dataset` · `od_plan_charts` · `od_layout_board` · `od_emit_patch` · `od_finish` · … |
| Client `od-nodes` | `od-answer-table` / `od-answer-chart` / `od-board-preview` / `od-clarify` |
| `od-context` | 知识/记忆 `inject` |
| `od-auth` | `OD_DSH_BRIDGE` → session meta |
| profile `od-conversation` | 裁剪 coding + BI persona |

工具策略：**一律 TS** → Java internal；从旧 Python 移植算法进本包，禁止再起 Python Agent。

### 3.3 仍 OD、不进 dsh

AppShell、编辑器、数据集、报告、Java conversations CRUD、Java internal BI、P010 管理页。

### 3.4 退役

| 退役物 | 时机 |
|--------|------|
| `opendashboard-harness/` 整目录 | 切流合并时删除（最迟 M4；不留 sidecar） |
| Vue `ConversationWorkspace` 主路径 | M4 |
| FE `/harness` 代理与 API 客户端 | M4 |
| 旧 ask 高保 | 已冻结 P006 snapshot |

---

## 4. 数据与会话迁移

### 4.1 新会话

1. OD → Java `conversationId`。  
2. Bridge → dsh `sessions.create` + 映射表。  
3. 交互只追加 SessionEvent；Java 摘要列表字段。

### 4.2 旧会话

**默认 A：只读遗留 / 归档**——不强求 SSE→SessionEvent 无损导入。需续聊则新开 dsh 会话。

### 4.3 持久化

`opendashboard-dsh-harness` 使用 dsh session-persistence（jsonl/sqlite），按 workspace 隔离；重启后 Chat + 轨迹同源重建。

### 4.4 记忆 / 知识

`od-context` pre-step `inject`；管理面仍 P010。

---

## 5. 波次计划

### M0 · 空壳接通

- 建 `opendashboard-dsh-harness/`：锁 `@deepseek-ai/dsh-*`，profile 能起 Web  
- OD `/conversations` embed `/dsh/` + `OD_DSH_BRIDGE`  
- 纯文本一轮  

**退出**：同域能聊一句。

### M1 · 问数出表

- TS：`od_list_datasets` / `od_get_schema` / `od_run_query` → Java  
- Node `od-answer-table` + `tools/pre-execute` 权限  

**退出**：出表；轨迹可见 tool。验收 PR-DSH-03。

### M2 · Ask-3 + 临时图

- TS：`od_run_sql` + **SQL 只读校验（迁自 sqlglot，无 Python）**  
- Node `od-answer-chart`；澄清 Node  
- 编辑器浮层 → 同一 dsh session  

**退出**：临时图；浏览器无裸 SQL。验收 PR-DSH-04。

### M3 · 一句话生成

- TS：profile → plan_charts → **质检 + layout**（迁自 Python）→ `od_emit_patch`  
- Node `od-board-preview` + 打开编辑器  
- Plan / approval 对齐 dsh  

**退出**：draft + 跳转。验收 PR-DSH-05（**pass**，2026-08-21）。

### M4 · 切主路径并删除 Python harness

- 默认对话走 `opendashboard-dsh-harness`  
- 下线 Vue 对话主路径  
- **删除 `opendashboard-harness/`**；去掉 FE `/harness`、启动脚本与文档中的 Python Agent 入口  
- 无 LLM：dsh headless + TS deterministic preset（PR-DSH-07）  
- 安全裁剪证明（PR-DSH-06）  
- P004/P006 SSE 验收 ID superseded（PR-DSH-08）  

**退出**：仓内无 Python Agent；FE 无 `/harness` 依赖。（**pass**，2026-08-21）

---

## 6. FE / 路由

| 项 | 做法 |
|----|------|
| `/conversations/:id?` | 壳 + embed；`:id` → resolve dsh session |
| Vite / Nginx | `/dsh/` → `opendashboard-dsh-harness` 服务端口 |
| replay / AiPanel | 读 dsh；删除 harness SSE 客户端 |

高保：`conversation.html` + `conversation-ask-dsh.html`。

---

## 7. 鉴权与安全检查表

- [ ] Bridge 短时、绑 workspace、不可伪造 userId  
- [ ] `od_*` → `X-OD-Internal-Token` + user/perms  
- [ ] 禁 invent patch 直写；禁默认 bash 碰生产库  
- [ ] SQL 仅 SELECT + 校验；结果预算  
- [ ] 跨工作区 session 拒绝 load  

---

## 8. 测试与验收

契约（Java ↔ `od_*`）、波次冒烟、问数/生成回归、杀进程后轨迹回放、越权拒绝。见 [acceptance.yaml](../test/acceptance.yaml)。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| dsh 破坏性变更 | 锁 npm 版本；插件薄；契约测 |
| sqlglot/质检/layout 重写量 | 对照旧 Python 单测移植；优先保行为不保结构 |
| 无 sidecar 缓冲 | M2/M3 把闸门做进 TS/Java，切流前必须可跑通再删 Python |
| 旧会话 | 只读/归档 |
| Cordis 学习成本 | M0 空壳 + cookbook |

---

## 10. 决策门（开干前）

1. **接受 P011**（PR-DSH-01）→ `roadmap/in-progress/`。  
2. 嵌入：同域反代 iframe（推荐）。  
3. 旧会话：**A 只读/归档**。  
4. ~~Python sidecar 保留期~~ → **已否决；直接删除**。  
5. P010 知识注入：M1 紧随或单独波次。  

未过门前不实现生产迁移；可继续 hi-fi 与本地试验。

> **2026-08-21**：已过门并开工 M0（见仓内 `opendashboard-dsh-harness/`）。

---

## 11. 接受后第一周

1. 建 **`opendashboard-dsh-harness/`**：`package.json` 锁 `@deepseek-ai/dsh-*` + 空 profile  
2. OD 路由 + bridge（M0）  
3. `od_list_datasets` / schema / query（M1）  
4. 表 Node  
5. 并行：从旧 Python 抽出 sql/质检/layout 的移植清单与单测  

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-21 | 初稿：现状→目标、组件清单、数据策略、M0–M4、决策门 |
| 2026-08-21 | §0.1：不整仓 vendor；Agent 主路径 TS |
| 2026-08-21 | **产品拍板**：目录名 `opendashboard-dsh-harness`；**直接删除 Python `opendashboard-harness`，不设 sidecar**；厚逻辑迁 TS/Java |
| 2026-08-21 | M0 落地；M1：`od_get_schema`/`od_run_query` + `od-answer-table` Node |
| 2026-08-21 | M2：`od_run_sql` + sql-guard；`od-answer-chart` |
| 2026-08-21 | **M3 已通**：TS plan/layout + `od_emit_patch` → apply-patch；`od-board-preview`；PR-DSH-05 pass |
| 2026-08-21 | **M4 切流**：默认 dsh；删 Python harness + FE `/harness`；PR-DSH-06…09 pass |
| 2026-08-21 | **提案 done**：hi-fi accepted；architecture/requirements 回写 |
