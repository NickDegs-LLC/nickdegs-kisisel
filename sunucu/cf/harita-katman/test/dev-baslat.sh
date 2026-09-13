#!/bin/bash
# uyum-test için yerel wrangler dev — GERÇEK öneki secrets'tan alır (loga yazmaz),
# böylece forward duman testi origin nginx'inden gerçekten geçer.
set -euo pipefail
cd "$(dirname "$0")/.."
source /opt/matrix/secrets/harita-uc.conf
exec wrangler dev --port "${PORT:-8787}" --var "ONEK:${HARITA_UC_ONEK}"
