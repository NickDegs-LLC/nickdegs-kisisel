import { izSuz } from '../../ortak/src/izsuzgec'
import { aylikButceLimit, butcePushBaslik, butcePushGovde, modMaliyet, trGunu } from '../../ortak/src/maliyet'

export type Env = {
  DB: D1Database; KV: KVNamespace; R2: R2Bucket; RENDER_Q: Queue; ORTAM: string
  RUNPOD_API_KEY: string; RUNPOD_ENDPOINT: string; DISPATCH_SECRET: string
  // MODAL DALI (2026-09-07): motor seçimi KV `dispatch:motor` bayrağında ('runpod' | 'modal').
  // Bayrak KV'de olduğu için GERİ DÖNÜŞ YENİDEN DAĞITIM İSTEMEZ.
  MODAL_SECRET?: string
}

// movelog-dispatch — Queue tüketicisi → RunPod /run (movelog-cloud.py'nin CF karşılığı).
// Mesaj gövdesi = rp_handler'ın beklediği job (day/from/to/mode/aspect/speed/track/ride_id/camdist/
// cam/type/user/name/line/dot/music/reel/ultra/kabartma/lang/premium/matched). Ön-eşleme (matching)
// GEÇİŞ KARARINA kadar motora bırakılır (matched göndermiyoruz -> motor kendi map-match'ini yapar;
// plan v2 Faz 1 notu). Başarısızlıkta Queue retry (max 3) + KV'ye son hata.
//
// TEK HAT (motor KV `dispatch:motor`): her iş -> movelog-render (GPU, RunPod veya Modal).
// 18.09: taktik (CPU) hattı kaldırıldı.
type Job = Record<string, unknown> & { ride_id?: string }

const simdi = () => Math.floor(Date.now() / 1000)

// ---------------------------------------------------------------------------
// GÜNLÜK GPU HARCAMA TAVANI (05.09)
// ÖLÇÜLEN maliyet: D1 gpu_costs → 912 GPU saniyesi / 1 adet 3B video (≈15,2 dk). RunPod flex
// fiyatlarıyla ≈ $0,19-0,28. Koddaki eski `MODE_MALIYET['3d'] = 0.033` bunun 6-9 KATI düşüktü;
// `flat: 0.0` ise bütçeye HİÇ girmiyordu. Bedel tablosu artık ortak/src/maliyet.ts (api ile aynı
// düğme; motor KV `dispatch:motor`'a göre RunPod/Modal).
// Kural: 2,5 × Σ(aylık bütçeler)/30. Bugün Σ ≈ $11,70 → $0,39/gün ortalama; $1,00 patlama payı
// bırakır. Eski $3,00 = $90/ay, toplam aylık ödeneğin 7,7 katı — fren değildi.
// 🔴 DÜZELTME (adversaryel doğrulama): $1,00 SAHİBİN KENDİ TEST GÜNÜNÜ keserdi — Barış 05.09'da
// tek başına 5 adet 3B üretti (≈$1,90) ve admin olduğu için aylık bütçe onu bağlamıyor, bu tavan
// TEK freni. $1,50 hem $3,00'ın "fren değil" sorununu çözer hem meşru kullanımı kesmez.
const GUNLUK_LIMIT_VARSAYILAN = 1.5        // USD/gün
const INCELEME = new Set(['appreview', 'appreview2'])   // App Store inceleme hesapları: tavansız
const PARK_TTL = 7 * 86400

/** Bekçi alarmı → KV 'bildirim:bekleyen' (tüketicisi: movelog-cron bildirim-kuyruk görevi). */
async function bildirimYaz(env: Env, msg: string): Promise<void> {
  try {
    await env.KV.put(`bildirim:bekleyen:${Date.now()}_${Math.floor(Math.random() * 1e8).toString(16)}`,
      JSON.stringify({ msg, konu: 'Move Log Bekçi', kaynak: 'movelog-dispatch' }), { expirationTtl: 7 * 86400 })
  } catch { /* yut */ }
}

