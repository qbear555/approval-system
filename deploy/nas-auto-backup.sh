#!/bin/bash
# ==============================================================================
# 線上簽核系統 — Synology NAS 企業級「每 30 天全自動備份」腳本
# 核心功能：
#   1. 自動 30 天間隔智慧節流（每日凌晨 03:00 巡檢，每滿 30 天自動觸發一次全量備份）
#   2. 支援 --force 手動強制立即備份（在 DSM 控制台點選「執行」或手動下指令時立即備份）
#   3. MySQL 資料庫匯出（含完整單據、簽核歷程、人員帳號、稽核日誌）
#   4. 系統檔案資料打包（單據附件 uploads、自訂印章模版 templates、簽章憑證 certs、簽核 PDF）
#   5. 系統程式碼與 Docker 環境配置打包（前後端程式、docker-compose、環境變數）
#   6. SHA-256 完整性校驗指紋產生（防竄改與確保檔案安全）
#   7. 自動歷史版本輪替機制（保留 180 天 / 6 個週期以上，避免歷史歸檔遺失）
#
# 排程任務：Synology DSM 任務排程器 ID=7 (Approval-System-Backup-30Days)
# ==============================================================================

set -euo pipefail

# 確保環境 PATH 包含群暉 MariaDB 10 與 Docker 指令路徑
export PATH="/volume1/@appstore/MariaDB10/usr/local/mariadb10.11/bin:/volume1/@appstore/ContainerManager/usr/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# 1. 基本路徑與變數設定
APP_DIR="/volume1/docker/approval-system"
BACKUP_ROOT="/volume1/docker/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATE_ONLY=$(date +"%Y%m%d")
BACKUP_DIR="${BACKUP_ROOT}/${DATE_ONLY}"

# 備份週期與保留設定
INTERVAL_DAYS=30
RETENTION_DAYS=180
LAST_STAMP_FILE="${APP_DIR}/data/.last_backup_timestamp"
FORCE_RUN=0

if [ "${1:-}" = "--force" ] || [ "${1:-}" = "-f" ]; then
  FORCE_RUN=1
fi

echo "===================================================================="
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 檢查簽核系統自動備份作業（週期：每 ${INTERVAL_DAYS} 天一次）..."
echo "===================================================================="

