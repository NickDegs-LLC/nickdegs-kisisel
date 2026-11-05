// motor3d — route-video.py "3d + SPEC_OUT" yolunun TS portu (sunucusuz).
// ═══════════════════════════════════════════════════════════════════════════════════
// KAYNAK: /opt/matrix/render-worker/scripts/route-video.py  (997 satırın 375'i bu yolda)
// ÇAĞRI EŞLENİĞİ (harita-proxy.py:461-470 — bugün sunucuda ne çalışıyorsa O):
//   route-video.py <gun> 3d <speed> track=… from=<int> to=<int> name=… acttype=…
//                  line=… dot=… camdist=… [9:16]
//   env: SPEC_OUT=… RVID_FPS=60 RENDER3D_SCALE=1.0 GOOGLE_3D_OLU=1 ROUTE_OUT=…
// => bu yolda SABİT olanlar (ölçüldü, kod dalları takip edilerek):
//   FREE=false · DRY=false · MODE="3d" · LANG="tr" · ULTRA=false · KABARTMA=false · REEL=false
//   SEG="" · CAMMODE="" · ZOOMO=None · MATES=[] · AVATAR=None · NOHUD=false · matched= YOK
//   FPS=60 · rscale=1.0 · GOOGLE_3D_OLU=1
//
// PORT EDİLMEYEN (bu parametrelerle ASLA çalışmayan) dallar: avatar,  [05.11: grup sürüşü/mates ARTIK VAR → eslerUret]
// FREE filigranı, seg=, ultra/kabartma/nohud/reel, Traccar HTTP dalı, rota_*.json yan dosyası,
// Garmin nabız (aşağıda ayrıca not), outMp4/ffmpeg/rscale (bulut render alanları — telefon yolunda ölü).
//
// ⚠️ İKİ BİLİNÇLİ SAPMA (ikisi de ölçülüp gerekçelendirildi):
//  1) `day`: sunucuda `time.strftime("%Y-%m-%d", time.localtime(frm))` = SUNUCU YEREL SAATİ
//     (Europe/Berlin). Worker'da TR (UTC+3) kullanılır — route-video.py'nin kendi TR sabitiyle
//     ve aynı satırdaki hhmm() ile TUTARLI olan tek seçim (Berlin ile tarih ve saat çelişebiliyordu).
//     Ölçüm rotasında iki seçim de AYNI sonucu verdi ("27 Ağu 2026 02:43").
//  2) `hr`: route-video.py map-match'ten SONRA `p["hr"]=hr_at(p["t"])` ile Garmin'den yeniden
//     dolduruyor; Garmin yoksa HEPSİ None olur (ölçüldü: 1921/1921 None). Worker'da Garmin yok
//     ve D1 positions'ta nabız kolonu da yok (grup7 /api/track hr:null döner) -> hr HEP null.
//     Yani bugünkü üretim çıktısıyla BİREBİR; kayıp yok.

import { bisectLeft, hav, pyformat, pyround, pyroundInt } from './sayi'

export type IzNokta = { t: number; lat: number; lon: number; alt?: number | null; spd?: number | null; hr?: number | null }

export type MotorGirdi = {
  frm: number; to: number
  speed: 'fast' | 'medium' | 'slow' | 'auto'
  acttype: string
  line: string; dot: string
  camdist: 'yakin' | 'orta' | 'uzak'
  aspect9x16: boolean
  name: string
  /** 05.11.2026 ORTAK SÜRÜŞ (telefonda): diğer sürücülerin ham izleri. Boşsa tek kişilik yol BİREBİR aynı. */
  mates?: { iz: IzNokta[]; line: string; dot: string }[]
}

type P = {
  t: number; lat: number; lon: number
  alt: number | null; spd: number; hr: number | null
  cum: number; dwell: boolean; poi: string
}

