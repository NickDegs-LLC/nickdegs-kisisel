#!/usr/bin/env node
// ghs.js BİREBİR uyum testi (02.09): yerel GHS blok export'u (scripts/ghs-r2-export.py --out DIZIN) ile
// worker grid'ini üretir, origin'in (harita-proxy /yukseklik, rasterio) çıktısıyla BAYT BAYT karşılaştırır.
// Kullanım: node test/uyum-yukseklik.mjs <ghs_dizini> [proxy_url]   (varsayılan http://127.0.0.1:8890)
import { readFileSync, existsSync } from "node:fs";
import { ghsGrid, ghsJson, mollweide } from "../src/ghs.js";

const [dizin, proxy = "http://127.0.0.1:8890"] = process.argv.slice(2);
if (!dizin) throw new Error("ghs dizini gerekli");
let okuma = 0;
const env = {
  MATCH_CACHE: {
    async get(key) {
      const p = `${dizin}/${key.replace(/^ghs\//, "")}`;
      if (!existsSync(p)) return null;
      okuma++;
      const b = readFileSync(p);
      return {
        json: async () => JSON.parse(b.toString("utf8")),
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      };
    },
  },
};

// [ad, bbox, n]
const ORNEKLER = [
  ["Levent", [28.99, 41.07, 29.03, 41.09], 160],
  ["İstanbul geniş", [28.85, 40.98, 29.15, 41.12], 160],
  ["Ankara Kızılay", [32.83, 39.9, 32.88, 39.94], 160],
  ["Pertek", [39.3, 38.85, 39.35, 38.88], 160],
  ["İzmir", [27.1, 38.4, 27.17, 38.45], 256],
  ["Antalya n=16", [30.68, 36.87, 30.73, 36.9], 16],
  ["Marmara açık deniz", [28.3, 40.6, 28.4, 40.7], 64],
  ["Raster sınırı (x≈2959000)", [33.0, 40.0, 33.3, 40.2], 96],
  ["Raster sınırı (y=4000000)", [35.0, 35.9, 35.2, 36.2], 96],
  ["Raster sınırı y=4000000 kara (Şam güneyi)", [36.2, 32.95, 36.4, 33.1], 128],
  ["Raster sınırı x=3959000 kara (Urmiye)", [45.3, 37.4, 45.9, 37.7], 128],
  ["Kapsam dışı (Paris)", [2.3, 48.85, 2.35, 48.87], 32],
  ["Kapsam dışı (Tahran)", [51.38, 35.68, 51.42, 35.7], 32],
];

let ayni = 0;
let farkli = 0;
for (const [ad, bb, n] of ORNEKLER) {
  const qs = `bbox=${bb.join(",")}&n=${n}`;
  const t0 = Date.now();
  const ref = await (await fetch(`${proxy}/yukseklik?${qs}`)).text();
  const t1 = Date.now();
  const o0 = okuma;
  const grid = await ghsGrid(env, bb, n);
  const js = ghsJson(n, bb, grid);
  const dt = Date.now() - t1;
  const doluHucre = grid.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
  const esit = js === ref;
  if (esit) ayni++;
  else {
    farkli++;
    let i = 0;
    while (i < js.length && js[i] === ref[i]) i++;
    console.log(`  FARK @${i}: ref «${ref.slice(Math.max(0, i - 30), i + 30)}» js «${js.slice(Math.max(0, i - 30), i + 30)}»`);
    try {
      const rg = JSON.parse(ref).grid;
      const jg = JSON.parse(js).grid;
      let f = 0;
      for (let k = 0; k < rg.length; k++) if (rg[k] !== jg[k]) f++;
      console.log(`  farklı hücre: ${f}/${rg.length}`);
    } catch {}
  }
  console.log(`${esit ? "AYNI" : "FARK"} ${ad} n=${n}: ${doluHucre}/${n * n} dolu, js ${dt} ms (${okuma - o0} blok), origin ${t1 - t0} ms`);
}
// Mollweide çapraz kanıt: PROJ referansı (rasterio.warp.transform) — bilinen nokta
const [mx, my] = mollweide(29.0, 41.0);
console.log(`mollweide(29,41) = ${mx.toFixed(3)}, ${my.toFixed(3)}`);
console.log(`SONUÇ: ${ayni} aynı, ${farkli} farklı / ${ORNEKLER.length}`);
process.exit(farkli ? 1 : 0);