// AYLIK KULLANICI BÜTÇESİ — varsayılan ortak/src/maliyet.ts (api ile aynı düğme);
// KV `butce-premium-usd` ile deploy'suz ayarlanır (18.09: tek katman, `butce-ultra-usd` ölü).
// NEDEN BURADA: `grup1.bumpDailyCap` YALNIZ `/api/rides/generate` yolunda çalışıyor. Otomatik
// üretim (activity-detect), onarım (video-butunluk) ve bekçi yolları HİÇBİR kullanıcı bütçesine
// girmiyordu — yani abonelik başına maliyet üst sınırı fiilen YOKTU. Cron tarafı işleri
// `oto: true` ile işaretliyor; hesap tek kapıda (burada) tutuluyor, çift sayım olmuyor.

/** Park gövdesi + sebep. kuyruk-bekçisi önce `dispatch:park-sebep:{rid}` okur. */
async function parkEt(
  env: Env, rid: string, govde: unknown, sebep: string, ekstra: Record<string, unknown> = {},
): Promise<void> {
  const t = simdi()
  await env.KV.put(`dispatch:bekleyen:${rid}`, JSON.stringify(govde), { expirationTtl: PARK_TTL })
  await env.KV.put(`dispatch:park-sebep:${rid}`,
    JSON.stringify({ t, sebep, ...ekstra }), { expirationTtl: PARK_TTL })
}

/** Otomatik işin kullanıcı aylık GPU bütçesine sığıp sığmadığı. Admin: limitsiz ama SAYILIR. */
async function aylikButce(
  env: Env, uid: string, bedel: number,
): Promise<{ ok: true } | { ok: false; harcanan: number; butce: number }> {
  const u = await env.DB.prepare('SELECT premium, admin FROM users WHERE uid = ?1')
    .bind(uid).first<{ premium: number | null; admin: number | null }>()
  if (!u) return { ok: true }                                   // kullanıcı yoksa engelleme
  const butce = await aylikButceLimit(env.KV)
  // ⚠️ grup1.ts TR gününe göre ay üretiyor (trDay). Burada UTC kullanılırsa ayın 1'i
  // 00:00-03:00 TR arası İKİ FARKLI kovaya yazılır ve bütçe sıfırlanmış gibi görünür.
  const ay = 'ay_' + trGunu(simdi()).slice(0, 7)
  const r = await env.DB.prepare('SELECT value FROM render_counts WHERE uid = ?1 AND counter_key = ?2')
    .bind(uid, ay).first<{ value: number }>()
  const harcanan = Number(r?.value ?? 0)
  if (!u.admin && harcanan + bedel > butce) return { ok: false, harcanan, butce }
  const now = simdi()
  await env.DB.prepare(
    `INSERT INTO render_counts (uid, counter_key, value, created_at, updated_at) VALUES (?1,?2,?3,?4,?4)
     ON CONFLICT(uid, counter_key) DO UPDATE SET value = ROUND(value + ?3, 4), updated_at = ?4`)
    .bind(uid, ay, bedel, now).run()
  return { ok: true }
}

