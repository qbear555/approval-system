#!/bin/bash
#===============================================================================
#  線上簽核系統 — NAS 一鍵更新（保留 data／不含覆寫 Email）
#
#  適用：已用 Docker 安裝過，現在把「新版安裝包」覆蓋到同一目錄後執行
#  用法（SSH 進 NAS 或 Container Manager 終端）：
#    cd /volume1/docker/approval-system   # 依實際路徑
#    chmod +x update.sh
#    sudo ./update.sh
#
#  會保留：data/approval.db、uploads、backups、mail-config.json、certs…
#  會更新：server/ public/ Dockerfile docker-compose 等程式檔（本目錄既有檔）
#===============================================================================
set -euo pipefail
cd "$(dirname "$0")"

DOCKER="${DOCKER:-/usr/local/bin/docker}"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

echo "========================================"
echo "  線上簽核系統 — NAS 一鍵更新"
echo "========================================"

if [[ ! -f docker-compose.yml && ! -f Dockerfile ]]; then
  echo "[ERR] 請在安裝目錄執行（需有 docker-compose.yml）"
  exit 1
fi

if [[ ! -d data ]]; then
  echo "[ERR] 找不到 data/，這不像已安裝環境。請用首次安裝流程。"
  exit 1
fi

# 絕不從本包套用 Email（若誤帶入則刪除包內的、不動 data 內正式檔）
# data/mail-config.json 一律保留不動
if [[ -f mail-config.json ]]; then
  echo "[!] 移除套件根目錄誤帶的 mail-config.json"
  rm -f mail-config.json
fi

TS="$(date +%Y%m%d-%H%M%S)"
BK="data/_update_backup"
mkdir -p "$BK"
if [[ -f data/approval.db ]]; then
  cp -a data/approval.db "$BK/approval.db.$TS"
  echo "[OK] 已備份資料庫 -> $BK/approval.db.$TS"
fi
if [[ -f data/mail-config.json ]]; then
  cp -a data/mail-config.json "$BK/mail-config.json.$TS"
  echo "[OK] 已備份 Email 設定 -> $BK/mail-config.json.$TS"
fi

if ! command -v docker >/dev/null 2>&1 && [[ ! -x "$DOCKER" ]]; then
  echo "[ERR] 找不到 docker。請在 Container Manager 終端或以 sudo 執行。"
  exit 1
fi
DOCKER_BIN="$(command -v docker || echo "$DOCKER")"

echo "[*] 重新建置並啟動容器（data 掛載保留）..."
if $DOCKER_BIN compose version >/dev/null 2>&1; then
  $DOCKER_BIN compose up -d --build
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose up -d --build
else
  $DOCKER_BIN compose up -d --build
fi

echo "[*] 等待服務..."
sleep 5
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3847/health 2>/dev/null || echo 000)"
CODE2="$(curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1:3848/health 2>/dev/null || echo 000)"
echo "  HTTP  3847 -> $CODE"
echo "  HTTPS 3848 -> $CODE2"

if [[ -f package.json ]]; then
  VER="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' package.json | head -1)"
  echo "  package.json $VER"
fi

echo "========================================"
echo "  更新完成"
echo "  資料與 Email 設定已保留在 data/"
echo "  網址：http://NAS的IP:3847  或  https://NAS的IP:3848"
echo "========================================"
