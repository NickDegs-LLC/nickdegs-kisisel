// motor3d — iz kaynağı. SUNUCU YOK: harita-proxy.py:452-456 backend'e HTTP atıyordu
// (`GET /api/track?frm=&to=&detay=1`); worker'da o uç zaten YERİNDE (grup7) — HTTP yerine
// AYNI mantık doğrudan D1/R2'den okunur (subrequest = 0).
//
// Sıra grup7 `/api/track` ile BİREBİR:
//   1) R2 `tracks/{int(frm)}.json`  (yüklenen GPX/TCX) — SAHİPLİK kontrolü (IDOR)
//      -> yalnız {lat,lon,spd}; zaman YOK => route-video.py t'yi from..to arasına eşit dağıtır
//   2) D1 `positions` (movelog-gps ingest; dispatch/isiHazirla deseni) — spd KNOT saklanır,
//      main.py:891 gibi ×1.852 -> km/h. Nabız kolonu YOK -> hr null.
import type { Env } from '../lib/env'
import { BARIS_UID } from '../lib/db'
import type { IzNokta } from './spec'
import { izSuz } from '../../../ortak/src/izsuzgec'

/** grup7 round1 ile aynı (main.py round(x,1) yaklaşığı). */
const round1 = (x: number): number => Math.round(x * 10) / 10

/** 🔴 IŞINLANMA SÜZGECİ (05.09) — bozuk tek nokta koca bir hayalet rota üretiyordu.
 *  VAKA (Barış): 31.08'de cihaz izine tam yuvarlak `lat=41.000000, lon=29.000000` çöp noktası
 *  düştü; ev noktalarıyla (40.9786, 37.9241) birleşince 12 dakikada **748 km**'lik sahte bir rota
 *  oluştu. Kullanıcı "evdeydim, nereden geldi bilmiyorum" dedi; "üret"e basınca `/api/motor3d`
 *  **500 'spec uretilemedi'** döndü ve telefon motoru sessizce pes etti.
 *  Kural: iki nokta arası ima edilen hız 400 km/s'i aşıyorsa (uçak bile değil) o nokta ATILIR.
 *  Ayrıca tam-tamsayı koordinat çifti (x.000000, y.000000) gerçek GPS'te olmaz -> atılır.
 *  Süzgeç okumada çalışır, yani D1'deki eski bozuk veriler de artık render'ı kırmaz. */
// 05.09: gövde ORTAK modüle taşındı (cf/ortak/src/izsuzgec.ts) — api, cron ve dispatch aynı
// kuralları kullanır. Buradaki sarmalayıcı yalnız eski çağrı adını korur.
const izTemizle = (pts: IzNokta[]): IzNokta[] => izSuz(pts)

export async function izOku(env: Env, user: string, frm: number, to: number): Promise<IzNokta[]> {
  // 1) yüklenen iz
  const anahtar = Math.trunc(frm)
  const obj = await env.R2.get(`tracks/${anahtar}.json`)
  if (obj) {
    const pts = await obj.json<Record<string, any>[]>()
    const row = await env.DB
      .prepare("SELECT COALESCE(NULLIF(uid,''), ?2) AS o FROM rides WHERE uploaded = 1 AND ts = ?1 LIMIT 1")
      .bind(anahtar, BARIS_UID).first<{ o: string }>()
    const sahibi = row ? row.o : BARIS_UID
    if (sahibi !== user) return []                       // grup7: 404 'iz bulunamadi' -> burada "iz yok"
    return izTemizle(pts.map((p) => ({ t: 0, lat: Number(p.lat), lon: Number(p.lon), spd: Number(p.spd) || 0, alt: null, hr: null })))
  }

  // 2) cihaz izi
  const u = await env.DB.prepare('SELECT tracker_id FROM users WHERE uid = ?1')
    .bind(user).first<{ tracker_id: string | null }>()
  if (!u?.tracker_id) return []
  const res = await env.DB
    .prepare('SELECT ts, lat, lon, spd, alt FROM positions WHERE device = ?1 AND ts >= ?2 AND ts <= ?3 ORDER BY ts')
    .bind(u.tracker_id, Math.floor(frm), Math.floor(to)).all<Record<string, any>>()
  return izTemizle((res.results ?? []).map((p) => ({
    t: Math.trunc(Number(p.ts ?? 0)),
    lat: Number(p.lat), lon: Number(p.lon),
    spd: round1((Number(p.spd) || 0) * 1.852),
    alt: p.alt === null || p.alt === undefined ? null : Number(p.alt),
    hr: null,
  })))
}
