// cf-harita-katman — GHS-BUILT-H ANBH bina yüksekliği grid'i, R2 bloklarından (02.09, Barış:
// "yüzde yüz sunucu bağımsız"). `harita-proxy.py:616-641` (rasterio örneklemesi) portu.
//
// VERİ: scripts/ghs-r2-export.py → MATCH_CACHE `ghs/index.json` + `ghs/{ad}/{by}_{bx}.bin`
//   (gzip, 256×256 uint16 LE, DESİMETRE = Python round(val,1)*10; nodata/≤0 = 0; boş blok yazılmaz).
// PROJEKSİYON: World_Mollweide (ESRI:54009) — PROJ `moll` KÜRESEL ileri dönüşümünün birebir kopyası
//   (aynı Newton döngüsü: 10 adım, 1e-7 tolerans; R = 6378137 = WGS84 a, PROJ küresel projeksiyonda
//   `a`yı kullanır, es=0). 02.09'da rasterio.warp.transform ile ölçülüp doğrulandı.
// ÖRNEKLEME (Python ile aynı): lons = bb[0]+(bb[2]-bb[0])*i/(n-1), lats = bb[1]+(bb[3]-bb[1])*j/(n-1),
//   k = j*n+i; her raster DOSYA ADI SIRASIYLA (R5_C21 … R6_C23), sınır KAPSAYICI, satır/sütun floor,
//   `val != nodata and val > 0` → grid[k] = round(val,1) (sonraki raster ezer).
// ÇIKTI: Python `json.dumps` ile BAYT BAYT aynı metin (", " / ": " ayraçları, `3.0`/`0.0` biçimi).
import { gunzip } from "./pmtiles.js";

const R = 6378137.0;
const C_X = (2 * Math.SQRT2) / Math.PI; // PROJ moll: C_x = 2r/π, r = √2
const C_Y = Math.SQRT2; //                        C_y = r
const BLOK = 256;
const BLOK_LRU = 48; // izolat başına ~6 MB (48 × 128 KB)

let indeksSoz = null; // Promise<indeks> — izolat ömrünce bir kez okunur
const blokOnbellek = new Map(); // "ad/by_bx" → Promise<Uint16Array|null>; Map ekleme sırası = LRU

/** PROJ `moll_s_forward` birebir (derece → metre). */
export function mollweide(lonDeg, latDeg) {
  const lam = lonDeg * (Math.PI / 180);
  let phi = latDeg * (Math.PI / 180);
  const k = Math.PI * Math.sin(phi);
  let i;
  for (i = 10; i; --i) {
    const V = (phi + Math.sin(phi) - k) / (1 + Math.cos(phi));
    phi -= V;
    if (Math.abs(V) < 1e-7) break;
  }
  if (!i) phi = phi < 0 ? -Math.PI / 2 : Math.PI / 2;
  else phi *= 0.5;
  return [R * (C_X * lam * Math.cos(phi)), R * (C_Y * Math.sin(phi))];
}

async function indeks(env) {
  if (!indeksSoz) {
    indeksSoz = (async () => {
      const o = await env.MATCH_CACHE.get("ghs/index.json");
      if (!o) throw new Error("ghs/index.json yok");
      const v = await o.json();
      if (!v || !Array.isArray(v.rasterlar) || v.blok !== BLOK) throw new Error("ghs index biçimi");
      return v;
    })();
    indeksSoz.catch(() => {
      indeksSoz = null; // sonraki istek yeniden denesin
    });
  }
  return indeksSoz;
}

function dolu(r, by, bx) {
  const i = by * r.nbx + bx;
  const b = parseInt(r.dolu.substr(i >> 3 << 1, 2), 16);
  return ((b >> (7 - (i & 7))) & 1) === 1;
}

/** Blok → Uint16Array (65536) | null (boş = sıfır). Eksik/bozuk blok FIRLATIR (sessiz sıfır YOK). */
function blok(env, r, by, bx) {
  if (!dolu(r, by, bx)) return Promise.resolve(null);
  const ad = `${r.ad}/${by}_${bx}`;
  let p = blokOnbellek.get(ad);
  if (p) {
    blokOnbellek.delete(ad); // LRU: sona taşı
    blokOnbellek.set(ad, p);
    return p;
  }
  p = (async () => {
    const o = await env.MATCH_CACHE.get("ghs/" + ad + ".bin");
    if (!o) throw new Error("ghs blok yok: " + ad);
    const u8 = await gunzip(new Uint8Array(await o.arrayBuffer()));
    if (u8.length !== BLOK * BLOK * 2) throw new Error("ghs blok boyu: " + ad);
    // uint16 LE; Uint16Array görünümü için 2-hizalı kopya (gunzip çıktısı hizalı, yine de güvenli)
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const out = new Uint16Array(BLOK * BLOK);
    for (let i = 0; i < out.length; i++) out[i] = dv.getUint16(i * 2, true);
    return out;
  })();
  p.catch(() => blokOnbellek.delete(ad));
  blokOnbellek.set(ad, p);
  while (blokOnbellek.size > BLOK_LRU) blokOnbellek.delete(blokOnbellek.keys().next().value);
  return p;
}

