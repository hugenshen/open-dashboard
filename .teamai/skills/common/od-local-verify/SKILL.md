---
name: od-local-verify
description: 本地启动 Open Dashboard 并做端到端验证。用户说启动、重启、5173 拒绝连接、3090、测一下、访问不了、提交前验证、mock 数据时使用。
---

# 本地验证

踩坑：[verify-real-path-not-mock.md](../../../learnings/verify-real-path-not-mock.md)、[hi-fi-ports-and-snapshots.md](../../../learnings/hi-fi-ports-and-snapshots.md)。

## 先分清用户要开哪一套

| 用户要看 | 命令 | URL |
|----------|------|-----|
| 产品（登录、工作台、数据集、编辑器） | 仓库根 `./scripts/up.sh` | `http://127.0.0.1:5173/` |
| 高保 | `.teamai/docs/prototypes/hi-fi/start.sh` | `http://127.0.0.1:8765/` |
| 对话 Agent（dsh） | `cd opendashboard-dsh-harness && ./start.sh` | `http://127.0.0.1:3080/` 或脚本打印的端口 |

用户说「三个服务都跑起来」时，三套都要起，不要只起一个却给另一个链接。

dsh 依赖：`pnpm install && pnpm approve-builds --all`（见仓库根 `AGENTS.md`）。

## 验证清单（改 UI / 对话 / 权限必做）

1. 浏览器打开目标 URL，走完点击/输入/提交，不是只截一张图。
2. 刷新、切到其他菜单再回来：对话追加内容、选中的数据集还在不在。
3. 空列表、错误态、未登录/无权限。
4. 生成看板后点编辑：图还在。分享页不可编辑。
5. 权限改动：用**新注册用户**走申请/审批，不要只用管理员。
6. 确认页面不是前端 mock；数据市场对接真实数据集。

## 常见误判

- `127.0.0.1 拒绝连接`：服务没起或端口错，先查进程再改业务代码。
- 对话 `404 conversation not found`：session / 历史 ID / 工作区，不是先改样式。
- 仪表盘 404：分清 `view=draft` 与 `published`，以及是否跨工作区。
- 问数/出板「没数据」：先查数据集是否选中、工具是否返回 schema、绑定闸是否拒绝，见 [quality-gate-not-prompt.md](../../../learnings/quality-gate-not-prompt.md)。

## 不要

- 把密钥、token、数据库密码写进代码或文档
- 在验证失败时声称提案已完成
