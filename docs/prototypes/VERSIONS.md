# 高保原型版本账本

`docs/` 里的原型分两层，开发必须分清：

| 层 | 路径 | 含义 | 开发怎么用 |
|----|------|------|------------|
| **当前增量** | [`hi-fi/`](./hi-fi/) | 唯一可改工作区，永远最新 | 仅当提案 `gates.hi-fi` 为 `none` 或 `wip` 时作为对照 |
| **历史冻结** | [`snapshots/<id>/`](./snapshots/) | 只读；一次打快照后不再改 | 提案 `prototype-snapshot` 指向的那一版才是验收/实现基线 |

识别与提案的关系：

1. 快照 ID 含提案号，例如 `2026-08-17-p007-app-shell-final`。
2. 本表的 **提案** 列是主键；提案文首 `prototype` / `prototype-snapshot` 必须能指回来。
3. **kind**：`increment` = 过程冻结（继续改 hi-fi 之前留档）；`acceptance` = 该提案高保验收基线。
4. **相对上一版**：写清改了什么。实现时若 `hi-fi: accepted`，只实现 acceptance 快照，不把后续 increment 当需求。

打快照：`./snapshot.sh <id> "<说明>" <Pxxx> <increment|acceptance>`（在本目录执行）。**禁止**改 snapshots 里的文件。

| ID | 日期 | 提案 | kind | 相对上一版 | 快照 |
|----|------|------|------|------------|------|
| `2026-08-17-p007-app-shell` | 2026-08-17 | [P007](../proposals/P007-app-shell/) | increment | 首次拆出左栏壳、工作台独立页、问数结果进对话流 | [snapshots/…](./snapshots/2026-08-17-p007-app-shell/) |
| `2026-08-17-p007-app-shell-final` | 2026-08-17 | [P007](../proposals/P007-app-shell/) | **acceptance** | 相对上一版：工作台三行对齐、空/少/多状态、SQLBot 仅编辑器、深色同步嵌入对话；**P007 高保实现对照此版** | [snapshots/…](./snapshots/2026-08-17-p007-app-shell-final/) |

当前 hi-fi 增量（未打快照）：[P009](../proposals/P009-workspace-governance/) 统一入口 `index.html`、同壳双区域、顶部工作区切换器、登录/注册、账号设置、成员权限管理页 `workspace-admin.html`，并将核心后台页改为宽屏占满式布局；[P008](../proposals/P008-permission-aware-workbench/) 用户端数据广场 `data-market.html` 改为顶栏分区+右侧搜索、默认全宽列表、铺满剩余视口；[P010](../proposals/P010-user-memory-ask-knowledge/) 管理端知识库 `knowledge.html`；对话分析页展示当前工作区、可问数据集与知识命中。**编辑器壳（试改）**：仪表盘编辑态隐藏产品顶栏、壳层操作并入编辑条；侧栏与其它页一致（进入默认收起，展开占位推内容，非浮层）。

预览某快照：

```bash
python3 -m http.server 8767 --directory docs/prototypes/snapshots/<id>
# 缺 vendor 时，把 hi-fi/vendor 拷进该快照或从当前 hi-fi 起服务对照 HTML
```
