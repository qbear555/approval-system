#!/usr/bin/env bash
# 線上簽核系統 — Ubuntu 原生安裝（Node 22 + systemd）
# 用法（專案根目錄）：
#   chmod +x scripts/ubuntu-install.sh
#   sudo ./scripts/ubuntu-install.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "請使用 sudo 執行：sudo ./scripts/ubuntu-install.sh"
  exit 1
fi

APP_USER="${SUDO_USER:-ubuntu}"
# 專案根目錄（scripts/ 的上一層）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="approval-system"
PORT="${PORT:-3847}"

echo "========================================"
echo "  安裝線上簽核系統 (Ubuntu)"
echo "  路徑: $APP_DIR"
echo "  使用者: $APP_USER"
echo "========================================"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg build-essential fontconfig

# Node.js 22
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE 'v(2[2-9]|[3-9][0-9])'; then
  echo "[*] 安裝 Node.js 22 ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "[*] Node $(node -v) / npm $(npm -v)"

cd "$APP_DIR"
echo "[*] npm install --omit=dev ..."
sudo -u "$APP_USER" npm install --omit=dev --no-audit --no-fund

mkdir -p "$APP_DIR/data/uploads" "$APP_DIR/data/backups" "$APP_DIR/data/mail-outbox"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/data"
# fonts 目錄若無則建立
mkdir -p "$APP_DIR/fonts"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/fonts" 2>/dev/null || true

# JWT
JWT_FILE="/etc/default/${SERVICE_NAME}"
if [[ ! -f "$JWT_FILE" ]]; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
  cat >"$JWT_FILE" <<EOF
PORT=${PORT}
NODE_ENV=production
JWT_SECRET=${SECRET}
TZ=Asia/Taipei
EOF
  echo "[*] 已寫入 $JWT_FILE"
else
  echo "[*] 保留既有 $JWT_FILE"
fi

# systemd
UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
cat >"$UNIT" <<EOF
[Unit]
Description=線上簽核系統 Approval System
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=-/etc/default/${SERVICE_NAME}
ExecStart=$(command -v node) ${APP_DIR}/server/index.js
Restart=on-failure
RestartSec=5
# 限制
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
sleep 1
systemctl --no-pager --full status "${SERVICE_NAME}" || true

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "========================================"
echo "  安裝完成"
echo "  本機: http://127.0.0.1:${PORT}"
echo "  區網: http://${IP:-<IP>}:${PORT}"
echo "  日誌: journalctl -u ${SERVICE_NAME} -f"
echo "  若尚未搬入 data/，請複製舊主機的 data 後："
echo "    sudo systemctl restart ${SERVICE_NAME}"
echo "========================================"
