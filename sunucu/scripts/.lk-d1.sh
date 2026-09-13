#!/bin/bash
set -uo pipefail
source /opt/matrix/secrets/movelog-cf.conf >/dev/null 2>&1
export CLOUDFLARE_API_TOKEN="${MOVELOG_CF_TOKEN:-}" CLOUDFLARE_ACCOUNT_ID="${MOVELOG_CF_ACCOUNT_ID:-45241304800d3e122aced1f0ae599943}" WRANGLER_SEND_METRICS=false
cd /opt/matrix/cf/api
npx wrangler d1 execute movelog-db --remote --json --command "$1" 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d[0]["results"], ensure_ascii=False))'
