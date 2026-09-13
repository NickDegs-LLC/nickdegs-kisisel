#!/usr/bin/env node
// harman.js + pmtiles.js BİREBİR uyum testi (02.09): R2'deki ortak PMTiles arşivinden (presigned URL,
// Range) ham karolar + yerel MS export'u ile JS harman'ı üretir, origin'in diske yazdığı referans
// harman karolarıyla (/opt/matrix/harita-cache/mvt-harman/{z}/{x}/{y}.mvt) BAYT BAYT karşılaştırır.
// Kullanım: node test/uyum-harman.mjs <pm_url_dosyası> <ms_dizini> [adet] [z-filtre]
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { karoOku, pmtilesOzet } from "../src/pmtiles.js";
import { harman, binalarCoz } from "../src/harman.js";

// 4. argüman: z-filtre ("13"/"14"/"15") VEYA "z/x/y" satırlı liste dosyası (yalnız onlar test edilir)
const [urlDosya, msDir, adetS = "60", zF] = process.argv.slice(2);
const URL_ = readFileSync(urlDosya, "utf8").trim();
let r2Okuma = 0;
let r2Bayt = 0;
const env = {
  PMTILES: {
    async get(_key, { range }) {
      r2Okuma++;
      const r = await fetch(URL_, { headers: { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` } });
      if (r.status !== 206) throw new Error("range " + r.status);
      const b = await r.arrayBuffer();
      r2Bayt += b.byteLength;
      return { arrayBuffer: async () => b };
    },
  },
};
async function msOku(x, y) {
  const p = `${msDir}/${x}/${y}.json`;
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
}

console.log("pmtiles:", JSON.stringify(await pmtilesOzet(env)));
const REF = "/opt/matrix/harita-cache/mvt-harman";
const ornekler = [];
if (zF && existsSync(zF)) {
  for (const s of readFileSync(zF, "utf8").split("\n")) if (s.trim()) ornekler.push(s.trim().split("/").map(Number));
} else {
  for (const z of readdirSync(REF)) {
    if (zF && z !== zF) continue;
    for (const x of readdirSync(`${REF}/${z}`))
      for (const f of readdirSync(`${REF}/${z}/${x}`)) ornekler.push([+z, +x, +f.replace(".mvt", "")]);
  }
}
// deterministik seyreltme: eşit aralıklı seçim (z13/14/15 hepsi girsin)
const adet = Math.min(+adetS, ornekler.length);
const secim = [];
for (let i = 0; i < adet; i++) secim.push(ornekler[Math.floor((i * ornekler.length) / adet)]);
let ayni = 0;
let farkli = 0;
const t0 = Date.now();
for (const [z, x, y] of secim) {
  const ref = new Uint8Array(readFileSync(`${REF}/${z}/${x}/${y}.mvt`));
  const t1 = Date.now();
  const r0 = r2Okuma;
  const js = await harman((zz, xx, yy) => karoOku(env, zz, xx, yy), msOku, z, x, y);
  const dt = Date.now() - t1;
  const esit = js && js.length === ref.length && js.every((b, i) => b === ref[i]);
  if (esit) ayni++;
  else {
    farkli++;
    const a = binalarCoz(ref).length;
    const b = js ? binalarCoz(js).length : -1;
    console.log(`FARK ${z}/${x}/${y}: ref ${ref.length}B/${a} bina, js ${js ? js.length : null}B/${b} bina`);
  }
  if (secim.length <= 12 || !esit) console.log(`  ${z}/${x}/${y} ${esit ? "AYNI" : "FARK"} ${dt} ms, R2 okuma ${r2Okuma - r0}`);
}
console.log(`SONUÇ: ${ayni} aynı, ${farkli} farklı / ${secim.length} (referans havuzu ${ornekler.length}); ${Date.now() - t0} ms; R2 ${r2Okuma} okuma, ${(r2Bayt / 1048576).toFixed(1)} MB`);
process.exit(farkli ? 1 : 0);
