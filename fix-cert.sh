#!/bin/sh
# 將 DSM 的 Let's Encrypt 憑證同步到簽核系統 :3848
# 用法（在 NAS 上以 root 執行）：sudo sh /volume1/docker/approval-system/fix-cert.sh
set -e

ARCH=/usr/syno/etc/certificate/_archive
DST=/volume1/docker/approval-system/data/certs
DOCKER=/usr/local/bin/docker
DOMAIN=catshome.tw

echo "=== 1. 掃描 DSM 憑證庫，找出 $DOMAIN 效期最新的憑證 ==="
BEST=""
BEST_END=0
BEST_CERT=""
BEST_KEY=""
for d in "$ARCH"/*/; do
  [ -d "$d" ] || continue
  if [ -f "$d/ECC-fullchain.pem" ] && [ -f "$d/ECC-privkey.pem" ]; then
    c="$d/ECC-fullchain.pem"; k="$d/ECC-privkey.pem"
  elif [ -f "$d/fullchain.pem" ] && [ -f "$d/privkey.pem" ]; then
    c="$d/fullchain.pem"; k="$d/privkey.pem"
  else
    continue
  fi
  # 必須包含目標網域（CN 或 SAN）
  if ! openssl x509 -in "$c" -noout -text 2>/dev/null | grep -q "$DOMAIN"; then
    continue
  fi
  end_str=$(openssl x509 -in "$c" -noout -enddate 2>/dev/null | cut -d= -f2)
  end=$(date -d "$end_str" +%s 2>/dev/null || echo 0)
  serial=$(openssl x509 -in "$c" -noout -serial 2>/dev/null | cut -d= -f2)
  echo "  $(basename "$d")  到期 $end_str  serial ${serial}"
  if [ "$end" -gt "$BEST_END" ]; then
    BEST_END=$end; BEST="$d"; BEST_CERT="$c"; BEST_KEY="$k"
  fi
done

if [ -z "$BEST" ]; then
  echo "❌ 找不到含 $DOMAIN 的憑證，請確認 DSM 憑證設定"
  exit 1
fi
echo "→ 選用：$(basename "$BEST")"
echo

echo "=== 2. 比對目前簽核系統使用的憑證 ==="
if [ -f "$DST/cert.pem" ]; then
  cur=$(openssl x509 -in "$DST/cert.pem" -noout -serial 2>/dev/null | cut -d= -f2)
  new=$(openssl x509 -in "$BEST_CERT" -noout -serial 2>/dev/null | cut -d= -f2)
  echo "  目前 serial: $cur"
  echo "  即將換成  : $new"
  if [ "$cur" = "$new" ]; then
    echo "  ✅ 已經是最新，無需更新"
    exit 0
  fi
fi
echo

echo "=== 3. 備份舊憑證並安裝新憑證 ==="
mkdir -p "$DST"
ts=$(date +%Y%m%d-%H%M%S)
[ -f "$DST/cert.pem" ] && cp -a "$DST/cert.pem" "$DST/cert.pem.bak-$ts" && echo "  已備份 cert.pem.bak-$ts"
[ -f "$DST/key.pem" ] && cp -a "$DST/key.pem" "$DST/key.pem.bak-$ts" && echo "  已備份 key.pem.bak-$ts"
cp -f "$BEST_CERT" "$DST/cert.pem"
cp -f "$BEST_KEY" "$DST/key.pem"
chmod 644 "$DST/cert.pem"
chmod 600 "$DST/key.pem"
chown 1000:1000 "$DST/cert.pem" "$DST/key.pem" 2>/dev/null || true
echo "  已安裝新憑證"
openssl x509 -in "$DST/cert.pem" -noout -subject -issuer -dates -serial
echo

echo "=== 4. 重啟容器 ==="
"$DOCKER" restart approval-system
sleep 5
"$DOCKER" ps --filter name=approval-system --format "{{.Names}}  {{.Status}}"
echo

echo "=== 5. 驗證 :3848 實際提供的憑證 ==="
echo | openssl s_client -connect 127.0.0.1:3848 -servername $DOMAIN 2>/dev/null \
  | openssl x509 -noout -dates -serial
echo
echo "✅ 完成"