# ------------------------------------------------------------------------------
# 2. 檢查間隔天數（未滿 30 天則略過，避免頻繁備份佔用儲存與 I/O）
# ------------------------------------------------------------------------------
if [ -f "${LAST_STAMP_FILE}" ] && [ "${FORCE_RUN}" -eq 0 ]; then
  LAST_TIME=$(cat "${LAST_STAMP_FILE}" | tr -d ' \r\n')
  CURRENT_TIME=$(date +%s)
  
  if [ -n "${LAST_TIME}" ] && [ "${LAST_TIME}" -gt 0 ] 2>/dev/null; then
    DIFF_SECONDS=$(( CURRENT_TIME - LAST_TIME ))
    DIFF_DAYS=$(( DIFF_SECONDS / 86400 ))
    
    if [ "${DIFF_DAYS}" -lt "${INTERVAL_DAYS}" ]; then
      REMAINING_DAYS=$(( INTERVAL_DAYS - DIFF_DAYS ))
      LAST_DATE_STR=$(date -d "@${LAST_TIME}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "上次")
      echo "ℹ️ [排程巡檢] 上次備份時間：${LAST_DATE_STR}（已過 ${DIFF_DAYS} 天）。"
      echo "   設定間隔為每 ${INTERVAL_DAYS} 天備份一次，距離下次自動備份尚餘約 ${REMAINING_DAYS} 天。"
      echo "   本次排程巡檢自動略過。"
      echo "   (如需立即備份，可在 DSM 控制台選取任務點擊「執行」，或指令帶入 --force)"
      echo "===================================================================="
      exit 0
    fi
  fi
fi

if [ "${FORCE_RUN}" -eq 1 ]; then
  echo "⚡ 偵測到強制備份旗標 (--force)，立即開始執行全量備份！"
else
  echo "🚀 已達 30 天備份週期，開始執行全量自動備份！"
fi

# 資料庫連線配置（依 docker-compose.yml 預設）
MYSQL_HOST="127.0.0.1"
MYSQL_PORT="3306"
MYSQL_USER="approval"
MYSQL_PASS="Ww837*5630"
MYSQL_DB="approval"

# 確保備份存放根目錄與今日備份目錄存在
mkdir -p "${BACKUP_DIR}"

# ------------------------------------------------------------------------------
# 3. 備份 MySQL 資料庫（完整資料庫匯出，含表結構、資料、觸發程序與交易一致性）
# ------------------------------------------------------------------------------
DB_DUMP_FILE="${BACKUP_DIR}/mysql_${MYSQL_DB}_${TIMESTAMP}.sql.gz"
echo "[1/4] 正在匯出 MySQL 資料庫 [${MYSQL_DB}]..."

if command -v mysqldump >/dev/null 2>&1; then
  mysqldump -h "${MYSQL_HOST}" -P "${MYSQL_PORT}" -u "${MYSQL_USER}" -p"${MYSQL_PASS}" \
    --single-transaction --routines --triggers --databases "${MYSQL_DB}" | gzip -9 > "${DB_DUMP_FILE}"
elif [ -x "/volume1/@appstore/MariaDB10/usr/local/mariadb10.11/bin/mysqldump" ]; then
  /volume1/@appstore/MariaDB10/usr/local/mariadb10.11/bin/mysqldump -h "${MYSQL_HOST}" -P "${MYSQL_PORT}" -u "${MYSQL_USER}" -p"${MYSQL_PASS}" \
    --single-transaction --routines --triggers --databases "${MYSQL_DB}" | gzip -9 > "${DB_DUMP_FILE}"
else
  docker run --rm --network host mariadb:10.11 mysqldump -h "${MYSQL_HOST}" -P "${MYSQL_PORT}" -u "${MYSQL_USER}" -p"${MYSQL_PASS}" \
    --single-transaction --routines --triggers --databases "${MYSQL_DB}" | gzip -9 > "${DB_DUMP_FILE}"
fi

DB_SIZE=$(du -sh "${DB_DUMP_FILE}" | cut -f1)
echo "  ✓ [成功] 資料庫備份檔：$(basename "${DB_DUMP_FILE}") (${DB_SIZE})"

# ------------------------------------------------------------------------------
# 4. 備份系統檔案資料（附件 uploads、自訂模版 templates、憑證 certs、簽核 PDF backups）
# ------------------------------------------------------------------------------
DATA_TAR_FILE="${BACKUP_DIR}/system_data_${TIMESTAMP}.tar.gz"
echo "[2/4] 正在打包系統檔案資料（單據附件、印章模版、憑證金鑰、簽核 PDF 存檔）..."

tar -czf "${DATA_TAR_FILE}" -C "${APP_DIR}" data

DATA_SIZE=$(du -sh "${DATA_TAR_FILE}" | cut -f1)
echo "  ✓ [成功] 檔案資料備份檔：$(basename "${DATA_TAR_FILE}") (${DATA_SIZE})"

# ------------------------------------------------------------------------------
# 5. 備份程式原始碼與容器配置（前後端代碼、Docker 設定、環境變數）
# ------------------------------------------------------------------------------
CODE_TAR_FILE="${BACKUP_DIR}/app_code_configs_${TIMESTAMP}.tar.gz"
echo "[3/4] 正在打包系統程式碼、前端產物與 Docker 配置..."

tar -czf "${CODE_TAR_FILE}" -C "${APP_DIR}" \
  --exclude="node_modules" \
  --exclude="data" \
  --exclude="*.log" \
  --exclude="temp_deploy_*.tar.gz" \
  .

CODE_SIZE=$(du -sh "${CODE_TAR_FILE}" | cut -f1)
echo "  ✓ [成功] 程式環境備份檔：$(basename "${CODE_TAR_FILE}") (${CODE_SIZE})"

# ------------------------------------------------------------------------------
# 6. 產生 SHA256 驗證清單（防竄改與確保檔案完整性）
# ------------------------------------------------------------------------------
CHECKSUM_FILE="${BACKUP_DIR}/SHA256SUMS_${TIMESTAMP}.txt"
(
  cd "${BACKUP_DIR}"
  sha256sum "$(basename "${DB_DUMP_FILE}")" "$(basename "${DATA_TAR_FILE}")" "$(basename "${CODE_TAR_FILE}")" > "${CHECKSUM_FILE}"
)
echo "  ✓ [成功] 產生 SHA256 完整性校驗清單"

# ------------------------------------------------------------------------------
# 7. 自動輪替機制：清理超過 retention 天數的歷史備份（保留最近 180 天）
# ------------------------------------------------------------------------------
echo "[4/4] 執行歷史備份輪替檢查（保留最近 ${RETENTION_DAYS} 天備份）..."
DELETED_COUNT=$(find "${BACKUP_ROOT}" -maxdepth 1 -mindepth 1 -type d -mtime "+${RETENTION_DAYS}" 2>/dev/null | wc -l)
find "${BACKUP_ROOT}" -maxdepth 1 -mindepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} + 2>/dev/null || true
find "${BACKUP_ROOT}" -maxdepth 1 -type f -name "approval_backup_*.tar.gz" -mtime "+${RETENTION_DAYS}" -exec rm -f {} + 2>/dev/null || true
echo "  ✓ [成功] 已清理過期歷史資料夾：${DELETED_COUNT} 個"

# ------------------------------------------------------------------------------
# 8. 更新備份時間戳記
# ------------------------------------------------------------------------------
date +%s > "${LAST_STAMP_FILE}"
chmod 666 "${LAST_STAMP_FILE}" 2>/dev/null || true

FREE_SPACE=$(df -h /volume1 | awk 'NR==2 {print $4}')
echo "===================================================================="
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🎉 簽核系統全量備份順利完成！"
echo "備份存檔目錄：${BACKUP_DIR}"
echo "下一次自動備份：約 30 天後 ($(date -d "+30 days" '+%Y-%m-%d' 2>/dev/null || echo "30天後"))"
echo "儲存空間餘額：/volume1 剩餘 ${FREE_SPACE}"
echo "===================================================================="