/**
 * bbox [minlon,minlat,maxlon,maxlat] + n → Uint16Array(n*n) DESİMETRE grid (Python grid'in ×10'u).
 * R2/indeks hatası FIRLATIR — çağıran origin/sıfır-grid'e düşer.
 */
export async function ghsGrid(env, bb, n) {
  if (!env.MATCH_CACHE) throw new Error("MATCH_CACHE bağı yok");
  const ix = await indeks(env);
  const N = n * n;
  const xs = new Float64Array(N);
  const ys = new Float64Array(N);
  for (let j = 0; j < n; j++) {
    const lat = bb[1] + ((bb[3] - bb[1]) * j) / (n - 1);
    for (let i = 0; i < n; i++) {
      const lon = bb[0] + ((bb[2] - bb[0]) * i) / (n - 1);
      const m = mollweide(lon, lat);
      xs[j * n + i] = m[0];
      ys[j * n + i] = m[1];
    }
  }
  const grid = new Uint16Array(N);
  for (const r of ix.rasterlar) {
    // 1. geçiş: hangi bloklar gerekli (paralel çek); 2. geçiş: örnekle
    const hucre = r.hucre || 100;
    const gerekli = new Map();
    const konum = new Int32Array(N).fill(-1); // blok indeksi*65536 + hücre; -1 = raster dışı
    for (let k = 0; k < N; k++) {
      const x = xs[k];
      const y = ys[k];
      if (!(x >= r.left && x <= r.right && y >= r.bottom && y <= r.top)) continue; // Python: kapsayıcı sınır
      const col = Math.floor((x - r.left) / hucre);
      const row = Math.floor((r.top - y) / hucre);
      if (!(row >= 0 && row < r.h && col >= 0 && col < r.w)) continue; // rasterio sample_gen → nodata
      const by = row >> 8;
      const bx = col >> 8;
      const ad = by * r.nbx + bx;
      if (!gerekli.has(ad)) gerekli.set(ad, blok(env, r, by, bx));
      konum[k] = ad * 65536 + ((row & 255) * BLOK + (col & 255));
    }
    if (!gerekli.size) continue;
    const bloklar = new Map();
    for (const [ad, p] of gerekli) bloklar.set(ad, await p);
    for (let k = 0; k < N; k++) {
      const q = konum[k];
      if (q < 0) continue;
      const b = bloklar.get(Math.floor(q / 65536));
      if (!b) continue; // boş blok = tüm hücreler 0/nodata → Python'da atlanır
      const dm = b[q % 65536];
      if (dm > 0) grid[k] = dm; // val>0 (ve nodata değil): sonraki raster ezer
    }
  }
  return grid;
}

/** Python `repr(float)` — json.dumps'ın float biçimi (3.0, 0.1, 1e-05, 1e+16). */
export function pyFloat(v) {
  if (Object.is(v, -0)) return "-0.0";
  if (!Number.isFinite(v)) return v !== v ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
  let s;
  if (v !== 0 && (Math.abs(v) < 1e-4 || Math.abs(v) >= 1e16)) s = v.toExponential();
  else s = String(v);
  if (/e/.test(s)) return s.replace(/e([+-])(\d)$/, "e$10$2"); // 1e-7 → 1e-07 (Python 2 haneli üs)
  return Number.isInteger(v) ? s + ".0" : s;
}

/** `json.dumps({"n":n,"bbox":bb,"grid":grid,"kule":[]})` ile bayt bayt aynı metin. */
export function ghsJson(n, bb, dmGrid) {
  const g = new Array(dmGrid.length);
  for (let i = 0; i < dmGrid.length; i++) g[i] = pyFloat(dmGrid[i] / 10);
  return `{"n": ${n}, "bbox": [${bb.map(pyFloat).join(", ")}], "grid": [${g.join(", ")}], "kule": []}`;
}
