// cf-harita-katman uyum testi (KARAR.md #8) — T4 / T5 / T11 + forward duman testi.
// Kullanım:
//   node test/uyum-test.mjs --birim          # yalnız saf birim testler (ağ yok)
//   test/dev-baslat.sh &                     # ayrı pencerede wrangler dev (gerçek önekle)
//   ONEK=... node test/uyum-test.mjs         # tam takım (BASE varsayılan http://127.0.0.1:8787)
// Önek asla ekrana YAZILMAZ. Canlıya karşı: BASE=https://harita.nickdegs.com ile aynı takım.
import {
  seyrelt,
  orneklet,
  dikis,
  bosBicim,
  SEYRELT_DERECE,
  ADIM_DERECE,
} from "../src/matching.js";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
let ONEK = process.env.ONEK || "";
if (!ONEK) {
  try {
    ONEK = /HARITA_UC_ONEK=(\S+)/.exec(
      readFileSync("/opt/matrix/secrets/harita-uc.conf", "utf8"),
    )[1];
  } catch {}
}
const GERCEK_ONEK = !!ONEK; // forward duman testi origin nginx'inden geçer, gerçek önek ister
if (!ONEK) ONEK = "testonek"; // matching testleri dev varsayılanıyla da çalışır
const SADECE_BIRIM = process.argv.includes("--birim");

let gecti = 0, kaldi = 0;
function dogrula(ad, kosul, detay = "") {
  if (kosul) { gecti++; console.log(`  OK   ${ad}`); }
  else { kaldi++; console.log(`  FAIL ${ad}${detay ? " — " + detay : ""}`); }
}
const metre = ([ax, ay], [bx, by]) => {
  const oy = ((ay + by) / 2) * Math.PI / 180;
  return Math.hypot((bx - ax) * 111320 * Math.cos(oy), (by - ay) * 111320);
};

// ── BİRİM TESTLER ────────────────────────────────────────────────────────────
console.log("[birim] saf fonksiyonlar");
dogrula("boş biçim bayt-birebir", bosBicim() === '{"matchings":[]}');

{ // seyrelt: ~22 m aralıklı 100 nokta → ilk/son korunur, ara mesafeler >= 60 m
  const cs = Array.from({ length: 100 }, (_, i) => `${(29 + i * 0.0002).toFixed(6)},41.000000`);
  const s = seyrelt(cs);
  dogrula("seyrelt ilk/son korunur", s[0] === cs[0] && s[s.length - 1] === cs[99]);
  dogrula("seyrelt sıklığı düşürür", s.length < cs.length && s.length > 20, `n=${s.length}`);
  let iyi = true;
  for (let i = 1; i < s.length - 1; i++) {
    const [a, b] = [s[i - 1], s[i]].map((c) => c.split(",").map(Number));
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < SEYRELT_DERECE) iyi = false;
  }
  dogrula("seyrelt ara mesafe >= 0.00054°", iyi);
  dogrula("seyrelt <=2 nokta aynen", seyrelt(["1,1", "2,2"]).length === 2);
}
{ // orneklet: 0.01° (~1.1 km) tek segment → ~20 m adımlar; 1° segmentte 400 tavanı
  const r = orneklet([[29, 41], [29.01, 41]]);
  const adimlar = r.slice(1).map((p, i) => Math.hypot(p[0] - r[i][0], p[1] - r[i][1]));
  dogrula("orneklet adım ~0.00018°",
    adimlar.every((a) => a > ADIM_DERECE * 0.5 && a < ADIM_DERECE * 1.51),
    `min=${Math.min(...adimlar).toFixed(6)} max=${Math.max(...adimlar).toFixed(6)}`);
  dogrula("orneklet uç noktalar korunur",
    r[0][0] === 29 && r[r.length - 1][0] === 29.01);
  const buyuk = orneklet([[29, 41], [30, 41]]);
  dogrula("orneklet segment tavanı 400", buyuk.length === 401, `n=${buyuk.length}`);
  const kisa = orneklet([[29, 41], [29.0001, 41]]); // adım*1.5 altı: bölünmez
  dogrula("orneklet kısa segmenti bölmez", kisa.length === 2);
}
{ // dikis: son noktaya en yakın olanın SONRASI alınır (bindirme tekrarı yok)
  const g = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const d = dikis([1.1, 0], g);
  dogrula("dikis en-yakın-sonrası", JSON.stringify(d) === "[[2,0],[3,0]]");
  dogrula("dikis son nokta en yakınsa boş", dikis([3, 0], g).length === 0);
}

