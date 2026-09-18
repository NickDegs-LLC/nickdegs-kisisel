import { izSuz } from '../../ortak/src/izsuzgec'
import { aylikButceLimit, butcePushBaslik, butcePushGovde, modMaliyet, trGunu } from '../../ortak/src/maliyet'

export type Env = {
  DB: D1Database; KV: KVNamespace; R2: R2Bucket; RENDER_Q: Queue; ORTAM: string
  RUNPOD_API_KEY: string; RUNPOD_ENDPOINT: string; DISPATCH_SECRET: string
  // MODAL DALI (2026-09-07): motor seçimi KV `dispatch:motor` bayrağında ('runpod' | 'modal').
  // Bayrak KV'de olduğu için GERİ DÖNÜŞ YENİDEN DAĞITIM İSTEMEZ.
  // TAKTİK override (2026-09-14): `dispatch:motor-tac` doluysa yalnız taktik hattı onu izler.
  MODAL_SECRET?: string
  // TAKTİK DALI (2026-08-30): ayrı CPU endpoint'i + presigned R2 PUT için S3 kimlikleri.
  RUNPOD_ENDPOINT_TAC?: string
  R2_ENDPOINT?: string; R2_ACCESS_KEY_ID?: string; R2_SECRET_ACCESS_KEY?: string; R2_BUCKET?: string
}

// movelog-dispatch — Queue tüketicisi → RunPod /run (movelog-cloud.py'nin CF karşılığı).
// Mesaj gövdesi = rp_handler'ın beklediği job (day/from/to/mode/aspect/speed/track/ride_id/camdist/
// cam/type/user/name/line/dot/music/reel/ultra/kabartma/lang/premium/matched). Ön-eşleme (matching)
// GEÇİŞ KARARINA kadar motora bırakılır (matched göndermiyoruz -> motor kendi map-match'ini yapar;
// plan v2 Faz 1 notu). Başarısızlıkta Queue retry (max 3) + KV'ye son hata.
//
// İKİ DAL (motor KV `dispatch:motor` / isteğe bağlı `dispatch:motor-tac`):
//   mode != 'tactical'  -> movelog-render (GPU, RunPod veya Modal)
//   mode == 'tactical'  -> movelog-tactical (CPU, RunPod veya Modal)
// Taktik motorunda R2 kimliği YOKTUR: video presigned PUT ile yüklenir (job.put_url), render-done'u
// lokal reconcile halleder (render_job.py:802 `TAC_PUT_URL` dalı).
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
// (/api/internal/render-done) 3B'de motorun KENDİSİ tarafından yapılır; taktikte
// put_url + reconcile (RunPod'daki gibi, sır konteynere girmez).
const MODAL_RUN = 'https://daclen10--movelog-render-run.modal.run'
const MODAL_TAC_RUN = 'https://daclen10--movelog-tactical-run.modal.run'

async function modalGonder(env: Env, job: Job): Promise<{ ok: boolean; status: number; body: string }> {
  if (!env.MODAL_SECRET) return { ok: false, status: 0, body: 'MODAL_SECRET yok' }
  const r = await fetch(MODAL_RUN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.MODAL_SECRET, input: job }),
  })
  return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 500) }
}

/** Hangi motor? KV bayrağı — okunamazsa RunPod (arıza ≠ sessiz motor değişimi).
 *  `dispatch:motor` ana bayrak (iki hat). `dispatch:motor-tac` doluysa yalnız
 *  taktik onu izler; boşsa taktik de ana bayrağı izler. */
