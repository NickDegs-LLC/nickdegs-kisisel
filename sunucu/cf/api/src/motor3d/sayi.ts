// motor3d — Python sayı davranışının birebir eşlenikleri.
// NEDEN GEREKLİ: spec.json'daki her sayı `round(x,6)` / `round(x,1)` / f"{x:.1f}" ile üretiliyor.
// Python round/format = ÇİFTE-YUVARLAMA yok + BANKER'S (yarımlar çifte). JS `Math.round(x*10)/10`
// hem çarpmadan hata alır hem yarımı YUKARI atar -> son hanede sessiz sapma.
// Burada double'ın TAM ondalık açılımı alınıp (toFixed exact'tir) elle yarım-çift yuvarlanır.

/** double'ın tam ondalık açılımı (işaretsiz) — |x| < 1e21 için toFixed exact'tir.
 *  nd+50 hane: bizim büyüklüklerde (|x|<1e6) ikilik kesir en fazla ~46 hane -> tam kapsar. */
function tamOndalik(a: number, nd: number): string {
  return a.toFixed(Math.min(100, nd + 50))
}

/** Python round(x, nd) — yarım-ÇİFTE (banker's), tek geçişte. */
export function pyround(x: number, nd: number): number {
  if (!Number.isFinite(x)) return x
  const neg = x < 0 || Object.is(x, -0)
  const a = Math.abs(x)
  if (a >= 1e15) return x                     // bu büyüklükte kesir yok
  const s = tamOndalik(a, nd)
  const nokta = s.indexOf('.')
  const hane = s.slice(0, nokta) + s.slice(nokta + 1)   // tüm haneler, nokta yok
  const tut = nokta + nd                                // saklanacak hane sayısı
  let kalan = hane.slice(0, tut)
  const artik = hane.slice(tut)
  let yukari = false
  if (artik) {
    const ilk = artik.charCodeAt(0) - 48
    if (ilk > 5) yukari = true
    else if (ilk === 5) {
      yukari = /[1-9]/.test(artik.slice(1)) ? true : ((kalan.charCodeAt(kalan.length - 1) - 48) % 2) === 1
    }
  }
  if (yukari) {
    // ondalık string üzerinde +1 (taşma dahil)
    const d = kalan.split('')
    let i = d.length - 1
    for (;;) {
      if (i < 0) { d.unshift('1'); break }
      if (d[i] === '9') { d[i] = '0'; i-- } else { d[i] = String(d[i].charCodeAt(0) - 48 + 1); break }
    }
    kalan = d.join('')
  }
  const tam = kalan.length - nd
  const metin = (tam <= 0 ? '0.' + '0'.repeat(-tam) + kalan : kalan.slice(0, tam) + '.' + kalan.slice(tam))
  const v = Number(metin)
  return neg ? -v : v
}

/** Python f"{x:.n f}" — yine yarım-ÇİFTE (JS toFixed yarımı BÜYÜĞE atar). */
export function pyformat(x: number, nd: number): string {
  if (!Number.isFinite(x)) return String(x)
  const neg = x < 0
  const a = Math.abs(x)
  const s = tamOndalik(a, nd)
  const nokta = s.indexOf('.')
  const hane = s.slice(0, nokta) + s.slice(nokta + 1)
  const tut = nokta + nd
  let kalan = hane.slice(0, tut)
  const artik = hane.slice(tut)
  let yukari = false
  if (artik) {
    const ilk = artik.charCodeAt(0) - 48
    if (ilk > 5) yukari = true
    else if (ilk === 5) {
      yukari = /[1-9]/.test(artik.slice(1)) ? true : ((kalan.charCodeAt(kalan.length - 1) - 48) % 2) === 1
    }
  }
  if (yukari) {
    const d = kalan.split('')
    let i = d.length - 1
    for (;;) {
      if (i < 0) { d.unshift('1'); break }
      if (d[i] === '9') { d[i] = '0'; i-- } else { d[i] = String(d[i].charCodeAt(0) - 48 + 1); break }
    }
    kalan = d.join('')
  }
  const tam = kalan.length - nd
  const govde = tam <= 0 ? '0.' + '0'.repeat(-tam) + kalan : (nd === 0 ? kalan : kalan.slice(0, tam) + '.' + kalan.slice(tam))
  return (neg ? '-' : '') + govde        // Python: f"{-0.04:.1f}" == "-0.0" (işaret korunur)
}

/** Python round(x) (ndigits yok) -> int, yarım-ÇİFTE. Liste seyreltmede kullanılır. */
export function pyroundInt(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 ? (Math.abs(r % 2) === 1 ? r - Math.sign(x) : r) : r
}

/** bisect.bisect_left(a, x) */
export function bisectLeft(a: number[], x: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m }
  return lo
}

/** route-video.py hav() birebir: math.radians = x*(pi/180) (CPython degToRad sabiti). */
const RAD = Math.PI / 180
export function hav(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const la1 = a[0] * RAD, lo1 = a[1] * RAD, la2 = b[0] * RAD, lo2 = b[1] * RAD
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
