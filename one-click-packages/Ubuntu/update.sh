#!/usr/bin/env bash
#===============================================================================
#  線上簽核系統 — Ubuntu 一鍵更新（保留 data／不含覆寫 Email）
#
#  用法（在安裝目錄）：
#    chmod +x update.sh
#    ./update.sh              # 自動偵測 Docker 或 native
#    ./update.sh --docker
#    ./update.sh --native
#===============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}[*]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE=docker; shift ;;
    --native) MODE=native; shift ;;
    -h|--help)
      echo "用法: ./update.sh [--docker|--native]"
      exit 0
      ;;
    *) err "未知參數: $1"; exit 1 ;;
  esac
done

echo "========================================"
echo "  線上簽核系統 — Ubuntu 一鍵更新"
echo "========================================"

if [[ ! -d data ]]; then
  err "找不到 data/。請在已安裝目錄執行，或先完成首次安裝。"
  exit 1
fi

# 套件根目錄若誤帶 mail-config，刪掉（不動 data/ 內正式設定）
rm -f ./mail-config.json 2>/dev/null || true

TS="$(date +%Y%m%d-%H%M%S)"
BK="data/_update_backup"
mkdir -p "$BK"
[[ -f data/approval.db ]] && cp -a data/approval.db "$BK/approval.db.$TS" && ok "備份 DB"
[[ -f data/mail-config.json ]] && cp -a data/mail-config.json "$BK/mail-config.json.$TS" && ok "備份 Email 設定"

# 自動偵測
if [[ -z "$MODE" ]]; then
  if [[ -f docker-compose.yml ]] && command -v docker >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q '^approval-system$'; then
      MODE=docker
    elif docker compose ps 2>/dev/null | grep -q approval; then
      MODE=docker
    fi
  fi
  if [[ -z "$MODE" ]] && systemctl list-unit-files 2>/dev/null | grep -q approval-system; then
    MODE=native
  fi
  if [[ -z "$MODE" ]]; then
    if [[ -f docker-compose.yml ]]; then MODE=docker; else MODE=native; fi
  fi
fi
info "模式: $MODE"

if [[ "$MODE" == "docker" ]]; then
  info "Docker 重新建置啟動..."
  if docker compose version >/dev/null 2>&1; then
    docker compose up -d --build
  else
    docker-compose up -d --build
  fi
  sleep 4
  curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:${PORT:-3847}/health" || true
elif [[ "$MODE" == "native" ]]; then
  info "更新 npm 依賴並重啟服務..."
  if [[ "$(id -u)" -eq 0 ]]; then
    npm install --omit=dev --no-audit --no-fund
    systemctl restart approval-system 2>/dev/null || {
      warn_msg="systemctl 重啟失敗，請手動: node server/index.js"
      echo "$warn_msg"
    }
  else
    npm install --omit=dev --no-audit --no-fund
    if systemctl is-active --quiet approval-system 2>/dev/null; then
      sudo systemctl restart approval-system
    else
      info "請手動重啟程序"
    fi
  fi
else
  err "未知模式"
  exit 1
fi

ok "更新完成 — data/ 與 Email 設定已保留"
echo "  網址：http://伺服器IP:3847  或  https://伺服器IP:3848"
