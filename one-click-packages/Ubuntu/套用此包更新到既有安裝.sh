#!/usr/bin/env bash
# 將「目前這個新版安裝包目錄」的程式套用到既有安裝路徑（保留 data）
# 用法：
#   chmod +x 套用此包更新到既有安裝.sh
#   ./套用此包更新到既有安裝.sh /opt/approval-system
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/ApprovalSystem-Ubuntu-Install" && pwd)"
DST="${1:-}"
if [[ -z "$DST" ]]; then
  echo "用法: $0 <既有安裝目錄>"
  echo "例:   $0 /opt/approval-system"
  exit 1
fi
if [[ ! -d "$DST/data" ]]; then
  echo "[ERR] 目標沒有 data/：$DST"
  exit 1
fi
if [[ ! -f "$SRC/package.json" ]]; then
  echo "[ERR] 找不到新版包：$SRC"
  exit 1
fi

echo "來源: $SRC"
echo "目標: $DST"
echo "將複製 server public fonts docs Dockerfile docker-compose 等，不碰 data/"
read -r -p "確定？[y/N] " a
[[ "$a" == "y" || "$a" == "Y" ]] || exit 0

TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DST/data/_update_backup"
[[ -f "$DST/data/approval.db" ]] && cp -a "$DST/data/approval.db" "$DST/data/_update_backup/approval.db.$TS"
[[ -f "$DST/data/mail-config.json" ]] && cp -a "$DST/data/mail-config.json" "$DST/data/_update_backup/mail-config.json.$TS"

for d in server public fonts docs seed-workflows; do
  if [[ -d "$SRC/$d" ]]; then
    rm -rf "$DST/$d"
    cp -a "$SRC/$d" "$DST/$d"
    echo "  ok $d/"
  fi
done
for f in package.json package-lock.json Dockerfile docker-compose.yml docker-entrypoint.sh \
         start-server.js update.sh .dockerignore; do
  if [[ -f "$SRC/$f" ]]; then
    cp -a "$SRC/$f" "$DST/$f"
    echo "  ok $f"
  fi
done

chmod +x "$DST/update.sh" 2>/dev/null || true
chmod +x "$DST/docker-entrypoint.sh" 2>/dev/null || true

echo "[*] 在目標目錄執行 update.sh ..."
(cd "$DST" && ./update.sh)
echo "[OK] 完成"
