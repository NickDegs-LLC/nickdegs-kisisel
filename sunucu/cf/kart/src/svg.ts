// kart/svg.ts — paylaşılabilir kartların SVG'si (sürüş kartı + haftalık özet kartı).
// Saf fonksiyonlar: girdi = api'nin hazırladığı veri, çıktı = SVG metni. Karo/harita YOK —
// rota Strava tarzı "rota sanatı" olarak düz çizilir (GPU yok, sıfır maliyet, ücretsiz kullanıcı dahil).
//
// FONT: yalnız Noto Sans (Latin + Kiril). CJK/Arapça/Devanagari glifi YOK → o dillerde etiket
// İngilizce basılır, yoksa kutu (tofu) çıkar. Emoji de YOK (renkli emoji fontu paketlenmedi).
// TARİH/SAYI: Intl, saat dilimi = TR günü (ortak/src/zaman.ts TR_OFSET ile aynı sabit; ortak
// modül bilerek import edilmedi: cf-deploy "ortak değişti → api gps dispatch cron" listesine kart
// girmiyor, sabit burada kalsın ki iki uç sessizce ayrışmasın — değişirse İKİ yer de güncellenir).

export type Nokta = { lat: number; lon: number }
export type Bicim = 'dikey' | 'kare'

export type SurusVeri = {
  dil: string
  kullanici?: string          // @handle (yoksa footer'da yalnız marka)
  tur: string                 // moto|car|bike|run|walk|'' (bilinmiyor)
  ts: number; to: number      // epoch (başlangıç/bitiş)
  km: number
  sureSn: number
  ortKmh: number
  maksKmh: number
  iz: Nokta[]
}

export type HaftaGun = { gun: string; km: number; n: number; dk: number }   // gun = 'YYYY-MM-DD'
export type HaftaVeri = {
  dil: string
  kullanici?: string
  gunler: HaftaGun[]          // 7 gün, eskiden yeniye
  toplamKm: number; toplamN: number; toplamDk: number
  seri: number                // üst üste aktif gün (bugünden geriye)
  iz?: Nokta[]                // haftanın en uzun sürüşü (silüet)
  izKm?: number
}

const TR_OFSET = 3 * 3600

// ---------- renkler ----------
const BG0 = '#0d131b', BG1 = '#0a0e13'
const ACCENT = '#00e5ff'            // activity-detect CFG.video_line_color ile aynı
const BAS = '#34d399', SON = '#ff3b30'   // bitiş = CFG.video_dot_color
const BEYAZ = '#ffffff', IKINCIL = 'rgba(255,255,255,0.62)', CIZGI = 'rgba(255,255,255,0.12)'

