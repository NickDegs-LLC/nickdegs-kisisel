// cf-harita-katman — B7 Map Matching / yola oturtma (KARAR.md #5)
// `harita-proxy.py:675-806` OSRM yolunun BİREBİR portu. Kanıt zinciri oradaki yorumlarda:
//   route+seyreltmesiz 391 kırılma · match+HMM = 45 · public OSRM match tavanı ~12 nokta
//   (10 ✓ 15 ✗ ölçüldü) → 10'luk dilim + 2 bindirme + en-yakın-nokta dikişi.
// Sözleşme farkları (KARAR):
//   - `code:"Ok"` EKLENİR (A5 önerilen çözüm — code şartlı 4 tüketici düzelmeden çalışır).
//   - Boş sonuç BAYT-BİREBİR `{"matchings":[]}` (404 değil; code'suz — bugünkü proxy ile aynı).
//   - `radiuses/tidy/access_token/timestamps` sorgu parametreleri YUTULUR (bugünkü gibi:
//     OSRM çağrısı sabit parametrelerle yapılır, tüketicinin 22/30/32/45 yarıçapları kabul edilir).
//   - Profil politikası (A6, devir-günü-sıfır-değişim): KV `profiller` varsayılan ["driving"]
//     → cycling/walking 404 (bugünkü davranış birebir). Karar gelince KV'den deploy'suz açılır.
//   - Boş sonuç ÖNBELLEĞE YAZILMAZ (bilinçli fark: boş = OSRM arızası göstergesi; Python'un
//     30 gün boş-önbellekleme footgun'ı taşınmadı — bkz README risk defteri).
import {
  ayarYukle,
  matchAnahtar,
  matchOnbellekBak,
  matchOnbellekYaz,
} from "./cache.js";

export const SEYRELT_DERECE = 0.00054; // ~60 m (HARITA_SEYRELT_DERECE varsayılanı)
export const ADIM_DERECE = 0.00018;    // ~20 m eşit aralıklı yeniden örnekleme
export const DILIM = 10;               // public OSRM match tavanı (~12; ölçüldü)
export const BINDIR = 2;               // dilim bindirmesi
export const YARICAP = "25";           // public OSRM tavanı (49 "TooBig" veriyor, ölçüldü)
export const DENEME = 3;               // dilim başına deneme (KARAR: 3 retry/backoff)
const ZAMAN_ASIMI_MS = 45000;          // Python: timeout=45

const RXM = /^\/matching\/v5\/mapbox\/([a-z0-9-]+)\/([^?]+)$/;

export async function matchingIsle(istek, env, ctx, ic) {
  const m = RXM.exec(ic);
  if (!m) return yok();
  const profil = m[1];
  const ayar = await ayarYukle(env);
  if (!ayar.profiller.includes(profil)) return yok(); // bugün: cycling/walking → 404

  let cs;
  try {
    cs = decodeURIComponent(m[2]).split(";").filter(Boolean);
  } catch {
    return yok();
  }
  if (!cs.length) return yok();

  // Seyreltme ÖNCE (deterministik) → önbellek anahtarı seyreltilmiş koordinatlardan.
  const seyrek = seyrelt(cs);
  const anahtar = await matchAnahtar(profil, seyrek);
  const on = await matchOnbellekBak(env, ctx, anahtar, ayar.matchTtlGun);
  if (on) return jsonYanit(on.govde, on.kaynak);

  const hep = await osrmMatch(seyrek, profil, ayar);
  if (hep && hep.length) {
    const govde = JSON.stringify({
      code: "Ok",
      matchings: [
        {
          confidence: 0.9,
          geometry: { type: "LineString", coordinates: orneklet(hep) },
        },
      ],
    });
    ctx.waitUntil(matchOnbellekYaz(env, anahtar, govde, ayar.matchTtlGun));
    return jsonYanit(govde, "osrm");
  }
  return jsonYanit(bosBicim(), "osrm-bos"); // önbelleğe yazılmaz
}

// ── saf yardımcılar (birim testte doğrudan çağrılır) ──────────────────────────

// harita-proxy.py:723-733 — ~60 m seyreltme; ilk/son nokta DAİMA korunur.
export function seyrelt(cs) {
  if (cs.length <= 2) return cs.slice();
  const sk = [cs[0]];
  let [sx, sy] = cs[0].split(",").map(Number);
  for (let i = 1; i < cs.length - 1; i++) {
    const [px, py] = cs[i].split(",").map(Number);
    if (Math.hypot(px - sx, py - sy) >= SEYRELT_DERECE) {
      sk.push(cs[i]);
      sx = px;
      sy = py;
    }
  }
  sk.push(cs[cs.length - 1]);
  return sk;
}

