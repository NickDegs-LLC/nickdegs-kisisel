// activity-detect — /opt/matrix/scripts/activity-detect.py (746 satır) TS portu.
// Traccar yerine D1 positions; register-ride doğrudan D1 (ic.registerRide); oto-video RENDER_Q
// (ORTAM=golge → 'golge:' önekli, GERÇEK RunPod işi YOK); push'lar KV push:bekleyen (kuru).
// BİLİNÇLİ TAŞINMAYANLAR: TCX→Element ayağı (kişisel; Matrix satırı bildirim:bekleyen'e düşer),
// _country_of geocoding (kaynakta da ÇAĞRILMIYOR — ölü kod), gcloud Pub/Sub yedeği (ölü yol).
// Nabız: positions tablosunda hr kolonu YOK (SEMA-NOTLARI kararı) → hr her yerde null (kaynakta da
// telefon noktalarında null'du; watch hattı Faz sonrası).
import type { GorevCtx } from '../takvim'
import type { Env } from '../env'
import {
  hav, hhmm, jsonParse, kvJson, kvJsonYaz, pushBekleyen, bildirimBekleyen, renderKuyruk,
  simdi, trGun, trGunAralik, trSaat, kvListe, ProfilRow, PROFIL_KOLON,
} from '../lib'
import { registerRide, renderDone } from '../ic'
import { izSuz } from '../../../ortak/src/izsuzgec'

// moto-config.json (2026-08-30 ölçümü) — değerler koda sabitlendi; KV 'moto-config' varsa üzerine yazar
const CFG = {
  stop_minutes: 5, stop_radius_m: 60, gap_minutes: 15, summary_hour: 21,
  act_min_dur_s: 300, act_min_m: 500, moto_min_dur_s: 120, moto_min_m: 700,
  auto_video: true, video_speed: 'medium', video_mode: 'flyover', video_aspect: '9:16',
  video_dot_color: '#ff3b30', video_line_color: '#00e5ff',
}
// 🔴 OTOMATİK VİDEO MİNİMUM MESAFESİ (Barış 05.09: "On tane video bu kadar bakiyeyse sıkıntı.
// Minimum kilometre ayarlayalım, evet."). ÖLÇÜM: 04-05.09'da 10 bulut videosu üretildi (~$3,8-7,4);
// içlerinde 0,7 km ve 1,1 km'lik rotalar vardı — 700 metrelik gezinti için tam 3B render.
// RunPod bakiyesi o an $12,77, anlık harcama $2,26/saat. Bu eşik SADECE OTOMATİK üretimi bağlar;
// kullanıcı "üret"e kendi basarsa mesafe sınırı UYGULANMAZ (bilerek istemiştir).
// KV `oto-video-min-km` ile deploy'suz ayarlanır (ör. "1.5"); yoksa varsayılan 2 km.
const OTO_MIN_KM_VARSAYILAN = 2.0
const FREN_HER = 4        // free kullanıcı bildirim freni (Barış 2026-08-12)
const FREN_MIN_GUN = 3

const TYPES: Record<string, [string, string]> = {
  walk: ['Yürüyüş', '🚶'], run: ['Koşu', '🏃'], bike: ['Bisiklet', '🚴'], moto: ['Motor', '🏍️'], car: ['Araba', '🚗'],
}

type Nokta = { t: number; lat: number; lon: number; ele: number; dop: number; spd: number }
type Akt = { s: Nokta[]; type: string; dist: number; dur: number; med: number; p85: number; mx: number; acc: number; dp90: number }

// ---------- istatistik + sınıflandırma (satır 201-238 birebir) ----------
function segStats(s: Nokta[]) {
  let dist = 0
  for (let k = 1; k < s.length; k++) dist += hav(s[k - 1], s[k])
  const dur = s[s.length - 1].t - s[0].t
  const spds = s.map((p) => p.spd).filter((v) => v > 1 && v < 160).sort((a, b) => a - b)
  const med = spds.length ? spds[Math.floor(spds.length / 2)] : 0
  const p85 = spds.length ? spds[Math.floor(spds.length * 0.85)] : 0
  const mx = spds.length ? spds[spds.length - 1] : 0
  const dops = s.map((p) => p.dop).filter((v) => v > 1 && v < 150).sort((a, b) => a - b)
  const dp90 = dops.length ? dops[Math.floor(dops.length * 0.9)] : 0
  let acc = 0
  for (let k = 1; k < s.length; k++) {
    const dt = s[k].t - s[k - 1].t
    if (dt > 0 && dt <= 8) {
      const a = ((s[k].spd - s[k - 1].spd) / 3.6) / dt
      if (a > acc) acc = a
    }
  }
  return { dist, dur, med, p85, mx, acc, dp90 }
}