// ---------- dil ----------
type Etiket = {
  loc: string; sure: string; ort: string; maks: string; hiz: string; hafta: string
  surus: string; gun: string; seri: string; enUzun: string; sa: string; dk: string
  tur: Record<string, string>
}
const E: Record<string, Etiket> = {
  tr: { loc: 'tr-TR', sure: 'SÜRE', ort: 'ORT. HIZ', maks: 'MAKS. HIZ', hiz: 'km/s', hafta: 'HAFTALIK ÖZET',
    surus: 'sürüş', gun: 'gün', seri: '{s} GÜN ÜST ÜSTE', enUzun: 'en uzun sürüş', sa: 'sa', dk: 'dk',
    tur: { moto: 'MOTOSİKLET', car: 'ARABA', bike: 'BİSİKLET', run: 'KOŞU', walk: 'YÜRÜYÜŞ', '': 'ROTA' } },
  en: { loc: 'en-US', sure: 'TIME', ort: 'AVG SPEED', maks: 'MAX SPEED', hiz: 'km/h', hafta: 'WEEKLY RECAP',
    surus: 'rides', gun: 'days', seri: '{s}-DAY STREAK', enUzun: 'longest ride', sa: 'h', dk: 'm',
    tur: { moto: 'MOTORCYCLE', car: 'CAR', bike: 'BIKE', run: 'RUN', walk: 'WALK', '': 'ROUTE' } },
  de: { loc: 'de-DE', sure: 'DAUER', ort: 'Ø TEMPO', maks: 'MAX. TEMPO', hiz: 'km/h', hafta: 'WOCHENRÜCKBLICK',
    surus: 'Fahrten', gun: 'Tage', seri: '{s} TAGE IN FOLGE', enUzun: 'längste Fahrt', sa: 'Std', dk: 'Min',
    tur: { moto: 'MOTORRAD', car: 'AUTO', bike: 'FAHRRAD', run: 'LAUF', walk: 'SPAZIERGANG', '': 'ROUTE' } },
  fr: { loc: 'fr-FR', sure: 'DURÉE', ort: 'VIT. MOY.', maks: 'VIT. MAX', hiz: 'km/h', hafta: 'BILAN DE LA SEMAINE',
    surus: 'sorties', gun: 'jours', seri: "{s} JOURS D'AFFILÉE", enUzun: 'plus longue sortie', sa: 'h', dk: 'min',
    tur: { moto: 'MOTO', car: 'VOITURE', bike: 'VÉLO', run: 'COURSE', walk: 'MARCHE', '': 'ITINÉRAIRE' } },
  es: { loc: 'es-ES', sure: 'TIEMPO', ort: 'VEL. MEDIA', maks: 'VEL. MÁX.', hiz: 'km/h', hafta: 'RESUMEN SEMANAL',
    surus: 'rutas', gun: 'días', seri: '{s} DÍAS SEGUIDOS', enUzun: 'ruta más larga', sa: 'h', dk: 'min',
    tur: { moto: 'MOTO', car: 'COCHE', bike: 'BICI', run: 'CARRERA', walk: 'PASEO', '': 'RUTA' } },
  it: { loc: 'it-IT', sure: 'DURATA', ort: 'VEL. MEDIA', maks: 'VEL. MAX', hiz: 'km/h', hafta: 'RIEPILOGO SETTIMANALE',
    surus: 'giri', gun: 'giorni', seri: '{s} GIORNI DI FILA', enUzun: 'giro più lungo', sa: 'h', dk: 'min',
    tur: { moto: 'MOTO', car: 'AUTO', bike: 'BICI', run: 'CORSA', walk: 'CAMMINATA', '': 'PERCORSO' } },
  pt: { loc: 'pt-BR', sure: 'TEMPO', ort: 'VEL. MÉDIA', maks: 'VEL. MÁX.', hiz: 'km/h', hafta: 'RESUMO DA SEMANA',
    surus: 'pedais', gun: 'dias', seri: '{s} DIAS SEGUIDOS', enUzun: 'pedal mais longo', sa: 'h', dk: 'min',
    tur: { moto: 'MOTO', car: 'CARRO', bike: 'BIKE', run: 'CORRIDA', walk: 'CAMINHADA', '': 'ROTA' } },
  ru: { loc: 'ru-RU', sure: 'ВРЕМЯ', ort: 'СР. СКОРОСТЬ', maks: 'МАКС. СКОРОСТЬ', hiz: 'км/ч', hafta: 'ИТОГИ НЕДЕЛИ',
    surus: 'поездок', gun: 'дн.', seri: 'СЕРИЯ {s} ДН.', enUzun: 'самая длинная поездка', sa: 'ч', dk: 'мин',
    tur: { moto: 'МОТОЦИКЛ', car: 'АВТО', bike: 'ВЕЛОСИПЕД', run: 'БЕГ', walk: 'ПРОГУЛКА', '': 'МАРШРУТ' } },
}
function etiket(dil: string): Etiket {
  return E[(dil || 'en').split('-')[0].toLowerCase()] ?? E.en
}

// ---------- biçimlendirme ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

function sayi(n: number, loc: string, ondalik: number): string {
  try {
    return new Intl.NumberFormat(loc, { minimumFractionDigits: ondalik, maximumFractionDigits: ondalik }).format(n)
  } catch { return n.toFixed(ondalik) }
}
/** km: 100'ün üstünde ondalıksız, altında 1 ondalık. */
const kmStr = (km: number, loc: string) => sayi(km, loc, km >= 100 ? 0 : 1)

function trDate(ts: number): Date { return new Date((ts + TR_OFSET) * 1000) }

function tarih(ts: number, loc: string, secenek: Intl.DateTimeFormatOptions): string {
  try { return new Intl.DateTimeFormat(loc, { ...secenek, timeZone: 'UTC' }).format(trDate(ts)) }
  catch { return trDate(ts).toISOString().slice(0, 10) }
}
const uzunTarih = (ts: number, loc: string) => tarih(ts, loc, { day: 'numeric', month: 'long', year: 'numeric' })
const saat = (ts: number, loc: string) => tarih(ts, loc, { hour: '2-digit', minute: '2-digit', hour12: false })

