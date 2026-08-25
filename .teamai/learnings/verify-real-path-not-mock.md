---
title: 声称完成前必须走真实点击路径，不要用 mock 和单次渲染代替验收
author: hugenshen
date: 2026-08-25
tags: [testing, debugging, workflow, verify, 测试]
---

## 背景

用户经常在 AI 说「已完成」之后发现：5173 拒绝连接、对话 404、生成后点编辑图没了、历史点进去没有思考过程、菜单要刷新才出现。另一类问题是前端还在吃 mock，数据市场不是真数据集。

## 解决方案

改 UI / 对话 / 权限 / 生成链路之后，最低验证：

1. 相关服务真的在听端口（见高保端口学习）
2. 用浏览器走用户会走的路径：登录 → 目标页 → 点、输入、提交、再进相关路由
3. 空状态、错误态、刷新后是否还在（对话追加内容尤其要测）
4. 生成看板后点「编辑」：图还在，不要只测 SSE 成功
5. 跨页共享状态：工作台问数带的数据集，到 `/conversations` 还在不在

本地三件套：

```bash
./scripts/up.sh                                          # 产品 FE+BE
./.teamai/docs/prototypes/hi-fi/start.sh                 # 高保
cd opendashboard-dsh-harness && ./start.sh               # 对话 Agent
```

用户说「帮我启动」时，问清要高保、产品还是 dsh；默认不要只起其中一个却给另一个 URL。

## 经验总结

- 截一张静态图 ≠ 验证。布局对齐、筛选、分页、发布按钮都要真正点。
- 图表类型切换应继承指标/维度/筛选；重新配一遍是已知差体验。
- 分享页与编辑页不是同一套壳；分享页底部大片空白、可操作加号都是回归项。
- `GET /api/dashboard/{id}?view=published|draft` 404：先分清 id 是否存在、view 是否用错、是否跨工作区。
- 提交前若用户要求分批 commit，按 Pxxx 切，标题带提案号。
- 不要把本地密钥写进仓库或 learnings。

## 相关 Skills

- od-local-verify
- od-hi-fi
- od-implement-proposal