if (SADECE_BIRIM) bitir();

// ── ENTEGRASYON (wrangler dev ya da canlı BASE) ─────────────────────────────
const U = (yol) => `${BASE}/${ONEK}${yol}`;
const IZ_YOL = "28.97918,41.02506;28.97850,41.02560;28.97780,41.02620"; // yol-üstü (ölçüldü 30.08)
const IZ_DENIZ = "30.5,42.5;30.51,42.51;30.52,42.52";                   // Karadeniz ortası

console.log(`[entegrasyon] BASE=${BASE} (önek gizli)`);
{
  const y = await fetch(`${BASE}/saglik`);
  const j = await y.json().catch(() => ({}));
  dogrula("/saglik anonim OK", y.status === 200 && j.ok === true && j.katman === "cf-harita-katman");
}
// T11 — önek denetimi
for (const yol of [`/matching/v5/mapbox/driving/${IZ_YOL}`, "/styles/v1/mapbox/satellite-v9/static/29,41,10.000,0/100x100@2x"]) {
  dogrula(`T11 öneksiz 404: ${yol.split("/")[1]}`, (await fetch(BASE + yol)).status === 404);
  dogrula(`T11 yanlış önek 404: ${yol.split("/")[1]}`, (await fetch(`${BASE}/yanlisonek${yol}`)).status === 404);
}
// T4 — matching biçimi
let ilkGovde = "";
{
  const y = await fetch(U(`/matching/v5/mapbox/driving/${IZ_YOL}?geometries=geojson&overview=full&tidy=true&radiuses=22;22;22&access_token=pk.xyz`));
  ilkGovde = await y.text();
  let j = {};
  try { j = JSON.parse(ilkGovde); } catch {}
  const m0 = (j.matchings || [])[0] || {};
  dogrula("T4 driving 200", y.status === 200);
  dogrula('T4 code:"Ok" eklendi', j.code === "Ok");
  dogrula("T4 confidence 0.9", m0.confidence === 0.9);
  dogrula("T4 LineString dolu", m0.geometry?.type === "LineString" && (m0.geometry?.coordinates?.length || 0) >= 2,
    `n=${m0.geometry?.coordinates?.length}`);
}
for (const rd of ["30;30;30", "32;32;32", "45;45;45"]) {
  const y = await fetch(U(`/matching/v5/mapbox/driving/${IZ_YOL}?radiuses=${rd}`));
  const j = await y.json().catch(() => ({}));
  dogrula(`T4 radiuses=${rd.split(";")[0]} kabul`, y.status === 200 && j.code === "Ok");
}
{
  const y = await fetch(U(`/matching/v5/mapbox/driving/${IZ_YOL}?geometries=geojson&overview=full&tidy=true&radiuses=22;22;22&access_token=pk.xyz`));
  dogrula("T4 ikinci istek önbellekten AYNI", (await y.text()) === ilkGovde,
    `X-Onbellek=${y.headers.get("X-Onbellek")}`);
}
for (const p of ["cycling", "walking"]) {
  dogrula(`T4 ${p} → 404 (varsayılan profil politikası)`,
    (await fetch(U(`/matching/v5/mapbox/${p}/${IZ_YOL}`))).status === 404);
}
{
  const y = await fetch(U(`/matching/v5/mapbox/driving/${IZ_DENIZ}?radiuses=25;25;25`));
  dogrula("T4 oturmayan iz → bayt-birebir boş biçim",
    y.status === 200 && (await y.text()) === '{"matchings":[]}');
}
// A4 KARARI: geocoding katmanda kalır → forward AÇIK (kod varsayılanı açık, KV `0` kapatır).
// Yerel `wrangler dev`'de origin'e gerçek önekle gidilir; önek yoksa forward anlamsız → atlanır.
if (!GERCEK_ONEK) {
  console.log("  SKIP geocoding forward (gerçek önek yok)");
} else {
  const y = await fetch(U("/geocoding/v5/mapbox.places/28.9784,41.0082.json?types=poi,neighborhood,locality,place&limit=1&language=tr"));
  const j = await y.json().catch(() => ({}));
  dogrula("A4 geocoding forward 200 + minimal alanlar",
    y.status === 200 && typeof j.features?.[0]?.text === "string" && j.features[0].text.length > 0,
    `durum=${y.status}`);
  dogrula("A4 geocoding Cache-Control 7 g (dolu sonuçta)",
    (y.headers.get("Cache-Control") || "").includes("max-age=604800"),
    `cc=${y.headers.get("Cache-Control")}`);
}