function sure(sn: number, e: Etiket): string {
  const dk = Math.max(0, Math.round(sn / 60))
  const h = Math.floor(dk / 60), m = dk % 60
  return h ? `${h} ${e.sa} ${m} ${e.dk}` : `${m} ${e.dk}`
}

function gunHarfi(gun: string, loc: string): string {
  try { return new Intl.DateTimeFormat(loc, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(gun + 'T12:00:00Z')) }
  catch { return gun.slice(-2) }
}

/** 'YYYY-MM-DD' → o günün TR öğle epoch'u (tarih yazdırmak için). */
function gunEpoch(gun: string): number { return Math.floor(Date.parse(gun + 'T12:00:00Z') / 1000) - TR_OFSET }

function tarihAraligi(g0: string, g1: string, loc: string): string {
  const a = trDate(gunEpoch(g0)), b = trDate(gunEpoch(g1))
  try {
    // Intl.formatRange yerel kurala göre birleştirir: "20–26 Ekim 2026" / "October 20 – 26, 2026"
    const f = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    if (typeof f.formatRange === 'function') return f.formatRange(a, b)
    return `${f.format(a)} – ${f.format(b)}`
  } catch { return `${g0} – ${g1}` }
}

// ---------- rota geometrisi ----------
type XY = { x: number; y: number }
type Kutu = { x: number; y: number; w: number; h: number }

/** Douglas-Peucker (yığınla; özyineleme yok — 20 bin noktada yığın taşmasın). Piksel toleransı. */
function sadelestir(p: XY[], tol: number): XY[] {
  if (p.length <= 2) return p
  const tut = new Uint8Array(p.length); tut[0] = 1; tut[p.length - 1] = 1
  const yigin: Array<[number, number]> = [[0, p.length - 1]]
  const t2 = tol * tol
  while (yigin.length) {
    const [a, b] = yigin.pop()!
    if (b - a < 2) continue
    const ax = p[a].x, ay = p[a].y, dx = p[b].x - ax, dy = p[b].y - ay
    const L2 = dx * dx + dy * dy || 1e-12
    let enUzak = -1, idx = -1
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((p[i].x - ax) * dx + (p[i].y - ay) * dy) / L2))
      const ex = p[i].x - (ax + t * dx), ey = p[i].y - (ay + t * dy)
      const d = ex * ex + ey * ey
      if (d > enUzak) { enUzak = d; idx = i }
    }
    if (enUzak > t2 && idx > 0) { tut[idx] = 1; yigin.push([a, idx], [idx, b]) }
  }
  const out: XY[] = []
  for (let i = 0; i < p.length; i++) if (tut[i]) out.push(p[i])
  return out
}

/** İzi kutuya sığdırır (en-boy korunur, ortalanır). Nokta yoksa null. */
function izYerlestir(iz: Nokta[], k: Kutu, pad: number): { d: string; bas: XY; son: XY } | null {
  const pts = iz.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  if (!pts.length) return null
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const kx = Math.cos((lat0 * Math.PI) / 180) || 1
  const pr = pts.map((p) => ({ x: p.lon * kx, y: -p.lat }))
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const q of pr) { if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y }
  const dx = Math.max(maxX - minX, 1e-5), dy = Math.max(maxY - minY, 1e-5)
  const olcek = Math.min((k.w - 2 * pad) / dx, (k.h - 2 * pad) / dy)
  const ox = k.x + (k.w - dx * olcek) / 2, oy = k.y + (k.h - dy * olcek) / 2
  const px = pr.map((q) => ({ x: ox + (q.x - minX) * olcek, y: oy + (q.y - minY) * olcek }))
  const s = sadelestir(px, 1.2)
  const f = (v: number) => (Math.round(v * 10) / 10).toString()
  let d = `M${f(s[0].x)} ${f(s[0].y)}`
  for (let i = 1; i < s.length; i++) d += `L${f(s[i].x)} ${f(s[i].y)}`
  return { d, bas: s[0], son: s[s.length - 1] }
}

function rotaSvg(iz: Nokta[], k: Kutu, kalin = 9): string {
  const y = izYerlestir(iz, k, 40)
  if (!y) return ''
  const tekNokta = y.d.indexOf('L') < 0
  const yol = tekNokta ? '' :
    `<path d="${y.d}" fill="none" stroke="${ACCENT}" stroke-opacity="0.35" stroke-width="${kalin * 3}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>` +
    `<path d="${y.d}" fill="none" stroke="${ACCENT}" stroke-width="${kalin}" stroke-linecap="round" stroke-linejoin="round"/>`
  const r = Math.max(8, Math.round(kalin * 1.5))
  return yol +
    `<circle cx="${y.bas.x}" cy="${y.bas.y}" r="${r}" fill="${BAS}" stroke="${BEYAZ}" stroke-width="3"/>` +
    `<circle cx="${y.son.x}" cy="${y.son.y}" r="${r}" fill="${SON}" stroke="${BEYAZ}" stroke-width="3"/>`
}