async function motorSec(env: Env, dal: 'taktik' | 'render' = 'render'): Promise<'runpod' | 'modal'> {
  try {
    if (dal === 'taktik') {
      const tac = String((await env.KV.get('dispatch:motor-tac')) ?? '').replace(/"/g, '')
      if (tac === 'modal' || tac === 'runpod') return tac
    }
    const v = await env.KV.get('dispatch:motor')
    return String(v ?? '').replace(/"/g, '') === 'modal' ? 'modal' : 'runpod'
  } catch { return 'runpod' }
}

// ---------- R2 SigV4 query presign (api/src/routes/grup1.ts:221 ile aynı desen, method parametrik) ----------
const enc = new TextEncoder()
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
async function sha256Hex(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))))
}
async function hmacRaw(key: Uint8Array | ArrayBuffer, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

/** SigV4 presign. SignedHeaders=host TEK — istemcinin gönderdiği Content-Type imzaya girmez
 *  (render_job.py:808 `Content-Type: video/mp4` yollar; imzasız başlık R2'de serbest). */
async function r2Presign(env: Env, key: string, method: 'GET' | 'PUT', secs: number): Promise<string | null> {
  const ep = env.R2_ENDPOINT, ak = env.R2_ACCESS_KEY_ID, sk = env.R2_SECRET_ACCESS_KEY
  const bucket = env.R2_BUCKET || 'movelog'
  if (!ep || !ak || !sk || !key) return null
  try {
    const u = new URL(ep)
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
    const dateStamp = amzDate.slice(0, 8)
    const scope = `${dateStamp}/auto/s3/aws4_request`
    const path = `/${bucket}/` + key.split('/').map(rfc3986).join('/')
    const q = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${ak}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(secs)],
      ['X-Amz-SignedHeaders', 'host'],
    ].map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).sort().join('&')
    const canonical = [method, path, q, `host:${u.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
    const sts = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n')
    let k = await hmacRaw(enc.encode('AWS4' + sk), dateStamp)
    for (const parca of ['auto', 's3', 'aws4_request']) k = await hmacRaw(k, parca)
    const sig = hex(await hmacRaw(k, sts))
    return `${u.origin}${path}?${q}&X-Amz-Signature=${sig}`
  } catch {
    return null
  }
}

// ---------- TAKTİK DALI ----------
/** movelog-cloud.py:489 kuralı: taktik ASLA 16:9 olmaz (dikey tasarım) -> geçersizse 9:16. */
function taktikAspect(a: unknown): string {
  return a === '4:5' || a === '9:16' ? (a as string) : '9:16'
}

/** tac_dispatch.py:90-93 kuralı: kullanıcı müziği ('lib:<id>' | 'active' | 'upload') bulut render'da
 *  ÇEKİLEMEZ (motor `/api/internal/music` + RENDER_DONE_SECRET ister; RunPod'da sır YOK) -> sessizce
 *  RASTGELE müziğe düşerdi (Barış'ın 2026-08-03 şikâyeti). Bu işler RunPod'a GÖNDERİLMEZ. */
function ozelMuzik(m: unknown): boolean {
  const s = String(m ?? '').trim()
  return s.startsWith('lib:') || s === 'active' || s === 'upload'
}

type TaktikErteleme = { ok: false; status: number; body: string; erteleme: string }
type TaktikGirdi = { ok: true; input: Job }

/** grup3.ts:903-916 çözümlemesinin birebir aynısı (öncelik: active → lib → upload+session → stock).
 *  user sanitizasyonu path traversal koruması (grup3.ts:899). Anahtar yoksa null —
 *  music_url konmaz, mühürlü kod stok müziğe düşer. */
function muzikAnahtari(job: Job): string | null {
  const user = String(job.user ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  if (!user) return null
  const ref = String(job.music ?? '').trim()
  const session = Math.trunc(Number(job.from ?? 0))
  if (ref === '' || ref === 'active') return `usermusic/${user}/active.m4a`
  if (ref.startsWith('lib:')) {
    const mid = ref.slice(4).replace(/[^A-Za-z0-9]/g, '')
    return mid ? `usermusic/${user}/${mid}.m4a` : null
  }
  if (ref === 'upload' && session) return `ridephotos/${user}_${session}/music.m4a`
  if (ref.startsWith('stock:')) {
    const ad = ref.slice(6).replace(/[^A-Za-z0-9]/g, '')
    return ad ? `stockmusic/${ad}.m4a` : null
  }
  return null
}

/** Müzik presign hatası ASLA işi düşürmez (avatar ile aynı). R2'de yoksa alan konmaz. */
async function muzikPresign(env: Env, job: Job): Promise<string | undefined> {
  try {
    const key = muzikAnahtari(job)
    if (!key) return undefined
    if (!(await env.R2.head(key))) return undefined
    return (await r2Presign(env, key, 'GET', 4 * 3600)) ?? undefined
  } catch {
    return undefined
  }
}

async function taktikGirdiHazirla(
  env: Env, job: Job, rid: string,
): Promise<TaktikGirdi | TaktikErteleme> {
  // ALAN ÖN-DENETİMİ — render_job.py:211 `job["vid"]`/`job["user"]` ile KeyError atar, :223 track
  // yoksa `fetch_track` (Traccar + kimlik) dener; bulutta ikisi de YOK. Eksik işi göndermek
  // = kesin başarısız render + boşa worker parası. Önce burada yakala.
  if (!job.user) return { ok: false, status: 0, body: 'user alanı yok', erteleme: 'user-yok' }
  if (!Array.isArray(job.track) || job.track.length === 0) {
    return { ok: false, status: 0, body: 'track boş/yok (bulut Traccar\'a erişemez)', erteleme: 'track-yok' }
  }

  const vid = String(job.vid ?? job.ride_id ?? rid)
  const put_url = await r2Presign(env, `videos/${vid}.mp4`, 'PUT', 4 * 3600)
  if (!put_url) return { ok: false, status: 0, body: 'presign başarısız (R2 kimliği?)', erteleme: 'presign-yok' }

  // Avatar: R2'de varsa presigned GET (rp_handler_tac indirip job['avatar']'a yerel yol yazar;
  // render_job.py:339 job.get('avatar') ÖNCELİKLİ). Yoksa alan hiç konmaz -> bugünkü bulut
  // davranışı (silüet) korunur. `_scp` zaten TAC_PUT_URL varken erken döner.
  let avatar_url: string | undefined
  const user = String(job.user ?? '')
  if (user) {
    try {
      if (await env.R2.head(`avatars/${user}.jpg`)) {
        avatar_url = (await r2Presign(env, `avatars/${user}.jpg`, 'GET', 4 * 3600)) ?? undefined
      }
    } catch { /* avatar opsiyonel — asla işi düşürmez */ }
  }

  const input: Job = { ...job, vid, aspect: taktikAspect(job.aspect), put_url }
  if (avatar_url) input.avatar_url = avatar_url
  return { ok: true, input }
}

async function taktikGonder(
  env: Env, job: Job, rid: string,
): Promise<{ ok: boolean; status: number; body: string; erteleme?: string }> {
  if (!env.RUNPOD_ENDPOINT_TAC) return { ok: false, status: 0, body: 'RUNPOD_ENDPOINT_TAC yok', erteleme: 'endpoint-yok' }
  if (ozelMuzik(job.music)) return { ok: false, status: 0, body: `özel müzik (${job.music})`, erteleme: 'ozel-muzik' }
  const g = await taktikGirdiHazirla(env, job, rid)
  if (!g.ok) return g

  const r = await fetch(`https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_TAC}/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RUNPOD_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input: g.input }),
  })
  return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 500) }
}