function classify(med: number, p85: number, mx: number, acc: number, dp90: number, vehicle: string): string {
  const motorized = p85 >= 30 || mx >= 48 || dp90 >= 45 || acc >= 3.5
  if (motorized) {
    const v = vehicle === 'moto' || vehicle === 'car' ? vehicle : 'moto'
    if (acc >= 3.2 && mx < 90) return 'moto'
    if (mx >= 95 && acc < 2.2) return 'car'
    return v
  }
  if (med >= 14) return 'bike'
  if (med >= 8) return 'run'
  return 'walk'
}

function valid(s: Nokta[]): boolean {
  const st = segStats(s)
  if (s.length < 3 || st.p85 < 4) return false
  if (st.p85 >= 30 || st.mx >= 48 || st.dp90 >= 45 || st.acc >= 3.5) {
    return st.dur >= CFG.moto_min_dur_s && st.dist >= CFG.moto_min_m
  }
  return st.dur >= CFG.act_min_dur_s && st.dist >= CFG.act_min_m
}

/** Otomatik video için minimum rota mesafesi (km). KV `oto-video-min-km` ezebilir. */
async function otoMinKm(env: Env): Promise<number> {
  try {
    const v = await env.KV.get('oto-video-min-km')
    const n = v === null ? NaN : parseFloat(v)
    return Number.isFinite(n) && n >= 0 ? n : OTO_MIN_KM_VARSAYILAN
  } catch { return OTO_MIN_KM_VARSAYILAN }
}

// ---------- free bildirim freni (satır 58-76) — KV freepush:{uid} ----------
async function freeBildirimHakki(env: Env, user: string, log: (s: string) => void): Promise<boolean> {
  if (!user) return false
  const st = await kvJson<{ n: number; son: number }>(env, `freepush:${user}`, { n: 0, son: 0 })
  st.n += 1
  const izin = st.n % FREN_HER === 0 && simdi() - (st.son || 0) > FREN_MIN_GUN * 86400
  if (izin) st.son = simdi()
  await kvJsonYaz(env, `freepush:${user}`, st)
  log(`  · free fren: ${user.slice(0, 14)} sürüş#${st.n} -> ${izin ? 'GÖNDER' : 'sus'}`)
  return izin
}

// ---------- 13 dilli metinler (satır 270-289, 631-643, 666-681 birebir) ----------
const UT: Record<string, string> = { en: 'Ride saved 🎉', tr: 'Sürüşün kaydedildi 🎉', ar: 'تم حفظ رحلتك 🎉', es: 'Ruta guardada 🎉', fr: 'Ride enregistrée 🎉', ru: 'Поездка сохранена 🎉', de: 'Fahrt gespeichert 🎉', it: 'Giro salvato 🎉', pt: 'Rolê salvo 🎉', ja: 'ライドを保存しました🎉', zh: '骑行已保存 🎉', ko: '라이딩 저장 완료 🎉', hi: 'राइड सेव हो गई 🎉' }
const UB: Record<string, string> = {
  en: 'Remember your gift video? With Premium every ride becomes a cinematic video automatically.',
  tr: 'Hediye videonu hatırlıyor musun? Premium ile her sürüşün otomatik sinematik videoya döner.',
  ar: 'أتذكر فيديو الهدية؟ مع بريميوم يتحول كل ركوب إلى فيديو سينمائي تلقائياً.',
  es: '¿Recuerdas tu vídeo de regalo? Con Premium cada ruta se convierte en vídeo automáticamente.',
  fr: 'Tu te souviens de ta vidéo offerte ? Avec Premium chaque ride devient une vidéo automatiquement.',
  ru: 'Помнишь подарочное видео? С Premium каждая поездка автоматически становится видео.',
  de: 'Erinnerst du dich an dein Geschenkvideo? Mit Premium wird jede Fahrt automatisch zum Video.',
  it: 'Ricordi il video in regalo? Con Premium ogni giro diventa un video automaticamente.',
  pt: 'Lembra do vídeo de presente? Com o Premium cada rolê vira vídeo automaticamente.',
  ja: 'プレゼント動画を覚えていますか？プレミアムなら毎回のライドが自動で動画になります。',
  zh: '还记得你的礼物视频吗？高级版让每次骑行自动变成视频。',
  ko: '선물 영상 기억하시나요? 프리미엄은 모든 라이딩을 자동으로 영상으로 만들어요.',
  hi: 'अपना गिफ्ट वीडियो याद है? प्रीमियम हर राइड को अपने आप वीडियो बनाता है।',
}

