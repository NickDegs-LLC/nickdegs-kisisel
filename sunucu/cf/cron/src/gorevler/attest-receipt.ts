// attest-receipt — App Attest receipt'ini Apple'da tazeler ve DOLANDIRICILIK METRİĞİNİ okur.
//
// NEDEN: attestation sırasında Apple bize bir "receipt" veriyor (attest_keys.receipt). Apple bunu
// kendi sunucusunda tazeleyince dönen receipt'in 17. alanında **risk metriği** oluyor: bu CİHAZIN
// son 30 günde ürettiği attest anahtarı sayısı. Yüksek sayı = aynı cihazda sürekli yeni kimlik
// üretiliyor = hile işareti. Barış'ın isteği: "device check şeyi dolandırıcılık önlemek için".
//
// NEDEN CRON (istek yolunda DEĞİL): Apple "alan 19'daki (not-before) tarihten ÖNCE çağırırsan 304
// döner" ve "alan 21'deki (expiry) tarihten sonra isteği onurlandırmayabilirim" diyor. Yani bu,
// isteğe bağlı bir doğrulama değil, ZAMANLANMIŞ bir tazeleme döngüsü.
//
// ⚠️ ANAHTAR: DeviceCheck yetkisi anahtar ÜRETİLİRKEN seçilir. Eldeki beş eski Apple anahtarının
// hepsi bu uca 401 veriyordu (17.09 ölçüldü); 7DYNKZZPCX bunun için üretildi ve 400 döndü
// (= kimlik doğrulandı, yalnız sahte gövde reddedildi). Anahtar yoksa görev sessizce atlanır.
//
// ORTAM AYRIMI: Apple "bir ortamda üretilen receipt ile diğerinden yeni receipt isteyemezsin" diyor.
// attest_keys.env ('production' | 'development') hangi uca gidileceğini belirler.
import type { GorevCtx } from '../takvim'
import { apnsJwtUret } from '../lib-push'
import { simdi } from '../lib'

const UC: Record<string, string> = {
  production: 'https://data.appattest.apple.com/v1/attestationData',
  development: 'https://data-development.appattest.apple.com/v1/attestationData',
}
const TEAM = 'SZF4T3P583'
const VARSAYILAN_KID = '7DYNKZZPCX'
const TUR_BASINA = 20          // bir koşuda en çok N anahtar (Apple 429 vermesin)

// ── minimal DER yürüyücüsü ────────────────────────────────────────────────
// Cron worker'ında DER aracı YOK (api'dekiler ayrı worker, import edilemez) → burada asgari set.
// 🔴 RECEIPT **DER DEĞİL, BER**'dir — 17.09'da gerçek baytlarla kanıtlandı (openssl asn1parse):
//   0:d=0  l=inf  SEQUENCE        ← belirsiz uzunluk (0x80)
//   52:d=5 l=inf  OCTET STRING    ← constructed, yük PARÇALI
//   54:d=6 l=1000 OCTET STRING    ← 1. parça
//   1058:d=6 l=348 OCTET STRING   ← 2. parça      (sonra EOC 00 00)
// İlk yazımda uzunluk baytı 0x80'i "uzun biçim, 0 bayt" sanıp len=0 okuyordum → yük HİÇ
// bulunamıyordu. Çökmüyordu ama risk metriği sessizce NULL kalırdı: işin tek amacı boşa giderdi.
// Bu yüzden: (a) belirsiz uzunluk + EOC desteği, (b) parçalı OCTET STRING birleştirme ŞART.
type El = { tag: number; icBas: number; icSon: number; son: number; bel: boolean }

function derOku(b: Uint8Array, off: number): El {
  // 🔴 FİKS 17.09 — SINIR KONTROLÜ. api tarafındaki `derEl` (grup6.ts:285) bozuk girdide
  // 'der: eof' atıyor; burada atmıyorduk: kırpık baytta `b[off]`/`b[i++]` undefined dönüp
  // uzunluk NaN'a kayıyor, `icSon` çöp oluyordu. Çökmez ama yanlış yük seçilip `risk_metrik`
  // SESSİZCE yanlış yazılabilirdi. Artık geçersiz elemanda `son > b.length` dönüyoruz →
  // derCocuk'taki `c.son > b.length` kontrolü (70) zinciri güvenle durduruyor.
  const gecersiz: El = { tag: 0, icBas: b.length, icSon: b.length, son: b.length + 1, bel: false }
  if (off < 0 || off + 2 > b.length) return gecersiz
  const tag = b[off]
  let i = off + 1
  let len = b[i++]
  if (len === 0x80) return { tag, icBas: i, icSon: b.length, son: b.length, bel: true }
  if (len & 0x80) {
    const n = len & 0x7f
    if (n > 4 || i + n > b.length) return { ...gecersiz, tag }   // >4 bayt uzunluk = 4GB+, receipt'te olamaz
    len = 0
    for (let k = 0; k < n; k++) len = len * 256 + b[i++]
  }
  if (i + len > b.length) return { ...gecersiz, tag }
  return { tag, icBas: i, icSon: i + len, son: i + len, bel: false }
}