// ───────── route-video.py:140-183 — VİDEO DİLİ (bu yolda LANG hep "tr") ─────────
const AY_TR = ['', 'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const ACT_TR: Record<string, string> = {
  moto: 'Motosiklet', car: 'Araba', bike: 'Bisiklet', run: 'Koşu', walk: 'Yürüyüş', d: 'Sürüş',
}
// _SADE = false (tr) -> semboller açık, birimler latin (route-video.py:176-179)
const SYM = { km: '▸', saat: '◷', alt: '▲', hr: '❤' }
const BIRIM = { km: 'km', m: 'm' }
const sy = (k: keyof typeof SYM) => SYM[k] + ' '

// ───────── route-video.py:224-228 — süre kademeleri ─────────
const SECS = { fast: 15, medium: 28, slow: 30, auto: 35 }
const SPK = { fast: 0.6, medium: 0.9, slow: 1.3, auto: 3.0 }
const SMAX = { fast: 30, medium: 45, slow: 60, auto: 180 }
// route-video.py:216 — KİLİTLİ KAMERA KADEMELERİ (Barış 2026-08-28 "bütün zoomlar için kilitle")
const CAM_KADEME: Record<string, number> = { yakin: 1.0, orta: 0.0, uzak: -1.0 }

const TR_OFS = 3 * 3600   // route-video.py:14  TR=timezone(timedelta(hours=3))

/** route-video.py:232 hhmm() — datetime.fromtimestamp(e, TR).strftime("%H:%M") */
function hhmm(e: number): string {
  const s = Math.floor(e + TR_OFS)
  const hh = ((Math.floor(s / 3600) % 24) + 24) % 24
  const mm = ((Math.floor(s / 60) % 60) + 60) % 60
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
}

/** route-video.py:234 daylabel() — tr fmt "{d} {a} {y}" */
function daylabel(frm: number): string {
  const d = new Date((Math.floor(frm) + TR_OFS) * 1000)
  return `${d.getUTCDate()} ${AY_TR[d.getUTCMonth() + 1]} ${d.getUTCFullYear()}`
}

const sayiMi = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const ll = (p: { lat: number; lon: number }): [number, number] => [p.lat, p.lon]

// ═════════════════════════════════════════════════════════════════════════
// map-match (route-video.py:296-338) — harita katmanı worker'ına gider (sunucu YOK)
// ═════════════════════════════════════════════════════════════════════════
function matchProfile(acttype: string): string {
  return ({ bike: 'cycling', run: 'walking', walk: 'walking' } as Record<string, string>)[acttype] ?? 'driving'
}

const uyu = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** SERVICE BINDING (31.08 ölçümü): aynı zone'daki worker'a fetch() route'a GİRMEZ, doğrudan
 *  origin'e (nginx → harita-proxy) gider. Sunucu kapalıyken matching/geocoding 502 → rota ham
 *  GPS'e düşüyor, POI kayboluyordu (261 nokta/7 POI → 303/0 ölçüldü) + ~15 sn ölü-origin cezası.
 *  Binding verilmişse onu kullan; yoksa (yerel test) global fetch. */
function cek(harita: Fetcher | undefined, u: string, o?: RequestInit): Promise<Response> {
  return harita ? harita.fetch(u, o) : fetch(u, o)
}

