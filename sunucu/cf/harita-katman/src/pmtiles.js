// cf-harita-katman — PMTiles v3 okuyucu, R2 ARALIK okumalı (02.09, Barış: "yüzde yüz sunucu
// bağımsız"). `scripts/pmtiles_okuyucu.py`nin birebir portu (başlık, dizin çözme, Hilbert
// karo kimliği, ikili arama, ≤4 yaprak seviyesi) — tek fark: dosya `open()` yerine
// `env.PMTILES.get(anahtar, {range})`.
//
// KAYNAK: ORTAK katman `hooder-harita/pmtiles/20260809.pmtiles` (137 GB, Protomaps, z0-15).
// ⚠️ ORTAK KATMAN KURALI (Barış 30.08): "Sadece Hooder yazabilecek" → bu modül **SALT-OKUR**;
// `put/delete` ÇAĞRISI YASAK. Anahtar `PMTILES_ANAHTAR` var'ından (arşiv yenilenince tek satır).
//
// Bellek: başlık + kök dizin isolate ömrünce tutulur; yaprak dizinleri LRU (96) — Python'daki
// `_YAPRAK_MAX` ile aynı. Aynı yaprağa eşzamanlı 16 istek (harman'ın 16 torunu) TEK okumaya
// katlanır (`_ucus`), yoksa R2'ye 16 aynı aralık gider.

const BASLIK = 127;
const ON_OKUMA = 16384; // spec: kök dizin ilk 16 KB içinde
const YAPRAK_MAX = 96;

let _durum = null; // { anahtar, hdr, kok }
let _durumSoz = null;
const _yaprak = new Map(); // "ofs,uz" → girdiler
const _ucus = new Map(); // "ofs,uz" → Promise (aynı yaprağa eşzamanlı okuma birleşimi)

function anahtar(env) {
  return env.PMTILES_ANAHTAR || "pmtiles/20260809.pmtiles";
}

async function aralik(env, ofs, uz) {
  const o = await env.PMTILES.get(anahtar(env), { range: { offset: ofs, length: uz } });
  if (!o) throw new Error("pmtiles yok: " + anahtar(env));
  return new Uint8Array(await o.arrayBuffer());
}

export async function gunzip(u8) {
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  w.write(u8).catch(() => {});
  w.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

async function acKodla(u8, sikistirma) {
  if (sikistirma === 2) return gunzip(u8);
  if (sikistirma === 1 || sikistirma === 0) return u8;
  throw new Error("desteklenmeyen sıkıştırma " + sikistirma);
}

// 64 bit'e kadar varint (ofsetler 137 GB → 2^37; çarpma ile, kaydırma 32 bit'te taşar)
function varint(b, i) {
  let r = 0;
  let carpan = 1;
  for (;;) {
    const x = b[i++];
    r += (x & 0x7f) * carpan;
    if (!(x & 0x80)) return [r, i];
    carpan *= 128;
  }
}

/** Dizin çöz → { tid: Float64Array, ofs: Float64Array, uz: Uint32Array, run: Uint32Array, n } */
function dizinCoz(veri) {
  let [n, i] = varint(veri, 0);
  const tid = new Float64Array(n);
  const run = new Uint32Array(n);
  const uz = new Uint32Array(n);
  const ofs = new Float64Array(n);
  let son = 0;
  for (let k = 0; k < n; k++) {
    let v;
    [v, i] = varint(veri, i);
    son += v;
    tid[k] = son;
  }
  for (let k = 0; k < n; k++) {
    let v;
    [v, i] = varint(veri, i);
    run[k] = v;
  }
  for (let k = 0; k < n; k++) {
    let v;
    [v, i] = varint(veri, i);
    uz[k] = v;
  }
  for (let k = 0; k < n; k++) {
    let v;
    [v, i] = varint(veri, i);
    ofs[k] = v === 0 && k > 0 ? ofs[k - 1] + uz[k - 1] : v - 1;
  }
  return { tid, ofs, uz, run, n };
}

/** Hilbert karo kimliği (spec `zxyToTileId`; Python `_tile_id` ile aynı) */
export function karoKimligi(z, x, y) {
  let taban = 0;
  for (let i = 0; i < z; i++) taban += 4 ** i; // ((1<<2z)-1)/3, z≤15 için tam
  const n = 2 ** z;
  let tx = x;
  let ty = y;
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      const t = tx;
      tx = ty;
      ty = t;
    }
  }
  return taban + d;
}

