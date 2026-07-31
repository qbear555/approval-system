#!/bin/sh
# 啟動前確保 HTTPS 自簽憑證存在（寫入 data volume，重啟可沿用）
set -e

CERT_DIR="${SSL_CERT_DIR:-/app/data/certs}"
KEY_PATH="${SSL_KEY_PATH:-$CERT_DIR/key.pem}"
CERT_PATH="${SSL_CERT_PATH:-$CERT_DIR/cert.pem}"
HTTPS_PORT="${HTTPS_PORT:-3848}"
SSL_CN="${SSL_CN:-approval-system}"
# 逗號分隔的 SAN，例如：IP:192.168.99.220,DNS:nas.local,DNS:localhost,IP:127.0.0.1
SSL_SAN="${SSL_SAN:-DNS:localhost,DNS:approval-system,IP:127.0.0.1,IP:192.168.99.220}"

mkdir -p /app/data/uploads /app/data/backups /app/data/mail-outbox /app/data/certs /app/data/branding "$CERT_DIR"

if [ "${HTTPS_ENABLED:-1}" != "0" ] && [ -n "$HTTPS_PORT" ] && [ "$HTTPS_PORT" != "0" ]; then
  if [ ! -f "$KEY_PATH" ] || [ ! -f "$CERT_PATH" ]; then
    echo "[entrypoint] 產生 HTTPS 自簽憑證 -> $CERT_PATH"
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
      -keyout "$KEY_PATH" \
      -out "$CERT_PATH" \
      -days 3650 \
      -subj "/CN=${SSL_CN}/O=Approval System/C=TW" \
      -addext "subjectAltName=${SSL_SAN}"
    chmod 600 "$KEY_PATH" 2>/dev/null || true
    chmod 644 "$CERT_PATH" 2>/dev/null || true
    echo "[entrypoint] 自簽憑證已建立（瀏覽器會提示不受信任，區網可繼續使用）"
  else
    echo "[entrypoint] 使用既有憑證: $CERT_PATH"
  fi
  export SSL_KEY_PATH="$KEY_PATH"
  export SSL_CERT_PATH="$CERT_PATH"
  export HTTPS_PORT
fi

exec node server/index.js
