#!/usr/bin/env bash
# Ubuntu Docker 一鍵建置啟動
# 用法：在專案根目錄
#   chmod +x scripts/ubuntu-docker-up.sh
#   ./scripts/ubuntu-docker-up.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "未安裝 Docker。請先："
  echo "  curl -fsSL https://get.docker.com | sudo sh"
  exit 1
fi

mkdir -p data/uploads data/backups data/mail-outbox
if [[ ! -f fonts/kaiu.ttf ]] && [[ ! -f fonts/NotoSansCJKtc-Regular.otf ]]; then
  echo "警告：fonts/ 下沒有中文字型，PDF 可能亂碼。請放入 kaiu.ttf 或 Noto 繁中 OTF。"
fi

echo "[*] docker compose up -d --build"
docker compose up -d --build
docker compose ps
echo ""
echo "完成。瀏覽 http://$(hostname -I | awk '{print $1}'):3847"
echo "記得修改 docker-compose.yml 的 JWT_SECRET"
