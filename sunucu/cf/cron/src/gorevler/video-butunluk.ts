// video-butunluk — R2'deki son videoların BÜTÜNLÜĞÜ + bozuk olanı YENİDEN ÜRETİME sokma.
// Faz T, 2026-08-31. 3 saatte bir (saat%3==0 UTC).
//
// FARKI (video-kontrol ile karışmasın):
//   · video-kontrol  = KULLANICI GİBİ TESLİM testi (JWT + Range GET + bildirim). Onarım YOK.
//   · video-butunluk = R2 BAYT bütünlüğü + ONARIM: bozuksa aynı rotayı yeniden kuyruğa alır ve
//     kullanıcıya "Hazırlanıyor" gösterecek pending_videos satırını açar.
//
// SINAMA (movelog-video-kontrol.py'nin bayt ayağı, ffprobe'suz — Worker'da subprocess yok):
//   R2 head yok / boyut < 0.3 MB / Content-Type != video/mp4 / ilk 64 baytta 'ftyp' yok /
//   ilk 256 KB'de 'moov' yok (faststart yok → akışta açılmaz).
// SAĞLAM çıkanlar KV'ye 7 gün işaretlenir → her tur baştan indirilmez (maliyet ~0).
//
// ONARIM İZİ: iş RENDER_Q'ya bırakılır (ORTAM=golge iken lib.renderKuyruk 'golge:' önekler → RunPod'a
// GİTMEZ). İz D1 positions'tan kurulur (Traccar'a ihtiyaç YOK — CF-yerli yol). İz 3 noktadan azsa
// yeniden üretim YAPILMAZ, bildirim yazılır. Aynı rid için en fazla 2 deneme.
import type { GorevCtx } from '../takvim'
import type { Env } from '../env'
import { jsonParse, kvJson, kvJsonYaz, renderKuyruk, simdi, trGun } from '../lib'
import { bildir, olayYaz, onar, saglamOlay } from './bekci-ortak'

const BEKCI = 'video-butunluk'
const KAC = 6                 // her turda en fazla bu kadar taze video sınanır
const GUN = 14                // bu kadar günlük pencere
const MIN_MB = 0.3
const MAX_DENEME = 2
// 🔴 06.09 — FASTSTART "BOZUK" DEĞİLDİR. iOS AVAssetWriter `moov` atomunu dosyanın SONUNA yazar;
// video TAMAMEN SAĞLAMDIR, sadece akışta geç açılır. Bu bekçi onu bozuk sayıp bulutta YENİDEN
// ÜRETTİRİYORDU. ÖLÇÜLDÜ: 2026-09-05_1788598167_1788613246 (telefon çıktısı) için 2 adet 3B
// yeniden üretim (~$0,76) + 2026-09-03 telefon videosu için 2 flyover (~$0,10) = ~$0,86 boşa gitti.
// Üstelik telefonun BEDAVA ürettiği bir videoyu PARALI bulut render'ıyla "onarmak" ters bir takas.
// Artık: tek sorun faststart ise yeniden üretim YOK, kalıcı işaret + tek seferlik bilgi notu.
// (Kaynak fiks 1.65'te: AVAssetWriter.shouldOptimizeForNetworkUse = true.)
const FASTSTART_SORUNU = 'moov ilk 256KB\'de yok (faststart yok) — akışta açılmaz'
const yalnizcaFaststart = (sorun: string[]): boolean =>
  sorun.length > 0 && sorun.every((x) => x === FASTSTART_SORUNU)

type VideoRow = {
  rid: string; uid: string | null; r2_key: string | null; date: string | null
  ts: number; to_ts: number; ride_type: string | null; mode: string | null
  speed: string | null; aspect: string | null; size: number | null; done_at: number | null
}

function bayttaBul(ham: Uint8Array, needle: string, sinir: number): number {
  const n = [...needle].map((ch) => ch.charCodeAt(0))
  const max = Math.min(ham.length, sinir) - n.length
  for (let i = 0; i <= max; i++) {
    let ok = true
    for (let j = 0; j < n.length; j++) if (ham[i + j] !== n[j]) { ok = false; break }
    if (ok) return i
  }
  return -1
}

async function sina(env: Env, v: VideoRow): Promise<string[]> {
  const sorun: string[] = []
  const key = v.r2_key || ''
  if (!key) return ['videos.r2_key BOŞ']
  const h = await env.R2.head(key)
  if (!h) return ["R2'de YOK"]
  const mb = h.size / 1048576
  if (mb < MIN_MB) sorun.push(`dosya çok küçük (${mb.toFixed(2)} MB)`)
  if (h.httpMetadata?.contentType && h.httpMetadata.contentType !== 'video/mp4') {
    sorun.push(`içerik tipi yanlış: ${h.httpMetadata.contentType}`)
  }
  const obj = await env.R2.get(key, { range: { offset: 0, length: 262144 } })
  if (!obj) return [...sorun, 'baytlar okunamadı (head var, get yok)']
  const ham = new Uint8Array(await obj.arrayBuffer())
  if (bayttaBul(ham, 'ftyp', 64) < 0) sorun.push('mp4 başlığı (ftyp) yok — bozuk dosya')
  if (bayttaBul(ham, 'moov', ham.length) < 0) sorun.push(FASTSTART_SORUNU)
  return sorun
}

