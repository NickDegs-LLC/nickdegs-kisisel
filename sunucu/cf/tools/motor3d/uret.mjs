#!/usr/bin/env node
// motor3d SAYFA/SÜRÜCÜ ÜRETİCİ (derleme zamanı) — Barış 2026-08-31
// ═══════════════════════════════════════════════════════════════════════════
// NEDEN: telefon-html.js istek anında `new Function(render3d.js kaynağı)` ile sayfayı üretiyor.
// Cloudflare Workers'ta `new Function`/`eval` YASAK ("Code generation from strings disallowed").
// Çözüm: o numarayı İSTEK ANINDAN DERLEME ANINA taşı. Sayfa kodu (543 satır tarayıcı JS/CSS)
// ELLE YENİDEN YAZILMAZ — render3d.js'ten MEKANİK olarak kesilip modül olarak sarmalanır.
// Böylece mühürlü davranış sabitleri byte-birebir korunur.
//
// ÇIKTI:
//   api/src/motor3d/sayfa.js    export sayfaUret(IN, MLJS, MLCSS, HARITA_TABAN, DEM_TABAN)
//   api/src/motor3d/surucu.js   export surucuUret(m)
//   api/src/motor3d/kilit.json  kaynak SHA-256 kilitleri + R2 vendor anahtarları
//   <stage>/maplibre-gl.<sha12>.js|.css   (R2'ye yüklenecek statik kütüphane)
//
// KİLİT: render3d.js / telefon-html.js değişirse SHA tutmaz -> `--dogrula` kırılır (CI kapısı).
// Kullanım: node uret.mjs [--stage <dizin>] [--dogrula]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BURASI = dirname(fileURLToPath(import.meta.url))
const CF = join(BURASI, '..', '..')                       // /opt/matrix/cf
const KAYNAK = process.env.MOTOR3D_KAYNAK || '/opt/matrix/render-worker/3d'
const HEDEF = join(CF, 'api', 'src', 'motor3d')
const stageIdx = process.argv.indexOf('--stage')
const STAGE = stageIdx > 0 ? process.argv[stageIdx + 1] : join(CF, '.wrangler', 'motor3d-stage')
const SADECE_DOGRULA = process.argv.includes('--dogrula')

const sha = (s) => createHash('sha256').update(s).digest('hex')
const oku = (p) => readFileSync(p, 'utf8')

const render3d = oku(join(KAYNAK, 'render3d.js'))
const telefon = oku(join(KAYNAK, 'telefon-html.js'))
const mljs = oku(join(KAYNAK, 'vendor', 'maplibre-gl.js'))
const mlcss = oku(join(KAYNAK, 'vendor', 'maplibre-gl.css'))