async function mapMatch(
  src: P[], acttype: string, onek: string, token: string, log: string[], harita?: Fetcher,
): Promise<{ lat: number; lon: number }[] | null> {
  if (!token || src.length < 2) return null       // Python: `if not MB or len(src)<2`
  const out: { lat: number; lon: number }[] = []
  let usedMatch = false
  let i = 0
  while (i < src.length - 1) {
    const seg = src.slice(i, i + 100)
    if (seg.length < 2) break
    const coords = seg.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
    const rad = seg.map(() => '32').join(';')
    const url = `${onek}/matching/v5/mapbox/${matchProfile(acttype)}/${coords}`
      + `?geometries=geojson&overview=full&tidy=true&radiuses=${rad}&access_token=${token}`
    let got = false
    let tani = ''                                        // teşhis (Python'un print'lerinin eşleniği)
    for (let t = 0; t < 3; t++) {
      try {
        const r = await cek(harita, url, { signal: AbortSignal.timeout(30_000) })
        if (!r.ok) throw new Error('HTTP ' + r.status)   // Python urlopen 4xx/5xx -> istisna
        const d = await r.json<{ code?: string; matchings?: { geometry: { coordinates: number[][] } }[] }>()
        tani = `HTTP ${r.status} code=${d.code ?? '-'} n=${(d.matchings ?? []).length}`
        // 🔴 ÖLÇÜLDÜ (31.08 canlı, wrangler tail): harita katmanı BAZI önbellek isabetlerinde
        // gövdeyi `code` ALANI OLMADAN döndürüyor (`{"matchings":[…]}`) — bu, `code` alanı
        // eklenmeden önce yazılmış eski kayıtlar. route-video.py'nin `d.get("code")=="Ok"`
        // testi bunları ELİYOR -> 4/4 dilim düşüyor -> rota YOLA OTURMUYOR (303 nokta ham
        // kalıyor, 261 eşleşmiş yerine). Aynı URL kenardan `code:"Ok"` dönüyor (colo farkı).
        // ÇÖZÜM: eşleşme VARSA kabul et. Boş gövde (`matchings:[]`) yine ham ize düşer,
        // yani Python'un davranışı YALNIZCA bu eski-kayıt durumunda iyileşir, hiç bozulmaz.
        const uygun = d.code === 'Ok' || (d.code === undefined && !!d.matchings?.length)
        if (uygun && d.matchings) {
          for (const m of d.matchings) {
            for (const c of m.geometry.coordinates) {
              const s = out[out.length - 1]
              if (!s || Math.abs(s.lat - c[1]) > 1e-7 || Math.abs(s.lon - c[0]) > 1e-7) out.push({ lat: c[1], lon: c[0] })
            }
          }
          got = true; usedMatch = true
        }
        break                                     // Ok veya kalıcı kod (NoMatch vs) -> retry etme
      } catch (e) {
        log.push(`map-match parça hata (deneme ${t + 1}): ${String(e).slice(0, 80)}`)
        await uyu(600 * (t + 1))
      }
    }
    if (!got) {
      log.push(`dilim@${i} (${seg.length} nokta) oturmadı: ${tani || 'istek başarısız'}`)
      for (const p of seg) {
        const s = out[out.length - 1]
        if (!s || Math.abs(s.lat - p.lat) > 1e-7 || Math.abs(s.lon - p.lon) > 1e-7) out.push({ lat: p.lat, lon: p.lon })
      }
    }
    i += 99
  }
  if (!usedMatch) log.push('map-match hiç oturmadı (ham iz kullanılacak)')
  return out.length >= 2 ? out : null
}