// T5 — 200 noktalı iz: ~20 m örnekleme + >60° kırılma < 45
{
  const rota = await (await fetch(
    "https://router.project-osrm.org/route/v1/driving/28.9850,41.0370;29.0074,41.0422?geometries=geojson&overview=full",
  )).json();
  const geom = rota.routes[0].geometry.coordinates;
  // kümülatif yay uzunluğu üzerinden TAM 200 noktaya doğrusal enterpolasyon (GPS izi taklidi)
  const kum = [0];
  for (let i = 1; i < geom.length; i++) kum.push(kum[i - 1] + metre(geom[i - 1], geom[i]));
  const toplam = kum[kum.length - 1];
  const iz = [];
  let s = 1;
  for (let k = 0; k < 200; k++) {
    const hedef = (toplam * k) / 199;
    while (s < geom.length - 1 && kum[s] < hedef) s++;
    const t = Math.min(1, Math.max(0, (hedef - kum[s - 1]) / ((kum[s] - kum[s - 1]) || 1)));
    iz.push([
      geom[s - 1][0] + (geom[s][0] - geom[s - 1][0]) * t,
      geom[s - 1][1] + (geom[s][1] - geom[s - 1][1]) * t,
    ]);
  }
  const yol = iz.map(([x, y2]) => `${x.toFixed(6)},${y2.toFixed(6)}`).join(";");
  const y = await fetch(U(`/matching/v5/mapbox/driving/${yol}?geometries=geojson&overview=full&tidy=true&radiuses=${iz.map(() => 32).join(";")}`));
  const j = await y.json().catch(() => ({}));
  const c = j.matchings?.[0]?.geometry?.coordinates || [];
  dogrula(`T5 ${iz.length} noktalı iz → 200 + dolu geometri`, y.status === 200 && c.length > iz.length, `çıktı n=${c.length}`);
  // Örnekleme yalnız nokta EKLER (Python birebir): yoğun kent geometrisinde küçük adımlar
  // kalır, garanti ÜST SINIRDIR (~2×0.00018° ≈ 40 m). Kamera penceresini bozan şey seyrek
  // bölgedir → asıl bekçi: max adım. Ham OSRM geometrisi (örnekleme kalkarsa) yüzlerce
  // metrelik segment içerir ve burada anında yakalanır. Ölçüm 30.08: max=36.3, band %43.
  const adimlar = c.slice(1).map((p, i) => metre(c[i], p)).filter((a) => a > 0.01);
  const enBuyuk = Math.max(...adimlar);
  const band = adimlar.filter((a) => a >= 12 && a <= 30).length / adimlar.length;
  dogrula("T5 seyrek bölge yok: max adım < 45 m", enBuyuk < 45, `max=${enBuyuk.toFixed(1)} m`);
  dogrula("T5 ~20 m yoğunlaşma: 12-30 m bandı >= %25", band >= 0.25, `band=%${(band * 100).toFixed(0)}`);
  let kirilma = 0;
  for (let i = 2; i < c.length; i++) {
    const h1 = Math.atan2(c[i - 1][1] - c[i - 2][1], (c[i - 1][0] - c[i - 2][0]) * Math.cos((c[i - 1][1] * Math.PI) / 180));
    const h2 = Math.atan2(c[i][1] - c[i - 1][1], (c[i][0] - c[i - 1][0]) * Math.cos((c[i][1] * Math.PI) / 180));
    let f = ((h2 - h1) * 180) / Math.PI;
    while (f > 180) f -= 360;
    while (f < -180) f += 360;
    if (Math.abs(f) > 60) kirilma++;
  }
  dogrula("T5 >60° kırılma < 45 (ham referans 45)", kirilma < 45, `kırılma=${kirilma}`);
}