type Prefs = Record<string, unknown>

// ---------- oto-video kuyruğu (satır 363-485 portu) ----------
async function queueCloudVideo(
  c: GorevCtx, dev: string, uid: string, prof: ProfilRow, prefs: Prefs, P: Nokta[],
  st: number, en: number, acttype: string, name: string, isSummary: boolean, forceMode?: string,
): Promise<void> {
  const { env, log } = c
  const track = P.filter((p) => st <= p.t && p.t <= en)
    .map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, spd: Math.round(p.spd * 10) / 10, alt: p.ele }))
  if (track.length < 3) { log('  → bulut: iz<3 nokta, video atlandı'); return }
  const rday = trGun(st)
  const rideId = isSummary ? `${rday}_ozet_${st}` : `${rday}_${st}`
  // 🔴 18.09 Barış: TEK KATMAN — otonom video ürünün FARKI, herkes 3B alır (Ultra kalktı).
  // Kullanıcı prefs.video_mode ile hâlâ daha ucuz bir moda inebilir; varsayılan 3B.
  const vmode = forceMode || (isSummary
    ? (prefs.summary_vid_mode as string) || CFG.video_mode
    : (prefs.video_mode as string) || '3d')
  const vspeed = isSummary ? (prefs.summary_vid_speed as string) || CFG.video_speed : CFG.video_speed
  const vaspect = isSummary ? (prefs.summary_vid_aspect as string) || CFG.video_aspect : CFG.video_aspect
  const job: Record<string, unknown> = {
    device: dev, user: uid, name, from: st, to: en, day: rday, ride_id: rideId, type: acttype,
    // 🔴 05.09: `oto: true` = bu iş KULLANICI TETİKLEMEDİ. API'nin bütçe kapısı (grup1.bumpDailyCap)
    // yalnız /api/rides/generate yolunda çalışıyor; otomatik üretim HİÇBİR kullanıcı bütçesine
    // girmiyordu. dispatch bu bayrağı görüp aylık kullanıcı bütçesini burada işler (tek kapı,
    // çift sayım yok).
    oto: true,
    mode: vmode, speed: vspeed, aspect: vaspect, premium: true, ts: simdi(), track,
    line: (prefs.video_line as string) || CFG.video_line_color,
    dot: (prefs.video_dot as string) || CFG.video_dot_color,
    // ⚠️ MOTOR SÖZLEŞMESİ: route-video.py `ultra=` bayrağını Ultra KATMANI için değil EN İYİ
    // KARO KAYNAĞI için okuyor (proxy en yüksek zoom + fill-extrusion). Google 3D öldüğünden
    // (GOOGLE_3D_OLU=1) beri başka etkisi yok. Tek katmanda herkes en iyisini alır → sabit true.
    ultra: true,
  }
  if (isSummary) {
    job.camdist = (prefs.summary_vid_cam as string) || 'orta'
    if (prefs.summary_vid_music) job.music = prefs.summary_vid_music
  }
  // CİHAZDA ÜRETİM (1.61 yerelq — satır 402-448): app /api/local-renders bu KV listesini okur
  const yerelOk = simdi() - Number(prof.yerel_son || 0) < 7 * 86400
  const yerelqYaz = async (neden: string): Promise<boolean> => {
    try {
      const lst = await kvJson<Record<string, unknown>[]>(env, `yerelq:${uid}`, [])
      if (!lst.some((x) => Math.trunc(Number(x.from ?? 0)) === st)) {
        const kayit: Record<string, unknown> = {}
        for (const k of ['from', 'to', 'type', 'mode', 'speed', 'aspect', 'line', 'dot', 'ride_id', 'ts', 'camdist']) {
          if (k in job) kayit[k] = job[k]
        }
        if (job.music) kayit.music = job.music
        lst.push(kayit)
        await kvJsonYaz(env, `yerelq:${uid}`, lst.slice(-10))
      }
      log(`  → CİHAZDA üretilecek (${neden}): ${rideId} mode=${job.mode}`)
      return true
    } catch { return false }
  }
  const prem = !!prof.premium
  // 🔴 VARSAYILAN ARTIK BULUT (Barış 05.09: "Varsayılan olarak telefondan üretilmeyecek").
  // NEDEN: telefon render'ı görünmez WKWebView'da kare kare snapshot alıyor; uygulama ARKA PLANA
  // düşerse snapshot BOŞ/BEYAZ döner (WebRouteVideo.swift:24'ün kendi yorumu: "ekran hiyerarşisinde
  // olmalı — yoksa snapshot boş döner") ve döngü o beyaz kareleri videoya YAZAR. Koruma yok →
  // kullanıcı beyaz video alıyor. Ayrıca uygulama kapalıyken iş hiç üretilmiyordu.
  // KV `telefon-render` = "1" yapılırsa eski davranış (bedava, telefonda) geri gelir — uygulama
  // güncellemesi beklemeden tek anahtarla dönülebilir. Anahtar YOKSA bulut kullanılır.
  const telefonAcik = (await env.KV.get('telefon-render')) === '1'
  if (telefonAcik && (job.mode === 'flat' || job.mode === 'flyover') && !forceMode && yerelOk) {
    if (await yerelqYaz('yerelq, bulut maliyeti SIFIR (KV telefon-render=1)')) return
  }
  const bulutKapali = (await env.KV.get('bulut-kapali')) !== null   // .bulut-kapali bayrağı → KV
  if (!forceMode && yerelOk && prem && bulutKapali) {
    if (await yerelqYaz('YEDEK YOL — bulut kapalı, telefonda üretilecek')) return
  }
  // BİRİNCİL: RENDER_Q → movelog-dispatch → RunPod (golge: öneki gerçek işi keser)
  const kid = await renderKuyruk(env, job, isSummary ? 'activity-detect:ozet' : 'activity-detect:oto')
  log(`  → KUYRUK: ${kid} • ${track.length} nokta • ${vmode}/${vspeed}`)
}

