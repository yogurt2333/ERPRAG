#!/usr/bin/env bash
# Run from an extracted certificate-setup bundle containing ops/ and acme.sh.
set -euo pipefail
host=${1:?hostname required}
[[ $host =~ ^[a-z0-9.-]+$ ]] || exit 1
base=$(cd "$(dirname "$0")/.." && pwd)
bash "$base/ops/check-memory.sh" 640
test ! -e /etc/nginx/conf.d/lean-erp-http.conf
printf 'c7d68b021cfd6380ea83a82962abde5b484779fee0b97d38681dfa1396bbc8d7  %s/acme.sh\n' "$base" | sha256sum -c -
install -d -m 755 /opt/lean-erp/acme /opt/lean-erp/ops /var/lib/lean-erp-acme/.well-known/acme-challenge
install -d -m 700 /var/lib/lean-erp-acme-account /etc/lean-erp/tls
install -m 755 "$base/acme.sh" /opt/lean-erp/acme/acme.sh
install -m 755 "$base/ops/check-memory.sh" /opt/lean-erp/ops/check-memory.sh
sed "s/ERP_HOST/$host/g" "$base/ops/nginx-http.conf" > /etc/nginx/conf.d/lean-erp-http.conf
if ! nginx -t; then
  mv /etc/nginx/conf.d/lean-erp-http.conf /etc/nginx/conf.d/lean-erp-http.conf.disabled
  exit 1
fi
printf 'lean-erp-acme-ready\n' > /var/lib/lean-erp-acme/.well-known/acme-challenge/deployment-probe
systemctl reload nginx
for attempt in {1..10}; do
  if curl -fsS -H "Host: $host" http://127.0.0.1/.well-known/acme-challenge/deployment-probe; then break; fi
  sleep 1
done
test "$(curl -fsS -H "Host: $host" http://127.0.0.1/.well-known/acme-challenge/deployment-probe)" = lean-erp-acme-ready
free -m