/** Belirsiz uzunlukta EOC'ye (00 00) kadar, sabit uzunlukta icSon'a kadar çocukları okur. */
function derCocuk(b: Uint8Array, el: El): El[] {
  const out: El[] = []
  let i = el.icBas
  const son = el.bel ? b.length : el.icSon
  while (i < son - 1) {
    if (b[i] === 0x00 && b[i + 1] === 0x00) break        // EOC
    const c = derOku(b, i)
    if (c.bel) {                                          // iç içe belirsiz → kendi EOC'sini bul
      const alt = derCocuk(b, c)
      let j = alt.length ? alt[alt.length - 1].son : c.icBas
      while (j < b.length - 1 && !(b[j] === 0x00 && b[j + 1] === 0x00)) j++
      c.icSon = j
      c.son = j + 2
    }
    if (c.son <= i || c.son > b.length) break             // bozuk uzunluk → sessizce dur
    out.push(c)
    i = c.son
  }
  return out
}

/** Parçalı (constructed) OCTET STRING → parçaları birleştirir; düz ise içeriği döner. */
function octetBirlestir(b: Uint8Array, el: El): Uint8Array {
  if (!el.bel && (el.tag & 0x20) === 0) return b.subarray(el.icBas, el.icSon)
  const parcalar: Uint8Array[] = []
  for (const c of derCocuk(b, el)) {
    if (c.bel || (c.tag & 0x20)) parcalar.push(octetBirlestir(b, c))
    else if (c.tag === 0x04) parcalar.push(b.subarray(c.icBas, c.icSon))
  }
  const boy = parcalar.reduce((t, p) => t + p.length, 0)
  const out = new Uint8Array(boy)
  let o = 0
  for (const p of parcalar) { out.set(p, o); o += p.length }
  return out
}

const intDeger = (b: Uint8Array, el: El): number => {
  let v = 0
  for (let i = el.icBas; i < el.icSon; i++) v = v * 256 + b[i]
  return v
}

/** PKCS#7 ContentInfo → SignedData → encapContentInfo → [0] → OCTET STRING (receipt yükü).
 *  Beklenen yol tutmazsa: tüm ağaçtaki OCTET STRING'ler arasından "SET of SEQUENCE" olanı arar. */
function receiptYuku(der: Uint8Array): Uint8Array | null {
  try {
    const kok = derOku(der, 0)                      // ContentInfo SEQUENCE
    const k1 = derCocuk(der, kok)                   // [0]=contentType OID, [1]=[0] EXPLICIT
    const acik = k1.find((x) => x.tag === 0xa0)
    if (acik) {
      const sd = derCocuk(der, acik)[0]             // SignedData SEQUENCE
      for (const c of derCocuk(der, sd)) {
        if (c.tag !== 0x30) continue                // encapContentInfo SEQUENCE ara
        const ic = derCocuk(der, c)
        const e0 = ic.find((x) => x.tag === 0xa0)
        if (!e0) continue
        const okt = derCocuk(der, e0)[0]
        // ⚠️ 0x04 (düz) DEĞİL, gerçek receipt'te 0x24/belirsiz (PARÇALI) geliyor → birleştir.
        if (okt && (okt.tag === 0x04 || okt.tag === 0x24 || okt.bel)) return octetBirlestir(der, okt)
      }
    }
  } catch { /* yapı beklenenden farklı → yedek tarama */ }
  // yedek: ilk "SET of SEQUENCE" gibi görünen OCTET STRING
  try {
    const yigin: El[] = [derOku(der, 0)]
    while (yigin.length) {
      const el = yigin.pop()!
      if (el.tag === 0x04 || el.tag === 0x24 || el.bel) {
        // yedek yol da PARÇALI OCTET STRING'i çözebilmeli — yoksa yalnız işe yaramayacağı
        // durumda "çalışıyormuş" gibi durur.
        const ic = octetBirlestir(der, el)
        if (ic.length > 8 && ic[0] === 0x31) return ic
      }
      if (el.tag === 0x30 || el.tag === 0x31 || (el.tag & 0x20)) {
        for (const c of derCocuk(der, el)) yigin.push(c)
      }
    }
  } catch { /* yut */ }
  return null
}

/** Yük: SET OF SEQUENCE { type INTEGER, version INTEGER, value OCTET STRING }.
 *  İlgilendiklerimiz: 6=tip('ATTEST'|'RECEIPT') · 17=risk metriği · 19=not-before · 21=expiry.
 *  Değerler OCTET STRING içinde UTF-8 METİN olarak durur. */
type Alanlar = { tip: string; risk: number | null; notBefore: number | null; expiry: number | null }

