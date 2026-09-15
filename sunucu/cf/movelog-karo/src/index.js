// karo.nickdegs.com — Android harita sohbeti (osmdroid) uydu karosu, sunucusuz.
// Neden (15.09 denetimi): KV `mapconfig.tiles` öneksiz `harita.nickdegs.com/xyz/sat/...` idi; worker
// route'ları yalnız önekli yolu yakaladığı için istek sunucudaki nginx/harita-proxy'ye düşüyordu.
// Bu worker aynı karoyu harita-katman'dan service binding ile alır (Esri/EOX/R2 zinciri + kenar önbelleği).
const RX = /^\/(sat|str)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.jpg$/
// osmdroid `userAgentValue = packageName` (MapChatScreen.kt, 30.06'dan beri; mapconfig 09.08'de geldi)
const UA_IZIN = /^com\.nickdegs\.movelog/
const MAXAGE = 2592000 // 30 g

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url)
    if (u.pathname === '/saglik') {
      return new Response('{"ok":true,"katman":"movelog-karo"}', {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return metin('yontem desteklenmiyor', 405)
    const m = RX.exec(u.pathname)
    if (!m || +m[2] > 19) return metin('yok', 404)
    if (!UA_IZIN.test(req.headers.get('user-agent') || '')) return metin('yasak', 403)
    const onek = (env.HARITA_ONEK || '').replace(/^\/+|\/+$/g, '')
    if (!onek) return metin('yapilandirma eksik', 503)

    const anahtar = new Request(`https://${u.host}${u.pathname}`)
    const on = await caches.default.match(anahtar)
    if (on) return on

    const y = await env.HARITA.fetch(
      `https://harita.nickdegs.com/${onek}/xyz/${m[1]}/${m[2]}/${m[3]}/${m[4]}.jpg`,
    )
    if (!y.ok) return metin('karo alinamadi', 502)
    const kaynak = y.headers.get('x-kaynak') || ''
    const yanit = new Response(y.body, {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': `public, max-age=${MAXAGE}`,
        'x-kaynak': kaynak,
      },
    })
    // "koyu" = hiçbir kaynak vermedi (geçici olabilir) → önbelleğe yazma
    if (kaynak !== 'koyu') ctx.waitUntil(caches.default.put(anahtar, yanit.clone()))
    return yanit
  },
}

function metin(s, status) {
  return new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
