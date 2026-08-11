# 协作规范（process）

所有人（含 AI）按本文推进需求。使用说明（HTML）：[guide.html](./guide.html)。

## 目录角色

| 路径 | 角色 |
|------|------|
| `product/overview.md` | 产品定位 |
| `product/requirements.md` | **仅已交付**基线（as-built） |
| `product/roadmap.md` | 下一步索引（按里程碑分组，链到 proposal） |
| `design/` | 现行说明书 + **硬契约** `openapi.yaml` / `rest.md` |
| `proposals/` | 进行中与已交付规格（靠 `status` 区分；无 archive 目录） |
| `prototypes/hi-fi/` | 当前高保原型（可改） |
| `prototypes/snapshots/` | 可选冻结快照（只读） |

## 新需求主路径

```text
roadmap 挂条 → proposals/Pxxx →（可选）原型
  → design/ + openapi → FE/BE 实现 → 回写 requirements → Pxxx 标 done
```

1. **立项**：`roadmap.md` 在对应里程碑（如 v0.5）下加条目并链接 Pxxx。  
2. **规格**：新建 `proposals/Pxxx-*.md`，`status: draft` → 评审后 `accepted` → 开工 `in-progress`。  
3. **契约**：跨 FE/BE 时，先更新 `design/openapi.yaml`（及必要 design 文），再改实现仓。  
4. **原型**：有新交互则改 `prototypes/hi-fi/`；破坏性大改前可拷到 `snapshots/`。  
5. **实现**：PR 注明 Pxxx；**未验收禁止写入** `requirements.md`。  
6. **交付**：验收点合并进 `requirements.md`；roadmap 勾掉；Pxxx → `status: done` 并填 `done: YYYY-MM-DD`。  

历史追溯：看 `proposals` 里 `done` 条目，或 git tag（如 `v0.5.0`）。**不保留 `archive/`。**

## 短路径

| 类型 | 做法 |
|------|------|
| 纯 UI、契约不变 | 可不建 proposal；必要时补一句 design |
| OpenAPI 与线上不符 | 无 proposal；改 openapi 或改代码（以已上线为准并尽快对齐） |
| 文档笔误 | 直接改对应 md |

## 版本（里程碑）

- 版本用在：`roadmap` 分组、proposal 的 `milestone`、发版 git tag。  
- **不**维护多份 `requirements-v0.x.md`；`requirements.md` 始终是当前已交付全集。  
- 想看旧版基线：`git show v0.4.0:docs/product/requirements.md`。

## 实例摘要

**分享加密码（跨端）**：roadmap v0.5 挂条 → P00x in-progress → 改 openapi + design → FE/BE → 写入 requirements → P00x done。  

**画布吸附（纯前端）**：可无 proposal；只改 FE（+ 可选 design/frontend）。  

**对话分析（P004）**：见 [proposals/P004-conversation.md](./proposals/P004-conversation.md)。