// ---------- ortak parçalar ----------
function govdeBas(W: number, H: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Noto Sans">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG0}"/><stop offset="1" stop-color="${BG1}"/></linearGradient>` +
    `<radialGradient id="isik" cx="0.15" cy="0.1" r="0.8"><stop offset="0" stop-color="${ACCENT}" stop-opacity="0.14"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>` +
    `<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12"/></filter>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#isik)"/>`
}

function altBilgi(W: number, yCizgi: number, yMetin: number, kullanici: string | undefined, boyut: number): string {
  const k = kullanici ? `<text x="${W - 90}" y="${yMetin}" text-anchor="end" font-size="${Math.round(boyut * 0.78)}" fill="${IKINCIL}">@${esc(kullanici)}</text>` : ''
  return `<line x1="90" y1="${yCizgi}" x2="${W - 90}" y2="${yCizgi}" stroke="${CIZGI}" stroke-width="2"/>` +
    `<text x="90" y="${yMetin}" font-size="${boyut}" font-weight="bold" fill="${BEYAZ}">Move Log</text>` +
    `<circle cx="${90 + boyut * 4.55}" cy="${yMetin - boyut * 0.08}" r="${Math.round(boyut * 0.14)}" fill="${ACCENT}"/>` + k
}

function baslik(y1: number, y2: number, ust: string, alt: string, b1: number, b2: number): string {
  return `<text x="90" y="${y1}" font-size="${b1}" font-weight="bold" letter-spacing="6" fill="${ACCENT}">${esc(ust)}</text>` +
    `<text x="90" y="${y2}" font-size="${b2}" fill="${IKINCIL}">${esc(alt)}</text>`
}

function buyukKm(y: number, km: string, b1: number, b2: number): string {
  return `<text x="90" y="${y}" fill="${BEYAZ}"><tspan font-size="${b1}" font-weight="bold">${km}</tspan>` +
    `<tspan dx="${Math.round(b2 * 0.3)}" font-size="${b2}" fill="${IKINCIL}">km</tspan></text>`
}

function istatistikSatiri(yE: number, yD: number, kolon: Array<[string, string]>, bE: number, bD: number, W: number): string {
  const adim = (W - 180) / kolon.length
  let s = ''
  kolon.forEach(([e, d], i) => {
    const x = Math.round(90 + i * adim)
    s += `<text x="${x}" y="${yE}" font-size="${bE}" letter-spacing="3" fill="${IKINCIL}">${esc(e)}</text>` +
      `<text x="${x}" y="${yD}" font-size="${bD}" font-weight="bold" fill="${BEYAZ}">${esc(d)}</text>`
  })
  return s
}

// ---------- SÜRÜŞ KARTI ----------
export function surusKarti(v: SurusVeri, bicim: Bicim): string {
  const e = etiket(v.dil), loc = e.loc
  const W = 1080, H = bicim === 'dikey' ? 1920 : 1080
  const turAd = e.tur[v.tur] ?? e.tur['']
  const altSatir = `${uzunTarih(v.ts, loc)} · ${saat(v.ts, loc)}–${saat(v.to, loc)}`
  const kolon: Array<[string, string]> = [
    [e.sure, sure(v.sureSn, e)],
    [e.ort, `${sayi(v.ortKmh, loc, 0)} ${e.hiz}`],
    [e.maks, `${sayi(v.maksKmh, loc, 0)} ${e.hiz}`],
  ]
  let s = govdeBas(W, H)
  if (bicim === 'dikey') {
    s += baslik(150, 208, turAd, altSatir, 34, 36)
    s += rotaSvg(v.iz, { x: 90, y: 300, w: 900, h: 940 })
    s += buyukKm(1440, kmStr(v.km, loc), 170, 60)
    s += istatistikSatiri(1565, 1640, kolon, 28, 60, W)
    s += altBilgi(W, 1760, 1842, v.kullanici, 44)
  } else {
    s += baslik(112, 162, turAd, altSatir, 28, 30)
    s += rotaSvg(v.iz, { x: 90, y: 210, w: 900, h: 450 }, 8)
    s += buyukKm(815, kmStr(v.km, loc), 130, 50)
    s += istatistikSatiri(905, 962, kolon, 24, 46, W)
    s += altBilgi(W, 1008, 1050, v.kullanici, 34)
  }
  return s + '</svg>'
}

// ---------- HAFTALIK ÖZET KARTI ----------
function cubuklar(g: HaftaGun[], k: Kutu, loc: string, bugun: string, bEtiket: number, bDeger: number): string {
  if (!g.length) return ''
  const maxKm = Math.max(...g.map((x) => x.km), 0.1)
  const genis = Math.round(k.w / g.length * 0.62)
  const adim = k.w / g.length
  const taban = k.y + k.h
  let s = ''
  g.forEach((d, i) => {
    const cx = k.x + adim * i + adim / 2
    const h = d.km > 0 ? Math.max(8, Math.round((k.h - bDeger - 20) * (d.km / maxKm))) : 5
    const x = Math.round(cx - genis / 2), y = taban - h
    const dolu = d.km > 0
    s += `<rect x="${x}" y="${y}" width="${genis}" height="${h}" rx="${Math.min(10, genis / 4)}" fill="${dolu ? ACCENT : 'rgba(255,255,255,0.12)'}" fill-opacity="${dolu ? (d.gun === bugun ? 1 : 0.75) : 1}"/>`
    if (dolu) s += `<text x="${cx}" y="${y - 14}" text-anchor="middle" font-size="${bDeger}" font-weight="bold" fill="${BEYAZ}">${kmStr(d.km, loc)}</text>`
    s += `<text x="${cx}" y="${taban + bEtiket + 16}" text-anchor="middle" font-size="${bEtiket}" fill="${d.gun === bugun ? ACCENT : IKINCIL}">${esc(gunHarfi(d.gun, loc))}</text>`
  })
  return s
}

export function haftaKarti(v: HaftaVeri, bicim: Bicim): string {
  const e = etiket(v.dil), loc = e.loc
  const W = 1080, H = bicim === 'dikey' ? 1920 : 1080
  const g = v.gunler.slice(-7)
  const g0 = g[0]?.gun ?? '', g1 = g[g.length - 1]?.gun ?? ''
  const aktifGun = g.filter((d) => d.n > 0).length
  const alt = `${v.toplamN} ${e.surus} · ${aktifGun} ${e.gun} · ${sure(v.toplamDk * 60, e)}`
  let s = govdeBas(W, H)
  if (bicim === 'dikey') {
    s += baslik(150, 208, e.hafta, tarihAraligi(g0, g1, loc), 34, 36)
    s += buyukKm(430, kmStr(v.toplamKm, loc), 170, 60)
    s += `<text x="90" y="520" font-size="40" fill="${IKINCIL}">${esc(alt)}</text>`
    s += cubuklar(g, { x: 90, y: 640, w: 900, h: 480 }, loc, g1, 32, 30)
    if (v.seri >= 2) s += `<text x="90" y="1290" font-size="40" font-weight="bold" letter-spacing="4" fill="${ACCENT}">${esc(e.seri.replace('{s}', String(v.seri)))}</text>`
    if (v.iz && v.iz.length > 1) {
      s += rotaSvg(v.iz, { x: 90, y: 1340, w: 900, h: 380 }, 6)
      if (v.izKm) s += `<text x="${W - 90}" y="1740" text-anchor="end" font-size="30" fill="${IKINCIL}">${kmStr(v.izKm, loc)} km · ${esc(e.enUzun)}</text>`
    }
    s += altBilgi(W, 1760, 1842, v.kullanici, 44)
  } else {
    s += baslik(112, 162, e.hafta, tarihAraligi(g0, g1, loc), 28, 30)
    s += buyukKm(330, kmStr(v.toplamKm, loc), 120, 50)
    s += `<text x="90" y="400" font-size="34" fill="${IKINCIL}">${esc(alt)}</text>`
    s += cubuklar(g, { x: 90, y: 460, w: 900, h: 380 }, loc, g1, 28, 26)
    if (v.seri >= 2) s += `<text x="90" y="965" font-size="34" font-weight="bold" letter-spacing="4" fill="${ACCENT}">${esc(e.seri.replace('{s}', String(v.seri)))}</text>`
    s += altBilgi(W, 1008, 1050, v.kullanici, 34)
  }
  return s + '</svg>'
}
