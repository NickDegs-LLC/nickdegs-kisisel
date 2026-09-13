// cf-harita-katman — MVT BİNA SENTEZİ + OSM/Microsoft HARMANI (02.09, sunucusuzlaştırma).
// `scripts/mvt_bina.py`nin BİREBİR portu — çıktı bayt bayt aynı (test: uyum-harman.mjs, origin'in
// diske yazdığı 1.188 harman karosuyla karşılaştırıldı). Aritmetik farkları bilerek korunur:
//   • sentez ölçekleme: Python `//` = Math.floor (negatif tampon koordinatları da doğru)
//   • MS halka: Python `int()` = Math.trunc (SIFIRA doğru; floor DEĞİL)
//   • derece: Python `math.degrees(x)` = x * (180/π) — `x*180/π` DEĞİL (son bit farkı olur)
// Neden harman (Python başlığından): Protomaps binaları esas z15'te taşır; z13-14'te 3-5 bina
// kalır → z13-14 karosu 2^d×2^d z15 torunundan sentezlenir, üstüne Microsoft ML binaları
// (OSM'in boş bıraktığı yerler; merkez mevcut OSM binasına <12 m ise atlanır) eklenir.
// MS satırları R2'de (`ms-bina/15/{x}/{y}.json`, export: scripts/ms-bina-r2-export.py) —
// `pid` Python `hash()` ile ORADA hesaplanır (tuple hash JS'e taşınamaz; id renk paletini seçer).

const EXT = 4096;

// ───────────────────────── protobuf yardımcıları ─────────────────────────

function varintOku(b, i) {
  let r = 0;
  let carpan = 1;
  for (;;) {
    const x = b[i++];
    r += (x & 0x7f) * carpan;
    if (!(x & 0x80)) return [r, i];
    carpan *= 128;
  }
}

function varintYaz(out, n) {
  // n ≥ 0, ≤ 2^53 (feature id'leri OSM ölçeğinde; 32 bit'i aşabilir → bölme ile)
  while (n >= 128) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

function zzCoz(n) {
  // (n >> 1) ^ (-(n & 1)) — 32 bit deltalar
  return (n >>> 1) ^ -(n & 1);
}

function zz(n) {
  return n < 0 ? -2 * n - 1 : 2 * n;
}

/** Bir alanı oku → [alanNo, telTipi, değer|altDizi, yeniIndeks] */
function alan(b, i) {
  let key;
  [key, i] = varintOku(b, i);
  const fno = Math.floor(key / 8);
  const tel = key & 7;
  if (tel === 0) {
    let v;
    [v, i] = varintOku(b, i);
    return [fno, tel, v, i];
  }
  if (tel === 2) {
    let ln;
    [ln, i] = varintOku(b, i);
    return [fno, tel, b.subarray(i, i + ln), i + ln];
  }
  if (tel === 5) return [fno, tel, b.subarray(i, i + 4), i + 4];
  if (tel === 1) return [fno, tel, b.subarray(i, i + 8), i + 8];
  throw new Error("tel tipi " + tel);
}

const _td = new TextDecoder("utf-8");

function f32(u8) {
  return new DataView(u8.buffer, u8.byteOffset, 4).getFloat32(0, true);
}
function f64(u8) {
  return new DataView(u8.buffer, u8.byteOffset, 8).getFloat64(0, true);
}

/** Python float(v): sayı → aynı; metin → float(); None/bool → hata (None) */
function pyFloat(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!/^[+-]?(\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?|inf(inity)?|nan)$/i.test(s)) return null;
    const f = Number(s.replace(/inf(inity)?/i, "Infinity").replace(/nan/i, "NaN"));
    return Number.isNaN(f) && !/nan/i.test(s) ? null : f;
  }
  return null;
}

// ───────────────────────── çözücü ─────────────────────────

