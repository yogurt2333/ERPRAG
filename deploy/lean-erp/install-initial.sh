#!/usr/bin/env bash
# Initial deployment only. No existing release, database or service is overwritten.
# Usage: bash install-initial.sh /tmp/lean-erp-RELEASE.tar.gz SHA256 HTTPS_ORIGIN
set -euo pipefail
archive=${1:?archive required}
expected=${2:?sha256 required}
origin=${3:?HTTPS origin required}
[[ $EUID == 0 ]] || { echo 'Run as root'; exit 1; }
[[ $origin =~ ^https://[a-z0-9.-]+$ ]] || { echo 'Invalid HTTPS origin'; exit 1; }
[[ $expected =~ ^[a-fA-F0-9]{64}$ ]] || exit 1
[[ -f $archive && ! -e /opt/lean-erp/current && ! -e /etc/systemd/system/lean-erp.service ]] || { echo 'Not a clean initial deployment'; exit 1; }
[[ ! -e /var/lib/lean-erp/erp.sqlite ]] || { echo 'Existing database; manual migration/backup required'; exit 1; }
check_memory() {
  local available
  available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  echo "Available memory: $((available / 1024)) MiB; required: 768 MiB"
  (( available >= 786432 )) || { echo 'Memory reserve too low; stopping before next deployment step'; exit 1; }
}
check_memory
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
install -d -m 755 /opt/lean-erp/releases /opt/lean-erp/runtime
release=/opt/lean-erp/releases/$(date -u +%Y%m%dT%H%M%SZ)
mkdir "$release"
tar -xzf "$archive" -C "$release"
if [[ ! -x /opt/lean-erp/node/bin/node ]]; then
  temp=$(mktemp -d /opt/lean-erp/runtime/download.XXXXXX)
  curl -fsS --connect-timeout 10 --max-time 60 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$temp/SHASUMS256.txt"
  node_archive=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' "$temp/SHASUMS256.txt")
  [[ $node_archive =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]] || { echo 'Unexpected Node manifest'; exit 1; }
  node_version=${node_archive#node-}; node_version=${node_version%-linux-x64.tar.xz}
  curl -fsS --connect-timeout 10 --max-time 240 "https://nodejs.org/dist/$node_version/$node_archive" -o "$temp/$node_archive"
  (cd "$temp"; awk -v file="$node_archive" '$2 == file' SHASUMS256.txt | sha256sum -c -)
  check_memory
  XZ_DEFAULTS=--memlimit-decompress=128MiB tar -xJf "$temp/$node_archive" -C /opt/lean-erp/runtime
  ln -s "/opt/lean-erp/runtime/node-$node_version-linux-x64" /opt/lean-erp/node
fi
export PATH=/opt/lean-erp/node/bin:$PATH
node --version
cd "$release"
# Dependencies were assembled and checked locally against the lockfile; no server-side npm.
test -f node_modules/@simplewebauthn/server/package.json
test -f node_modules/@sinclair/typebox/package.json
id lean-erp >/dev/null 2>&1 || useradd --system --home-dir /var/lib/lean-erp --shell /sbin/nologin lean-erp
install -d -m 700 -o lean-erp -g lean-erp /var/lib/lean-erp
install -d -m 750 -o root -g lean-erp /etc/lean-erp
install -d -m 755 /opt/lean-erp/ops
install -m 755 "$release/ops/check-memory.sh" /opt/lean-erp/ops/check-memory.sh
printf 'ERP_WEB_ORIGIN=%s\nERP_DB=/var/lib/lean-erp/erp.sqlite\nERP_PORT=3100\n' "$origin" > /etc/lean-erp/environment
chown root:lean-erp /etc/lean-erp/environment
chmod 640 /etc/lean-erp/environment
chmod -R go-w "$release"
ln -s "$release" /opt/lean-erp/current
install -m 644 "$release/ops/lean-erp.service" /etc/systemd/system/lean-erp.service
install -m 755 "$release/ops/bootstrap-operator.sh" /usr/local/bin/lean-erp-bootstrap
systemd-analyze verify /etc/systemd/system/lean-erp.service
check_memory
systemctl daemon-reload
systemctl enable --now lean-erp
for attempt in {1..15}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3100/ >/dev/null; then break; fi
  sleep 1
done
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/me)" = 401
systemctl show lean-erp -p ActiveState -p SubState -p MemoryCurrent -p MainPID
echo 'Loopback service ready. HTTPS publication and operator enrollment remain separate steps.'
