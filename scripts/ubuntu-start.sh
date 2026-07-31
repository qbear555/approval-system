#!/usr/bin/env bash
# 前景啟動（測試用，非 systemd）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"
export PORT="${PORT:-3847}"
export NODE_ENV="${NODE_ENV:-production}"
export TZ="${TZ:-Asia/Taipei}"
mkdir -p data/uploads data/backups data/mail-outbox
if [[ ! -d node_modules ]]; then
  npm install --omit=dev --no-audit --no-fund
fi
echo "Starting approval-system at http://0.0.0.0:${PORT}"
exec node server/index.js