// ---------- tek cihaz analizi ----------
async function cihazIsle(c: GorevCtx, dev: string, gun: string): Promise<void> {
  const { env, now, log } = c
  const [g0, g1] = trGunAralik(gun)
  const prof = await env.DB.prepare(`SELECT ${PROFIL_KOLON} FROM users WHERE tracker_id = ?1`)
    .bind(dev).first<ProfilRow>()
  const uid = prof?.uid || ''
  const prefs = jsonParse<Prefs>(prof?.prefs_json ?? null, {})
  const devName = (prof?.name || prof?.handle || '').trim() || dev
  const rows = await env.DB.prepare(
    'SELECT ts, lat, lon, alt, spd FROM positions WHERE device = ?1 AND ts >= ?2 AND ts < ?3 ORDER BY ts')
    .bind(dev, g0, g1).all<{ ts: number; lat: number; lon: number; alt: number | null; spd: number | null }>()
  // 🔴 FİKS 05.09: burası `rides.km`'yi ÜRETEN yer ve HAM okuyordu. `positions`'taki tek bir çöp
  // koordinat (41.000000, 29.000000) 91 saniyede 744,96 km'lik sıçrama doğurup "748,7 km yürüyüş /
  // 13 dk" diye üç HAYALET rota yaratmıştı. Süzgeç artık ortak modülden ve okuma anında uygulanıyor.
  const hamP = rows.results.map((p) => ({
    t: p.ts, lat: p.lat, lon: p.lon, ele: p.alt ?? 0,
    dop: (p.spd ?? 0) * 1.852,   // knot → km/h (main.py:159 ile aynı çarpan)
    spd: 0,
  }))
  const P: Nokta[] = izSuz(hamP)
  if (P.length !== hamP.length) log(`  iz süzgeci: ${hamP.length - P.length} çöp/ışınlanma noktası atıldı`)
  for (let i = 1; i < P.length; i++) {
    const dt = P[i].t - P[i - 1].t
    P[i].spd = dt > 0 ? (hav(P[i - 1], P[i]) / dt) * 3.6 : 0
  }

  // --- durma-temelli segmentasyon (satır 166-185 birebir) ---
  const STOP_SEC = CFG.stop_minutes * 60, STOP_R = CFG.stop_radius_m, GAP_SEC = CFG.gap_minutes * 60
  const segs: Nokta[][] = []
  let cur: Nokta[] = []
  let anchor: Nokta | null = null
  for (const p of P) {
    if (!cur.length) { cur = [p]; anchor = p; continue }
    const prev = cur[cur.length - 1]
    if (p.t - prev.t >= GAP_SEC) { segs.push(cur); cur = [p]; anchor = p; continue }
    if (hav(anchor!, p) > STOP_R) { anchor = p; cur.push(p) }
    else if (p.t - anchor!.t >= STOP_SEC) {
      const seg = cur.filter((q) => q.t <= anchor!.t)
      if (seg.length) segs.push(seg)
      cur = [p]; anchor = p
    } else cur.push(p)
  }
  if (cur.length) segs.push(cur)
  let openTrip = false
  if (segs.length && now - segs[segs.length - 1][segs[segs.length - 1].length - 1].t < STOP_SEC) {
    openTrip = true; segs.pop()
  }

  // --- uyandırma bekçisi (satır 292-308) ---
  // 18.09: güvenlik uzun-duraklama bloğu KALDIRILDI (güvenli sürüş özelliği çıktı);
  // aşağıdaki wakepush bekçisi GÜVENLİK DEĞİL, sessiz uyandırma — kalıyor.
  if (uid && P.length >= 2) {
    const a = P[P.length - 2], b = P[P.length - 1]
    const age = now - b.t, gap = b.t - a.t, d = hav(a, b)
    if (age <= 900 && gap >= 120 && d >= 700) {
      const mk = await env.KV.get(`wakepush:${uid}`)
      if (mk === null) {
        await kvJsonYaz(env, `wakepush:${uid}`, b.t, 600)
        await pushBekleyen(env, { user: uid, silent: 1 })
        log(`BEKÇİ: beklemede ${(d / 1000).toFixed(1)}km yer değiştirme -> sessiz uyandırma (${uid})`)
      }
    }
  }
  // --- aktiviteler ---
  const vehicle = (prefs.vehicle as string) || 'moto'
  const acts: Akt[] = []
  for (const s of segs) {
    if (!valid(s)) continue
    const st = segStats(s)
    acts.push({ s, type: classify(st.med, st.p85, st.mx, st.acc, st.dp90, vehicle), ...st })
  }
  log(`${gun} dev=${dev} (${devName}): ${P.length} nokta, ${segs.length} segment, ${acts.length} aktivite (açık=${openTrip})`)

  // --- Rotalar'a kaydet (idempotent upsert; satır 532-534) ---
  if (uid) {
    for (const a of acts) {
      const st0 = a.s[0].t, en0 = a.s[a.s.length - 1].t
      await registerRide(env, {
        user: uid, ride_id: `${trGun(st0)}_${Math.trunc(st0)}`, date: trGun(st0),
        ts: Math.trunc(st0), to: Math.trunc(en0), type: a.type,
        km: Math.round(a.dist / 100) / 10, lat: a.s[0].lat, lon: a.s[0].lon,
      })
    }
  }

  // --- gönderim durumu (sent_act → KV) ---
  const scope = uid || dev
  const sentKey = `sent:act:${gun}_${scope}`
  const done = new Set(await kvJson<string[]>(env, sentKey, []))
  const yeni = acts.filter((a) => !done.has(String(Math.trunc(a.s[0].t))))
  const ozetKey = `sent:ozet:${gun}_${scope}`
  const ozetVar = (await env.KV.get(ozetKey)) !== null
  const reqler = uid ? await kvListe(env, `summaryreq:${uid}_`, 20) : []
  const onDemand = reqler.length > 0
  const sumEnabled = (prof?.summary_enabled ?? 1) !== 0            // COALESCE(summary_enabled,1)
  const userHour = prof?.summary_hour ?? CFG.summary_hour          // COALESCE(summary_hour,21)
  const summaryDue = onDemand || (sumEnabled && trSaat(now) >= userHour)
  const needSummary = acts.length > 0 && summaryDue && (onDemand || !ozetVar)

  // --- OTO-VİDEO RETRY (satır 554-611): R2'de hazırsa render-done, yoksa backoff'lu yeniden kuyruk ---
  if (CFG.auto_video && uid && prof?.premium) {
    const minKm = await otoMinKm(env)
    for (const a of acts) {
      if (a.type !== 'moto' && a.type !== 'car') continue
      if (a.dist / 1000 < minKm) {          // kısa gezinti -> otomatik video YOK (bakiye koruması)
        log(`  oto-video atlandı: ${(a.dist / 1000).toFixed(1)} km < ${minKm} km eşiği`)
        continue
      }
      const vst = Math.trunc(a.s[0].t), ven = Math.trunc(a.s[a.s.length - 1].t)
      const vrid = `${trGun(vst)}_${vst}`
      const vidVar = await env.DB.prepare('SELECT 1 x FROM videos WHERE rid = ?1').bind(vrid).first()
      if (vidVar) continue
      // 🔴 FİKS 05.09: `videos` henüz yazılmamışken iş HÂLÂ render oluyor olabilir. `pending_videos`
      // bakılmadığı için 20 dk sonra ikinci kez kuyruğa giriyordu = ikinci GPU faturası + 2. bildirim.
      const bekleyen = await env.DB.prepare('SELECT 1 x FROM pending_videos WHERE vid = ?1').bind(vrid).first()
      if (bekleyen) { log(`  oto-video atlandı: ${vrid} hâlâ render oluyor (pending_videos)`); continue }
      if (now - ven < 300) continue
      const vkey = `videos/${vrid}.mp4`
      const obj = await env.R2.head(vkey)
      if (obj) {
        await renderDone(env, {
          ride_id: vrid, key: vkey, user: uid, date: trGun(vst), ts: vst, to: ven, type: a.type,
          mode: (prefs.video_mode as string) || '3d',
          speed: CFG.video_speed, aspect: (prefs.video_aspect as string) || CFG.video_aspect,
          size: obj.size, ultra: true,
        })
        log(`  ✅ OTO-VİDEO LAND: ${vrid} — R2'de hazırdı, render-done D1'e işlendi`)
        continue
      }
      const mk = await kvJson<{ n: number; son: number }>(env, `autovid:${uid}:${vst}`, { n: 0, son: 0 })
      if (mk.n >= 8) continue
      if (now - mk.son < 1200) continue
      await queueCloudVideo(c, dev, uid, prof, prefs, P, vst, ven, a.type, devName, false)
      await kvJsonYaz(env, `autovid:${uid}:${vst}`, { n: mk.n + 1, son: now }, 2 * 86400)
      log(`  🔁 OTO-VİDEO RETRY: ${vrid} (deneme ${mk.n + 1}/8)`)
    }
  }

  if (!yeni.length && !needSummary) return

  // --- biten aktiviteler (satır 615-704) — TCX ayağı TAŞINMADI, Matrix satırı bildirim:bekleyen ---
  for (const a of yeni) {
    const [lbl, em] = TYPES[a.type]
    const st0 = a.s[0].t, en0 = a.s[a.s.length - 1].t
    await bildirimBekleyen(env,
      `${em} ${lbl} ${hhmm(st0)}–${hhmm(en0)}: ~${(a.dist / 1000).toFixed(1)} km, ${Math.floor(a.dur / 60)} dk. (${devName})`,
      'aktivite')
    done.add(String(Math.trunc(st0)))
    const isAuto = a.type === 'moto' || a.type === 'car'
    const lng = prof?.lang || 'en'
    const minKm2 = await otoMinKm(env)
    if (CFG.auto_video && isAuto && prof?.premium && a.dist / 1000 >= minKm2) {
      // 🔴 FİKS 05.09 — ÇİFT ÜRETİM: burada ikinci kez kuyruklamak HER otomatik videoyu 2 kez
      // GPU'ya gönderiyordu (kanıt: aynı rid için D1 size ≠ R2 size, D1 satırı R2 yüklemesinden
      // ÖNCE yazılmış). Yukarıdaki OTO-VİDEO RETRY dalı (satır ~340) aynı `acts` dizisini aynı turda
      // zaten geziyor ve videos/pending_videos/R2/autovid/eşik korumalarının HEPSİNE sahip.
      // Bu dal artık yalnız else-zincirini kısa devre ettirmek için duruyor.
      log(`  → ${a.type} (premium): oto-video RETRY dalına bırakıldı (çift kuyruklama yok)`)
    } else if (CFG.auto_video && isAuto && uid) {
      // ücretsiz motorlu: oto-üretim YOK (Barış 2026-08-28) — frenli upsell
      if (await freeBildirimHakki(env, uid, log)) {
        await pushBekleyen(env, { user: uid, title: UT[lng] || UT.en, body: UB[lng] || UB.en })
        log('  → motorlu araç (free): upsell push')
      } else log('  → motorlu araç (free): upsell SUSTURULDU (fren)')
    } else if (uid) {
      // motorsuz: "kaydedildi" bildirimi (premium muaf frenli)
      if (prof?.premium || (await freeBildirimHakki(env, uid, log))) {
        await pushBekleyen(env, {
          user: uid, title: `${em} ${lbl} kaydedildi`,
          body: `${(a.dist / 1000).toFixed(1)} km · ${Math.floor(a.dur / 60)} dk otomatik algılandı. İstersen videoya dönüştür.`,
        })
        log(`  → ${a.type}: kaydedildi + bildirim`)
      } else log(`  → ${a.type}: kaydedildi, bildirim SUSTURULDU`)
    }
  }
  await kvJsonYaz(env, sentKey, [...done], 3 * 86400)

  // 🔴 FİKS 04.09: özetlenecek aktivite yoksa da on-demand isteği TÜKETİLMELİ; yoksa istek
  // TTL dolana dek her turda yeniden denenir ve kullanıcı hiçbir geri bildirim almaz.
  if (onDemand && !needSummary) {
    for (const k of reqler) { try { await env.KV.delete(k) } catch { /* sonraki tur */ } }
    log(`özet isteği tüketildi ama üretilecek aktivite yok (${gun}, ${acts.length} aktivite)`)
  }

  // --- günün özeti (satır 707-741) ---
  if (needSummary) {
    const tot = new Map<string, [number, number, number]>()
    for (const a of acts) {
      const t = tot.get(a.type) ?? [0, 0, 0]
      t[0] += 1; t[1] += a.dist / 1000; t[2] += Math.floor(a.dur / 60)
      tot.set(a.type, t)
    }
    const totalKm = acts.reduce((s, a) => s + a.dist, 0) / 1000
    const totalMin = Math.floor(acts.reduce((s, a) => s + a.dur, 0) / 60)
    const sp = (a: Akt) => (a.dur > 0 ? (a.dist / 1000) / (a.dur / 3600) : 0)
    const fastest = acts.reduce((m, a) => (sp(a) > sp(m) ? a : m), acts[0])
    const longest = acts.reduce((m, a) => (a.dist > m.dist ? a : m), acts[0])
    const first = acts.reduce((m, a) => (a.s[0].t < m.s[0].t ? a : m), acts[0])
    const last = acts.reduce((m, a) => (a.s[a.s.length - 1].t > m.s[m.s.length - 1].t ? a : m), acts[0])
    const lines = [
      onDemand ? '📊 Şu ana kadarki özet' : `🗓️ ${gun} günün özeti`,
      `Toplam: ${totalKm.toFixed(1)} km · ${totalMin} dk · ${acts.length} aktivite`,
    ]
    for (const [typ, [n, km, dk]] of tot) lines.push(`${TYPES[typ][1]} ${TYPES[typ][0]}: ${n}× · ${km.toFixed(1)} km · ${dk} dk`)
    lines.push(`⚡ En hızlı an: ${TYPES[fastest.type][1]} ~${sp(fastest).toFixed(0)} km/s`)
    lines.push(`📏 En uzun: ${TYPES[longest.type][1]} ${(longest.dist / 1000).toFixed(1)} km`)
    lines.push(`🕒 ${hhmm(first.s[0].t)}–${hhmm(last.s[last.s.length - 1].t)}`)
    lines.push('📍 ' + acts.map((a) => `${TYPES[a.type][1]}${hhmm(a.s[0].t)}`).join(' → '))
    const text = lines.join('\n')
    await bildirimBekleyen(env, text, 'gün özeti')
    await kvJsonYaz(env, ozetKey, text, 3 * 86400)   // durum bayrağı: "bu gün için özet gönderildi mi"
    // 🔴 FİKS 04.09: özet YALNIZ KV'ye yazılıyordu; uygulamanın "Günlük özet" ekranı ise D1
    // `activities` tablosundan okuyor (api grup7.ts:478) → ekran BOMBOŞ görünüyordu (tablo da yoktu,
    // migration 0005 ile açıldı). Artık kanonik kopya D1'e gider; KV bayrağı yukarıda kalır.
    // uid yoksa (cihaz-only akış) yazılmaz: uid NOT NULL + sahipsiz özet gizlilik ihlali olurdu.
    if (uid) {
      const simdiTs = Math.floor(Date.now() / 1000)
      try {
        await env.DB.prepare(
          `INSERT INTO activities (id, uid, day, summary, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT(uid, day) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`)
          .bind(`${uid}_${gun}`, uid, gun, text, simdiTs).run()
      } catch (e) {
        log(`özet D1'e yazılamadı: ${String(e).slice(0, 120)}`)   // SESSİZ YUTMA YOK — göreve düşsün
      }
    }
    // 🔴 FİKS 04.09 (2. tur): istek burada tüketilir — özet KALICI olarak yazıldıktan hemen sonra.
    // Önce aşağıdaki push/oto-video adımlarından SONRA siliniyordu; queueCloudVideo patlayınca
    // cihazIsle fırlıyor, silme hiç çalışmıyor ve istek TTL dolana dek her turda özet ürettiriyordu.
    // ÖLÇÜLDÜ: 00:12'de özet D1'e yazıldı, `summaryreq:` anahtarı yerinde kaldı.
    for (const k of reqler) { try { await env.KV.delete(k) } catch { /* sonraki tur yeniden dener */ } }
    if (onDemand) log(`on-demand istek tüketildi (${reqler.length})`)

    if (uid) {
      await pushBekleyen(env, {
        user: uid, title: 'Günlük özetin hazır 📊',
        body: `${totalKm.toFixed(1)} km · ${acts.length} aktivite · en hızlı ~${sp(fastest).toFixed(0)} km/s`,
      })
      const motorlu = acts.filter((x) => x.type === 'moto' || x.type === 'car')
      // 🔴 FİKS 05.09: 2 km eşiği yalnız tekil oto-videolarda vardı, ÖZET dalında YOKTU —
      // 0,4 km'lik bir gün de ~25 dk 3B GPU render'ı tetikleyebiliyordu (bakiye koruması).
      const ozetMinKm = await otoMinKm(env)
      // oto-video hatası özet akışını düşürmesin (yukarıdaki istek tüketimi zaten yapıldı)
      if (prof?.premium && motorlu.length && totalKm >= ozetMinKm) {
        try {
        await queueCloudVideo(c, dev, uid, prof, prefs, P,
          Math.trunc(first.s[0].t), Math.trunc(last.s[last.s.length - 1].t),
          motorlu[motorlu.length - 1].type, `${devName} • Gün özeti`, true)
        } catch (e) { log(`oto-video kuyruklanamadı: ${String(e).slice(0, 140)}`) }
      }
    }
    // 🔴 FİKS 04.09: `summaryreq:` istekleri OKUNUYOR ama HİÇ SİLİNMİYORDU (satır 306) → bir kez
    // "üret"e basan kullanıcı için onDemand SONSUZA DEK true kalır, her turda yeni özet+push gider.
    // İstek tüketildi, şimdi temizleniyor.
    log('özet gönderildi' + (onDemand ? ' (on-demand)' : ''))
  } else if (onDemand && uid) {
    await pushBekleyen(env, { user: uid, title: 'Günlük özet', body: 'Bugün henüz kayıtlı aktivite yok.' })
  }
  if (onDemand) for (const rk of reqler) { try { await env.KV.delete(rk) } catch { /* yut */ } }
}