/** Günlük harcama tavanı. Aşılmışsa iş RunPod'a GÖNDERİLMEZ (park edilir, kaybolmaz). */
async function butceKapisi(
  env: Env, job: Job | undefined, rid: string,
): Promise<{ ok: true } | { ok: false; harcanan: number; limit: number; tur: 'gunluk' | 'aylik' }> {
  try {
    const ham = await env.KV.get('gpu-gunluk-limit-usd')
    const limit = ham === null ? GUNLUK_LIMIT_VARSAYILAN : parseFloat(ham)
    if (!Number.isFinite(limit) || limit <= 0) return { ok: true }        // 0/geçersiz = tavan kapalı
    // App Store inceleme hesapları hiçbir tavana takılmaz (grup1.INCELEME ile aynı liste):
    // hakem kapasite duvarına çarparsa özelliği bozuk sayar ve sürüm reddedilir.
    if (INCELEME.has(String((job as Record<string, unknown> | undefined)?.user ?? ''))) return { ok: true }
    const gun = trGunu(simdi())
    // ⚠️ AYNI İŞ İKİ KEZ SAYILMASIN: kuyruk mesajı retry edilirse (runpodGonder !ok / exception)
    // bu kapıdan tekrar geçer. Sayaç idempotent değilse bir retry fırtınası günlük bütçeyi
    // GERÇEK bir GPU işi çalışmadan tüketir ve tüm üretimi kilitler.
    const sayildi = `gpu:sayildi:${gun}:${rid}`
    if ((await env.KV.get(sayildi)) !== null) return { ok: true }         // bu rid bugün zaten sayıldı
    const anahtar = `gpu:gun:${gun}`
    const harcanan = parseFloat((await env.KV.get(anahtar)) || '0') || 0
    const jb = job as Record<string, unknown> | undefined
    // grup1.ts `turMaliyet` ile aynı: 3d -> 3d, speed=auto -> auto, sonra mod.
    // 18.09: `cam === 'pacman' -> sv` dalı KALKTI (Sokak/Street View ürünü kaldırıldı).
    const mod = String(jb?.mode === '3d' ? '3d' : jb?.speed === 'auto' ? 'auto' : (jb?.mode ?? 'flyover'))
    const bedel = await modMaliyet(env.KV, mod, 0.1)
    if (harcanan + bedel > limit) return { ok: false, harcanan, limit, tur: 'gunluk' }
    // OTOMATİK işler (cron/onarım/bekçi) kullanıcının AYLIK bütçesine de girer — API yolu
    // kendi hesabını grup1.bumpDailyCap'te tutuyor, burada çift saymıyoruz.
    const j = job as Record<string, unknown> | undefined
    const uid = String(j?.user ?? '')
    if (j?.oto && uid) {
      const ay = await aylikButce(env, uid, bedel)
      if (!ay.ok) return { ok: false, harcanan: ay.harcanan, limit: ay.butce, tur: 'aylik' }
    }
    // 36 saat TTL: gün dönünce anahtar kendiliğinden düşer, sıfırlama işi gerekmez
    await env.KV.put(anahtar, (harcanan + bedel).toFixed(4), { expirationTtl: 36 * 3600 })
    await env.KV.put(sayildi, String(bedel), { expirationTtl: 36 * 3600 })
    return { ok: true }
  } catch { return { ok: true } }        // sayaç okunamadıysa üretimi ENGELLEME (arıza ≠ tavan)
}