/** Bozuk videoyu D1'den yeniden kurup kuyruğa bırak. Dönen: null = kurulamadı (sebep string). */
async function yenidenUret(c: GorevCtx, v: VideoRow): Promise<{ vid: string; nokta: number } | string> {
  const { env } = c
  const uid = v.uid || ''
  if (!uid) return 'videos.uid boş'
  const prof = await env.DB.prepare(
    'SELECT uid, name, handle, lang, tracker_id, premium, prefs_json FROM users WHERE uid = ?1')
    .bind(uid).first<{ uid: string; name: string | null; handle: string | null; lang: string | null; tracker_id: string | null; premium: number | null; prefs_json: string | null }>()
  if (!prof) return 'kullanıcı kaydı yok'
  const dev = prof.tracker_id || ''
  if (!dev) return 'kullanıcının tracker_id\'si yok'
  const frm = Math.trunc(v.ts)
  const to = Math.trunc(v.to_ts || v.ts + 2 * 3600)
  const pos = await env.DB.prepare(
    'SELECT ts, lat, lon, alt, spd FROM positions WHERE device = ?1 AND ts >= ?2 AND ts <= ?3 ORDER BY ts')
    .bind(dev, frm, to).all<{ ts: number; lat: number; lon: number; alt: number | null; spd: number | null }>()
  const track = pos.results.map((p) => ({
    t: p.ts, lat: p.lat, lon: p.lon,
    spd: Math.round((p.spd ?? 0) * 1.852 * 10) / 10,   // knot → km/h (activity-detect ile aynı çarpan)
    alt: p.alt ?? 0,
  }))
  if (track.length < 3) return `D1 positions'ta iz yok (${track.length} nokta)`

  const now = simdi()
  const day = v.date || trGun(frm)
  const vid = `${day}_${frm}_${now}`                                  // main.py:2707 ile aynı biçim
  const prefs = jsonParse<Record<string, unknown>>(prof.prefs_json, {})
  const job: Record<string, unknown> = {
    device: dev, user: uid, name: prof.name || prof.handle || uid,
    from: frm, to, day, ride_id: vid, vid,
    type: v.ride_type || 'moto',
    mode: v.mode || 'flyover',
    speed: v.speed || 'medium',
    aspect: v.aspect || '16:9',
    premium: true, ultra: true, ts: now,        // motor sözleşmesi: en iyi karo kaynağı
    oto: true,                     // 05.09: onarım da GPU parası harcar → aylık bütçeye işlenir

    lang: prof.lang || 'en',
    line: (prefs.video_line as string) || '', dot: (prefs.video_dot as string) || '',
    kabartma: false,                                                  // MÜHÜRLÜ (2026-08-11)
    track,
    kaynak_rid: v.rid,                                                // hangi bozuk videonun yerine
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR REPLACE INTO pending_videos (vid, uid, date, ts, to_ts, ride_type, mode, queued_at, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?8)`)
      .bind(vid, uid, day, frm, to, v.ride_type ?? null, v.mode ?? null, now),
    env.DB.prepare('DELETE FROM failed_videos WHERE vid = ?1').bind(vid),
  ])
  await renderKuyruk(env, job, 'video-butunluk:yeniden')
  return { vid, nokta: track.length }
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const r = await env.DB.prepare(
    `SELECT rid, uid, r2_key, date, ts, to_ts, ride_type, mode, speed, aspect, size, done_at
     FROM videos WHERE COALESCE(done_at, 0) > ?1 ORDER BY done_at DESC LIMIT 40`)
    .bind(now - GUN * 86400).all<VideoRow>()
  const adaylar: VideoRow[] = []
  for (const v of r.results) {
    if (adaylar.length >= KAC) break
    if ((await env.KV.get(`bekci:butunluk:ok:${v.rid}`)) !== null) continue   // 7 gün içinde sağlam görüldü
    adaylar.push(v)
  }
  if (!adaylar.length) {
    log(`sınanacak yeni video yok (${r.results.length} taze video, hepsi işaretli)`)
    await saglamOlay(env, BEKCI, 'butunluk-temiz', { taze: r.results.length, sinanan: 0 })
    return
  }

  let bozuk = 0, saglam = 0
  for (const v of adaylar) {
    const sorun = await sina(env, v)
    if (!sorun.length) {
      saglam++
      await kvJsonYaz(env, `bekci:butunluk:ok:${v.rid}`, now, 7 * 86400)
      log(`✓ ${v.rid}`)
      continue
    }
    // Tek sorun faststart ise: video SAĞLAM, yalnız akışta geç açılıyor → GPU harcama.
    if (yalnizcaFaststart(sorun)) {
      saglam++
      await kvJsonYaz(env, `bekci:butunluk:ok:${v.rid}`, now, 30 * 86400)
      log(`~ ${v.rid}: faststart yok (video sağlam, yeniden üretim YAPILMADI)`)
      continue
    }
    bozuk++
    const deneme = await kvJson<number>(env, `bekci:butunluk:deneme:${v.rid}`, 0)
    log(`✗ ${v.rid}: ${sorun.join('; ')}`)
    if (deneme >= MAX_DENEME) {
      await olayYaz(env, {
        bekci: BEKCI, tespit: 'bozuk-video-pes', aksiyon: `${MAX_DENEME} yeniden üretim denendi, düzelmedi`,
        sonuc: 'basarisiz', detay: { rid: v.rid, uid: v.uid, sorun, deneme },
      })
      await bildir(c, {
        bekci: BEKCI, tespit: 'bozuk-video-pes-bildirim', saat: 12,
        msg: `🚨 Video ${MAX_DENEME} yeniden üretime rağmen bozuk: ${v.rid.slice(0, 34)} — ${sorun.slice(0, 2).join('; ')}`,
        detay: { rid: v.rid },
      })
      // 🔴 FİKS 05.09: pes edilen rid HER TURDA yeniden aday oluyordu (`bekci:butunluk:ok:` işareti
      // yalnız SAĞLAM videoya konuyordu) → aynı alarm sonsuza dek tekrarlıyor ve bozuk kayıt
      // kullanıcının listesinde OYNATILAMAZ hâlde duruyordu. Artık: kalıcı işaret + kartı gizle.
      await kvJsonYaz(env, `bekci:butunluk:ok:${v.rid}`, now, 30 * 86400)
      try {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO deleted_rides (rid, created_at, updated_at) VALUES (?1,?2,?2)')
          .bind(v.rid, now).run()
      } catch { /* gizlenemedi; alarm zaten yazıldı */ }
      continue
    }
    // ONARIM: kuru modda gerçekten kurmadan "yapardım" yazmak yeterli değil — iz sayısını ÖLÇÜP yazıyoruz.
    const olcum = await izOlc(env, v)
    await onar(c, {
      bekci: BEKCI, tespit: 'bozuk-video',
      aksiyon: `aynı rotayı yeniden üretime al: pending_videos + RENDER_Q (iz ${olcum} nokta, deneme ${deneme + 1}/${MAX_DENEME})`,
      detay: { rid: v.rid, uid: v.uid, sorun, iz_nokta: olcum, mode: v.mode, aspect: v.aspect },
      kuruGecit: v.rid,
      uygula: async () => {
        const s = await yenidenUret(c, v)
        if (typeof s === 'string') throw new Error(s)
        await kvJsonYaz(env, `bekci:butunluk:deneme:${v.rid}`, deneme + 1, 30 * 86400)
        await kvJsonYaz(env, `bekci:butunluk:yeni:${v.rid}`, s.vid, 30 * 86400)
        // 🔴 FİKS 05.09: onarım YENİ bir rid üretiyor ama ESKİ bozuk satır `videos`ta kalıyordu →
        // kullanıcı tek rota için 2-3 kart görüyordu (ölçüldü: 2026-09-03 rotası 3 kart).
        // Yeni video kuyruğa girdiği an eskisini gizle; onarım tutmazsa yeni kayıt hiç oluşmaz
        // ve bir sonraki tur zaten bu rid'i tekrar ele alır.
        try {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO deleted_rides (rid, created_at, updated_at) VALUES (?1,?2,?2)')
            .bind(v.rid, now).run()
        } catch { /* gizlenemedi; kopya kart kalır ama üretim sürer */ }
      },
      dogrula: async () => {
        const yeni = await kvJson<string>(env, `bekci:butunluk:yeni:${v.rid}`, '')
        return !!yeni && (await env.DB.prepare('SELECT 1 x FROM pending_videos WHERE vid = ?1').bind(yeni).first()) !== null
      },
    })
  }
  if (!bozuk) await saglamOlay(env, BEKCI, 'butunluk-sinandi', { sinanan: adaylar.length, saglam, taze: r.results.length }, 2)
  log(`sınandı ${adaylar.length}: sağlam ${saglam}, bozuk ${bozuk}`)
}

/** Yeniden üretim mümkün mü? — iz nokta sayısını ÖLÇER (kuru turda da gerçek ölçüm yazılsın diye). */
async function izOlc(env: Env, v: VideoRow): Promise<number> {
  try {
    const prof = await env.DB.prepare('SELECT tracker_id FROM users WHERE uid = ?1').bind(v.uid || '')
      .first<{ tracker_id: string | null }>()
    if (!prof?.tracker_id) return -1
    const q = await env.DB.prepare(
      'SELECT COUNT(*) n FROM positions WHERE device = ?1 AND ts >= ?2 AND ts <= ?3')
      .bind(prof.tracker_id, Math.trunc(v.ts), Math.trunc(v.to_ts || v.ts + 7200)).first<{ n: number }>()
    return Number(q?.n ?? 0)
  } catch { return -1 }
}
