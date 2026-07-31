#!/usr/bin/env bash
# 備份 data 目錄
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-./approval-data-backup-${STAMP}.tar.gz}"

if [[ ! -d data ]]; then
  echo "找不到 data/ 目錄"
  exit 1
fi

# 若 Docker 在跑，建議先 stop（可選）
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx approval-system; then
  echo "[!] 容器運行中，建議先: docker compose stop"
  echo "    仍繼續打包…"
fi

tar -czf "$OUT" data
echo "[OK] 已備份: $OUT ($(du -h "$OUT" | awk '{print $1}'))"