async function runpodGonder(env: Env, job: Job): Promise<{ ok: boolean; status: number; body: string }> {
  const r = await fetch(`https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT}/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RUNPOD_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input: job }),
  })
  return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 500) }
}

// ---------- MODAL DALI (2026-09-07, taktik 2026-09-14) ----------
// Modal ucu RunPod'un /run sözleşmesini TAKLİT EDER ({"input": job} alır,
// {"id":..., "status":"IN_QUEUE"} döner) → çağıran taraf aynı kalır. Geri çağrı
// (/api/internal/render-done) motorun KENDİSİ tarafından yapılır.
const MODAL_RUN = 'https://daclen10--movelog-render-run.modal.run'

async function modalGonder(env: Env, job: Job): Promise<{ ok: boolean; status: number; body: string }> {
  if (!env.MODAL_SECRET) return { ok: false, status: 0, body: 'MODAL_SECRET yok' }
  const r = await fetch(MODAL_RUN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.MODAL_SECRET, input: job }),
  })
  return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 500) }
}

/** Hangi motor? KV `dispatch:motor` bayrağı — okunamazsa RunPod (arıza ≠ sessiz motor değişimi).
 *  18.09: TEK HAT — `dispatch:motor-tac` override'ı taktikle birlikte kalktı. */
async function motorSec(env: Env): Promise<'runpod' | 'modal'> {
  try {
    const v = await env.KV.get('dispatch:motor')
    return String(v ?? '').replace(/"/g, '') === 'modal' ? 'modal' : 'runpod'
  } catch { return 'runpod' }
}

/** Kuyruktan gelen işi RunPod sözleşmesine çevirir (movelog-cloud.py:546-566 eşleniği).
 *  ÖLÇÜLDÜ (31.08 kesimi): API 'vid' gönderiyor, rp_handler 'ride_id' bekliyor; ayrıca normal
 *  rotalarda 'track' GÖMÜLÜ DEĞİL (eski dispatcher Traccar'dan çekip gömüyordu) — RunPod'da
 *  Traccar yok, iz D1 positions'tan doldurulur. İkisi eksikken iş 200 alıp SESSİZCE boş dönüyordu. */
async function isiHazirla(env: Env, b: Job): Promise<Job> {
  const j: Job = { ...b }
  if (!j.ride_id) j.ride_id = (j.vid as string) ?? `${j.day ?? ''}_${j.from ?? 0}`
  const iz = j.track as unknown[] | undefined
  if (!iz || !iz.length) {
    const uid = String(j.user ?? '')
    const frm = Math.trunc(Number(j.from ?? 0)), to = Math.trunc(Number(j.to ?? 0))
    if (uid && frm && to) {
      const u = await env.DB.prepare('SELECT tracker_id FROM users WHERE uid=?1')
        .bind(uid).first<{ tracker_id: string | null }>()
      if (u?.tracker_id) {
        const r = await env.DB.prepare(
          'SELECT lat, lon, ts, spd, alt FROM positions WHERE device=?1 AND ts BETWEEN ?2 AND ?3 ORDER BY ts')
          .bind(u.tracker_id, frm, to).all<Record<string, number>>()
        // 🔴 FİKS 05.09: RunPod'a giden iz HAM gidiyordu — çöp koordinat (41,29) yüzünden 748 km'lik
        // hayalet rotalar gerçek GPU parasıyla render edilebiliyordu. Ortak süzgeç burada da devrede.
        j.track = izSuz((r.results ?? []).map(
          (p) => ({ lat: p.lat, lon: p.lon, t: p.ts, spd: p.spd, alt: p.alt })))
      }
    }
  }
  // Gövdeyle GELEN iz de süzülür (telefon/istemci kaynaklı çöp de buradan geçmesin)
  if (Array.isArray(j.track) && j.track.length) {
    j.track = izSuz(j.track as Array<{ lat: number; lon: number; t?: number }>)
  }
  return j
}

/** İzi doldurmayı DENEYEBİLDİĞİMİZ halde boş kalan iş mi?
 *  user+from+to yoksa iz zaten başka yoldan geliyordur (ör. gövdede gömülü) — ona KARIŞMA,
 *  yalnız "D1'den doldurmayı denedik, veri yok" halini yakala. */
function izsiz(j: Job): boolean {
  const iz = j.track as unknown[] | undefined
  if (iz && iz.length) return false
  return !!String(j.user ?? '') && Math.trunc(Number(j.from ?? 0)) > 0 && Math.trunc(Number(j.to ?? 0)) > 0
}

/** Oto işte bütçe push'u dönem başına en fazla 1 kez. Manuel işte her zaman bildir (Türkçe sebep). */
async function butceKullaniciBildir(
  env: Env, uid: string, oto: boolean, tur: 'aylik' | 'gunluk',
): Promise<{ bildir: boolean; govde?: string; baslik?: string }> {
  if (!uid) return { bildir: false }
  if (!oto) return { bildir: true }            // kullanıcının kendi bastığı iş: bugünkü davranış
  const gun = trGunu(simdi())
  const anahtar = tur === 'aylik'
    ? `bildirim:butce:${uid}:aylik:${gun.slice(0, 7)}`
    : `bildirim:butce:${uid}:gunluk:${gun}`
  if ((await env.KV.get(anahtar)) !== null) return { bildir: false }
  const pr = await env.DB.prepare('SELECT lang FROM users WHERE uid = ?1').bind(uid)
    .first<{ lang: string | null }>()
  await env.KV.put(anahtar, String(simdi()), { expirationTtl: tur === 'aylik' ? 40 * 86400 : 36 * 3600 })
  return { bildir: true, govde: butcePushGovde(pr?.lang, tur), baslik: butcePushBaslik(pr?.lang) }
}

/** pending → failed taşı + kullanıcıya bildirim kuyruğa (api render-failed ucuyla aynı sözleşme). */
/** pending kilidini AÇ + hata kartı + kullanıcı bildirimi. Ortak yol (izsiz / bütçe).
 *  `pushGovde` verilirse push gövdesi o olur; failed_videos.reason hep `sebep` (Türkçe kalır). */
async function isiBitir(
  env: Env, j: Job, rid: string, sebep: string, iz: string, bildir = true, pushGovde?: string, pushBaslik?: string,
): Promise<void> {
  const uid = String(j.user ?? '') || null
  const now = simdi()
  const pv = await env.DB.prepare('SELECT date, ts, to_ts, ride_type, mode FROM pending_videos WHERE vid = ?1')
    .bind(rid).first<{ date: string | null; ts: number; to_ts: number; ride_type: string | null; mode: string | null }>()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pending_videos WHERE vid = ?1').bind(rid),
    env.DB.prepare(
      `INSERT INTO failed_videos (vid, uid, reason, failed_at, date, ts, to_ts, ride_type, mode, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
       ON CONFLICT(vid) DO UPDATE SET uid=?2, reason=?3, failed_at=?4, date=?5, ts=?6, to_ts=?7, ride_type=?8, mode=?9, updated_at=?10`)
      .bind(rid, uid, sebep, now, pv?.date ?? null, pv?.ts ?? null, pv?.to_ts ?? null,
        pv?.ride_type ?? null, pv?.mode ?? null, now),
  ])
  if (uid && bildir) {
    await env.KV.put(`push:bekleyen:${iz}_${rid.split('/').join('_')}_${now}`,
      JSON.stringify({ user: uid, title: pushBaslik ?? 'Video oluşturulamadı', body: pushGovde ?? sebep, ts: now, route: 'videos' }),
      { expirationTtl: 7 * 86400 })
  }
  await env.KV.put(`dispatch:${iz}:${rid}`, JSON.stringify({ t: now, uid }), { expirationTtl: 7 * 86400 })
}

async function izsizBitir(env: Env, j: Job, rid: string): Promise<void> {
  const uid = String(j.user ?? '') || null
  const now = simdi()
  const sebep = 'Bu rota için yeterli GPS verisi yok.'
  const pv = await env.DB.prepare('SELECT date, ts, to_ts, ride_type, mode FROM pending_videos WHERE vid = ?1')
    .bind(rid).first<{ date: string | null; ts: number; to_ts: number; ride_type: string | null; mode: string | null }>()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pending_videos WHERE vid = ?1').bind(rid),
    env.DB.prepare(
      `INSERT INTO failed_videos (vid, uid, reason, failed_at, date, ts, to_ts, ride_type, mode, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
       ON CONFLICT(vid) DO UPDATE SET uid=?2, reason=?3, failed_at=?4, date=?5, ts=?6, to_ts=?7, ride_type=?8, mode=?9, updated_at=?10`)
      .bind(rid, uid, sebep, now, pv?.date ?? null, pv?.ts ?? null, pv?.to_ts ?? null,
        pv?.ride_type ?? null, pv?.mode ?? null, now),
  ])
  if (uid) {
    await env.KV.put(`push:bekleyen:izsiz_${rid.split('/').join('_')}_${now}`,
      JSON.stringify({ user: uid, title: 'Video oluşturulamadı', body: sebep, ts: now }),
      { expirationTtl: 7 * 86400 })
  }
  await env.KV.put(`dispatch:izsiz:${rid}`, JSON.stringify({ t: now, uid }), { expirationTtl: 7 * 86400 })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url)
    if (u.pathname === '/health') {
      const son = await env.KV.get('dispatch:son').catch(() => null)
      return Response.json({
        ok: true, worker: 'movelog-dispatch', ortam: env.ORTAM,
        son: son && JSON.parse(son),
      })
    }
    // Test/gölge beslemesi: sırla korunur; api worker'ı Faz 2'de doğrudan RENDER_Q producer kullanacak.
    if (u.pathname === '/internal/enqueue' && req.method === 'POST') {
      if (req.headers.get('x-dispatch-secret') !== env.DISPATCH_SECRET) return new Response('yetkisiz', { status: 403 })
      const job = (await req.json()) as Job
      if (!job.ride_id) return Response.json({ ok: false, err: 'ride_id şart' }, { status: 400 })
      await env.RENDER_Q.send(job)
      return Response.json({ ok: true, queued: job.ride_id })
    }
    return new Response('not found', { status: 404 })
  },
  async queue(batch: MessageBatch<Job>, env: Env): Promise<void> {
    for (const m of batch.messages) {
      const rid = String(m.body?.ride_id ?? m.body?.vid ?? '?')
      // GÖLGE KORUMASI (2026-08-30, cron dolumu): 'golge:' önekli iş RunPod'a GİTMEZ — MUTLAK KURAL
      // (bakiye korunur; movelog-cron ORTAM=golge iken her işi bu önekle kuyruklar). KV izi bırak + ack.
      if (rid.startsWith('golge:') || env.ORTAM === 'golge') {
        await env.KV.put(`dispatch:golge:${rid}`,
          JSON.stringify({ t: simdi(), mode: m.body?.mode ?? null, kaynak: m.body?.kaynak ?? null }),
          { expirationTtl: 86400 })
        m.ack()
        continue
      }
      // 🔴 FİKS 04.09 — ÖZET İŞLERİ BURAYA AİT DEĞİL (para sızıntısı kapatıldı).
      // `POST /api/summary/now` yıllardır kuyruğa `{type:'summary'}` atıyordu ama burada `type`
      // hiç okunmuyordu: ride_id yok → isiHazirla `"_0"` üretiyor, `izsiz()` de `from>0` şartı
      // yüzünden false kalıyor → mesaj GERÇEK BİR RunPod GPU işi olarak gönderiliyor, RunPod 200
      // diyor, ack'leniyor ve iş sessizce buharlaşıyor. Kullanıcı özet alamıyor, bakiye eriyor.
      // Özet üretimi cron/gorevler/activity-detect.ts'te (KV `summaryreq:`); API artık oraya yazıyor.
      // Bu dal, YOLDA KALMIŞ eski kuyruk mesajları ve güncellenmemiş istemciler için köprü:
      // isteği doğru kapıya çevirip ack'liyor — RunPod'a HİÇBİR ŞEY gitmiyor.
      const tur = String(m.body?.type ?? '')
      if (tur === 'summary' || tur === 'range') {
        const kul = String((m.body as Record<string, unknown>)?.user ?? '')
        if (kul) {
          const b = m.body as Record<string, unknown>
          // ⚠️ ARALIK isteğinde from/to TAŞINMALI. Taşınmazsa tüketici (activity-detect) BUGÜNÜN
          // özetini üretir → kullanıcı 12 Ağustos aralığı isteyip bugünün özetini alır. Eskiden bu
          // mesaj sessizce buharlaşıyordu; köprü onu "yanlış cevap"a çevirmemeli.
          const kayit: Record<string, unknown> = { user: kul, ts: simdi(), kaynak: 'kuyruk-koprusu', tur }
          if (tur === 'range') {
            kayit.from = Math.trunc(Number(b?.from ?? 0)) || 0
            kayit.to = Math.trunc(Number(b?.to ?? 0)) || 0
          }
          await env.KV.put(`summaryreq:${kul}_${simdi()}`, JSON.stringify(kayit), { expirationTtl: 2 * 3600 })
        }
        await env.KV.put(`dispatch:ozet:${kul || '?'}_${simdi()}`,
          JSON.stringify({ t: simdi(), tur, yonlendirildi: !!kul }), { expirationTtl: 86400 })
        m.ack()
        continue
      }
      // 🔴 FİKS 05.09 — GÜNLÜK GPU HARCAMA TAVANI (uçtan uca tarama, "harcama tavanı yok").
      // Öncesi: `grup1.ts` bütçe kapısı YALNIZ kullanıcı-tetikli istekte çalışıyordu ve orada da
      // DAILY_*_CAP=0, flat maliyeti 0.0, admin tamamen muaftı; cron/bekçi yollarında ise
      // `bumpDailyCap` HİÇ çağrılmıyordu. Yani otomatik üretim, retry döngüleri ve bekçiler
      // sınırsızdı. Burası tüm yolların ORTAK darboğazı: her GPU işi bu kapıdan geçer.
      // Tavan KV `gpu-gunluk-limit-usd` ile deploy'suz değiştirilebilir (0 = kapalı).
      const kapi = await butceKapisi(env, m.body, rid)
      if (!kapi.ok) {
        // İş KAYBOLMUYOR: gövde park edilir, tavan sıfırlanınca (ertesi gün / ay) yeniden gönderilebilir.
        const parkSebep = kapi.tur === 'aylik' ? 'butce-aylik' : 'butce-gunluk'
        await parkEt(env, rid, m.body, parkSebep, { harcanan: kapi.harcanan, limit: kapi.limit })
        await env.KV.put(`dispatch:butce:${rid}`,
          JSON.stringify({ t: simdi(), harcanan: kapi.harcanan, limit: kapi.limit, tur: kapi.tur }), { expirationTtl: PARK_TTL })
        // 🔴 FİKS 05.09: burada `pending_videos` TEMİZLENMİYORDU → kullanıcı SONSUZ "Hazırlanıyor"
        // görürdü (aynı tuzak 4 satır aşağıda `izsiz` yolu için zaten biliniyordu). Tavan ne
        // kadar sıkılaşırsa bu yol o kadar sık tetiklenir; kilit açılmadan tavan düşürülemez.
        // 🔴 FİKS 14.09: oto işte de bütçe mesajını push et — ama kullanıcı başına dönem başına
        // EN FAZLA 1 KEZ (KV bildirim:butce:{uid}:aylik|gunluk:…). Manuel işte davranış aynı.
        const jb = (m.body ?? {}) as Record<string, unknown>
        const sebepTr = kapi.tur === 'aylik'
          ? 'Bu ayki video payın doldu. Ayın 1\'inde sıfırlanır.'
          : 'Günlük üretim kapasitesi doldu, yarın tekrar dene.'
        const push = await butceKullaniciBildir(env, String(jb.user ?? ''), !!jb.oto, kapi.tur)
        await isiBitir(env, jb as Job, rid, sebepTr, 'butce', push.bildir, push.govde, push.baslik)
        await bildirimYaz(env,
          (kapi.tur === 'aylik'
            ? `💸 Kullanıcının AYLIK GPU bütçesi doldu ($${kapi.harcanan.toFixed(2)}/$${kapi.limit.toFixed(2)}). `
            : `💸 GPU GÜNLÜK harcama tavanı doldu ($${kapi.harcanan.toFixed(2)}/$${kapi.limit.toFixed(2)}). `) +
          `İş park edildi, RunPod'a GÖNDERİLMEDİ: ${rid.slice(0, 40)}`)
        m.ack()
        continue
      }
      try {
        const is = await isiHazirla(env, m.body)
        // BOŞ İZ = KESİN BAŞARISIZLIK (01.09 Semra vakası): RunPod 200 döner, iş sessizce ölür,
        // pending_videos temizlenmez → kullanıcı sonsuz "Hazırlanıyor" görürdü. Göndermeden bitir.
        if (izsiz(is)) {
          await izsizBitir(env, is, rid)
          m.ack()
          continue
        }
        const motor = await motorSec(env)
        let r: { ok: boolean; status: number; body: string }
        switch (motor) {
          case 'modal':
            r = await modalGonder(env, is)
            break
          case 'runpod':
            r = await runpodGonder(env, is)
            break
          default: {
            const _eksik: never = motor
            throw new Error(`bilinmeyen motor: ${_eksik}`)
          }
        }
        await env.KV.put('dispatch:son',
          JSON.stringify({ rid, status: r.status, motor, t: simdi() }))
        if (r.ok) { m.ack(); continue }
        // 402 = bakiye yok -> retry İSRAF, bekçi/bakiye düzelince yeniden kuyruklanır; kalıcı kaydet
        if (r.status === 402) {
          await parkEt(env, rid, m.body, 'bakiye')
          m.ack()
          continue
        }
        // 409/429/5xx vb: GECİKMELİ retry (02.09 Barış onayı). Gecikmesiz retry 3 hakkı saniyeler içinde
        // yakıp işi DLQ'ya (movelog-render-olu) düşürüyordu — ör. 409 ENDPOINT_PAUSED penceresi 30-70 sn.
        // 45 s × deneme (45/90/135) → ~4.5 dk'lık arıza tolere edilir; sonra DLQ + pending-reconcile.
        m.retry({ delaySeconds: Math.min(45 * Math.max(1, m.attempts), 300) })
      } catch {
        m.retry({ delaySeconds: Math.min(45 * Math.max(1, m.attempts), 300) })
      }
    }
  },
}
