// motor3d — statik MapLibre kopyası (939 KB js + 68 KB css) R2'den, Cache API + izolat belleği ile.
// NEDEN R2: kütüphane sayfanın %67'si ama TAMAMEN DEĞİŞMEZ; bundle'a gömülürse her deploy
// (movelog-api CANLI worker'ı) 1 MB şişer. R2'de tutup üç kademeli önbellekle çekiyoruz:
//   ① izolat belleği (aynı izolatta 2. istek: 0 ms, 0 subrequest)
//   ② Cache API (aynı kolokasyondaki diğer izolatlar)
//   ③ R2 (soğuk)
// SÜRÜM KAYMASI İMKÂNSIZ: anahtar içerik SHA-256'sını taşır (`maplibre-gl.<sha12>.js`) ve
// bundle'daki sabit ile aynı olmak ZORUNDA — nesne yoksa 500 verilir, SESSİZ bozulma OLMAZ.
// Yükleyen: cf/tools/motor3d-sablon-uret.sh
import type { Env } from '../lib/env'
import { VENDOR } from './vendor-anahtar'

let bellek: { js: string; css: string } | null = null

const KOK = 'https://motor3d-vendor.invalid/'

type Bekle = { waitUntil(p: Promise<unknown>): void }   // ExecutionContext'in bize gereken tek yüzü

async function parcaAl(env: Env, anahtar: string, ctx?: Bekle): Promise<string> {
  const istek = new Request(KOK + anahtar)
  try {
    const on = await caches.default.match(istek)
    if (on) return await on.text()
  } catch { /* Cache API yoksa R2'ye düş */ }
  const o = await env.R2.get(anahtar)
  if (!o) throw new Error(`motor3d vendor eksik: ${anahtar} (tools/motor3d-sablon-uret.sh çalıştır)`)
  const metin = await o.text()
  try {
    const yanit = new Response(metin, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' },
    })
    const p = caches.default.put(istek, yanit)
    if (ctx) ctx.waitUntil(p); else await p
  } catch { /* önbellek yazımı best-effort */ }
  return metin
}

export async function vendorAl(env: Env, ctx?: Bekle): Promise<{ js: string; css: string }> {
  if (bellek) return bellek
  const [js, css] = await Promise.all([parcaAl(env, VENDOR.js, ctx), parcaAl(env, VENDOR.css, ctx)])
  bellek = { js, css }
  return bellek
}