/** Ham MVT → [{fid, ext, rings:[[[x,y],…]…], hgt|null}] (yalnız `buildings` katmanı, POLYGON) */
export function binalarCoz(ham) {
  const out = [];
  let i = 0;
  while (i < ham.length) {
    let fno, tel, v;
    [fno, tel, v, i] = alan(ham, i);
    if (fno !== 3 || tel !== 2) continue;
    let adi = null;
    let extent = 4096;
    const feats = [];
    const keys = [];
    const vals = [];
    let j = 0;
    while (j < v.length) {
      let f2, t2, v2;
      [f2, t2, v2, j] = alan(v, j);
      if (f2 === 1) adi = _td.decode(v2);
      else if (f2 === 5) extent = v2;
      else if (f2 === 2) feats.push(v2);
      else if (f2 === 3) keys.push(_td.decode(v2));
      else if (f2 === 4) {
        let kk = 0;
        let val = null;
        while (kk < v2.length) {
          let f3, t3, v3;
          [f3, t3, v3, kk] = alan(v2, kk);
          if (f3 === 1) val = _td.decode(v3);
          else if (f3 === 2) val = f32(v3);
          else if (f3 === 3) val = f64(v3);
          else if (f3 === 4 || f3 === 5) val = v3;
          else if (f3 === 6) val = v3 % 2 === 1 ? -(v3 + 1) / 2 : v3 / 2; // sint64 zigzag (büyük değerler için bölme)
          break;
        }
        vals.push(val);
      }
    }
    if (adi !== "buildings") continue;
    const hidx = keys.indexOf("height");
    for (const fb of feats) {
      let fid = 0;
      let tip = 0;
      let geom = null;
      let hgt = null;
      let k = 0;
      while (k < fb.length) {
        let f3, t3, v3;
        [f3, t3, v3, k] = alan(fb, k);
        if (f3 === 1) fid = v3;
        else if (f3 === 3) tip = v3;
        else if (f3 === 4) geom = v3;
        else if (f3 === 2 && hidx >= 0) {
          let m = 0;
          const tags = [];
          while (m < v3.length) {
            let t4;
            [t4, m] = varintOku(v3, m);
            tags.push(t4);
          }
          for (let a = 0; a < tags.length - 1; a += 2) {
            if (tags[a] === hidx) {
              const vv = tags[a + 1] < vals.length ? vals[tags[a + 1]] : undefined;
              hgt = vv === undefined ? null : pyFloat(vv);
              break;
            }
          }
        }
      }
      if (tip !== 3 || !geom || geom.length === 0) continue; // yalnız POLYGON
      const rings = [];
      let cur = null;
      let x = 0;
      let y = 0;
      let g = 0;
      while (g < geom.length) {
        let cmd;
        [cmd, g] = varintOku(geom, g);
        const cid = cmd & 7;
        const cnt = Math.floor(cmd / 8);
        if (cid === 1) {
          for (let q = 0; q < cnt; q++) {
            let dx, dy;
            [dx, g] = varintOku(geom, g);
            [dy, g] = varintOku(geom, g);
            x += zzCoz(dx);
            y += zzCoz(dy);
            cur = [[x, y]];
            rings.push(cur);
          }
        } else if (cid === 2) {
          for (let q = 0; q < cnt; q++) {
            let dx, dy;
            [dx, g] = varintOku(geom, g);
            [dy, g] = varintOku(geom, g);
            x += zzCoz(dx);
            y += zzCoz(dy);
            cur.push([x, y]);
          }
        } // 7 = ClosePath: geç
      }
      if (rings.length) out.push({ fid, ext: extent, rings, hgt });
    }
  }
  return out;
}

// ───────────────────────── kodlayıcı ─────────────────────────

function lenAlan(out, fno, veri) {
  varintYaz(out, fno * 8 + 2);
  varintYaz(out, veri.length);
  for (let i = 0; i < veri.length; i++) out.push(veri[i]);
}

const _te = new TextEncoder();

