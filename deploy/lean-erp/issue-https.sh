#!/usr/bin/env bash
set -euo pipefail
umask 077
host=${1:?hostname required}
[[ $host =~ ^[a-z0-9.-]+$ ]] || exit 1
base=$(cd "$(dirname "$0")/.." && pwd)
bash /opt/lean-erp/ops/check-memory.sh 640
test ! -e /etc/nginx/conf.d/lean-erp-https.conf
acme=(/bin/sh /opt/lean-erp/acme/acme.sh --home /opt/lean-erp/acme --config-home /var/lib/lean-erp-acme-account --cert-home /var/lib/lean-erp-acme-account/certs --server letsencrypt)
"${acme[@]}" --issue -d "$host" -w /var/lib/lean-erp-acme --keylength ec-256
"${acme[@]}" --install-cert -d "$host" --ecc --key-file /etc/lean-erp/tls/key.pem --fullchain-file /etc/lean-erp/tls/fullchain.pem --reloadcmd 'nginx -t && systemctl reload nginx'
sed "s/ERP_HOST/$host/g" "$base/ops/nginx-https.conf" > /etc/nginx/conf.d/lean-erp-https.conf
if ! nginx -t; then
  mv /etc/nginx/conf.d/lean-erp-https.conf /etc/nginx/conf.d/lean-erp-https.conf.disabled
  exit 1
fi
systemctl reload nginx
install -m 644 "$base/ops/lean-erp-cert-renew.service" /etc/systemd/system/lean-erp-cert-renew.service
install -m 644 "$base/ops/lean-erp-cert-renew.timer" /etc/systemd/system/lean-erp-cert-renew.timer
systemd-analyze verify /etc/systemd/system/lean-erp-cert-renew.service /etc/systemd/system/lean-erp-cert-renew.timer
systemctl daemon-reload
systemctl enable --now lean-erp-cert-renew.timer
for attempt in {1..10}; do
  if curl -fsS --resolve "$host:443:127.0.0.1" "https://$host/" -o /dev/null; then break; fi
  sleep 1
done
curl -fsS --resolve "$host:443:127.0.0.1" "https://$host/" -o /dev/null
openssl x509 -in /etc/lean-erp/tls/fullchain.pem -noout -subject -issuer -dates
free -m
