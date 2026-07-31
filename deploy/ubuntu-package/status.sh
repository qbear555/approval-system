#!/usr/bin/env bash
# 檢查服務狀態
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PORT="${PORT:-3847}"

echo "======== 線上簽核系統狀態 ========"
echo "目錄: $SCRIPT_DIR"
echo ""

if command -v docker >/dev/null 2>&1; then
  echo "--- Docker ---"
  docker ps -a --filter name=approval-system --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
  echo ""
fi

if systemctl list-unit-files 2>/dev/null | grep -q approval-system; then
  echo "--- systemd ---"
  systemctl --no-pager --full status approval-system 2>/dev/null || true
  echo ""
fi

echo "--- 埠 ${PORT} ---"
if command -v ss >/dev/null 2>&1; then
  ss -lntp 2>/dev/null | grep ":${PORT}" || echo "(未監聽)"
elif command -v netstat >/dev/null 2>&1; then
  netstat -lntp 2>/dev/null | grep ":${PORT}" || echo "(未監聽)"
fi

echo ""
echo "--- HTTP 探測 ---"
if command -v curl >/dev/null 2>&1; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "http://127.0.0.1:${PORT}/api/departments" || echo fail)"
  echo "GET /api/departments => $code"
else
  echo "(無 curl，略過)"
fi

echo ""
if [[ -f data/approval.db ]]; then
  echo "資料庫: data/approval.db ($(du -h data/approval.db | awk '{print $1}'))"
else
  echo "資料庫: (尚無 approval.db，首次啟動會自動建立)"
fi
