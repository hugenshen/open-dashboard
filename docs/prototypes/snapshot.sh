#!/usr/bin/env bash
# 冻结当前 hi-fi 到 snapshots/<id>/（不含 vendor）。
# 用法（在 docs/prototypes/ 下）：
#   ./snapshot.sh 2026-08-17-p007-app-shell "P007 左栏壳" P007 increment
#   ./snapshot.sh 2026-08-17-p007-final "P007 高保定稿" P007 acceptance
set -euo pipefail
cd "$(dirname "$0")"
ID="${1:-}"
NOTE="${2:-}"
PROPOSAL="${3:-}"
KIND="${4:-increment}"
if [[ -z "$ID" || -z "$NOTE" || -z "$PROPOSAL" ]]; then
  echo "usage: $0 <id> \"<说明>\" <Pxxx> <increment|acceptance>" >&2
  echo "  id 例: 2026-08-17-p007-app-shell" >&2
  exit 1
fi
if [[ ! "$ID" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$ ]]; then
  echo "id must look like YYYY-MM-DD-slug" >&2
  exit 1
fi
if [[ ! "$PROPOSAL" =~ ^P[0-9]{3}$ ]]; then
  echo "proposal must look like P007" >&2
  exit 1
fi
if [[ "$KIND" != "increment" && "$KIND" != "acceptance" ]]; then
  echo "kind must be increment or acceptance" >&2
  exit 1
fi
DEST="snapshots/$ID"
if [[ -e "$DEST" ]]; then
  echo "already exists: $DEST" >&2
  exit 1
fi
mkdir -p "$DEST"
# 不拷 echarts 等 vendor，快照只保留可 diff 的交互文件
rsync -a --exclude vendor --exclude '.DS_Store' hi-fi/ "$DEST/"
DATE="$(date +%Y-%m-%d)"
PROP_DIR="$(ls -d ../proposals/${PROPOSAL}-* 2>/dev/null | head -1 || true)"
PROP_LINK="${PROPOSAL}"
if [[ -n "$PROP_DIR" ]]; then
  PROP_LINK="[${PROPOSAL}](../../${PROP_DIR#../})"
fi
cat > "$DEST/SNAPSHOT.md" <<EOF
# 快照 \`$ID\`

- 日期：$DATE
- 提案：$PROP_LINK
- kind：\`$KIND\`
- 说明：$NOTE
- 相对上一版：请在 VERSIONS.md 与本文件补写相对上一快照的改动
- 来源：\`docs/prototypes/hi-fi/\`（不含 vendor）
- 只读：不要在本目录改交互；继续改请回 \`hi-fi/\`

预览：把 \`../../hi-fi/vendor\` 拷到本目录 \`vendor/\` 后起静态服务，或直接对照 HTML。
EOF
echo "wrote $DEST"
if grep -q "| \`$ID\` |" VERSIONS.md 2>/dev/null; then
  echo "VERSIONS.md already has $ID"
else
  {
    echo "| \`$ID\` | $DATE | [$PROPOSAL](../proposals/) | $KIND | $NOTE | [snapshots/$ID/](./snapshots/$ID/) |"
  } >> VERSIONS.md
  echo "appended $ID to VERSIONS.md（提案链接与「相对上一版」请手补）"
fi
if [[ "$KIND" == "acceptance" && -n "$PROP_DIR" ]]; then
  echo "提示：把 ${PROP_DIR}/README.md 的 prototype-snapshot 指到 docs/prototypes/snapshots/$ID/"
fi
