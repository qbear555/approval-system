#!/usr/bin/env bash
# 解除安裝線上簽核系統（保留 data/ 資料，除非加 --purge-data）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PURGE=0
[[ "${1:-}" == "--purge-data" ]] && PURGE=1

echo "======== 解除安裝線上簽核系統 ========"

# Docker
if command -v docker >/dev/null 2>&1; then
  if [[ -f docker-compose.yml ]]; then
    if docker compose version >/dev/null 2>&1; then
      docker compose down 2>/dev/null || true
    elif command -v docker-compose >/dev/null 2>&1; then
      docker-compose down 2>/dev/null || true
    fi
    docker rm -f approval-system 2>/dev/null || true
    echo "[OK] 已停止 Docker 容器"
  fi
fi

# systemd
if [[ "$(id -u)" -eq 0 ]] && systemctl list-unit-files | grep -q approval-system.service; then
  systemctl stop approval-system 2>/dev/null || true
  systemctl disable approval-system 2>/dev/null || true
  rm -f /etc/systemd/system/approval-system.service
  systemctl daemon-reload
  echo "[OK] 已移除 systemd 服務"
  if [[ "$PURGE" -eq 1 ]]; then
    rm -f /etc/default/approval-system
    echo "[OK] 已刪除 /etc/default/approval-system"
  fi
elif systemctl is-active --quiet approval-system 2>/dev/null; then
  echo "[!] 請使用 sudo 移除 systemd 服務"
fi

if [[ "$PURGE" -eq 1 ]]; then
  read -r -p "確定刪除 data/ 全部資料？不可復原！(yes/NO): " ans
  if [[ "$ans" == "yes" ]]; then
    rm -rf data
    echo "[OK] 已刪除 data/"
  else
    echo "已保留 data/"
  fi
else
  echo "[*] 資料目錄 data/ 已保留。若要一併刪除請執行："
  echo "    ./uninstall.sh --purge-data"
fi

echo "完成。"