/** İkili arama → [ofs, uz, yaprakMi] | null (spec `findTile`) */
function bul(g, tid) {
  let m = 0;
  let n = g.n - 1;
  while (m <= n) {
    const k = (n + m) >> 1;
    const c = tid - g.tid[k];
    if (c > 0) m = k + 1;
    else if (c < 0) n = k - 1;
    else return [g.ofs[k], g.uz[k], g.run[k] === 0];
  }
  if (n >= 0) {
    if (g.run[n] === 0) return [g.ofs[n], g.uz[n], true];
    if (tid - g.tid[n] < g.run[n]) return [g.ofs[n], g.uz[n], false];
  }
  return null;
}

function u64(dv, o) {
  return Number(dv.getBigUint64(o, true));
}

async function basla(env) {
  const ad = anahtar(env);
  if (_durum && _durum.anahtar === ad) return _durum;
  if (_durumSoz) return _durumSoz;
  _durumSoz = (async () => {
    try {
      const on = await aralik(env, 0, ON_OKUMA);
      if (on.length < BASLIK) throw new Error("pmtiles başlık kısa");
      const magic = String.fromCharCode(...on.subarray(0, 7));
      if (magic !== "PMTiles" || on[7] !== 3) throw new Error("pmtiles v3 değil");
      const dv = new DataView(on.buffer, on.byteOffset, on.byteLength);
      const hdr = {
        kokO: u64(dv, 8),
        kokU: u64(dv, 16),
        yaprakO: u64(dv, 40),
        veriO: u64(dv, 56),
        ic: on[97],
        tc: on[98],
        minz: on[100],
        maxz: on[101],
      };
      let kokHam;
      if (hdr.kokO + hdr.kokU <= on.length) kokHam = on.subarray(hdr.kokO, hdr.kokO + hdr.kokU);
      else kokHam = await aralik(env, hdr.kokO, hdr.kokU);
      const kok = dizinCoz(await acKodla(kokHam, hdr.ic));
      _durum = { anahtar: ad, hdr, kok };
      _yaprak.clear();
      return _durum;
    } finally {
      _durumSoz = null;
    }
  })();
  return _durumSoz;
}

async function yaprakOku(env, hdr, ofs, uz) {
  const k = ofs + "," + uz;
  const var_ = _yaprak.get(k);
  if (var_) {
    _yaprak.delete(k); // LRU: sona taşı
    _yaprak.set(k, var_);
    return var_;
  }
  let soz = _ucus.get(k);
  if (!soz) {
    soz = (async () => {
      try {
        const d = await acKodla(await aralik(env, hdr.yaprakO + ofs, uz), hdr.ic);
        const g = dizinCoz(d);
        _yaprak.set(k, g);
        while (_yaprak.size > YAPRAK_MAX) _yaprak.delete(_yaprak.keys().next().value);
        return g;
      } finally {
        _ucus.delete(k);
      }
    })();
    _ucus.set(k, soz);
  }
  return soz;
}

/**
 * Ham MVT (gzip AÇILMIŞ) → Uint8Array | null (karo yok). R2/biçim hatası FIRLATIR — çağıran
 * zincirde bir sonraki kaynağa geçer (Python'daki 3 deneme + None yerine).
 */
export async function karoOku(env, z, x, y) {
  const { hdr, kok } = await basla(env);
  if (z < hdr.minz || z > hdr.maxz) return null;
  const n = 2 ** z;
  if (!(x >= 0 && x < n && y >= 0 && y < n)) return null;
  const tid = karoKimligi(z, x, y);
  let g = kok;
  for (let seviye = 0; seviye < 4; seviye++) {
    const s = bul(g, tid);
    if (!s) return null;
    const [ofs, uz, yaprakMi] = s;
    if (!yaprakMi) {
      if (uz === 0) return null;
      const ham = await aralik(env, hdr.veriO + ofs, uz);
      return hdr.tc === 2 ? gunzip(ham) : ham;
    }
    g = await yaprakOku(env, hdr, ofs, uz);
  }
  return null;
}

/** Sağlık/teşhis: başlık özeti (gizli bilgi yok) */
export async function pmtilesOzet(env) {
  const { hdr, kok } = await basla(env);
  return { anahtar: anahtar(env), minz: hdr.minz, maxz: hdr.maxz, kok: kok.n, yaprakOnbellek: _yaprak.size };
}
