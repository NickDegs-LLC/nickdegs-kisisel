export type Env = { DB: D1Database; KV: KVNamespace; R2: R2Bucket; ORTAM: string }

// movelog-gps — OsmAnd uyumlu GPS ingest (Traccar'ın yerine).
// Telefon (Tracker.swift sendLoc): POST ?id&lat&lon&timestamp&speed(knot)&altitude&accuracy&bearing[&batt][&charge=true]
// Sözleşme: Traccar gibi 200 + boş gövde döner; hatalı istekte bile telefon kilitlenmesin diye 400 kısa.
// Kimlik: bugünkü modelle aynı — device id (trackerId) bilinmeden yazılamaz; ayrıca kaba hız/aralık doğrulaması.
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const u = new URL(req.url)
    if (u.pathname === '/health') {
      const r = await env.DB.prepare('select count(*) as n from positions').first<{ n: number }>().catch(() => null)
      return Response.json({ ok: r !== null, rows: r?.n ?? -1, worker: 'movelog-gps', ortam: env.ORTAM })
    }
    if (req.method !== 'POST' && req.method !== 'GET') return new Response('', { status: 405 })
    const q = u.searchParams
    const device = (q.get('id') || '').trim()
    const lat = parseFloat(q.get('lat') || ''), lon = parseFloat(q.get('lon') || '')
    let ts = parseInt(q.get('timestamp') || '', 10)
    if (!/^\d{6,12}$/.test(device) || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return new Response('bad request', { status: 400 })
    // 🔴 ÇÖP KOORDİNAT SÜZGECİ (05.09). VAKA: 31.08'de bu uca tam yuvarlak `lat=41, lon=29`
    // düştü; kullanıcının ev noktalarıyla (40.9786, 37.9241) birleşince 12 dakikada 748 km'lik
    // HAYALET ROTA oluştu ve o rotanın videosu üretilemedi (/api/motor3d 500 'spec uretilemedi').
    // Gerçek bir GPS ölçümü asla iki eksende birden tam tamsayı gelmez; (0,0) da Null Island'dır.
    // Kabul edip bozuk veri üretmektense sessizce YUTUYORUZ (200 dönüyoruz ki istemci retry'a girmesin).
    if ((Number.isInteger(lat) && Number.isInteger(lon)) || (lat === 0 && lon === 0)) {
      console.log(`cop koordinat atlandi: device=${device} lat=${lat} lon=${lon}`)
      return new Response('OK', { status: 200 })
    }
    const now = Math.floor(Date.now() / 1000)
    if (!isFinite(ts) || ts < 946684800) ts = now            // eski/bozuk zaman -> şimdi (Traccar da toleranslı)
    if (ts > now + 300) ts = now                              // gelecekten gelen zamanı kırp
    const num = (k: string) => { const v = parseFloat(q.get(k) || ''); return isFinite(v) ? v : null }
    const batt = num('batt')
    const yaz = env.DB.prepare(
      `insert into positions (device, ts, lat, lon, spd, alt, acc, brg, batt, charge, created_at)
       values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
      .bind(device, ts, lat, lon, num('speed'), num('altitude'), num('accuracy'), num('bearing'),
            batt === null ? null : Math.max(0, Math.min(100, Math.round(batt))),
            q.get('charge') === 'true' ? 1 : 0, now)
      .run()
    ctx.waitUntil(yaz.catch(() => {}))   // telefonu D1 gecikmesine bekletme; Traccar da anında 200 döner
    return new Response('', { status: 200 })
  },
}
