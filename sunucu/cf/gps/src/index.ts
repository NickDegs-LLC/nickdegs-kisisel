import { trGun } from '../../ortak/src/zaman'
import { GERIGUN_TTL_SN, gerigunAnahtar } from '../../ortak/src/gecgun'
import type { GeriGunIsaret } from '../../ortak/src/gecgun'

export type Env = { DB: D1Database; KV: KVNamespace; R2: R2Bucket; ORTAM: string }

// movelog-gps — OsmAnd uyumlu GPS ingest (Traccar'ın yerine).
// Telefon (Tracker.swift sendLoc): POST ?id&lat&lon&timestamp&speed(knot)&altitude&accuracy&bearing[&batt][&charge=true]
// Sözleşme: Traccar gibi 200 + boş gövde döner; hatalı istekte bile telefon kilitlenmesin diye 400 kısa.
// Kimlik: bugünkü modelle aynı — device id (trackerId) bilinmeden yazılamaz; ayrıca kaba hız/aralık doğrulaması.

// TR günü + geç gün anahtar sözleşmesi ORTAK modülde (ortak/src/zaman.ts · ortak/src/gecgun.ts).
// Eskiden TR_OFSET/trGun burada ELLE KOPYAYDI ve cron'daki kopyayla aynı kalacağını yalnız bir
// yorum satırı garanti ediyordu; ayrışsalar işaret yanlış güne yazılır ve gezi sessizce oluşmazdı.

/**
 * GEÇ GELEN GÜN İŞARETİ — SU SEVİYESİ (22.09 "otobüs vakası" + aynı gün düşmanca inceleme).
 *
 * Cron'daki activity-detect YALNIZ bugünün TR gününü tarıyor. Şebekesiz yolculukta tampon TR gece
 * yarısından SONRA boşalırsa noktalar positions'a yazılır ama hiçbir cron turu o günü segmentlemez
 * → gezi de otonom video da HİÇ oluşmaz. Bu işaret cron'a "şu cihazın şu gününü geriye dönük işle" der.
 *
 * 🔴 KOŞULSUZ YAZ, ÖNCE OKUMA (eski "varsa yazma + cron silince biter" modeli KIRIKTI):
 *   · Cron ilk turda anahtarı silince, boşalmanın GERİ KALANI için işaret bir daha oluşmuyordu
 *     (izolat-içi Set bir kez yazıp susuyordu) → otobüs vakasında 1440 noktanın çoğu positions'a
 *     yazılıp HİÇ segmentlenmiyordu. Vakanın ta kendisi.
 *   · Varlığa bakmak (KV.get === null) KV'nin nihai tutarlılığı yüzünden de güvenilmezdi: cron
 *     sildikten sonra gps bir süre daha bayat "dolu" okuyup yazmıyordu.
 * Artık her geç nokta seviyeyi (yazma anını) KOŞULSUZ ileri taşır; okuma yok → bayat okuma yok.
 * Cron `işaret.t > işlendi.sv` olan çiftleri işler, anahtarı SİLMEZ (bkz. ortak/src/gecgun.ts).
 * Maliyet: boşalma turu başına ~400 KV yazımı — anahtar tek, değer küçük; kaybolan rotanın yanında hiç.
 */
async function gecGunIsareti(env: Env, device: string, ts: number, bugun: string, now: number): Promise<void> {
  const gun = trGun(ts)
  if (gun >= bugun) return                       // bugünün noktası: cron zaten tarıyor, işaret gereksiz
  const isaret: GeriGunIsaret = { t: now, ts }   // t = SEVİYE (monotonik yazma anı), ts = teşhis
  await env.KV.put(gerigunAnahtar(device, gun), JSON.stringify(isaret), { expirationTtl: GERIGUN_TTL_SN })
}

