#!/bin/bash
set -e
cd "$(dirname "$0")"
echo 線上簽核系統 NAS 部署
if command -v docker >/dev/null 2>&1; then
  docker compose up -d --build
  echo 開啟 http://NAS的IP:3847  admin/admin123
else
  echo 請用 Container Manager 匯入 docker-compose.yml
  exit 1
fi