// harita-proxy.py:757-766 — DİKİŞ: yeni geometride eldeki son noktaya EN YAKIN noktayı bul,
// ondan SONRAsını ekle → bindirme bölgesi tekrarlanmaz, dilim sıçraması olmaz.
export function dikis(sonNokta, g) {
  const [sx, sy] = sonNokta;
  let eni = 0;
  let enu = Infinity;
  for (let k = 0; k < g.length; k++) {
    const u = (g[k][0] - sx) ** 2 + (g[k][1] - sy) ** 2;
    if (u < enu) {
      enu = u;
      eni = k;
    }
  }
  return g.slice(eni + 1);
}

// harita-proxy.py:776-794 — ~20 m EŞİT ARALIKLI yeniden örnekleme (kamera yumuşatıcısının
// sabit WINs penceresi bu aralığa kalibre; kalkarsa "kamera bir anda dönüyor" geri gelir).
export function orneklet(hep) {
  const re = [hep[0]];
  for (let k = 1; k < hep.length; k++) {
    const [ax, ay] = k === 1 ? re[re.length - 1] : hep[k - 1];
    const [bx, by] = hep[k];
    const dx = bx - ax;
    const dy = by - ay;
    const uz = Math.hypot(dx, dy);
    if (uz > ADIM_DERECE * 1.5) {
      const n = Math.min(400, Math.floor(uz / ADIM_DERECE)); // segment başına ≤400
      for (let t = 1; t < n; t++) {
        re.push([ax + (dx * t) / n, ay + (dy * t) / n]);
      }
    }
    re.push([bx, by]);
  }
  return re;
}

export function bosBicim() {
  return '{"matchings":[]}'; // BAYT-BİREBİR (T4)
}

// ── OSRM zinciri ─────────────────────────────────────────────────────────────

// harita-proxy.py:734-774 — dilimle, eşle, köprüle, dik; URL başarısızsa sıradakine geç.
async function osrmMatch(cs, profil, ayar) {
  for (const taban of ayar.osrmUrls(profil)) {
    const hep = [];
    let i = 0;
    let iyi = true;
    while (i < cs.length - 1) {
      const par = cs.slice(i, i + DILIM);
      if (par.length < 2) break;
      const g = await dilimGetir(taban, profil, par);
      if (g === null) {
        iyi = false; // bu OSRM adresi kötü → sıfırdan sıradaki adresle dene
        break;
      }
      // dilim oturmadıysa (yol dışı/park alanı) ham dilim noktalarıyla köprüle
      let ek = g.length ? g : par.map((c) => c.split(",").map(Number));
      if (hep.length) ek = dikis(hep[hep.length - 1], ek);
      for (const n of ek) hep.push(n);
      i += DILIM - BINDIR;
      if (i < cs.length - 1) await uyku(ayar.beklemeMs); // dilim arası 0.12 sn (public OSRM freni)
    }
    if (iyi && hep.length) return hep;
  }
  return null;
}

// Tek dilim: sabit parametreler (geometries/overview/tidy/gaps/radiuses=25) — Python birebir.
// KARAR eki: 3 deneme/backoff — ama 4xx DETERMİNİSTİK (NoSegment/NoMatch), tekrar denenmez
// (Python'da da tek denemede URL-başarısız sayılır; canlı ölçüm 30.08: deniz → 400 NoSegment).
async function dilimGetir(taban, profil, par) {
  const rd = par.map(() => YARICAP).join(";");
  const u =
    `${taban.replace(/\/+$/, "")}/match/v1/${profil}/` +
    par.join(";") +
    `?geometries=geojson&overview=full&tidy=true&gaps=ignore&radiuses=${rd}`;
  for (let d = 1; d <= DENEME; d++) {
    try {
      const y = await fetch(u, {
        signal: AbortSignal.timeout(ZAMAN_ASIMI_MS),
        headers: { "User-Agent": "cf-harita-katman/1.0" },
      });
      if (y.status >= 400 && y.status < 500 && y.status !== 429) {
        return null; // deterministik ret (NoSegment vb.) — backoff israfı yok
      }
      if (!y.ok) throw new Error("HTTP " + y.status);
      const r = await y.json();
      const g = [];
      for (const mm of r.matchings || []) {
        const k = mm.geometry && mm.geometry.coordinates;
        if (k && k.length) for (const n of k) g.push(n);
      }
      return g; // boş dizi = 200 ama dilim oturmadı → çağıran ham köprü kurar
    } catch {
      if (d < DENEME) await uyku(250 * d); // geçici hata: 250/500 ms backoff
    }
  }
  return null;
}

function uyku(ms) {
  return ms > 0 ? new Promise((coz) => setTimeout(coz, ms)) : Promise.resolve();
}

function jsonYanit(govde, kaynak) {
  return new Response(govde, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // 31.08: diğer uçlarla aynı olsun diye eklendi (öneksiz nginx yolunda vardı, önekli yolda
      // düşüyordu). Tüketicisi bugün Python ama tarayıcıya taşınırsa gerekli.
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Onbellek": kaynak, // tanı amaçlı; tüketiciler okumaz
    },
  });
}

function yok() {
  return new Response("yol taninmadi", {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  });
}