async function taktikModalGonder(
  env: Env, job: Job, rid: string,
): Promise<{ ok: boolean; status: number; body: string; erteleme?: string }> {
  if (!env.MODAL_SECRET) return { ok: false, status: 0, body: 'MODAL_SECRET yok', erteleme: 'secret-yok' }
  const g = await taktikGirdiHazirla(env, job, rid)
  if (!g.ok) return g

  const input: Job = { ...g.input }
  // ozelMuzik burada İŞİ DÜŞÜRMEZ — presigned GET üret, yoksa alan konmaz (stok müziğe düşer).
  const music_url = await muzikPresign(env, job)
  if (music_url) input.music_url = music_url

  const r = await fetch(MODAL_TAC_RUN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.MODAL_SECRET, input }),
  })
  return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 500) }
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
        taktik: { endpoint: env.RUNPOD_ENDPOINT_TAC ? 'var' : 'yok', presign: env.R2_ENDPOINT ? 'var' : 'yok' },
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
      const taktik = m.body?.mode === 'tactical' || m.body?.tur === 'taktik'
      // 🔴 FİKS 05.09 — GÜNLÜK GPU HARCAMA TAVANI (uçtan uca tarama, "harcama tavanı yok").
      // Öncesi: `grup1.ts` bütçe kapısı YALNIZ kullanıcı-tetikli istekte çalışıyordu ve orada da
      // DAILY_*_CAP=0, flat maliyeti 0.0, admin tamamen muaftı; cron/bekçi yollarında ise
      // `bumpDailyCap` HİÇ çağrılmıyordu. Yani otomatik üretim, retry döngüleri ve bekçiler
      // sınırsızdı. Burası tüm yolların ORTAK darboğazı: her GPU işi bu kapıdan geçer.
      // Tavan KV `gpu-gunluk-limit-usd` ile deploy'suz değiştirilebilir (0 = kapalı).
      if (!taktik) {
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
        const motor = await motorSec(env, taktik ? 'taktik' : 'render')
        let r: { ok: boolean; status: number; body: string; erteleme?: string }
        switch (motor) {
          case 'modal':
            r = taktik ? await taktikModalGonder(env, is, rid) : await modalGonder(env, is)
            break
          case 'runpod':
            r = taktik ? await taktikGonder(env, is, rid) : await runpodGonder(env, is)
            break
          default: {
            const _eksik: never = motor
            throw new Error(`bilinmeyen motor: ${_eksik}`)
          }
        }
        await env.KV.put('dispatch:son',
          JSON.stringify({ rid, status: r.status, dal: taktik ? 'taktik' : 'render', motor, t: simdi() }))
        if (r.ok) { m.ack(); continue }
        // Taktik ertelemeleri (yapılandırma eksik / özel müzik / presign yok): retry İŞE YARAMAZ.
        // İş KAYBOLMASIN -> gövdeyi KV'ye al + ack. Sebep ayrı anahtarda görünür.
        if (taktik && (r as { erteleme?: string }).erteleme) {
          const sebep = (r as { erteleme?: string }).erteleme || 'endpoint-yok'
          await parkEt(env, rid, m.body, sebep, { not: r.body })
          // UYUMLULUK: eski bekçi `dispatch:taktik:ertelendi` okuyor — yazılmaya devam.
          await env.KV.put(`dispatch:taktik:ertelendi:${rid}`,
            JSON.stringify({ t: simdi(), sebep, not: r.body }), { expirationTtl: PARK_TTL })
          m.ack()
          continue
        }
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
