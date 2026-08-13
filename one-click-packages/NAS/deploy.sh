#!/bin/bash
set -e
cd "$(dirname "$0")"
echo 線上簽核系統 NAS 部署
if command -v docker >/dev/null 2>&1; then
  docker compose up -d --build
  echo 開啟 http://NAS的IP:3847 或 https://NAS的IP:3848
  echo 全新庫帳號 Admin，密碼見 data/.admin-bootstrap.txt
else
  echo 請用 Container Manager 匯入 docker-compose.yml
  exit 1
fi