// ───────── 1) sayfa.js : render3d.js modül kapsamı (satır 1 → sürücü IIFE'si) ─────────
// Node bağları SADECE 6 yerde (ölçüldü): 3 require, IN okuma, MLJS/MLCSS okuma, 2 process.env.
// Hepsi PARAMETREYE çevrilir; başka HİÇBİR satıra dokunulmaz.
function sayfaUretici(src) {
  const kes = src.indexOf('(async()=>{')
  if (kes < 0) throw new Error('render3d.js: sürücü IIFE bulunamadı')
  let g = src.slice(0, kes)
  const degis = [
    ["const puppeteer = require('puppeteer');", '/* puppeteer: sürücüde, sayfada YOK */'],
    ["const { spawn } = require('child_process');", '/* child_process: sürücüde, sayfada YOK */'],
    ["const fs = require('fs');", '/* fs: parametreye taşındı */'],
    ["const IN = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));", '/* IN: parametre */'],
    ["const MLJS  = fs.readFileSync(__dirname + '/vendor/maplibre-gl.js', 'utf8');", '/* MLJS: parametre (R2) */'],
    ["const MLCSS = fs.readFileSync(__dirname + '/vendor/maplibre-gl.css', 'utf8');", '/* MLCSS: parametre (R2) */'],
    ["process.env.HARITA_TABAN || 'https://harita.nickdegs.com/24579d9db6c7c001'",
      "HARITA_TABAN || 'https://harita.nickdegs.com/24579d9db6c7c001'"],
    ["process.env.DEM_TABAN || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'",
      "DEM_TABAN || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'"],
  ]
  for (const [a, b] of degis) {
    if (!g.includes(a)) throw new Error('render3d.js: beklenen satır YOK -> ' + a.slice(0, 60))
    g = g.replace(a, b)
  }
  // kalan Node izi var mı? (yeni bir require/fs sızarsa derleme kırılsın)
  const kalan = g.match(/\brequire\s*\(|\bfs\s*\.|process\.(env|argv)|__dirname/g)
  if (kalan) throw new Error('render3d.js modül kapsamında Node izi kaldı: ' + [...new Set(kalan)].join(', '))
  return `// ⚠️ OTOMATİK ÜRETİLDİ — ELLE DÜZENLEME. Kaynak: ${KAYNAK}/render3d.js (modül kapsamı, satır 1..IIFE)
// Üretici: cf/tools/motor3d/uret.mjs · kaynak SHA-256: ${sha(src)}
// Değişiklik SADECE mekanik: 3 require + IN/MLJS/MLCSS okuması + 2 process.env -> parametre.
// Sayfa/CSS/çizim kodunun TEK BİR KARAKTERİ değişmedi (mühür korunur).
/* eslint-disable */
export function sayfaUret(IN, MLJS, MLCSS, HARITA_TABAN, DEM_TABAN) {
${g}
  return { HTML, IN, smPath, pts, frames, fps, zoom, pitch, title, W, H, OW, OH };
}
`
}

// ───────── 2) surucu.js : telefon-html.js'in türetilmiş matematiği + sayfa-içi sürücü ─────────
// telefon-html.js satır 33..189 (Node-tarafı türetilmiş değerler + SURUCU şablonu + HTML.replace).
function surucuUretici(src) {
  const bas = src.indexOf('// Sürücünün ihtiyacı olan Node-tarafı türetilmiş değerler')
  const son = src.indexOf('fs.writeFileSync(outPath, son);')
  if (bas < 0 || son < 0) throw new Error('telefon-html.js: sürücü bloğu sınırları bulunamadı')
  const g = src.slice(bas, son).trimEnd()
  const kalan = g.match(/\brequire\s*\(|\bfs\s*\.|process\.(env|argv)|__dirname/g)
  if (kalan) throw new Error('telefon-html.js sürücü bloğunda Node izi kaldı: ' + [...new Set(kalan)].join(', '))
  return `// ⚠️ OTOMATİK ÜRETİLDİ — ELLE DÜZENLEME. Kaynak: ${KAYNAK}/telefon-html.js (satır 33..189)
// Üretici: cf/tools/motor3d/uret.mjs · kaynak SHA-256: ${sha(src)}
// Değişiklik SADECE mekanik: mod.exports destructuring -> fonksiyon parametresi; fs.writeFileSync -> return.
/* eslint-disable */
export function surucuUret(m) {
  const { HTML, IN, smPath, pts, frames, fps, zoom, pitch, title, W, H, OW, OH } = m;
${g}
  return son;
}
`
}

const sayfaJs = sayfaUretici(render3d)
const surucuJs = surucuUretici(telefon)

const jsSha = sha(mljs), cssSha = sha(mlcss)
const vendorAnahtar = {
  js: `motor3d/maplibre-gl.${jsSha.slice(0, 12)}.js`,
  css: `motor3d/maplibre-gl.${cssSha.slice(0, 12)}.css`,
}
const kilit = {
  uretim: new Date().toISOString(),
  kaynak: {
    'render3d.js': sha(render3d),
    'telefon-html.js': sha(telefon),
    'vendor/maplibre-gl.js': jsSha,
    'vendor/maplibre-gl.css': cssSha,
  },
  boyut: { mljs: mljs.length, mlcss: mlcss.length },
  r2: vendorAnahtar,
}

if (SADECE_DOGRULA) {
  const eski = JSON.parse(oku(join(HEDEF, 'kilit.json')))
  const fark = Object.entries(kilit.kaynak).filter(([k, v]) => eski.kaynak[k] !== v)
  if (fark.length) {
    console.error('KİLİT TUTMADI — kaynak değişmiş, motor3d şablonunu yeniden üret:')
    for (const [k] of fark) console.error('  · ' + k)
    process.exit(1)
  }
  if (oku(join(HEDEF, 'sayfa.js')) !== sayfaJs || oku(join(HEDEF, 'surucu.js')) !== surucuJs) {
    console.error('KİLİT TUTMADI — üretilmiş sayfa.js/surucu.js kaynakla uyuşmuyor'); process.exit(1)
  }
  console.log('KİLİT OK'); process.exit(0)
}

mkdirSync(HEDEF, { recursive: true })
mkdirSync(STAGE, { recursive: true })
writeFileSync(join(HEDEF, 'sayfa.js'), sayfaJs)
writeFileSync(join(HEDEF, 'surucu.js'), surucuJs)
writeFileSync(join(HEDEF, 'kilit.json'), JSON.stringify(kilit, null, 2) + '\n')
// vendor: R2'ye yüklenecek (bundle'a GİRMEZ — 1,0 MB statik kütüphane)
writeFileSync(join(STAGE, vendorAnahtar.js.split('/').pop()), mljs)
writeFileSync(join(STAGE, vendorAnahtar.css.split('/').pop()), mlcss)
// worker'ın beklediği anahtarlar (bundle'a gömülü sabit) — sürüm kayması SESSİZ olamaz
writeFileSync(join(HEDEF, 'vendor-anahtar.ts'),
  `// ⚠️ OTOMATİK ÜRETİLDİ (cf/tools/motor3d/uret.mjs). R2'deki statik MapLibre kopyasının anahtarları.
// İçerik SHA'sı anahtarın içinde -> bundle ile R2 nesnesi ayrışırsa 500 verilir, SESSİZ bozulma OLMAZ.
export const VENDOR = ${JSON.stringify(vendorAnahtar, null, 2)} as const
export const VENDOR_SHA = ${JSON.stringify({ js: jsSha, css: cssSha }, null, 2)} as const
`)

console.log('ÜRETİLDİ')
console.log('  sayfa.js         ', sayfaJs.length, 'B')
console.log('  surucu.js        ', surucuJs.length, 'B')
console.log('  R2 (stage):      ', join(STAGE, vendorAnahtar.js.split('/').pop()), mljs.length, 'B')
console.log('  R2 (stage):      ', join(STAGE, vendorAnahtar.css.split('/').pop()), mlcss.length, 'B')
console.log('  R2 anahtarları:  ', vendorAnahtar.js, '|', vendorAnahtar.css)
if (!existsSync(join(KAYNAK, 'vendor', 'maplibre-gl.js'))) process.exit(4)
