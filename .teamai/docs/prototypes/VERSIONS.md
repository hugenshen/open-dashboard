# 高保原型版本账本

`.teamai/docs/` 里的原型分两层，开发必须分清：

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
| `2026-08-21-p006-ask-data` | 2026-08-21 | [P006](../proposals/P006-ask-data/) | **acceptance** | 冻结迁 dsh 前的自研问数壳（`conversation-workspace` 结果卡 / 步骤折叠 / 工作台 autorun）；**P006 旧交互实现对照此版**；其后问数表面改走 [P011](../proposals/P011-dsh-conversation-surface/) | [snapshots/…](./snapshots/2026-08-21-p006-ask-data/) |
| `2026-08-23-pre-p013` | 2026-08-23 | [P013](../proposals/P013-dashboard-page-templates/) | increment | 相对 P006/P007 快照之后的 hi-fi：冻结 P008/P009/P010 目录治理与壳增量，作为 P013 模板市场开工前档 | [snapshots/…](./snapshots/2026-08-23-pre-p013/) |

当前 hi-fi 增量（未打 acceptance 快照）：[P013](../proposals/P013-dashboard-page-templates/) 模板市场（`dashboard.html?v=p013t15#/templates`）；[P014](../proposals/P014-conversation-history/) 对话「新对话 / 历史」抽屉；[P016](../proposals/P016-conversation-analysis-report/) 对话分析报告 chip + 右侧可展开节点轨迹（工具/输入/输出/耗时）+ 完成后原位 HTML/MD 快照栏且可回看过程（叠在已 accepted 的 `conversation-ask-dsh.html` 上，尚未冻结）。P008 / P009 / P010 仍叠在同一 hi-fi。
[P011](../proposals/P011-dsh-conversation-surface/) 问数表面基线仍是该页的落地/澄清/运行中/已回答/生成看板；产品壳 `conversation.html` 嵌此页。旧 `conversation-workspace.html` 仅作生成/对照。

预览某快照：

```bash
python3 -m http.server 8767 --directory .teamai/docs/prototypes/snapshots/<id>
# 缺 vendor 时，把 hi-fi/vendor 拷进该快照或从当前 hi-fi 起服务对照 HTML
```
