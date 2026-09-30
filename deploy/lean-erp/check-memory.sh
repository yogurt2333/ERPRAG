#!/usr/bin/env bash
set -euo pipefail
minimum=${1:-768}
[[ $minimum =~ ^[0-9]+$ ]] || exit 1
available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
echo "Available memory: $((available / 1024)) MiB; required: $minimum MiB"
(( available >= minimum * 1024 ))
