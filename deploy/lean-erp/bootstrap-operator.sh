#!/usr/bin/env bash
# Run interactively; the one-time token is shown to the operator, not saved to a file.
set -euo pipefail
bash /opt/lean-erp/ops/check-memory.sh 768
source /etc/lean-erp/environment
systemd-run --quiet --wait --pipe --unit="lean-erp-bootstrap-$RANDOM" -p MemoryMax=128M -p CPUQuota=50% -p Nice=10 -p OOMScoreAdjust=500 \
  /usr/sbin/runuser -u lean-erp -- /usr/bin/env "ERP_WEB_ORIGIN=$ERP_WEB_ORIGIN" "ERP_DB=$ERP_DB" "ERP_PORT=$ERP_PORT" \
  /opt/lean-erp/node/bin/node --max-old-space-size=64 /opt/lean-erp/current/src/erp/web/main.ts bootstrap "${1:-操作员}"