/** [{fid, rings, hgt|null, renk|null}] → tek `buildings` katmanlı ham MVT (Uint8Array) */
export function binaKarosuKodla(features, extent = EXT) {
  const fbs = [];
  const hvals = []; // ["h", sayı] | ["r", metin]
  const hmap = new Map();
  for (const f of features) {
    const geom = [];
    let x = 0;
    let y = 0;
    for (const ring of f.rings) {
      if (ring.length < 3) continue;
      varintYaz(geom, 1 | (1 << 3)); // MoveTo ×1
      varintYaz(geom, zz(ring[0][0] - x));
      varintYaz(geom, zz(ring[0][1] - y));
      x = ring[0][0];
      y = ring[0][1];
      varintYaz(geom, 2 | ((ring.length - 1) << 3)); // LineTo ×n-1
      for (let p = 1; p < ring.length; p++) {
        varintYaz(geom, zz(ring[p][0] - x));
        varintYaz(geom, zz(ring[p][1] - y));
        x = ring[p][0];
        y = ring[p][1];
      }
      varintYaz(geom, 7 | (1 << 3)); // ClosePath
    }
    if (!geom.length) continue;
    const tags = [];
    if (f.hgt !== null && f.hgt !== undefined) {
      const k = "h:" + f.hgt; // Python ("h", float) sözlük anahtarı; sayı→metin birebir (Object.is dışında -0/0 ayrımı yok, Python'da da 0.0 == -0.0)
      if (!hmap.has(k)) {
        hmap.set(k, hvals.length);
        hvals.push(["h", f.hgt]);
      }
      tags.push(0, hmap.get(k));
    }
    if (f.renk) {
      const k = "r:" + f.renk;
      if (!hmap.has(k)) {
        hmap.set(k, hvals.length);
        hvals.push(["r", String(f.renk)]);
      }
      tags.push(1, hmap.get(k));
    }
    const fb = [];
    varintYaz(fb, (1 << 3) | 0);
    varintYaz(fb, f.fid); // id
    if (tags.length) {
      const tb = [];
      for (const t of tags) varintYaz(tb, t);
      lenAlan(fb, 2, tb);
    }
    varintYaz(fb, (3 << 3) | 0);
    varintYaz(fb, 3); // type=POLYGON
    lenAlan(fb, 4, geom); // geometry
    lenAlan(fbs, 2, fb); // layer.features
  }
  const kv = [];
  if (hvals.length) {
    lenAlan(kv, 3, _te.encode("height"));
    lenAlan(kv, 3, _te.encode("renk"));
    for (const [tip, v] of hvals) {
      if (tip === "h") {
        const vb = [];
        varintYaz(vb, (3 << 3) | 1);
        const b8 = new Uint8Array(8);
        new DataView(b8.buffer).setFloat64(0, v, true);
        for (const c of b8) vb.push(c);
        lenAlan(kv, 4, vb);
      } else {
        const sb = [];
        lenAlan(sb, 1, _te.encode(v));
        lenAlan(kv, 4, sb);
      }
    }
  }
  const katman = [];
  varintYaz(katman, (15 << 3) | 0);
  varintYaz(katman, 2); // version=2
  lenAlan(katman, 1, _te.encode("buildings"));
  for (const c of fbs) katman.push(c);
  for (const c of kv) katman.push(c);
  varintYaz(katman, (5 << 3) | 0);
  varintYaz(katman, extent); // extent
  const tile = [];
  lenAlan(tile, 3, katman); // tile.layers
  return Uint8Array.from(tile);
}

// ───────────────────────── sentez ─────────────────────────

/**
 * z13-14 karosunu z15 torunlarından üret. karoOku(z,x,y) → Promise<Uint8Array|null>.
 * Torunlar PARALEL okunur (R2 ~16 aralık, tek tur); sonuç sırası Python ile aynı (cy dış, cx iç).
 */
