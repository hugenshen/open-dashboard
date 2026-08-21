# P007 · Vue AppShell 设计（Shell-2）

> 状态：产品实现中。高保交互以冻结快照为准；本文只写 Vue 落点。  
> 交互真相：[`2026-08-17-p007-app-shell-final`](../../prototypes/snapshots/2026-08-17-p007-app-shell-final/)  
> 提案入口：[README](./README.md)

## 本轮交付（请先验这一块）

产品壳 + 工作台三行布局。权限消费面仍归 P008。

| 做 | 不做 |
|----|------|
| 全站左栏 + 顶栏 `AppShell` | OpenAPI / IAM / 权限感知（P008） |
| 工作台三行：问数 / 概览 / 常用 / 待处理 / 最近看板 / 最近报告 | 我的 / 共享给我 / 可问数据集选择器（P008） |
| `?state=empty`、`?count=1\|2\|10` | 拆 `editorCore` / `commercial.js` |
| `GET /api/auth/menus` 驱动菜单 | 问数结果卡交互细节（P006） |
| 编辑器 `meta.shell = 'editor'`：默认细轨，可展开（占位推内容）；隐藏产品顶栏，SQLBot/帮助/外观/账号并入编辑条 | 资源页内部卡片全量深色重绘 |
| SQLBot 仅仪表盘编辑器 | |
| 浅色 / 深色侧栏 / 深色，写入 `od.theme` | |

## 信息架构

```
┌─────────┬────────────────────────────────┐
│ 左栏    │ （非编辑）顶栏：帮助 / 外观 / 账号 │
│ 开始    ├────────────────────────────────┤
│  工作台 │ 编辑态：无产品顶栏；壳层操作在     │
│  对话   │ 编辑器 .bar 右侧（含 SQLBot）     │
│ 资源    │           模块内容区            │
│  …      │                                │
│ 收起    │                                │
└─────────┴────────────────────────────────┘
* SQLBot 仅 `shell=editor`。`#phaseTabs` 仍挂在壳层操作 DOM，产品不展示。
```

问数入口：工作台页内框（提交后 `od.ask.q` + autorun 进对话）、对话流、编辑器 SQLBot。资源模块顶栏不放问数框。

## 壳层规则

| 规则 | 行为 |
|------|------|
| 默认 | 左栏 240px 展开 |
| 用户收起 | `localStorage['od.rail.slim']`；非编辑器记住偏好；收起/展开不弹 toast |
| 仪表盘编辑器 | 进入默认细轨 72px（不写偏好）；可展开为完整左栏（占位推内容，非浮层）；离开后恢复用户偏好 |
| 编辑器顶栏 | 隐藏产品 `od-top`；SQLBot / 帮助 / 外观 / 账号 Teleport 到 `#editorShellHost` |
| 窄屏 ≤900px | CSS 强制图标轨 |
| 分享页 | `meta.hideShell`，无产品壳 |
| 对话内侧栏 | 隐藏；新对话 / 历史 / 探索放对话顶条 |

禁止再用 `id="modNav"`：`editorCore.js` 会劫持该节点做高保 hash 路由。产品必须保留隐藏的 `id="phaseTabs"`，供编辑器内核绑定；产品挂载后固定 Phase C，不提供 A/B/C 切换。

## Vue 结构

```
App.vue
  └─ AppShell          # 菜单、主题、细轨、顶栏
       └─ <router-view>
/share/:token          # 无 AppShell
```

| 文件 | 职责 |
|------|------|
| `src/shell/AppShell.vue` | 左栏 + 顶栏 |
| `src/shell/app-shell.css` | 对齐高保 `shared/shell.css` 变量与布局 |
| `src/shell/theme.ts` | `od.theme` / `od.rail.slim` |
| `src/workbench/views/Workbench.vue` | 三行工作台；问数跳转对话 |
| `src/router/index.ts` | 编辑器 `meta.shell = 'editor'` |

菜单仍走 `GET /api/auth/menus`，失败回落到内置六项。对话项是否出现由后端 `ConversationProperties.enabled` 决定。

## 主题

`html[data-od-theme]`：`light`（默认）/ `dark-rail` / `dark`。  
深色必须写到 `documentElement`，嵌入 iframe 同步 `dataset.odTheme`，避免深色外壳包白框。

## 与高保差异（本轮已知）

- 最近问数在问数框下方，来自 Java `de_conversation`（`GET /api/conversations?limit=8`）。右栏最近报告来自 `GET /api/report?limit=4`（`de_report` 按 updateTime 倒序），条目用文档图标而非「报」字：已发布绿、草稿紫。列表失败不得伪装成没有记录。
- 最近看板首屏固定 3 张（`?count=10` 仍只展示 3 张，完整列表走「全部」）；封面按名称/分组推断领域插画，不再用高保里的重复 sparkline。
- 资源页内部（列表轨、表单）未按全深色重绘，壳层已跟主题走。
- 浅色壳：左栏选中与顶栏使用 `--od-bg`（与模块画布同色），不再用 `--od-brand-soft` 选中块 / 顶栏半透明白。冻结快照仍是旧配色。
- 产品编辑器不展示 Phase A/B/C（高保快照仍可切换）；能力固定为 C，移动布局走画布「PC布局 / 移动布局」。
- 账号菜单为演示，不接真实 IAM。