export default {
  // ⚠️ `_ctx`: ExecutionContext artık KULLANILMIYOR (eskiden ctx.waitUntil ile D1 yazımı
  // beklenmeden 200 dönülüyordu — aşağıdaki nota bak). İmza sözleşme gereği duruyor.
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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
    // 🔴 İŞARET ÖNCE, INSERT SONRA (bilerek). İşaret yazılıp insert patlarsa: 500 döner, istemci
    // aynı noktayı yeniden gönderir — zararsız (noktasız bir geç gün cron'da boş geçer). Ters
    // sırada olsaydı "satır D1'de ama cron habersiz" hâli doğardı: düzeltmeye çalıştığımız kayıp.
    //
    // 🔴 KV HATASI GPS ALIMINI DURDURMAZ (22.09 düzeltmesi). Eskiden burada 500 dönülüyordu: KV
    // arızası TÜM ingest'i kapatıyor, istemci kuyruğu şişiyor ve sorun KV'de olduğu hâlde noktalar
    // D1'e hiç yazılmıyordu. Su seviyesi modelinde TEK kaçırılan işaret yazımı zaten zararsız —
    // sıradaki nokta (boşalmada saniyeler içinde) seviyeyi yine ileri taşır. Logla ve devam et.
    try {
      await gecGunIsareti(env, device, ts, trGun(now), now)
    } catch (e) {
      console.log(`gec gun isareti yazilamadi (nokta yine de yaziliyor): device=${device} ts=${ts} ${String(e).slice(0, 160)}`)
    }
    // 🔴 22.09 "OTOBÜS VAKASI" — 200 ARTIK YALAN SÖYLEMİYOR.
    // Eskiden: `ctx.waitUntil(yaz.catch(() => {}))` + hemen 200. Yani D1 yazımı BEKLENMİYOR,
    // hatası YUTULUYORDU. İstemci kuyruğu (GpsKuyruk.swift) "2xx aldım → noktayı kuyruktan sil"
    // sözleşmesiyle çalışıyor: yazım sessizce başarısız olursa nokta KALICI olarak kaybolurdu —
    // düzeltmeye çalıştığımız hatanın aynısı. Artık yazım beklenir, hata 500'e döner, istemci
    // noktayı kuyruğunda tutup tekrar dener.
    // ⚠️ Yukarıdaki ÇÖP KOORDİNAT dalı BİLEREK 200 dönmeye devam ediyor: o nokta asla kabul
    // edilmeyecek, 500 dönmek istemciyi sonsuz retry'a sokardı (kuyruk yalnız 2xx'te düşürür).
    try {
      // 🔴 OR IGNORE — RETRY DEDUP'U (22.09). Yukarıdaki 200 sözleşmesi retry'ı NORMAL yol yaptı:
      // satır yazıldıktan SONRA yanıtı kaybolan nokta (timeout/kopan bağlantı) istemci kuyruğunda
      // kalır ve tekrar gelir. positions'ta PK/UNIQUE yoktu, hiçbir katmanda dedup yoktu → aynı fix
      // ikinci satır olur, segStats mesafeyi ÇİFT sayar (rides.km şişer, hız/ivme bozulur).
      // Eş migration: db/migrations/0012_positions_uniq.sql → uq_positions_dev_ts(device, ts).
      // ⚠️ İndeks UYGULANMADAN da bu satır güvenli: kısıt yoksa OR IGNORE'un etkisi YOKTUR
      //   (davranış bugünküyle birebir aynı), indeks gelince mükerrer sessizce yutulur ve istemci
      //   2xx alıp noktayı kuyruğundan düşürür. Tersi (indeks var, OR IGNORE yok) her retry'ı
      //   500'e çevirip noktayı kuyrukta SONSUZA DEK tutardı — bu yüzden kod indeksten ÖNCE gider.
      // ⚠️ OR IGNORE kısıt ihlallerini sessizce yutar; buraya gelen satırda device/ts/lat/lon
      //   yukarıda doğrulandı ve created_at daima dolu → NOT NULL ihlali sessizce düşemez.
      // NABIZ (22.09): saat her noktaya `&hr=` ekliyor ama bu uç okumuyordu ve kolon yoktu →
      // nabız sessizce düşüyordu. Artık yazılıyor. 25 < hr < 250 dışı değer YOK SAYILIR (null):
      // sensör teması kopunca saat 0 veya uçuk değer basabiliyor; /api/live/hr-report ucu da
      // aynı aralığı kullanıyor (grup2.ts), sözleşme ortak kalsın.
      // 🔴 SIRA: bu satır ancak 0012_positions_hr.sql UYGULANDIKTAN SONRA dağıtılabilir; kolon
      // yokken INSERT patlar → her nokta 500 → tüm kullanıcılarda konum akışı durur.
      const hrHam = num('hr')
      const hrDeger = hrHam !== null && hrHam > 25 && hrHam < 250 ? Math.round(hrHam) : null
      await env.DB.prepare(
        `insert or ignore into positions (device, ts, lat, lon, spd, alt, acc, brg, batt, charge, created_at, hr)
         values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`)
        .bind(device, ts, lat, lon, num('speed'), num('altitude'), num('accuracy'), num('bearing'),
              batt === null ? null : Math.max(0, Math.min(100, Math.round(batt))),
              q.get('charge') === 'true' ? 1 : 0, now, hrDeger)
        .run()
    } catch (e) {
      console.log(`positions yazilamadi: device=${device} ts=${ts} ${String(e).slice(0, 200)}`)
      return new Response('db error', { status: 500 })
    }
    return new Response('', { status: 200 })
  },
}