// ---------- görev girişi: bugün aktif tüm cihazlara fan-out (satır 99-114) ----------
export async function kos(c: GorevCtx): Promise<void> {
  const gun = trGun(c.now)
  const [g0, g1] = trGunAralik(gun)
  const devs = await c.env.DB.prepare('SELECT DISTINCT device FROM positions WHERE ts >= ?1 AND ts < ?2')
    .bind(g0, g1).all<{ device: string }>()
  // cihaz -> işlenecek TR günü
  const isle = new Map<string, string>()
  for (const d of devs.results) isle.set(d.device, gun)

  // 🔴 FİKS 04.09 — ON-DEMAND ÖZET, BUGÜN HAREKET OLMASA DA İŞLENMELİ.
  // Eskiden burada "bugün aktif cihaz yok" deyip ÇIKILIYORDU: kullanıcı "üret"e bastığında
  // (ör. TR gece yarısından sonra ya da sürüş yapılmayan bir günde) istek KV'de öylece kalıyor,
  // özet HİÇ üretilmiyordu. Ölçüldü 05.09 00:09 TR: bekleyen istek var, konum yok → görev bitiyordu.
  // Artık bekleyen istek sahiplerinin son HAREKETLİ günü işlenir.
  const istekler = await kvListe(c.env, 'summaryreq:', 50)
  for (const k of istekler) {
    const uid = k.slice('summaryreq:'.length).split('_')[0]
    if (!uid) { await c.env.KV.delete(k); continue }
    const row = await c.env.DB.prepare('SELECT tracker_id FROM users WHERE uid = ?1')
      .bind(uid).first<{ tracker_id: string | null }>()
    const dev = row?.tracker_id || ''
    if (!dev) { await c.env.KV.delete(k); c.log(`özet isteği düştü (takipçi yok): ${uid}`); continue }
    if (isle.has(dev)) continue                      // zaten bugün işlenecek
    const son = await c.env.DB.prepare('SELECT MAX(ts) AS t FROM positions WHERE device = ?1 AND ts >= ?2')
      .bind(dev, c.now - 3 * 86400).first<{ t: number | null }>()
    if (!son?.t) { await c.env.KV.delete(k); c.log(`özet isteği düştü (3 günde veri yok): ${uid}`); continue }
    isle.set(dev, trGun(son.t))                      // son hareketli günü özetle
    c.log(`özet isteği: ${uid} → ${trGun(son.t)} günü işlenecek (bugün hareket yok)`)
  }

  if (!isle.size) { c.log('bugün aktif cihaz yok, bekleyen özet isteği de yok'); return }
  for (const [dev, g] of isle) {
    try { await cihazIsle(c, dev, g) } catch (e) { c.log(`cihaz ${dev} hata: ${String(e).slice(0, 150)}`) }
  }
}
