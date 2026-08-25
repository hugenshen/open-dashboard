# 冻结快照

本目录只读。当前增量工作区是 [`../hi-fi/`](../hi-fi/)。账本见 [`../VERSIONS.md`](../VERSIONS.md)。

每个快照目录里的 `SNAPSHOT.md` 必须写清：提案号、`increment` 还是 `acceptance`、相对上一版改了什么。

打快照：

```bash
cd .teamai/docs/prototypes
./snapshot.sh YYYY-MM-DD-p007-slug "说明" P007 increment
# 高保定稿（实现对照此版）：
./snapshot.sh YYYY-MM-DD-p007-slug-final "P007 高保定稿" P007 acceptance
```

不要改这里的 HTML/CSS/JS。要继续演进，改 `hi-fi/`，需要时再打新快照。
