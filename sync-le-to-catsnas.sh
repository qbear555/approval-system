#!/bin/sh
# Push latest DSM Let's Encrypt cert to CATSNAS (192.168.99.250)
# Called from fix-cert.sh after the approval-system cert is refreshed.
set -e
export PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ARCH=/usr/syno/etc/certificate/_archive
DOMAIN=catshome.tw
KEY=/var/services/homes/tsuming/.ssh/id_ed25519_catsnas
DEST=tsuming@192.168.99.250
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
  openssl x509 -in "$c" -noout -text 2>/dev/null | grep -q "$DOMAIN" || continue
  end_str=$(openssl x509 -in "$c" -noout -enddate 2>/dev/null | cut -d= -f2)
  end=$(date -d "$end_str" +%s 2>/dev/null || echo 0)
  if [ "$end" -gt "$BEST_END" ]; then BEST_END=$end; BEST_CERT="$c"; BEST_KEY="$k"; fi
done
[ -n "$BEST_CERT" ] || { echo "no DSM LE cert for $DOMAIN"; exit 1; }
WORKDIR=/tmp/le-to-catsnas
mkdir -p "$WORKDIR"
cp -f "$BEST_CERT" "$WORKDIR/fullchain.pem"
cp -f "$BEST_KEY" "$WORKDIR/privkey.pem"
awk 'BEGIN{n=0} /BEGIN CERT/{n++} n>1{print}' "$WORKDIR/fullchain.pem" > "$WORKDIR/chain.pem"
chown tsuming:users "$WORKDIR" "$WORKDIR"/* 2>/dev/null || true
chmod 644 "$WORKDIR/fullchain.pem" "$WORKDIR/chain.pem"
chmod 600 "$WORKDIR/privkey.pem"
sudo -u tsuming scp -i "$KEY" -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
  "$WORKDIR/fullchain.pem" "$WORKDIR/privkey.pem" "$WORKDIR/chain.pem" "$DEST:/volume1/home/tsuming/le-inbox/"
sudo -u tsuming ssh -i "$KEY" -o BatchMode=yes "$DEST" \
  "sudo -n /usr/local/AppCentral/letsencrypt/apply-from-inbox.sh"
echo "CATSNAS synced $(openssl x509 -in "$BEST_CERT" -noout -enddate)"
