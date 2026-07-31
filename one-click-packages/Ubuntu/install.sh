#!/usr/bin/env bash
#===============================================================================
#  線上簽核系統 — Ubuntu 一鍵安裝
#  適用：Ubuntu 22.04 / 24.04 LTS（x86_64）
#
#  用法：
#    chmod +x install.sh
#    ./install.sh              # 互動選單
#    ./install.sh --docker     # 直接 Docker 安裝
#    ./install.sh --native     # 直接原生 Node 安裝
#    sudo ./install.sh --docker
#===============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[*]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[ERR]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-3847}"
MODE=""
NONINTERACTIVE=0
INSTALL_USER="${SUDO_USER:-${USER:-ubuntu}}"

usage() {
  cat <<EOF
線上簽核系統 Ubuntu 一鍵安裝

用法:
  ./install.sh [選項]

選項:
  --docker          使用 Docker Compose 安裝（建議）
  --native          使用 Node.js + systemd 安裝
  --port N          服務埠號（預設 3847）
  --yes, -y         非互動（搭配 --docker 或 --native）
  -h, --help        顯示說明

範例:
  ./install.sh
  ./install.sh --docker
  sudo ./install.sh --native --port 3847
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE=docker; shift ;;
    --native) MODE=native; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --yes|-y) NONINTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "未知參數: $1"; usage; exit 1 ;;
  esac
done

need_root_for_native() {
  if [[ "$(id -u)" -ne 0 ]]; then
    err "原生安裝需要 root，請執行："
    echo "  sudo ./install.sh --native"
    exit 1
  fi
}

check_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    info "作業系統: ${PRETTY_NAME:-$ID}"
    if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *"ubuntu"* && "${ID_LIKE:-}" != *"debian"* ]]; then
      warn "未偵測到 Ubuntu，仍繼續嘗試安裝…"
    fi
  fi
  ARCH="$(uname -m)"
  info "架構: $ARCH"
  if [[ "$ARCH" != "x86_64" && "$ARCH" != "amd64" && "$ARCH" != "aarch64" ]]; then
    warn "未經驗證的架構: $ARCH"
  fi
}

ensure_dirs() {
  mkdir -p data/uploads data/backups data/mail-outbox fonts
  if [[ ! -f fonts/kaiu.ttf && ! -f fonts/NotoSansCJKtc-Regular.otf ]]; then
    warn "fonts/ 尚無中文字型，PDF 中文可能異常。請放入 kaiu.ttf 後重建／重啟。"
  fi
}

gen_jwt() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

write_env_file() {
  local dest="$1"
  local secret
  secret="$(gen_jwt)"
  cat >"$dest" <<EOF
# 線上簽核系統環境變數 — 請妥善保管
PORT=${PORT}
NODE_ENV=production
JWT_SECRET=${secret}
TZ=Asia/Taipei
EOF
  chmod 600 "$dest" 2>/dev/null || true
  ok "已產生環境檔: $dest"
}

#---------------- Docker ----------------
install_docker_engine() {
  if command -v docker >/dev/null 2>&1; then
    ok "已安裝 Docker: $(docker --version)"
    return 0
  fi
  info "安裝 Docker Engine…"
  if [[ "$(id -u)" -ne 0 ]]; then
    err "安裝 Docker 需要 sudo。請執行: sudo ./install.sh --docker"
    exit 1
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  if [[ -n "${INSTALL_USER}" && "${INSTALL_USER}" != "root" ]]; then
    usermod -aG docker "$INSTALL_USER" || true
    warn "已將 $INSTALL_USER 加入 docker 群組，請重新登入後再執行 docker 指令。"
  fi
  ok "Docker 安裝完成"
}

install_docker_mode() {
  echo ""
  echo "======== Docker 模式安裝 ========"
  check_os
  ensure_dirs

  if [[ "$(id -u)" -eq 0 ]]; then
    install_docker_engine
  elif ! command -v docker >/dev/null 2>&1; then
    err "未偵測到 Docker，請用 root 安裝："
    echo "  sudo ./install.sh --docker"
    exit 1
  fi

  # compose 檔
  if [[ ! -f docker-compose.yml ]]; then
    err "找不到 docker-compose.yml"
    exit 1
  fi

  # 寫入 .env 給 compose
  if [[ ! -f .env ]]; then
    write_env_file .env
  else
    ok "保留既有 .env"
  fi
  # 同步 PORT 到 compose 可用
  if ! grep -q '^JWT_SECRET=' .env 2>/dev/null; then
    write_env_file .env
  fi

  # docker-compose 讀取 JWT
  # 更新 compose 使用 env 檔（若不支援則已有預設）
  info "建置並啟動容器（首次可能需數分鐘）…"
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
  else
    err "找不到 docker compose"
    exit 1
  fi

  # 若有 .env 中的 JWT，注入
  set -a
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
  set +a

  $COMPOSE build
  $COMPOSE up -d

  sleep 2
  $COMPOSE ps || true

  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo ""
  ok "Docker 安裝完成！"
  echo "----------------------------------------"
  echo "  網址:  http://${ip:-127.0.0.1}:${PORT}"
  echo "  本機:  http://127.0.0.1:${PORT}"
  echo "  資料:  $SCRIPT_DIR/data/"
  echo "  日誌:  $COMPOSE logs -f"
  echo "  停止:  $COMPOSE down"
  echo "  重啟:  $COMPOSE restart"
  echo "----------------------------------------"
  echo "  預設管理員（全新庫）: admin / admin123"
  echo "  若已放入 data/approval.db，請用既有帳號登入。"
  echo "  請儘快修改密碼，並確認 .env 的 JWT_SECRET。"
  echo "----------------------------------------"
}