export async function sentezle(karoOku, z, x, y, kaynakZ = 15, extent = EXT) {
  const d = kaynakZ - z;
  if (d <= 0) return null;
  const n = 1 << d;
  const isler = [];
  for (let cy = 0; cy < n; cy++)
    for (let cx = 0; cx < n; cx++) isler.push(karoOku(kaynakZ, (x << d) + cx, (y << d) + cy));
  const hamlar = await Promise.all(isler);
  const feats = [];
  let q = 0;
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const ham = hamlar[q++];
      if (!ham || !ham.length) continue;
      for (const { fid, ext, rings, hgt } of binalarCoz(ham)) {
        const yeni = [];
        const bolen = ext * n;
        for (const ring of rings) {
          const t = [];
          for (const [px, py] of ring) {
            const sx = Math.floor(((px + cx * ext) * extent) / bolen);
            const sy = Math.floor(((py + cy * ext) * extent) / bolen);
            const son = t[t.length - 1];
            if (!son || son[0] !== sx || son[1] !== sy) t.push([sx, sy]); // ardışık aynı noktaları at
          }
          if (t.length >= 3) yeni.push(t);
        }
        if (yeni.length) feats.push({ fid, rings: yeni, hgt, renk: null });
      }
    }
  }
  if (!feats.length) return null;
  return binaKarosuKodla(feats, extent);
}

// ───────────────────────── OSM + Microsoft HARMAN ─────────────────────────

function derece(r) {
  return r * (180 / Math.PI); // CPython math.degrees birebir
}

function tbb(z, x, y) {
  const n = 2 ** z;
  const w = (x / n) * 360 - 180;
  const e = ((x + 1) / n) * 360 - 180;
  const no = derece(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))));
  const so = derece(Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))));
  return [w, so, e, no];
}

/**
 * z13-15 karosu: OSM binaları (z15 ham / z13-14 sentez) + MS ML binaları.
 *   karoOku(z,x,y) → Promise<Uint8Array|null>
 *   msOku(x15,y15) → Promise<Array<[cx, cy, pid, poly]>> (rowid sırası; yoksa [])
 * Dönüş: Uint8Array | null (bina yok → çağıran ham karoya düşer, origin'deki gibi).
 */
export async function harman(karoOku, msOku, z, x, y) {
  const [W, S, E, N] = tbb(z, x, y);
  const d = 15 - z;
  const n = 1 << d;
  // ① OSM + ② MS satırları PARALEL (MS: index sırası x15 dış, y15 iç — SQLite `ix(x15,y15)` ile aynı)
  const msIs = [];
  for (let cx = 0; cx < n; cx++)
    for (let cy = 0; cy < n; cy++) msIs.push(msOku((x << d) + cx, (y << d) + cy));
  const osmIs = (async () => {
    if (z === 15) {
      const ham0 = await karoOku(z, x, y);
      return ham0 && ham0.length ? binalarCoz(ham0) : [];
    }
    const sy = await sentezle(karoOku, z, x, y);
    return sy ? binalarCoz(sy) : [];
  })();
  const [osm, msParcalar] = await Promise.all([osmIs, Promise.all(msIs)]);

  const feats = [];
  const omerk = [];
  for (const f of osm) {
    feats.push({ fid: f.fid, rings: f.rings, hgt: f.hgt, renk: null });
    const r0 = f.rings[0];
    let sx = 0;
    let sy = 0;
    for (const p of r0) {
      sx += p[0];
      sy += p[1];
    }
    const mx = sx / r0.length;
    const my = sy / r0.length;
    omerk.push([W + (mx / EXT) * (E - W), N - (my / EXT) * (N - S)]);
  }
  for (const rows of msParcalar) {
    for (const [cx, cy, pid, poly] of rows) {
      let yakin = false;
      for (const [ox, oy] of omerk) {
        const dx = (ox - cx) * 85000;
        const dy = (oy - cy) * 111000;
        if (dx * dx + dy * dy < 144) {
          yakin = true;
          break;
        }
      }
      if (yakin) continue;
      const t = [];
      for (const p of poly) {
        const px = Math.trunc(((p[0] - W) / (E - W)) * EXT);
        const py = Math.trunc(((N - p[1]) / (N - S)) * EXT);
        const son = t[t.length - 1];
        if (!son || son[0] !== px || son[1] !== py) t.push([px, py]);
      }
      if (t.length < 3) continue;
      feats.push({ fid: pid, rings: [t], hgt: null, renk: null });
      omerk.push([cx, cy]);
    }
  }
  if (!feats.length) return null;
  return binaKarosuKodla(feats, EXT);
}