function alanlariCoz(yuk: Uint8Array): Alanlar {
  const s: Alanlar = { tip: '', risk: null, notBefore: null, expiry: null }
  const td = new TextDecoder()
  const kok = derOku(yuk, 0)                        // SET
  for (const seq of derCocuk(yuk, kok)) {
    if (seq.tag !== 0x30) continue
    const p = derCocuk(yuk, seq)
    if (p.length < 3 || p[2].tag !== 0x04) continue
    const tip = intDeger(yuk, p[0])
    const metin = td.decode(yuk.subarray(p[2].icBas, p[2].icSon)).trim()
    if (tip === 6) s.tip = metin
    else if (tip === 17) { const n = parseInt(metin, 10); if (!isNaN(n)) s.risk = n }
    else if (tip === 19) { const t = Date.parse(metin); if (!isNaN(t)) s.notBefore = Math.floor(t / 1000) }
    else if (tip === 21) { const t = Date.parse(metin); if (!isNaN(t)) s.expiry = Math.floor(t / 1000) }
  }
  return s
}

const b64Coz = (s: string): Uint8Array => {
  const bin = atob(s.replace(/\s+/g, ''))
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

type Satir = {
  key_id: string; uid: string; env: string; receipt: string | null
  receipt_not_before: number | null; receipt_expiry: number | null
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  if (!env.DEVICECHECK_P8) { log('DEVICECHECK_P8 yok — atlandı'); return }

  // Sırası gelenler: receipt'i olan, not-before geçmiş (ya da hiç denenmemiş), expiry gelmemiş.
  const sr = await env.DB.prepare(
    `SELECT key_id, uid, env, receipt, receipt_not_before, receipt_expiry
       FROM attest_keys
      WHERE receipt IS NOT NULL AND receipt <> ''
        AND (receipt_not_before IS NULL OR receipt_not_before <= ?1)
        AND (receipt_expiry IS NULL OR receipt_expiry > ?1)
      ORDER BY COALESCE(receipt_checked, 0) ASC
      LIMIT ?2`).bind(now, TUR_BASINA).all<Satir>()
  const satirlar = sr.results ?? []
  if (!satirlar.length) { log('sırası gelen anahtar yok'); return }

  const kid = env.DEVICECHECK_KEY_ID || VARSAYILAN_KID
  const jwt = await apnsJwtUret(env.DEVICECHECK_P8, kid, TEAM)   // DeviceCheck jetonu = APNs ile aynı şekil
  let ok = 0; let erken = 0; let hata = 0

  for (const s of satirlar) {
    const uc = UC[s.env] || UC.production
    let yanit: Response
    try {
      yanit = await fetch(uc, { method: 'POST', headers: { Authorization: jwt }, body: s.receipt! })
    } catch (e) {
      hata++
      await env.DB.prepare('UPDATE attest_keys SET receipt_hata = ?2, updated_at = ?3 WHERE key_id = ?1')
        .bind(s.key_id, 'ag:' + String(e).slice(0, 40), now).run()
      continue
    }
    if (yanit.status === 304) {          // not-before gelmemiş — Apple'ın beklenen cevabı, hata değil
      erken++
      await env.DB.prepare('UPDATE attest_keys SET receipt_hata = ?2, updated_at = ?3 WHERE key_id = ?1')
        .bind(s.key_id, '304-erken', now).run()
      continue
    }
    if (yanit.status !== 200) {
      hata++
      log(`${s.uid} ${s.key_id.slice(0, 10)} HTTP ${yanit.status}`)
      await env.DB.prepare('UPDATE attest_keys SET receipt_hata = ?2, updated_at = ?3 WHERE key_id = ?1')
        .bind(s.key_id, String(yanit.status), now).run()
      continue
    }
    // 200 → gövde YENİ receipt (base64). Apple: "Store this receipt in place of the one used".
    const yeni = (await yanit.text()).trim()
    let a: Alanlar | null = null
    try {
      const yuk = receiptYuku(b64Coz(yeni))
      if (yuk) a = alanlariCoz(yuk)
    } catch (e) { log('receipt çözülemedi: ' + String(e).slice(0, 60)) }
    await env.DB.prepare(
      `UPDATE attest_keys SET receipt = ?2, receipt_tip = ?3, risk_metrik = ?4,
         receipt_not_before = ?5, receipt_expiry = ?6, receipt_checked = ?7,
         receipt_hata = NULL, updated_at = ?7 WHERE key_id = ?1`)
      .bind(s.key_id, yeni, a?.tip || null, a?.risk ?? null,
        a?.notBefore ?? null, a?.expiry ?? null, simdi()).run()
    ok++
    if (a && a.risk !== null) log(`${s.uid} risk=${a.risk} tip=${a.tip}`)
  }
  log(`tazelendi=${ok} erken(304)=${erken} hata=${hata} / ${satirlar.length}`)
}
