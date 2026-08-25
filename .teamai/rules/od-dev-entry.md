---
description: 实现只走 in-progress 提案的开发入口，不从聊天或最新 hi-fi 猜测。
---

# 开发入口

当前任务只做 `.teamai/docs/product/roadmap/in-progress/` 里写了「当前做到哪」的条目。

实现 `Pxxx` 时：

1. 打开 `.teamai/docs/proposals/Pxxx-name/README.md` 文首与「开发入口」
2. 按表读 `test/acceptance.yaml`、`design/`、指定原型
3. 跨 FE/BE 先改 `.teamai/docs/design/openapi.yaml`，再改代码

不要从聊天、最新 hi-fi 或 done 提案里顺手抄未列入开发入口的内容。