// Forward duman testi — gerçek önek ister (origin nginx yalnız onu tanır)
if (!GERCEK_ONEK) {
  console.log("  SKIP forward duman testi (gerçek önek yok)");
} else {
  const y = await fetch(U("/styles/v1/mapbox/satellite-streets-v12/static/28.978400,41.008200,15.000,0/100x100@2x?access_token=pk.xyz&attribution=false&logo=false"));
  const buf = new Uint8Array(await y.arrayBuffer());
  const b = jpegBoyut(buf);
  dogrula("forward statik 200 + image/jpeg",
    y.status === 200 && (y.headers.get("Content-Type") || "").includes("image/jpeg"), `ct=${y.headers.get("Content-Type")} n=${buf.length}`);
  dogrula("forward @2x çıktı TAM 2W×2H (200×200)", b && b.w === 200 && b.h === 200, `boyut=${b?.w}x${b?.h}`);
  dogrula("forward Cache-Control 30 g eklendi", (y.headers.get("Cache-Control") || "").includes("max-age=2592000"));
}

// ═══ SUNUCUSUZLAŞTIRILAN UÇLAR (31.08) — /xyz /mvt /yukseklik + worker-içi geocoding ═══
// Hepsi origin'den BAĞIMSIZ çalışmalı. Karo referansları: İstanbul Sultanahmet.
{
  console.log("[sunucusuz uçlar]");
  const jpg = async (yol) => {
    const y = await fetch(U(yol));
    const b = new Uint8Array(await y.arrayBuffer());
    return { y, b, boyut: jpegBoyut(b) };
  };

  // 256×256 ŞART: MapLibre raster kaynağı tileSize:256 diyor; farklı boyut mozaiği kaydırır.
  for (const [ad, yol] of [
    ["sat z14", "/xyz/sat/14/9510/6142.jpg"],
    ["str z14", "/xyz/str/14/9510/6142.jpg"],
    ["sat z17", "/xyz/sat/17/76086/49138.jpg"],
    ["sat okyanus z18 (koyu karo)", "/xyz/sat/18/109226/131072.jpg"],
  ]) {
    const { y, b, boyut } = await jpg(yol);
    dogrula(`/xyz ${ad} → 200 + 256×256 jpeg`,
      y.status === 200 && boyut && boyut.w === 256 && boyut.h === 256 && b.length > 300,
      `durum=${y.status} boyut=${boyut?.w}x${boyut?.h} n=${b.length}`);
    dogrula(`/xyz ${ad} ACAO+CORP+30 g`,
      y.headers.get("Access-Control-Allow-Origin") === "*" &&
        y.headers.get("Cross-Origin-Resource-Policy") === "cross-origin" &&
        (y.headers.get("Cache-Control") || "").includes("max-age=2592000"));
  }

  // KATMAN TAVANI (ürün ayrımı): premium z17'de, ultra z18'de kapanır → z18'de İKİSİ FARKLI
  // görüntü üretmeli. Aynı çıkarsa tavan uygulanmıyor demektir (Ultra farkı sessizce kaybolur).
  {
    const p = await jpg("/xyz/sat/18/152173/98276.jpg?k=premium");
    const u = await jpg("/xyz/sat/18/152173/98276.jpg?k=ultra");
    dogrula("/xyz katman tavanı: premium(z17) ≠ ultra(z18)",
      p.y.status === 200 && u.y.status === 200 && p.b.length !== u.b.length,
      `premium=${p.b.length}B ultra=${u.b.length}B`);
    dogrula("/xyz tavan üstü kırpma 256×256 kalıyor",
      p.boyut?.w === 256 && p.boyut?.h === 256, `boyut=${p.boyut?.w}x${p.boyut?.h}`);
    dogrula("/xyz kırpma gerçekten yapıldı (X-Kaynak tavan işareti)",
      (p.y.headers.get("X-Kaynak") || "").includes("tavan"),
      `X-Kaynak=${p.y.headers.get("X-Kaynak")}`);
  }

  // /mvt — eksik karoda **204** (404 DEĞİL: CrowdSec http-probing render IP'sini banlar).
  {
    const y12 = await fetch(U("/mvt/12/2377/1535.mvt"));
    const b12 = await y12.arrayBuffer();
    dogrula("/mvt z12 → 200 + dolu MVT", y12.status === 200 && b12.byteLength > 1000, `n=${b12.byteLength}`);
    dogrula("/mvt Content-Type + ACAO",
      (y12.headers.get("Content-Type") || "").includes("vnd.mapbox-vector-tile") &&
        y12.headers.get("Access-Control-Allow-Origin") === "*");
    const y14 = await fetch(U("/mvt/14/9510/6142.mvt"));
    dogrula("/mvt z14 → 200 (bina karosu)", y14.status === 200);
    const y17 = await fetch(U("/mvt/17/76086/49138.mvt"));
    dogrula("/mvt kaynaksız zoom → 204 (404 DEĞİL)", y17.status === 204, `durum=${y17.status}`);
  }

  // /yukseklik — sözleşme {n,bbox,grid,kule}; origin ölse bile 200 (sıfır grid fail-soft).
  {
    const y = await fetch(U("/yukseklik?bbox=28.97,41.00,28.99,41.02&n=32"));
    const j = await y.json().catch(() => ({}));
    dogrula("/yukseklik → 200 + {n,bbox,grid,kule}",
      y.status === 200 && j.n === 32 && Array.isArray(j.bbox) && j.bbox.length === 4 &&
        Array.isArray(j.grid) && j.grid.length === 32 * 32 && Array.isArray(j.kule),
      `durum=${y.status} grid=${j.grid?.length}`);
    dogrula("/yukseklik bbox'sız → 400", (await fetch(U("/yukseklik"))).status === 400);
  }

  // B8 sözleşmesi — worker İÇİNDE (Nominatim). Alan adları motorun okuduklarıyla birebir.
  {
    const y = await fetch(U("/geocoding/v5/mapbox.places/32.8597,39.9334.json?types=neighborhood,locality,place&limit=1&language=en"));
    const j = await y.json().catch(() => ({}));
    dogrula("B8 geocoding worker-içi 200 + text",
      y.status === 200 && typeof j.features?.[0]?.text === "string" && j.features[0].text.length > 0,
      `durum=${y.status}`);
    dogrula("B8 context[0] = {id:'place.1', text:city}",
      j.features?.[0]?.context?.[0]?.id === "place.1" &&
        typeof j.features[0].context[0].text === "string",
      `context=${JSON.stringify(j.features?.[0]?.context)}`);
    const yu = await fetch(U("/geocoding/v5/mapbox.places/32.8597,39.9334.json?types=country"));
    const ju = await yu.json().catch(() => ({}));
    dogrula("B8 types=country → ülke + boş context",
      yu.status === 200 && ju.features?.[0]?.text && ju.features[0].context?.length === 0,
      `${JSON.stringify(ju)}`);
  }

  // T11 yeni uçlarda da geçerli + tarayıcı tüketicisi için ön-uçuş.
  for (const yol of ["/xyz/sat/14/9510/6142.jpg", "/mvt/12/2377/1535.mvt", "/yukseklik?bbox=1,1,2,2"]) {
    dogrula(`T11 öneksiz 404: ${yol.split("/")[1].split("?")[0]}`,
      (await fetch(BASE + yol)).status === 404);
  }
  {
    const y = await fetch(U("/xyz/sat/14/9510/6142.jpg"), { method: "OPTIONS" });
    dogrula("CORS ön-uçuş 204 + ACAO", y.status === 204 && y.headers.get("Access-Control-Allow-Origin") === "*",
      `durum=${y.status}`);
  }
}

bitir();

function jpegBoyut(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}
function bitir() {
  console.log(`\nSONUÇ: ${gecti} geçti, ${kaldi} kaldı`);
  process.exit(kaldi ? 1 : 0);
}
