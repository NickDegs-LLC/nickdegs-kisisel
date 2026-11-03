// movelog-kart — SVG → PNG render servisi. Yalnız service binding'den çağrılır (api KART).
//
//   POST /            gövde: { tip: 'surus'|'hafta', bicim?: 'dikey'|'kare', veri: SurusVeri|HaftaVeri }
//                     yanıt: image/png (1080×1920 ya da 1080×1080)
//   POST /?svg=1      aynı gövde, yanıt: image/svg+xml (hata ayıklama — ham SVG)
//   GET  /health      { ok: true }
//
// resvg WASM ilk istekte bir kez yüklenir (izolat ömrünce kalır). Fontlar paketten (Data rule).
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import fontNormal from '../fonts/NotoSans-Regular.ttf'
import fontKalin from '../fonts/NotoSans-Bold.ttf'
import { surusKarti, haftaKarti, karoPlani, SURUS_KUTU } from './svg'
import type { Bicim, SurusVeri, HaftaVeri, Karo } from './svg'

type Env = { HARITA?: Fetcher; HARITA_UC?: string }

let wasmHazir: Promise<void> | null = null
function hazirla(): Promise<void> {
  if (!wasmHazir) {
    wasmHazir = initWasm(resvgWasm).catch((e) => { wasmHazir = null; throw e })
  }
  return wasmHazir
}

const MAX_GOVDE = 512 * 1024   // iz zaten api'de 400 noktaya seyreltilir; sınır yalnız emniyet
const KARO_ZAMAN_MS = 8000     // tek karo için üst sınır; gecikenler boş kalır (kart yine çıkar)

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf); let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Arka plan uydu karoları: harita-katman `/xyz/sat/{z}/{x}/{y}.jpg` (service binding, public uç yok).
 *  Alınamayan karo atlanır — kart harita yarım da olsa üretilir. */
async function karolariGetir(env: Env, iz: SurusVeri['iz'], bicim: Bicim): Promise<Karo[]> {
  if (!env.HARITA || !env.HARITA_UC) return []
  const plan = karoPlani(iz, SURUS_KUTU[bicim])
  if (!plan) return []
  const out = await Promise.allSettled(plan.karolar.map(async (t) => {
    const r = await env.HARITA!.fetch(new Request(`${env.HARITA_UC}/xyz/sat/${plan.z}/${t.x}/${t.y}.jpg`, {
      headers: { 'user-agent': 'movelog-kart/1.0' }, signal: AbortSignal.timeout(KARO_ZAMAN_MS),
    }))
    if (!r.ok) throw new Error(String(r.status))
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('jpeg') && !ct.includes('jpg')) throw new Error('jpeg değil')
    return { px: t.px, py: t.py, data: b64(await r.arrayBuffer()) } as Karo
  }))
  return out.filter((x): x is PromiseFulfilledResult<Karo> => x.status === 'fulfilled').map((x) => x.value)
}

export function pngUret(svg: string): Uint8Array {
  const r = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: {
      fontBuffers: [new Uint8Array(fontNormal), new Uint8Array(fontKalin)],
      loadSystemFonts: false,
      defaultFontFamily: 'Noto Sans',
    },
    shapeRendering: 2,   // geometricPrecision
    textRendering: 2,    // geometricPrecision
    imageRendering: 0,
  })
  const png = r.render().asPng()
  r.free()
  return png
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, worker: 'movelog-kart' })
    if (req.method !== 'POST') return json(405, { detail: 'yalnız POST' })
    const len = Number(req.headers.get('content-length') || 0)
    if (len > MAX_GOVDE) return json(413, { detail: 'gövde çok büyük' })

    let b: { tip?: string; bicim?: string; veri?: unknown; harita?: boolean }
    try { b = (await req.json()) as typeof b } catch { return json(400, { detail: 'geçersiz JSON' }) }
    const bicim: Bicim = b.bicim === 'kare' ? 'kare' : 'dikey'
    if (!b.veri || typeof b.veri !== 'object') return json(400, { detail: 'veri yok' })

    let svg: string
    if (b.tip === 'surus') {
      const veri = b.veri as SurusVeri
      const karolar = b.harita === false ? [] : await karolariGetir(env, veri.iz ?? [], bicim)
      svg = surusKarti(veri, bicim, karolar)
    }
    else if (b.tip === 'hafta') svg = haftaKarti(b.veri as HaftaVeri, bicim)
    else return json(400, { detail: "tip 'surus' ya da 'hafta' olmalı" })

    if (url.searchParams.get('svg') === '1') {
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8' } })
    }
    try {
      await hazirla()
      const png = pngUret(svg)
      return new Response(png, { headers: { 'content-type': 'image/png', 'x-kart-bicim': bicim, 'x-kart-svg-kb': String(Math.round(svg.length / 1024)) } })
    } catch (e) {
      return json(500, { detail: `render hatası: ${(e as Error).message}` })
    }
  },
}
