// video-kontrol — movelog-video-kontrol.py (205 satır) portu. 6 saatte bir (saat%6==0 UTC).
// Son 48 saatin en yeni 5 videosunu KULLANICI GİBİ sınar: R2 boyut/Content-Type, teslim ucundan
// kullanıcının kendi JWT'siyle Range GET (JWT_SECRET+API_UC varsa), ftyp+moov bayt kontrolü.
// TAŞINMAYAN: ffprobe adımı (Worker'da subprocess yok — bayt kontrolü yeterli sinyal, GOREVLER.md).
import type { GorevCtx } from '../takvim'
import type { Env } from '../env'
import { bildirimBekleyen, gorunenAd, kvJson, kvJsonYaz, simdi } from '../lib'

const KAC = 5, SAAT = 48, SESSIZ = 12, MIN_MB = 0.3

type Durum = { sonbildirim: Record<string, number>; temiz_tur: number }

function sessizde(st: Durum, konu: string): boolean {
  if (simdi() - (st.sonbildirim[konu] || 0) < SESSIZ * 3600) return true
  st.sonbildirim[konu] = simdi()
  return false
}

function b64u(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** main.py make_jwt eşleniği (HS256; tv D1'den) — teslim yolunu kullanıcının gördüğü gibi sınamak için. */
async function makeJwt(env: Env, user: string): Promise<string> {
  const enc = new TextEncoder()
  const tvRow = await env.DB.prepare('SELECT tv FROM users WHERE uid = ?1').bind(user).first<{ tv: number | null }>()
  const h = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const p = b64u(enc.encode(JSON.stringify({ sub: user, exp: simdi() + 3600, tv: Math.trunc(Number(tvRow?.tv ?? 0)) })))
  const key = await crypto.subtle.importKey('raw', enc.encode(env.JWT_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`))
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`
}

async function sina(c: GorevCtx, rid: string, r2Key: string, user: string): Promise<string[]> {
  const { env } = c
  const sorun: string[] = []
  // 06.09: SAĞLAM ama akışta geç açılan (faststart yok). Ayrı tutulur: bu bir BOZUKLUK değil,
  // yalnız oynatma gecikmesi. Alarm üretmez, log'a düşer — yoksa bilgi tamamen kaybolurdu.
  const yavas: string[] = []
  // 2) R2'de duruyor mu
  const h = await env.R2.head(r2Key)
  if (!h) { sorun.push('R2\'de YOK'); return sorun }
  const mb = h.size / 1048576
  if (mb < MIN_MB) sorun.push(`R2 dosyası çok küçük (${mb.toFixed(2)} MB)`)
  if (h.httpMetadata?.contentType !== 'video/mp4') sorun.push(`R2 içerik tipi yanlış: ${h.httpMetadata?.contentType}`)
  // 3) teslim ucu (kullanıcı JWT'siyle Range) — anahtar varsa; yoksa R2 baytlarıyla 4'e geç
  let ham: Uint8Array | null = null
  if (env.JWT_SECRET && env.API_UC) {
    try {
      const tk = await makeJwt(env, user)
      const rs = await fetch(`${env.API_UC}/api/rides/${rid}/video`, {
        headers: { authorization: `Bearer ${tk}`, range: 'bytes=0-262143' },
      })
      if (rs.status !== 200 && rs.status !== 206) { sorun.push(`teslim ucu HTTP ${rs.status} — kullanıcı videoyu AÇAMAZ`); return sorun }
      const ct = rs.headers.get('content-type')
      if (ct !== 'video/mp4') sorun.push(`teslim içerik tipi yanlış: ${ct}`)
      if (rs.headers.get('accept-ranges') !== 'bytes') sorun.push('Range desteklenmiyor (AVPlayer aramayı yapamaz)')
      ham = new Uint8Array(await rs.arrayBuffer())
    } catch (e) { sorun.push(`teslim ucu hata: ${String(e).slice(0, 70)}`); return sorun }
  } else {
    c.log(`  (JWT_SECRET/API_UC yok — teslim ucu atlandı, baytlar R2'den okundu: ${rid})`)
    const obj = await env.R2.get(r2Key, { range: { offset: 0, length: 262144 } })
    if (obj) ham = new Uint8Array(await obj.arrayBuffer())
  }
  // 4) gerçekten oynatılabilir mi (ftyp başta + moov ilk 256KB'de = faststart)
  if (ham) {
    const bul = (needle: string, sinir: number) => {
      const n = [...needle].map((ch) => ch.charCodeAt(0))
      const max = Math.min(ham!.length, sinir) - n.length
      for (let i = 0; i <= max; i++) {
        let ok = true
        for (let j = 0; j < n.length; j++) if (ham![i + j] !== n[j]) { ok = false; break }
        if (ok) return i
      }
      return -1
    }
    if (bul('ftyp', 64) < 0) sorun.push('mp4 başlığı (ftyp) yok — bozuk dosya')
    // 06.09: faststart eksikliği "AÇAMIYOR" değil "geç açılıyor" — ayrı, düşük şiddetli etiket.
    // Eskiden 🚨 "kullanıcı AÇAMIYOR" alarmı üretiyordu ve yanıltıcıydı (video sağlam).
    if (bul('moov', ham.length) < 0) yavas.push('akışta geç açılıyor (faststart yok)')
  }
  if (yavas.length) c.log(`  ~ ${rid}: ${yavas.join('; ')} (bozukluk DEĞİL, alarm üretilmedi)`)
  return sorun
}

/**
 * 🔴 05.09 — HAKEM ÖRNEK İÇERİĞİ NÖBETÇİSİ.
 * App Store inceleme notu "rotaya dokun ve oynat, bitmiş video akar" diyor ve bu, kendi rotası
 * olmayan HER kullanıcının gördüğü örnek içerik (grup7.listRides → etkinSahip → ORNEK_UID).
 * ÖLÇÜLDÜ (05.09, uygulama incelemedeyken): `appreview` hesabında 5 rota vardı ama **0 video** —
 * `videos/` önekinin 7 günlük R2 lifecycle kuralı örnek videoları silmiş, ardından `d1-tutarlilik`
 * D1 satırlarını da temizlemişti. Hakem notu takip etse boş ekran görecekti = ret sebebi.
 * Kalıcı çözüm: örnek video artık kuralsız `ornek/` önekinde duruyor. Bu nöbetçi, bir şekilde
 * yine kaybolursa (elle silme, yanlış anahtar, yeni kural) SESSİZ KALMASIN diye var.
 */
async function ornekIcerikKontrol(c: GorevCtx): Promise<void> {
  const { env, log } = c
  try {
    const r = await env.DB.prepare(
      "SELECT rid, r2_key FROM videos WHERE uid = 'appreview' AND rid NOT IN (SELECT rid FROM deleted_rides)")
      .all<{ rid: string; r2_key: string | null }>()
    let saglam = 0
    for (const v of r.results) {
      if (!v.r2_key) continue
      if (await env.R2.head(v.r2_key)) saglam++
      else log(`⚠️ örnek video R2'de YOK: ${v.rid} (${v.r2_key})`)
    }
    if (saglam > 0) { log(`örnek içerik sağlam (${saglam} oynatılabilir video)`); return }
    await bildirimBekleyen(env,
      '🚨 APP STORE ÖRNEK İÇERİĞİ KAYIP: `appreview` hesabında oynatılabilir video KALMADI. ' +
      'İnceleme notu "rotaya dokun ve oynat" diyor — bir sonraki sürüm bu yüzden REDDEDİLİR. ' +
      'Çözüm: appreview rotası için video üret ve r2_key\'i kuralsız `ornek/` önekine al.',
      'Move Log İnceleme')
    log('🚨 örnek içerik KAYIP — bildirim kuyruğa atıldı')
  } catch (e) {
    log('örnek içerik kontrolü hata: ' + String(e).slice(0, 120))
  }
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  await ornekIcerikKontrol(c)
  const st = await kvJson<Durum>(env, 'bekci:video-kontrol', { sonbildirim: {}, temiz_tur: 0 })
  const yeni = await env.DB.prepare(
    'SELECT rid, uid, r2_key, done_at FROM videos WHERE done_at > ?1 ORDER BY done_at DESC LIMIT ?2')
    .bind(now - SAAT * 3600, KAC).all<{ rid: string; uid: string | null; r2_key: string | null; done_at: number }>()
  if (!yeni.results.length) { log('sınanacak taze video yok'); return }
  const bozuk: { rid: string; uid: string; sorun: string[] }[] = []
  for (const v of yeni.results) {
    if (!v.r2_key) continue
    const s = await sina(c, v.rid, v.r2_key, v.uid || '')
    if (s.length) bozuk.push({ rid: v.rid, uid: v.uid || '?', sorun: s })
  }
  if (bozuk.length) {
    const satirlar: string[] = []
    for (const b of bozuk.slice(0, 4)) {
      const p = await env.DB.prepare('SELECT uid, name, handle FROM users WHERE uid = ?1').bind(b.uid)
        .first<{ uid: string; name: string | null; handle: string | null }>()
      satirlar.push(`• ${p ? gorunenAd(p) : b.uid.slice(0, 10)} / ${b.rid.slice(0, 24)}: ${b.sorun.slice(0, 2).join('; ')}`)
    }
    if (!sessizde(st, 'bozuk-video')) {
      await bildirimBekleyen(env,
        '🚨 VİDEO TESLİM SORUNU — üretildi ama kullanıcı AÇAMIYOR:\n' + satirlar.join('\n') +
        `\n(${bozuk.length}/${yeni.results.length} son video bozuk)`, 'Move Log Video')
    }
    st.temiz_tur = 0
    log(`${bozuk.length}/${yeni.results.length} bozuk`)
  } else {
    st.temiz_tur = (st.temiz_tur || 0) + 1
    log(`temiz tur #${st.temiz_tur} (${yeni.results.length} video sınandı)`)
  }
  await kvJsonYaz(env, 'bekci:video-kontrol', st)
}