/** route-video.py:466-471 _poi() — ters geokod (dwell kümesi başına 1 istek). */
async function poiAl(lat: number, lon: number, onek: string, token: string, harita?: Fetcher): Promise<string> {
  try {
    const u = `${onek}/geocoding/v5/mapbox.places/${lon},${lat}.json`
      + `?access_token=${token}&types=poi,neighborhood,locality,place&limit=1&language=tr`
    const r = await cek(harita, u, { signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return ''
    const d = await r.json<{ features?: { text?: string }[] }>()
    const fs = d.features ?? []
    return fs.length ? (fs[0].text ?? '') : ''
  } catch { return '' }
}

// ═════════════════════════════════════════════════════════════════════════
// frame_indices (route-video.py:394-432) — MÜHÜRLÜ pacing, birebir
// ═════════════════════════════════════════════════════════════════════════
export function frameIndices(P: P[], FR: number): number[] {
  const V_MIN = 7.0, V_MAX = 95.0, DWELL_BEAT = 2.0
  const sp0 = P.map((p) => Math.max(V_MIN, Math.min(V_MAX, p.spd || 0.0)))
  const smsp = (a: number[], k: number): number[] => {
    const o: number[] = []
    for (let i = 0; i < a.length; i++) {
      const lo = Math.max(0, i - k), hi = Math.min(a.length, i + k + 1)
      let s = 0
      for (let j = lo; j < hi; j++) s += a[j]      // Python sum() ile AYNI toplama sırası
      o.push(s / (hi - lo))
    }
    return o
  }
  const kw = Math.max(4, Math.floor(P.length / 28))
  const sps = smsp(smsp(sp0, kw), kw)
  const w = [0.0]
  for (let i = 1; i < P.length; i++) {
    const d = hav(ll(P[i - 1]), ll(P[i]))
    const v = sps[i] / 3.6
    let add = d / v
    if (P[i].dwell && !P[i - 1].dwell) add += DWELL_BEAT
    w.push(w[w.length - 1] + add)
  }
  const total = w[w.length - 1]
  if (total <= 0 || FR < 2) {
    const o: number[] = []
    for (let f = 0; f < FR; f++) o.push((f * (P.length - 1)) / Math.max(1, FR - 1))
    return o
  }
  const out: number[] = []
  let j = 0
  for (let f = 0; f < FR; f++) {
    const tt = (f / (FR - 1)) * total
    while (j < P.length - 1 && w[j + 1] < tt) j++
    const seg = j < P.length - 1 ? w[j + 1] - w[j] : 0.0
    const fr = seg <= 0 ? 0.0 : Math.max(0.0, Math.min(1.0, (tt - w[j]) / seg))
    out.push(j + fr)
  }
  return out
}

export type Spec = Record<string, unknown> & { frames: number; fps: number; W: number; H: number }

export class SpecHata extends Error {
  constructor(public readonly kod: number, public readonly detay: string) { super(detay) }
}

// ═════════════════════════════════════════════════════════════════════════
// ANA: iz -> spec (route-video.py 243-552 arasının 3d/SPEC dalı)
// ═════════════════════════════════════════════════════════════════════════
export async function specUret(
  ham: IzNokta[], g: MotorGirdi, onek: string, token: string, harita?: Fetcher,
): Promise<{ spec: Spec; log: string[] }> {

  const log: string[] = []
  const FPS = 60                                                     // env RVID_FPS=60
  const [VW, VH] = g.aspect9x16 ? [1080, 1920] : [1920, 1080]        // FREE=false
  const CAMZ = CAM_KADEME[g.camdist] ?? 0.0
  const durSecs = (km: number) => Math.min(SMAX[g.speed], Math.max(SECS[g.speed], km * SPK[g.speed]))

  // ── route-video.py:243-251: iz dosyasından P ──
  let P: P[] = ham.map((p) => ({
    t: Number(p.t ?? 0), lat: p.lat, lon: p.lon,
    alt: sayiMi(p.alt) ? p.alt : null,
    spd: sayiMi(p.spd) ? p.spd : (null as unknown as number),
    hr: sayiMi(p.hr) ? p.hr : null,
    cum: 0, dwell: false, poi: '',
  }))
  if (P.length && !P[0].t) {                                          // t yoksa from..to arasına eşit dağıt
    const f = g.frm || 0, t = g.to || (f + P.length), n = Math.max(1, P.length - 1)
    P.forEach((p, i) => { p.t = f + ((t - f) * i) / n })
  }
  P.sort((a, b) => a.t - b.t)                                         // Python list.sort — kararlı
  P = P.filter((p) => p.t >= g.frm - 1).filter((p) => p.t <= g.to + 1)

  // ── route-video.py:259-273: GPS ışınlanma (outlier) temizliği ──
  const hh = (a: P, b: P) => hav(ll(a), ll(b))
  for (let pass = 0; pass < 4; pass++) {
    if (P.length < 3) break
    let ch = false
    // 11.10 FİKS (route-video.py ile AYNI): uç nokta YALNIZ gerçekten ışınlanmaysa atılır (ima edilen
    // hız > 55 m/s ya da zaman ilerlemiyor). Seyrek kayıtta sürüşün gerçek ilk/son noktası siliniyordu.
    const isin = (a: P, b: P) => { const dt = Math.abs(b.t - a.t); return dt <= 0 || hh(a, b) / dt > 55 }
    if (hh(P[0], P[1]) > 200 && hh(P[1], P[2]) < 160 && isin(P[0], P[1])) { P = P.slice(1); ch = true }
    if (P.length >= 3 && hh(P[P.length - 1], P[P.length - 2]) > 200 && hh(P[P.length - 2], P[P.length - 3]) < 160
        && isin(P[P.length - 2], P[P.length - 1])) {
      P = P.slice(0, -1); ch = true
    }
    const cl: P[] = [P[0]]
    for (let i = 1; i < P.length - 1; i++) {
      if (hh(P[i - 1], P[i]) > 160 && hh(P[i], P[i + 1]) > 160 && hh(P[i - 1], P[i + 1]) < hh(P[i - 1], P[i]) * 0.6) { ch = true; continue }
      cl.push(P[i])
    }
    cl.push(P[P.length - 1]); P = cl
    if (!ch) break
  }

  // ── route-video.py:274-286: dedup / glitch ayıklama ──
  const Q: P[] = []
  for (const p of P) {
    if (Q.length) {
      const q = Q[Q.length - 1]
      const d = hav(ll(q), ll(p)), dt = p.t - q.t
      if (d < 3) continue
      if (dt <= 0 && d > 40) continue
      if (dt > 0 && d / dt > 70) continue
    }
    Q.push(p)
  }
  P = Q
  // 🔴 05.09: burası 500 'spec uretilemedi' diyordu — ne kullanıcı ne biz sebebini anlıyorduk.
  // VAKA: kullanıcının evde sabit dururken oluşan hayalet rotası; içindeki tek çöp koordinat
  // (41.000000, 29.000000) süzülünce geriye hareketsiz 4 nokta kaldı. Bu bir SUNUCU hatası değil,
  // rotanın kendisi videoya elverişsiz -> 422 + kullanıcıya gösterilebilir NET mesaj.
  if (P.length < 5) {
    throw new SpecHata(422, `bu rotada video için yeterli konum yok (${P.length} nokta, en az 5 gerekli)`)
  }
  // Hareketsiz rota: tüm noktalar ~aynı yerdeyse video anlamsız (kamera hedefi yok).
  {
    const enlem = P.map((x) => x.lat), boylam = P.map((x) => x.lon)
    const dLat = Math.max(...enlem) - Math.min(...enlem)
    const dLon = Math.max(...boylam) - Math.min(...boylam)
    // ~50 m: 0.00045° enlem. Kabaca ama amaç "hiç hareket yok"u yakalamak.
    if (dLat < 0.00045 && dLon < 0.00045) {
      throw new SpecHata(422, 'bu rotada hareket yok (tüm noktalar aynı yerde) — video üretilemez')
    }
  }

  // ── route-video.py:288-294: cum + spd doldurma ──
  P[0].cum = 0.0
  if (!sayiMi(P[0].spd)) P[0].spd = 0.0
  for (let i = 1; i < P.length; i++) {
    const dt = P[i].t - P[i - 1].t
    const d = hav(ll(P[i - 1]), ll(P[i]))
    const ps = P[i].spd
    P[i].spd = sayiMi(ps) ? ps : (dt > 0 && dt < 600 ? (d / dt) * 3.6 : P[i - 1].spd)
    P[i].cum = P[i - 1].cum + d
  }
  let TOTKM = P[P.length - 1].cum / 1000.0

  // ── route-video.py:339-370: map-match + t/spd/alt/hr/cum taşıma ──
  const matched = await mapMatch(P, g.acttype, onek, token, log, harita)
  if (matched && matched.length >= 2) {
    const srcN = P.length
    let srctot = P[P.length - 1].cum || 1.0
    const srccum = P.map((p) => p.cum)
    const M: P[] = matched.map((m) => ({ ...m, t: 0, alt: null, spd: 0, hr: null, cum: 0, dwell: false, poi: '' }))
    const mcum = [0.0]
    for (let i = 1; i < M.length; i++) mcum.push(mcum[i - 1] + hav(ll(M[i - 1]), ll(M[i])))
    const mtot = mcum[mcum.length - 1] || 1.0
    for (let i = 0; i < M.length; i++) {
      const dAlong = (mcum[i] / mtot) * srctot
      const j = Math.max(1, Math.min(bisectLeft(srccum, dAlong), srcN - 1))
      const a = P[j - 1], b = P[j]
      const seg = srccum[j] - srccum[j - 1] || 1.0
      const fr = (dAlong - srccum[j - 1]) / seg
      M[i].t = a.t + (b.t - a.t) * fr
      M[i].spd = a.spd + (b.spd - a.spd) * fr
      const aa = a.alt, ba = b.alt
      M[i].alt = sayiMi(aa) && sayiMi(ba) ? aa + (ba - aa) * fr : (sayiMi(aa) ? aa : ba)
      const ah = a.hr, bh = b.hr
      M[i].hr = sayiMi(ah) && sayiMi(bh) ? Math.trunc(ah + (bh - ah) * fr) : (sayiMi(ah) ? Math.trunc(ah) : null)
      M[i].cum = dAlong
    }
    M[0].t = P[0].t; M[M.length - 1].t = P[P.length - 1].t
    M[0].cum = 0.0; M[M.length - 1].cum = srctot
    // 11.10 FİKS (route-video.py ile AYNI): MESAFE yola oturtulmuş geometriden; eskiden ham GPS
    // noktaları arası kuş uçuşu toplamıydı (seyrek kayıtta eksik). Saçma eşleşmede eski değer kalır.
    if (0.5 * srctot <= mtot && mtot <= 3.0 * srctot) {
      for (let i = 0; i < M.length; i++) M[i].cum = mcum[i]
      srctot = mtot; TOTKM = mtot / 1000.0
    }
    M[0].spd = P[0].spd; M[M.length - 1].spd = P[P.length - 1].spd
    P = M
    log.push(`yola oturtuldu (map-match) ${srcN} -> ${P.length} nokta`)
    const MMAX = 3000                                                 // 3D kilitlenme koruması
    if (P.length > MMAX) {
      const st = (P.length - 1) / (MMAX - 1)
      const eski = P
      P = []
      for (let i = 0; i < MMAX; i++) P.push(eski[pyroundInt(i * st)])
      P[P.length - 1].cum = srctot
      log.push(`map-match seyreltildi -> ${P.length} nokta`)
    }
  }

  // ── route-video.py:392: Garmin nabzı (worker'da YOK -> hepsi null; bugünkü üretimle birebir) ──
  for (const p of P) p.hr = null

  // ── route-video.py:456-458: kare sayısı ──
  const FRMAX = g.speed === 'auto' ? 10200 : 3600
  const FR = Math.max(120, Math.min(Math.trunc(durSecs(TOTKM) * FPS), FRMAX))

  // ── route-video.py:461-468: MEKAN/UZUN-DURUŞ tespiti (~40 m içinde ≥70 sn) ──
  let s0 = 0
  for (let i = 1; i <= P.length; i++) {
    if (i === P.length || hav(ll(P[s0]), ll(P[i])) > 40) {
      if (i - 1 > s0 && P[i - 1].t - P[s0].t >= 70) for (let k = s0; k < i; k++) P[k].dwell = true
      s0 = i
    }
  }

  // ── route-video.py:472-482: dwell kümesi merkezinden ters geokod ──
  let i2 = 0
  while (i2 < P.length) {
    if (P[i2].dwell) {
      let j2 = i2
      while (j2 < P.length && P[j2].dwell) j2++
      const cl = P.slice(i2, j2)
      const cla = cl.reduce((s, x) => s + x.lat, 0) / cl.length
      const clo = cl.reduce((s, x) => s + x.lon, 0) / cl.length
      const nm = await poiAl(cla, clo, onek, token, harita)
      for (let k = i2; k < j2; k++) P[k].poi = nm
      i2 = j2
    } else i2++
  }

  // ── route-video.py:483-486: pts (ANAHTAR SIRASI ÖNEMLİ — sürücü JSON.stringify eder) ──
  const pts = P.map((p) => ({
    lon: pyround(p.lon, 6), lat: pyround(p.lat, 6), tm: hhmm(p.t),
    spd: pyround(p.spd, 1), cum: pyround(p.cum, 1), hr: p.hr, dwell: p.dwell, poi: p.poi,
    alt: sayiMi(p.alt) ? pyround(p.alt, 1) : null,
  }))

  // ── route-video.py:492-508: intro/outro istatistikleri ──
  const dsec = Math.max(1, P[P.length - 1].t - P[0].t)
  const dm = Math.trunc(dsec / 60), h3 = Math.trunc(dm / 60), m3 = dm % 60
  const sure3 = h3 ? `${h3} sa ${m3} dk` : `${m3} dk`
  const hrs3 = P.map((p) => p.hr).filter((x): x is number => !!x)
  const ahr3 = hrs3.length ? Math.trunc(hrs3.reduce((a, b) => a + b, 0) / hrs3.length) : null
  const MET3: Record<string, number> = { walk: 3.8, run: 9.8, bike: 8.0 }
  const kcal3 = MET3[g.acttype] !== undefined ? Math.trunc(MET3[g.acttype] * 75 * (dsec / 3600.0)) : null
  const alts3 = P.map((p) => p.alt).filter((x): x is number => sayiMi(x))
  let gain3: number | null = null
  if (alts3.length >= 5) {
    let g3 = 0.0, r3 = alts3[0]
    for (const av of alts3.slice(1)) {
      if (av - r3 > 2) { g3 += av - r3; r3 = av } else if (av < r3) r3 = av
    }
    gain3 = Math.trunc(g3)
  }
  const stats3 = [
    `${sy('km')}${pyformat(TOTKM, 1)} ${BIRIM.km}     •     ${sure3}`,
    `${sy('saat')}${hhmm(P[0].t)} - ${hhmm(P[P.length - 1].t)}`,
  ]
  const l33: string[] = []
  if (gain3 && gain3 >= 15) l33.push(`${sy('alt')}${gain3} ${BIRIM.m}`)
  if (ahr3) l33.push(`❤ ${ahr3}`)
  if (kcal3) l33.push(`★ ${kcal3} kcal`)
  if (l33.length) stats3.push(l33.join('     •     '))

  // ── route-video.py:513-524: UZUN ROTA OTOMATİK KADRAJ ──
  let zL: number | null = null, pL: number | null = null
  if (TOTKM > 600) { zL = 10.3; pL = 45 } else if (TOTKM > 350) { zL = 11.2; pL = 48 } else if (TOTKM > 150) { zL = 12.2; pL = 52 }
  if (zL !== null) {
    zL += ({ yakin: 3.9, orta: 3.0, uzak: 0.0 } as Record<string, number>)[g.camdist] ?? 3.0
    pL = Math.min(58, (pL as number) + (({ yakin: 10, orta: 7, uzak: 0 } as Record<string, number>)[g.camdist] ?? 7))
  }

  const FIDX3 = frameIndices(P, FR)

  // ── 05.11.2026 ORTAK SÜRÜŞ: her eş sürücünün konumu, öndekinin O KAREDEKİ zamanında örneklenir ──
  // sayfa.js/surucu.js sözleşmesi: mates[i] = { pts2: [[lon,lat]…] (iz çizgisi), pos2: [[lon,lat]] × FR, line, dot }
  const mates = eslerUret(g.mates ?? [], P, FIDX3)

  // ── route-video.py:527-544: inp (spec) — ANAHTAR SIRASI kaynakla birebir ──
  const spec: Spec = {
    token, W: VW, H: VH, fps: FPS, outMp4: '', ffmpeg: 'ffmpeg', frames: FR, noHud: false,
    rscale: 1.0,                                                       // env RENDER3D_SCALE=1.0
    pitch: pL ?? 60,
    zoom: zL ?? 16.4 + CAMZ,
    dwellZoom: 1.4, wm: '', lineColor: g.line, dotColor: g.dot,
    frameIdx: FIDX3, name: g.name, activity: ACT_TR[g.acttype] ?? ACT_TR.d, stats: stats3,
    avatarImg: '', gkey: '', camdist: g.camdist, tilt: 23, camMode: '',
    ultra: false, kabartma: false,
    satStyle: true,        // (TOTKM>150) or (not ULTRA=true) or GOOGLE_3D_OLU=1 -> bu yolda DAİMA true
    title: { date: `${daylabel(g.frm)} ${hhmm(P[0].t)}`, totkm: pyformat(TOTKM, 1) },
    pts,
  }
  if (mates.length) { spec.mates = mates; log.push(`ortak sürüş: ${mates.length} eş sürücü`) }
  return { spec, log }
}


/** 05.11.2026 — ortak sürüş eşleri. Öndekinin kare zamanı t(f) = P[FIDX[f]].t (kesirli ara değer);
 *  eşin konumu t(f) anında doğrusal ara değerle bulunur, iz dışında uçlara sabitlenir. */
export function eslerUret(
  ham: { iz: IzNokta[]; line: string; dot: string }[], P: { t: number }[], FIDX: number[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const N = P.length
  const kareZaman = FIDX.map((fi) => {
    const i0 = Math.max(0, Math.min(N - 1, Math.floor(fi))), i1 = Math.min(N - 1, i0 + 1), fr = fi - i0
    return P[i0].t + (P[i1].t - P[i0].t) * fr
  })
  for (const m of ham) {
    const Q = m.iz.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(Number(p.t)))
      .map((p) => ({ t: Number(p.t), lat: p.lat, lon: p.lon })).sort((a, b) => a.t - b.t)
    if (Q.length < 3) continue
    const zt = Q.map((q) => q.t)
    const pos2 = kareZaman.map((tt) => {
      if (tt <= Q[0].t) return [pyround(Q[0].lon, 6), pyround(Q[0].lat, 6)]
      if (tt >= Q[Q.length - 1].t) return [pyround(Q[Q.length - 1].lon, 6), pyround(Q[Q.length - 1].lat, 6)]
      const j = Math.max(1, bisectLeft(zt, tt)), a = Q[j - 1], b = Q[j]
      const fr = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 0
      return [pyround(a.lon + (b.lon - a.lon) * fr, 6), pyround(a.lat + (b.lat - a.lat) * fr, 6)]
    })
    // iz çizgisi: en çok 1500 nokta (sayfa boyutu)
    const adim = Math.max(1, Math.ceil(Q.length / 1500))
    const pts2: number[][] = []
    for (let i = 0; i < Q.length; i += adim) pts2.push([pyround(Q[i].lon, 6), pyround(Q[i].lat, 6)])
    const son = Q[Q.length - 1]; pts2.push([pyround(son.lon, 6), pyround(son.lat, 6)])
    out.push({ line: m.line, dot: m.dot, pts2, pos2 })
  }
  return out
}
