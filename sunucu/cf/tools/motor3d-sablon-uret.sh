#!/usr/bin/env bash
# motor3d ŞABLON ÜRETİMİ + R2 YÜKLEME  (Barış 2026-08-31)
# ─────────────────────────────────────────────────────────────────────────────
#  1) render3d.js + telefon-html.js -> api/src/motor3d/{sayfa.js,surucu.js,vendor-anahtar.ts,kilit.json}
#     (istek anındaki `new Function` numarası DERLEME ANINA taşınır; Workers'ta eval yasak)
#  2) vendor/maplibre-gl.{js,css} -> R2 movelog kovası  motor3d/maplibre-gl.<sha12>.{js,css}
#     Anahtar içerik SHA'sını taşır -> bundle ile R2 ayrışırsa uç 500 verir, SESSİZ bozulma OLMAZ.
#
#  Kullanım:
#    tools/motor3d-sablon-uret.sh            # üret + R2'ye yükle (varsa atlar)
#    tools/motor3d-sablon-uret.sh --dogrula  # SADECE kilit kontrolü (CI kapısı; hiçbir şey yazmaz)
#    tools/motor3d-sablon-uret.sh --zorla    # R2'de olsa bile yeniden yükle
set -euo pipefail
CF="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$CF/.wrangler/motor3d-stage"
KOVA="movelog"
cd "$CF"

if [[ "${1:-}" == "--dogrula" ]]; then
  exec node "$CF/tools/motor3d/uret.mjs" --dogrula
fi
ZORLA=0; [[ "${1:-}" == "--zorla" ]] && ZORLA=1

echo "── 1/2  şablon çıkarımı ───────────────────────────────────────────────"
node "$CF/tools/motor3d/uret.mjs" --stage "$STAGE"

JS_ANAHTAR=$(node -e "console.log(require('$CF/api/src/motor3d/kilit.json').r2.js)")
CSS_ANAHTAR=$(node -e "console.log(require('$CF/api/src/motor3d/kilit.json').r2.css)")

echo "── 2/2  R2 yükleme (kova: $KOVA) ──────────────────────────────────────"
yukle() {  # $1=r2 anahtarı  $2=yerel dosya  $3=content-type
  if [[ $ZORLA -eq 0 ]] && npx wrangler r2 object get "$KOVA/$1" --remote --pipe >/dev/null 2>&1; then
    echo "   zaten var, atlandı: $1"; return
  fi
  npx wrangler r2 object put "$KOVA/$1" --file "$2" --content-type "$3" --remote
  echo "   yüklendi: $1"
}
yukle "$JS_ANAHTAR"  "$STAGE/$(basename "$JS_ANAHTAR")"  "text/plain;charset=utf-8"
yukle "$CSS_ANAHTAR" "$STAGE/$(basename "$CSS_ANAHTAR")" "text/plain;charset=utf-8"

echo
echo "TAMAM. Sırada: npm run typecheck  &&  (cd api && npx wrangler deploy)"