#---------------- Native ----------------
install_native_mode() {
  echo ""
  echo "======== 原生 Node + systemd 安裝 ========"
  need_root_for_native
  check_os
  ensure_dirs

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg build-essential fontconfig openssl

  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE 'v(2[2-9]|[3-9][0-9])'; then
    info "安裝 Node.js 22…"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  ok "Node $(node -v) / npm $(npm -v)"

  info "npm install --omit=dev …"
  if [[ -n "$INSTALL_USER" && "$INSTALL_USER" != "root" ]]; then
    chown -R "$INSTALL_USER:$INSTALL_USER" "$SCRIPT_DIR"
    sudo -u "$INSTALL_USER" npm install --omit=dev --no-audit --no-fund
  else
    npm install --omit=dev --no-audit --no-fund
  fi

  write_env_file /etc/default/approval-system
  # 同步 PORT
  sed -i "s/^PORT=.*/PORT=${PORT}/" /etc/default/approval-system

  local node_bin
  node_bin="$(command -v node)"
  cat >/etc/systemd/system/approval-system.service <<EOF
[Unit]
Description=線上簽核系統 Approval System
After=network.target

[Service]
Type=simple
User=${INSTALL_USER}
Group=${INSTALL_USER}
WorkingDirectory=${SCRIPT_DIR}
EnvironmentFile=-/etc/default/approval-system
ExecStart=${node_bin} ${SCRIPT_DIR}/server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  chown -R "$INSTALL_USER:$INSTALL_USER" "$SCRIPT_DIR/data" 2>/dev/null || true
  systemctl daemon-reload
  systemctl enable approval-system
  systemctl restart approval-system
  sleep 1
  systemctl --no-pager --full status approval-system || true

  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo ""
  ok "原生安裝完成！"
  echo "----------------------------------------"
  echo "  網址:  http://${ip:-127.0.0.1}:${PORT}"
  echo "  狀態:  systemctl status approval-system"
  echo "  日誌:  journalctl -u approval-system -f"
  echo "  重啟:  systemctl restart approval-system"
  echo "  停止:  systemctl stop approval-system"
  echo "  資料:  $SCRIPT_DIR/data/"
  echo "----------------------------------------"
  echo "  預設管理員（全新庫）: admin / admin123"
  echo "----------------------------------------"

  if command -v ufw >/dev/null 2>&1; then
    if ufw status 2>/dev/null | grep -q 'Status: active'; then
      info "偵測到 ufw，開放埠 ${PORT}…"
      ufw allow "${PORT}/tcp" || true
    fi
  fi
}

#---------------- Menu ----------------
banner() {
  cat <<'EOF'

  ╔══════════════════════════════════════════╗
  ║     線上簽核系統 — Ubuntu 一鍵安裝       ║
  ║     Approval System Installer            ║
  ╚══════════════════════════════════════════╝

EOF
}

main() {
  banner
  info "安裝目錄: $SCRIPT_DIR"

  if [[ -z "$MODE" ]]; then
    if [[ "$NONINTERACTIVE" -eq 1 ]]; then
      err "非互動模式請指定 --docker 或 --native"
      exit 1
    fi
    echo "請選擇安裝方式："
    echo "  1) Docker Compose（建議，環境隔離、與 NAS 相同）"
    echo "  2) 原生 Node.js + systemd（不使用 Docker）"
    echo "  3) 取消"
    echo ""
    read -r -p "輸入選項 [1-3]: " choice
    case "$choice" in
      1) MODE=docker ;;
      2) MODE=native ;;
      *) echo "已取消"; exit 0 ;;
    esac
  fi

  case "$MODE" in
    docker) install_docker_mode ;;
    native) install_native_mode ;;
    *) err "未知模式"; exit 1 ;;
  esac
}

main
