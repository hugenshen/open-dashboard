# 原型

高保交互参照，**不是**产品运行时。和提案、路线图一起作为团队知识沉淀。

| 目录 | 含义 | 和提案的关系 |
|------|------|----------------|
| [hi-fi/](./hi-fi/) | **当前增量**工作区（可改） | 提案 `prototype:`；`gates.hi-fi=wip` 时开发看这里 |
| [snapshots/](./snapshots/) | **历史冻结**（只读） | 提案 `prototype-snapshot:`；`gates.hi-fi=accepted` 时开发看这里 |
| [VERSIONS.md](./VERSIONS.md) | 版本账本：提案、kind、相对上一版改动 | 用 Pxxx + kind 识别该对照哪一版 |

规则：[../process.md](../process.md) · 清单：[hi-fi/MANIFEST.md](./hi-fi/MANIFEST.md)

开发某提案时：打开该提案 README 的「开发入口」，不要自己在 hi-fi 和 snapshots 之间猜。

预览：

```bash
./.teamai/docs/prototypes/hi-fi/start.sh
# → http://127.0.0.1:8765/workbench.html
```
