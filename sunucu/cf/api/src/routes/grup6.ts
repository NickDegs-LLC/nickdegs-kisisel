// grup6 — api/iap + api/integrity + api/attest + api/local-renders + api/groupvideo +
//         api/safety + api/routes (main.py birebir) + App Store/Play sunucu-sunucu bildirimleri
//         (sözleşme: cf/contracts/grup6.json; bildirim uçları yeni)
//
// Kapsanan uçlar (TAM yol; mount kökü '/'):
//   POST   /api/iap/verify          — StoreKit2 JWS: WebCrypto ES256 + elle x5c zincir doğrulama (pinli Apple Root G3)
//   POST   /api/iap/google          — Play abonelik: SA RS256 JWT (WebCrypto) + androidpublisher fetch
//   POST   /api/iap/google/boost    — Play consumable; idempotensi anahtarı orderId; sku encodeURIComponent'li
//   POST   /api/iap/apple/bildirim  — App Store Server Notifications V2 (auth YOK; JWS + pinli Root G3)
//   POST   /api/iap/google/bildirim — Play RTDN Pub/Sub push (OIDC Bearer; JWKS jwks:google)
//   GET    /api/integrity/nonce     — KV integrity_nonce:{uid} (TTL 600)
//   POST   /api/integrity           — Play Integrity decode; FAIL-OPEN; sayaçlar D1 integrity_stats
//   GET    /api/attest/challenge    — KV attest_challenge:{uid} (TTL 600)
//   POST   /api/attest              — App Attest: elle CBOR + x509 zincir + OID nonce; FAIL-OPEN; attest_key KORUNUR
//   GET    /api/local-renders       — KV yerelq:{uid} listesi + users.yerel_son damgası (saatte 1)
//   POST   /api/local-renders/done  — KV yerelq listesinden from kaydını sil
//   GET    /api/groupvideo          — prefs_json.group_video (varsayılan 'both')
//   PUT    /api/groupvideo          — whitelist both|group|solo
//   GET    /api/safety              — prefs_json.safety_* + buddy_profile (_profile_of eşleniği)
//   PUT    /api/safety              — KISMİ güncelleme ('anahtar body'de varsa yaz'); buddy friends kontrolü
//   POST   /api/routes/share        — IDOR: sahiplik ihlali 404; kulüp > kişi; push → KV push:bekleyen
//   GET    /api/routes/shared       — shared_route_targets indeksli gelen kutusu (en yeni 50)
//
// Depo eşlemeleri (cf_mapping):
//   adminq → KV 'adminq:bekleyen:{ms}' (grup3 ile aynı)   pushq → KV 'push:bekleyen:{ms}_{hex}'   (Faz 3'te gerçek iletim)
//   yerelq/{u}.json → KV 'yerelq:{uid}' (ÜRETİCİ hâlâ sunucudaki activity-detect — senkron gerekir, dönüş notuna bkz)
//   INTEGRITY_ENFORCE / APPATTEST_ENFORCE → KV 'config:INTEGRITY_ENFORCE' / 'config:APPATTEST_ENFORCE' == '1'
//   /opt/movelog/data/sv-kapali bayrağı  → lib/ortak svKapali (tek KV anahtarı 'sv_off'; varlık = kapalı)
//   integrity_stats.db (sqlite)          → D1 integrity_stats (CREATE IF NOT EXISTS — migration'da yok, Python gibi kendi açar)
//   google-play-admin.json               → wrangler secret GOOGLE_SA_JSON (Env tipinde YOK — yerel cast, çekirdek nota bkz)

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, Env } from '../lib/env'
import { authUser, b64uDecode, b64uEncode } from '../lib/auth'
import { getUser, jsonGet, jsonSet, simdi } from '../lib/db'
import { Hata, hata } from '../lib/hata'
import { adminq as adminqLib, pushq as pushqLib, svKapali } from '../lib/ortak'
import { jwksGetir, rs256Dogrula } from './grup3'
import {
  abonelikUygula, appleAboneDurum, bildirimKararOku, bildirimKaydet, bildirimTekrar,
  googleAboneDurum, kullaniciAdi,
} from '../lib/iap-abonelik'

const g = new Hono<AppEnv>()
const enc = new TextEncoder()
const td = new TextDecoder()

// ---------------------------------------------------------------------------
// Sabitler (main.py:1470-1482, 1594-1595, 1653, 1786)
// ---------------------------------------------------------------------------
const IAP_BUNDLE_ID = 'com.nickdegs.kisisel'
const BOOST_2X_ID = 'com.nickdegs.kisisel.boost.daily2x'
const SOKAK_IDS: Record<string, number> = { 'com.nickdegs.kisisel.sokak.tek': 1, 'com.nickdegs.kisisel.sokak.uclu': 3 }
const VIDEO_IDS: Record<string, number> = { 'com.nickdegs.kisisel.video.uclu': 3, 'com.nickdegs.kisisel.video.besli': 5 }
const ULTRA_IDS = new Set(['com.nickdegs.kisisel.ultra.monthly', 'com.nickdegs.kisisel.ultra.yearly'])
const SUB_IDS = new Set(['com.nickdegs.kisisel.premium.monthly', 'com.nickdegs.kisisel.premium.yearly', ...ULTRA_IDS])
const ANDROID_PKG = 'com.nickdegs.movelog'
// İnceleme hesapları DOKUNMA = appreview/appreview2 — lib/iap-abonelik.ts (cron premium-suresi.ts ile AYNEN aynı)
const ANDROID_BOOST_SKU = 'boost_daily2x'
// ANDROID TÜKETİLEBİLİR PAKETLER (Android 1.61, 2026-08-31) — main.py'de YOKTU (Google dalında yalnız
// boost vardı). Apple ürünlerinin Play karşılıkları; adlar birebir eşlenik (…video.uclu → video_uclu).
// GÜVENLİK: sku istemciden gelir ama Google purchases.products doğrulaması token'ı ÜRÜNE bağlar —
// sahte sku ile başka ürünün hakkı alınamaz (Google 400 döner, aşağıda 'satın alma doğrulanamadı').
const ANDROID_SOKAK_IDS: Record<string, number> = { sokak_tek: 1, sokak_uclu: 3 }
const ANDROID_VIDEO_IDS: Record<string, number> = { video_uclu: 3, video_besli: 5 }

// Apple Root CA - G3 (pinli, main.py:1486) — StoreKit2 JWS zinciri buna kadar doğrulanır
const APPLE_ROOT_G3_B64 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA=='

// Apple App Attest Root CA (pinli, main.py:1784-1785)
const APPATTEST_ROOT_B64 =
  'MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYwJAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwKQXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNaFw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlvbiBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9ybmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdhNbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9auYen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijVoyFraWVIyd/dganmrduC1bmTBGwD'

// Env'de HENÜZ tanımlı olmayan sırlar/ayarlar (çekirdek env.ts'e eklenmeli — kural 5: lib düzenlenmedi)
type EkSirlar = { GOOGLE_SA_JSON?: string; APPATTEST_APPID?: string }
const ekSir = (env: Env): EkSirlar => env as unknown as EkSirlar
const appAttestAppId = (env: Env): string => ekSir(env).APPATTEST_APPID || 'SZF4T3P583.' + IAP_BUNDLE_ID

// ---------------------------------------------------------------------------
// Python semantiği yardımcıları
// ---------------------------------------------------------------------------
/** Python str(x) eşleniği: undefined → varsayılan (dict.get), None → 'None', bool → 'True'/'False'. */
function pyStr(v: unknown, varsayilan = ''): string {
  if (v === undefined) return varsayilan
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  return String(v)
}

/** Python truthiness: None/''/0/False/boş liste/boş dict → false. */
function pyTruthy(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === '' || v === 0) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/** `payload.get("x") or {}` deseni: nesne değilse boş nesne. */
function nesne(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** FastAPI `body: dict = Body(...)` eşleniği: JSON değilse / dict değilse 422 (FastAPI detay listesi). */
async function bodyAl(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  let v: unknown
  try {
    v = await c.req.json()
  } catch {
    throw new Hata(422, [{ type: 'json_invalid', loc: ['body', 0], msg: 'JSON decode error', input: {}, ctx: { error: 'Expecting value' } }])
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v))
    throw new Hata(422, [{ type: 'dict_type', loc: ['body'], msg: 'Input should be a valid dictionary', input: v ?? null }])
  return v as Record<string, unknown>
}

function gunUTC(): string {
  return new Date().toISOString().slice(0, 10)   // ölçüldü: container TZ'siz = UTC → gün sınırı kaymaz
}

/** Python time.strftime("%d.%m.%Y %H:%M", localtime) eşleniği (localtime fiilen UTC — sözleşme notu). */
function tarihStrUTC(epochSn: number): string {
  const d = new Date(epochSn * 1000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}

function hexRasgele(bayt: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bayt))
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** secrets.token_urlsafe(24) eşleniği (24 rasgele bayt → padding'siz base64url). */
const tokenUrlsafe24 = () => b64uEncode(crypto.getRandomValues(new Uint8Array(24)))

function stdB64Decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function stdB64Encode(b: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i])
  return btoa(bin)
}

function baytEsit(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** `ig in hay` (bytes containment) eşleniği. */
function altDiziVar(hay: Uint8Array, ig: Uint8Array): boolean {
  dis: for (let i = 0; i + ig.length <= hay.length; i++) {
    for (let j = 0; j < ig.length; j++) if (hay[i + j] !== ig[j]) continue dis
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Kuyruk/bayrak yardımcıları (gölge mod: KV; Faz 3'te gerçek iletim/Queue)
// NOT: adminq/pushq/profileOf birden çok grubun ihtiyacı — lib'e taşınmalı (dönüş notu).
// ---------------------------------------------------------------------------
/** main.py _adminq eşleniği — lib/ortak adminq'ya devredildi (bütünleştirme 08-30). */
async function adminq(env: Env, msg: string): Promise<void> {
  await adminqLib(env, msg)
}

/** main.py _pushq eşleniği — lib/ortak pushq'ya devredildi (bütünleştirme 08-30). */
async function pushq(env: Env, user: string, title: string, body: string, route?: string): Promise<void> {
  await pushqLib(env, user, title, body, route)
}

/** KV '1' bayrağı (INTEGRITY_ENFORCE / APPATTEST_ENFORCE) — okunamazsa KAPALI tarafta kal. */
async function kvBayrak(env: Env, ad: string): Promise<boolean> {
  try {
    return (await env.KV.get('config:' + ad)) === '1'
  } catch {
    return false
  }
}

/** KV'de tutulan tek-kullanımlık nonce/challenge kaydı {n, ts}. */
async function kvNonceOku(env: Env, anahtar: string): Promise<{ n: string; ts: number } | null> {
  try {
    const raw = await env.KV.get(anahtar)
    if (!raw) return null
    const v = JSON.parse(raw) as { n?: unknown; ts?: unknown }
    if (typeof v?.n === 'string' && typeof v?.ts === 'number') return { n: v.n, ts: v.ts }
    return null
  } catch {
    return null
  }
}

/** profiles setdefault eşleniği: users satırı yoksa boş satır aç (tv=0, varsayılan kolonlar). */
async function kullaniciGarantile(db: D1Database, uid: string): Promise<void> {
  const ts = simdi()
  await db.prepare('INSERT INTO users (uid, created_at, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT(uid) DO NOTHING')
    .bind(uid, ts).run()
}

/** main.py _att_stat eşleniği: doğrulama denemesini D1'de say; HER hata yutulur (akış bozulmaz).
 *  Tablo migration'da YOK — Python'daki sqlite gibi burada CREATE IF NOT EXISTS ile açılır. */
async function attStat(db: D1Database, plat: string, sonuc: string): Promise<void> {
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS integrity_stats (gun TEXT, plat TEXT, sonuc TEXT, adet INTEGER, PRIMARY KEY (gun, plat, sonuc))').run()
    await db.prepare(
      'INSERT INTO integrity_stats (gun, plat, sonuc, adet) VALUES (?1, ?2, ?3, 1) ' +
      'ON CONFLICT(gun, plat, sonuc) DO UPDATE SET adet = adet + 1')
      .bind(gunUTC(), plat, sonuc).run()
  } catch (e) {
    console.log('att_stat hata:', String(e).slice(0, 80))
  }
}

/** render_counts.boost_{gün} sayacını +1 artır, YENİ değeri döndür (main.py:1586-1590 / 1680-1682). */
async function boostArtir(db: D1Database, uid: string): Promise<number> {
  const ts = simdi()
  const r = await db.prepare(
    'INSERT INTO render_counts (uid, counter_key, value, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3) ' +
    'ON CONFLICT(uid, counter_key) DO UPDATE SET value = value + 1, updated_at = ?3 RETURNING value')
    .bind(uid, 'boost_' + gunUTC(), ts).first<{ value: number }>()
  return Math.trunc(Number(r?.value ?? 1))
}

/** Abone/üye sayımı (adminq metinleri için; main.py:1553-1554 deseni). */
async function uyeSay(db: D1Database): Promise<{ n: number; abone: number }> {
  const r = await db.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN premium = 1 THEN 1 ELSE 0 END) AS abone FROM users')
    .first<{ n: number; abone: number | null }>()
  return { n: Number(r?.n ?? 0), abone: Number(r?.abone ?? 0) }
}

// ---------------------------------------------------------------------------
// _profile_of eşleniği (main.py:1389-1407) — buddy_profile / gönderen adı için
// ---------------------------------------------------------------------------
async function profileOf(env: Env, db: D1Database, u: string): Promise<Record<string, unknown>> {
  const p = await getUser(db, u)
  let avatar: unknown = null
  if (p?.avatar_json) {
    try { avatar = JSON.parse(p.avatar_json) } catch { avatar = null }
  }
  const ultraHam = !!Number(p?.ultra ?? 0)
  const adminHam = !!Number(p?.admin ?? 0)
  // free_tactical: kill-switch (config, varsayılan AÇIK) + hesap-1 + cihaz-1 (main.py:1406)
  let ftAcik = true
  try {
    const cfg = await db.prepare("SELECT value_json FROM config WHERE key = 'free_tactical_enabled'").first<{ value_json: string }>()
    if (cfg) { try { ftAcik = pyTruthy(JSON.parse(cfg.value_json)) } catch { ftAcik = true } }
  } catch { ftAcik = true }
  let cihazKullanildi = false
  if (p?.attest_key) {
    const d = await db.prepare('SELECT 1 AS x FROM free_tactical_devices WHERE attest_key = ?1').bind(p.attest_key).first()
    cihazKullanildi = d !== null
  }
  const svOff = await svKapali(env)   // tek KV anahtarı 'sv_off' (lib/ortak; bütünleştirme 08-30)
  return {
    username: u,
    name: pyTruthy(p?.name) ? String(p!.name) : u,
    handle: pyTruthy(p?.handle) ? String(p!.handle) : '',
    avatar: pyTruthy(avatar) ? avatar : { type: 'initials' },
    premium: !!Number(p?.premium ?? 0),
    ultra: ultraHam || adminHam,                       // Ultra tier (admin bypass)
    sv_off: svOff,                                     // /opt/movelog/data/sv-kapali → KV bayrağı
    sokak_hak: Math.trunc(Number(p?.sokak_hak ?? 0) || 0),
    video_hak: Math.trunc(Number(p?.video_hak ?? 0) || 0),
    sokak_hediye: false,                               // her zaman False (main.py:1400-1405)
    free_tactical: !!(ftAcik && !(ultraHam || adminHam) && !Number(p?.free_tactical_used ?? 0) && (!p?.attest_key || !cihazKullanildi)),
    admin: adminHam,
  }
}

// ---------------------------------------------------------------------------
// DER / X.509 / ECDSA yardımcıları (WebCrypto — cryptography kütüphanesinin eşleniği)
// ---------------------------------------------------------------------------
type DerEl = { tag: number; bas: number; icBas: number; icSon: number }

function derEl(b: Uint8Array, off: number): DerEl {
  if (off + 2 > b.length) throw new Error('der: eof')
  const tag = b[off]
  let i = off + 1
  let len = b[i++]
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) throw new Error('der: uzunluk bicimi')
    len = 0
    for (let k = 0; k < n; k++) len = len * 256 + b[i++]
  }
  if (i + len > b.length) throw new Error('der: tasma')
  return { tag, bas: off, icBas: i, icSon: i + len }
}

function derCocuklar(b: Uint8Array, el: DerEl): DerEl[] {
  const out: DerEl[] = []
  let off = el.icBas
  while (off < el.icSon) {
    const c = derEl(b, off)
    out.push(c)
    off = c.icSon
  }
  return out
}

const derButun = (b: Uint8Array, el: DerEl) => b.subarray(el.bas, el.icSon)   // tag+uzunluk+içerik
const derIc = (b: Uint8Array, el: DerEl) => b.subarray(el.icBas, el.icSon)    // yalnız içerik

const OID_ECDSA_SHA256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])
const OID_ECDSA_SHA384 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03])
const OID_ECDSA_SHA512 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x04])
const OID_EGRI_P256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07])
const OID_EGRI_P384 = new Uint8Array([0x2b, 0x81, 0x04, 0x00, 0x22])
const OID_EGRI_P521 = new Uint8Array([0x2b, 0x81, 0x04, 0x00, 0x23])
const OID_APPATTEST_NONCE = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02])  // 1.2.840.113635.100.8.2

type Egri = 'P-256' | 'P-384' | 'P-521'
type HashAd = 'SHA-256' | 'SHA-384' | 'SHA-512'
const egriBoyut = (e: Egri): number => (e === 'P-256' ? 32 : e === 'P-384' ? 48 : 66)

type Sertifika = {
  der: Uint8Array
  tbs: Uint8Array        // tbsCertificate'in TAM DER'i (tag+len dahil) — imza bunun üstünde
  tbsEl: DerEl
  spki: Uint8Array       // subjectPublicKeyInfo TAM DER'i (importKey 'spki')
  egri: Egri             // bu sertifikanın AÇIK ANAHTAR eğrisi
  imzaHash: HashAd       // bu sertifikanın İMZA hash'i (signature_hash_algorithm eşleniği)
  imzaDer: Uint8Array    // ECDSA-Sig-Value (DER SEQ{r,s})
}

function sertifikaCoz(der: Uint8Array): Sertifika {
  const kok = derEl(der, 0)                       // Certificate ::= SEQUENCE
  const [tbsEl, algEl, sigEl] = derCocuklar(der, kok)
  const algOid = derIc(der, derCocuklar(der, algEl)[0])
  let imzaHash: HashAd
  if (baytEsit(algOid, OID_ECDSA_SHA256)) imzaHash = 'SHA-256'
  else if (baytEsit(algOid, OID_ECDSA_SHA384)) imzaHash = 'SHA-384'
  else if (baytEsit(algOid, OID_ECDSA_SHA512)) imzaHash = 'SHA-512'
  else throw new Error('imza algoritmasi desteklenmiyor')
  const sigIc = derIc(der, sigEl)                 // BIT STRING: [kullanılmayan-bit][DER imza]
  const imzaDer = sigIc.subarray(1)
  const tc = derCocuklar(der, tbsEl)              // [0]version?, serial, sigalg, issuer, validity, subject, spki, ...
  const kay = tc[0].tag === 0xa0 ? 1 : 0
  const spkiEl = tc[kay + 5]
  const spkiAlgKisim = derCocuklar(der, derCocuklar(der, spkiEl)[0])
  const egriOid = spkiAlgKisim.length > 1 ? derIc(der, spkiAlgKisim[1]) : new Uint8Array()
  let egri: Egri
  if (baytEsit(egriOid, OID_EGRI_P256)) egri = 'P-256'
  else if (baytEsit(egriOid, OID_EGRI_P384)) egri = 'P-384'
  else if (baytEsit(egriOid, OID_EGRI_P521)) egri = 'P-521'
  else throw new Error('egri desteklenmiyor')
  return { der, tbs: derButun(der, tbsEl), tbsEl, spki: derButun(der, spkiEl), egri, imzaHash, imzaDer }
}

/** Uzantı ara (tbs → [3] explicit → SEQ OF Extension); dönen = extnValue OCTET STRING İÇERİĞİ. */
function uzantiBul(cert: Sertifika, oid: Uint8Array): Uint8Array | null {
  for (const c of derCocuklar(cert.der, cert.tbsEl)) {
    if (c.tag !== 0xa3) continue
    const dizi = derCocuklar(cert.der, c)[0]
    for (const ext of derCocuklar(cert.der, dizi)) {
      const kisim = derCocuklar(cert.der, ext)    // OID, [BOOLEAN critical], OCTET STRING
      if (baytEsit(derIc(cert.der, kisim[0]), oid)) return derIc(cert.der, kisim[kisim.length - 1])
    }
  }
  return null
}

/** DER ECDSA-Sig-Value → WebCrypto ham r||s (eğri boyutuna sol-sıfır dolgulu). */
function derImzaHam(imzaDer: Uint8Array, boyut: number): Uint8Array {
  const seq = derEl(imzaDer, 0)
  const [r, s] = derCocuklar(imzaDer, seq)
  const out = new Uint8Array(boyut * 2)
  const yaz = (el: DerEl, konum: number) => {
    let v = derIc(imzaDer, el)
    let i = 0
    while (i < v.length - 1 && v[i] === 0) i++
    v = v.subarray(i)
    if (v.length > boyut) throw new Error('imza bileseni tasti')
    out.set(v, konum + boyut - v.length)
  }
  yaz(r, 0)
  yaz(s, boyut)
  return out
}

/** alt sertifikanın imzasını üst (imzalayan) sertifikanın anahtarıyla doğrula. */
async function sertifikaImzaDogrula(alt: Sertifika, ust: Sertifika): Promise<boolean> {
  const key = await crypto.subtle.importKey('spki', ust.spki as unknown as ArrayBuffer & Uint8Array,
    { name: 'ECDSA', namedCurve: ust.egri }, false, ['verify'])
  const ham = derImzaHam(alt.imzaDer, egriBoyut(ust.egri))
  return crypto.subtle.verify({ name: 'ECDSA', hash: alt.imzaHash }, key, ham, alt.tbs)
}

// ---------------------------------------------------------------------------
// StoreKit2 JWS doğrulama (main.py _verify_storekit_jws birebir; geçersiz/sahte → null)
// ---------------------------------------------------------------------------
async function storekitJwsDogrula(jws: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = (jws || '').split('.')
    if (parts.length !== 3) return null
    const header = JSON.parse(td.decode(b64uDecode(parts[0]))) as Record<string, unknown>
    const x5cHam = header.x5c
    const x5c: string[] = Array.isArray(x5cHam) ? (x5cHam as string[]) : []
    if (x5c.length < 2) return null
    const rootDer = stdB64Decode(APPLE_ROOT_G3_B64)
    let ders = x5c.map(stdB64Decode)
    // zincirin sonu PINLI Apple root ile birebir aynı olmalı; değilse pinli root zincir sonuna eklenir
    if (baytEsit(ders[ders.length - 1], rootDer)) ders[ders.length - 1] = rootDer
    else ders = [...ders, rootDer]
    const certs = ders.map(sertifikaCoz)
    for (let i = 0; i < certs.length - 1; i++)
      if (!(await sertifikaImzaDogrula(certs[i], certs[i + 1]))) return null
    // JWS imzasını LEAF ile doğrula (ES256, ham r||s 64 bayt)
    const ham = b64uDecode(parts[2])
    if (ham.length !== 64) return null
    const leafKey = await crypto.subtle.importKey('spki', certs[0].spki as unknown as ArrayBuffer & Uint8Array,
      { name: 'ECDSA', namedCurve: certs[0].egri }, false, ['verify'])
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, leafKey, ham,
      enc.encode(parts[0] + '.' + parts[1]))
    if (!ok) return null
    return JSON.parse(td.decode(b64uDecode(parts[1]))) as Record<string, unknown>
  } catch (e) {
    console.log('storekit jws doğrulama başarısız:', String(e).slice(0, 120))
    return null
  }
}

// ---------------------------------------------------------------------------
// Google SA erişim token'ı (RS256 SA JWT, WebCrypto) + ~55 dk KV cache (sözleşme önerisi)
// ---------------------------------------------------------------------------
let _rsaCache: { pem: string; key: CryptoKey } | null = null

async function rsaAnahtar(pem: string): Promise<CryptoKey> {
  if (_rsaCache && _rsaCache.pem === pem) return _rsaCache.key
  const der = stdB64Decode(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  const key = await crypto.subtle.importKey('pkcs8', der as unknown as ArrayBuffer & Uint8Array,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  _rsaCache = { pem, key }
  return key
}

async function saErisimToken(env: Env, kapsam: 'androidpublisher' | 'playintegrity'): Promise<string | null> {
  try {
    const kvKey = 'gtoken:' + kapsam
    try {
      const onbellek = await env.KV.get(kvKey)
      if (onbellek) return onbellek
    } catch { /* cache okunamazsa taze al */ }
    const saHam = ekSir(env).GOOGLE_SA_JSON
    if (!saHam) return null                        // secret yok → 503 yolu (Python SA dosyası yok gibi)
    const sa = JSON.parse(saHam) as { client_email: string; private_key: string }
    const now = simdi()
    const header = b64uEncode(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
    const claim = b64uEncode(enc.encode(JSON.stringify({
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/' + kapsam,
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    })))
    const key = await rsaAnahtar(sa.private_key)
    const imza = b64uEncode(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(header + '.' + claim))))
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${imza}` }),
    })
    const j = (await r.json()) as Record<string, unknown>
    const at = j.access_token
    if (typeof at === 'string' && at) {
      try { await env.KV.put(kvKey, at, { expirationTtl: 3300 }) } catch { /* cache yazılamazsa da token döner */ }
      return at
    }
    return null
  } catch (e) {
    console.log('google token hata:', String(e).slice(0, 120))
    return null
  }
}

/** main.py _decode_integrity eşleniği: hazır değilse / reddederse null (FAIL-OPEN üst katmanda). */
async function integrityCoz(env: Env, token: string): Promise<Record<string, unknown> | null> {
  const at = await saErisimToken(env, 'playintegrity')
  if (!at) return null
  try {
    const r = await fetch(`https://playintegrity.googleapis.com/v1/${ANDROID_PKG}:decodeIntegrityToken`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + at, 'content-type': 'application/json' },
      body: JSON.stringify({ integrityToken: token }),
    })
    if (r.status !== 200) {
      console.log('integrity decode reddetti:', r.status, (await r.text()).slice(0, 120))
      return null
    }
    const j = (await r.json()) as Record<string, unknown>
    const p = j.tokenPayloadExternal
    return p !== null && typeof p === 'object' ? (p as Record<string, unknown>) : null
  } catch (e) {
    console.log('integrity decode hata:', String(e).slice(0, 100))
    return null
  }
}

// ---------------------------------------------------------------------------
// CBOR çözücü (App Attest nesnesi için asgari alt küme) + _verify_appattest eşleniği
// ---------------------------------------------------------------------------
function cborOku(b: Uint8Array, st: { i: number }): unknown {
  if (st.i >= b.length) throw new Error('cbor: eof')
  const ib = b[st.i++]
  const mt = ib >> 5
  const ai = ib & 0x1f
  let n = 0
  if (ai < 24) n = ai
  else if (ai === 24) n = b[st.i++]
  else if (ai === 25) { n = (b[st.i] << 8) | b[st.i + 1]; st.i += 2 }
  else if (ai === 26) { n = b[st.i] * 0x1000000 + ((b[st.i + 1] << 16) | (b[st.i + 2] << 8) | b[st.i + 3]); st.i += 4 }
  else if (ai === 27) { for (let k = 0; k < 8; k++) n = n * 256 + b[st.i + k]; st.i += 8 }
  else throw new Error('cbor: ek bilgi ' + ai)   // 28-31 (belirsiz uzunluk dahil) desteklenmez
  switch (mt) {
    case 0: return n
    case 1: return -1 - n
    case 2: { const v = b.subarray(st.i, st.i + n); st.i += n; return v }
    case 3: { const v = td.decode(b.subarray(st.i, st.i + n)); st.i += n; return v }
    case 4: { const a: unknown[] = []; for (let k = 0; k < n; k++) a.push(cborOku(b, st)); return a }
    case 5: {
      const m: Record<string, unknown> = {}
      for (let k = 0; k < n; k++) { const anah = cborOku(b, st); m[String(anah)] = cborOku(b, st) }
      return m
    }
    case 6: return cborOku(b, st)                 // tag → içeriği döndür
    default:                                      // 7: basit değerler (float'lar attestation'da yok)
      if (ai === 20) return false
      if (ai === 21) return true
      if (ai === 22 || ai === 23) return null
      return n
  }
}

type AttestSonuc = { ok: boolean; why: string; keyId: string }

/** main.py _verify_appattest eşleniği: HER istisna içeride yutulur → (ok=false, why='err:...'). */
async function appAttestDogrula(env: Env, attB64: string, challenge: string): Promise<AttestSonuc> {
  try {
    const obj = nesne(cborOku(stdB64Decode(attB64), { i: 0 }))
    if (obj.fmt !== 'apple-appattest') return { ok: false, why: 'fmt', keyId: '' }
    const attStmt = nesne(obj.attStmt)
    const x5cHam = attStmt.x5c
    if (!Array.isArray(x5cHam)) throw new Error('x5c yok')
    const authData = obj.authData
    if (!(authData instanceof Uint8Array)) throw new Error('authData yok')
    const ders = [...(x5cHam as Uint8Array[]), stdB64Decode(APPATTEST_ROOT_B64)]
    const certs = ders.map(sertifikaCoz)
    for (let i = 0; i < certs.length - 1; i++)     // zincir: cred <- ara <- Apple App Attest Root
      if (!(await sertifikaImzaDogrula(certs[i], certs[i + 1]))) return { ok: false, why: 'err:zincir', keyId: '' }
    const chHash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(challenge)))
    const birlesik = new Uint8Array(authData.length + chHash.length)
    birlesik.set(authData, 0)
    birlesik.set(chHash, authData.length)
    const nonce = new Uint8Array(await crypto.subtle.digest('SHA-256', birlesik))
    const ext = uzantiBul(certs[0], OID_APPATTEST_NONCE)
    if (!ext || !altDiziVar(ext, nonce)) return { ok: false, why: 'nonce', keyId: '' }
    const appidHash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(appAttestAppId(env))))
    if (!baytEsit(authData.subarray(0, 32), appidHash)) return { ok: false, why: 'rpid', keyId: '' }
    const credLen = (authData[53] << 8) | authData[54]  // keyId (credentialId) = cihaz-benzersiz
    const keyId = stdB64Encode(authData.subarray(55, 55 + credLen))
    return { ok: true, why: 'ok', keyId }
  } catch (e) {
    return { ok: false, why: 'err:' + String(e).slice(0, 60), keyId: '' }
  }
}

// ===========================================================================
// UÇLAR
// ===========================================================================

// ---------- POST /api/iap/verify (main.py:1530-1591) ----------
g.post('/api/iap/verify', authUser, async (c) => {
  const body = await bodyAl(c)
  const user = c.get('user')
  const db = c.env.DB
  const p = await storekitJwsDogrula(pyStr(body.jws))
  if (!p || p.bundleId !== IAP_BUNDLE_ID) hata(400, 'geçersiz veya doğrulanamayan işlem')
  const pid = pyStr(p.productId)
  const tid = pyStr(p.transactionId)
  if (!pid || !tid) hata(400, 'eksik işlem')
  await kullaniciGarantile(db, user)
  const prof = await getUser(db, user)
  const kayit = await db.prepare('SELECT uid FROM iap_transactions WHERE tid = ?1').bind(tid).first<{ uid: string }>()
  const ts = simdi()
  const ad = pyTruthy(prof?.name) ? String(prof!.name) : user.slice(0, 10)

  if (SUB_IDS.has(pid)) {
    const ultra = ULTRA_IDS.has(pid) ? 1 : 0     // premium abonelik → ultra False (main.py:1545)
    const exp = p.expiresDate
    // 🔴 FİKS 05.09 — APP STORE İNCELEMESİNİ KIRACAK DELİK. `premium-suresi` görevi süresi
    // dolmuş abonelikleri düşürüyor ve tek koruma `premium_until IS NULL`. Ama inceleme
    // hesapları (appreview/appreview2) inceleme sırasında uygulama içinden SANDBOX satın alma
    // yaparsa bu uç çalışır ve `premium_until` YAZILIR — sandbox aylık abonelik **5 DAKİKADA**
    // biter. 7 gün sonra inceleme hesabının premium'u düşer ve sonraki inceleme REDDEDİLİR.
    // Sandbox işlemi premium'u AÇAR (inceleme test edebilsin) ama bitiş tarihi YAZILMAZ →
    // düşürme görevi ona hiç dokunmaz. Üretim işlemleri etkilenmez.
    const sandbox = pyStr(p.environment).toLowerCase() === 'sandbox'
    if (pyTruthy(exp) && !sandbox) {
      await db.prepare('UPDATE users SET premium = 1, ultra = ?1, premium_until = ?2, updated_at = ?3 WHERE uid = ?4')
        .bind(ultra, Math.floor(Number(exp) / 1000), ts, user).run()
    } else {
      // sandbox VEYA expiresDate yok → premium açılır, süre yazılmaz (düşürme kapsamı dışında)
      await db.prepare('UPDATE users SET premium = 1, ultra = ?1, updated_at = ?2 WHERE uid = ?3')
        .bind(ultra, ts, user).run()
    }
    if (!kayit) {                                 // YENİ işlem → Barış'a anlık haber (yalnız İLK işlemde)
      await db.prepare('INSERT INTO iap_transactions (tid, uid, pid, ts, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)')
        .bind(tid, user, pid, ts).run()
      const expS = pyTruthy(exp) ? tarihStrUTC(Math.floor(Number(exp) / 1000)) : '?'
      const deneme = pyTruthy(p.offerType) ? ' (deneme/tanıtım teklifi)' : ''
      const say = await uyeSay(db)
      await adminq(c.env,
        `💰 Move Log Abonelik\n${ad} → ${ultra ? 'ULTRA' : 'Premium'} · iOS${deneme}\n` +
        `Ürün: ${pid.split('.').pop()} · bitiş ${expS}\nToplam: ${say.abone} abone · ${say.n} üye`)
    }
    // Bildirim eşleşmesi: originalTransactionId yenilemelerde sabit kalır, transactionId değişir.
    const orig = pyStr(p.originalTransactionId)
    if (orig && orig !== tid) {
      await db.prepare(
        'INSERT OR IGNORE INTO iap_transactions (tid, uid, pid, ts, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)')
        .bind(orig, user, pid, ts).run()
    }
    return c.json({ ok: true, premium: true })
  }

  if (Object.hasOwn(SOKAK_IDS, pid)) {   // Python `pid in SOKAK_IDS` = yalnız KENDİ anahtarları (JS `in` prototipe de bakar)
    if (kayit) return c.json({ ok: true, already: true, sokak: Math.trunc(Number(prof?.sokak_hak ?? 0) || 0) })
    await db.prepare('INSERT INTO iap_transactions (tid, uid, pid, ts, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)')
      .bind(tid, user, pid, ts).run()
    const adet = SOKAK_IDS[pid]
    const yeni = await db.prepare('UPDATE users SET sokak_hak = COALESCE(sokak_hak, 0) + ?1, updated_at = ?2 WHERE uid = ?3 RETURNING sokak_hak')
      .bind(adet, ts, user).first<{ sokak_hak: number }>()
    const toplam = Math.trunc(Number(yeni?.sokak_hak ?? adet))
    await adminq(c.env, `💰 Move Log Sokak Hakkı\n${ad} → ${adet} hak · iOS\nÜrün: ${pid.split('.').pop()}\nToplam hakkı: ${toplam}`)
    return c.json({ ok: true, sokak: toplam })
  }

  if (Object.hasOwn(VIDEO_IDS, pid)) {
    if (kayit) return c.json({ ok: true, already: true, video: Math.trunc(Number(prof?.video_hak ?? 0) || 0) })
    await db.prepare('INSERT INTO iap_transactions (tid, uid, pid, ts, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)')
      .bind(tid, user, pid, ts).run()
    const adet = VIDEO_IDS[pid]
    const yeni = await db.prepare('UPDATE users SET video_hak = COALESCE(video_hak, 0) + ?1, updated_at = ?2 WHERE uid = ?3 RETURNING video_hak')
      .bind(adet, ts, user).first<{ video_hak: number }>()
    const toplam = Math.trunc(Number(yeni?.video_hak ?? adet))
    await adminq(c.env, `💰 Move Log Video Paketi\n${ad} → ${adet} video · iOS\nÜrün: ${pid.split('.').pop()}\nToplam hakkı: ${toplam}`)
    return c.json({ ok: true, video: toplam })
  }

  if (pid === BOOST_2X_ID) {
    if (kayit) return c.json({ ok: true, already: true })   // idempotent
    await db.prepare('INSERT INTO iap_transactions (tid, uid, pid, ts, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)')
      .bind(tid, user, pid, ts).run()
    await adminq(c.env, `💰 BOOST satın alındı: ${ad}`)
    const sayac = await boostArtir(db, user)                // her boost +1 kat (üst üste alınabilir)
    return c.json({ ok: true, boost_mult: 1 + sayac })
  }

  hata(400, 'bilinmeyen ürün')
})

// ---------- POST /api/iap/google (main.py:1614-1650) ----------
g.post('/api/iap/google', authUser, async (c) => {
  const body = await bodyAl(c)
  const user = c.get('user')
  const tok = pyStr(body.token)
  if (!tok) hata(400, 'eksik satın alma')
  const at = await saErisimToken(c.env, 'androidpublisher')
  if (!at) hata(503, 'doğrulama servisi hazır değil')
  const r = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PKG}/purchases/subscriptionsv2/tokens/${encodeURIComponent(tok)}`,
    { headers: { Authorization: 'Bearer ' + at } })
  if (r.status !== 200) hata(400, 'satın alma doğrulanamadı')
  const d = (await r.json()) as Record<string, unknown>
  const state = pyStr(d.subscriptionState)
  if (state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') {
    const db = c.env.DB
    // GİZLİLİK/gelir: token tek hesaba — replay ile başkası premium alamaz (main.py:1632-1634)
    const eski = await db.prepare('SELECT uid FROM iap_transactions WHERE tid = ?1').bind(tok).first<{ uid: string }>()
    if (eski && eski.uid !== user) hata(409, 'bu satin alma baska hesaba ait')
    const ilkDogrulama = !eski                    // bildirim SADECE token ilk görüldüğünde
    const ts = simdi()
    await db.prepare(
      "INSERT INTO iap_transactions (tid, uid, pid, ts, created_at, updated_at) VALUES (?1, ?2, 'google-sub', ?3, ?3, ?3) " +
      "ON CONFLICT(tid) DO UPDATE SET uid = ?2, pid = 'google-sub', ts = ?3, updated_at = ?3")
      .bind(tok, user, ts).run()
    await kullaniciGarantile(db, user)
    const lineItems = Array.isArray(d.lineItems) ? (d.lineItems as Record<string, unknown>[]) : []
    const pids = lineItems.map((li) => pyStr(nesne(li).productId))
    const ultra = pids.some((x) => x.includes('ultra'))   // "ultra" içeren ürün → ultra tier
    // 🔴 FİKS 05.09: `premium_until` YAZILMIYORDU ("iOS'tan farklı" diye bilinçli bırakılmış).
    // Sonuç: Android abonesinin bitiş tarihi hiçbir yerde tutulmuyor → abonelik iptal edilse bile
    // premium sonsuza dek açık kalıyor ve `premium-suresi` görevi (premium_until IS NULL olanı
    // atlar) onu ASLA düşüremiyor. Bitiş zamanı zaten elimizde: lineItems[0].expiryTime (RFC3339).
    const expIso = pyStr(nesne(lineItems[0]).expiryTime)
    const expTs = expIso ? Math.floor(Date.parse(expIso) / 1000) : 0
    if (Number.isFinite(expTs) && expTs > 0) {
      await db.prepare('UPDATE users SET premium = 1, ultra = ?1, premium_until = ?2, updated_at = ?3 WHERE uid = ?4')
        .bind(ultra ? 1 : 0, expTs, ts, user).run()
    } else {
      await db.prepare('UPDATE users SET premium = 1, ultra = ?1, updated_at = ?2 WHERE uid = ?3')
        .bind(ultra ? 1 : 0, ts, user).run()
    }
    if (ilkDogrulama) {
      const li0 = nesne(lineItems[0])
      let expS = pyStr(li0.expiryTime).slice(0, 16).replaceAll('T', ' ')
      if (!expS) expS = '?'
      const say = await uyeSay(db)
      const prof = await getUser(db, user)
      const ad = pyTruthy(prof?.name) ? String(prof!.name) : user.slice(0, 10)
      await adminq(c.env,
        `💰 Move Log Abonelik\n${ad} → ${ultra ? 'ULTRA' : 'Premium'} · Android\n` +
        `Ürün: ${pids.join(', ') || 'google-sub'} · bitiş ${expS}\nToplam: ${say.abone} abone · ${say.n} üye`)
    }
    return c.json({ ok: true, premium: true, ultra })   // 05.09: premium_until artık YAZILIYOR
  }
  hata(400, `abonelik aktif değil (${state})`)
})

// ---------- POST /api/iap/google/boost (main.py:1656-1684) ----------
g.post('/api/iap/google/boost', authUser, async (c) => {
  const body = await bodyAl(c)
  const user = c.get('user')
  const tok = pyStr(body.token)
  const sku = pyStr(body.sku, ANDROID_BOOST_SKU)
  if (!tok) hata(400, 'eksik satın alma')
  // BEYAZ LİSTE (1.61): bilinmeyen sku sessizce BOOST'a yazılmasın (eskiden her sku boost sayılırdı).
  // 1.60 istemcisi sku GÖNDERMEZ → varsayılan boost_daily2x, bu dal onu bozmaz.
  const sokakAdet = Object.hasOwn(ANDROID_SOKAK_IDS, sku) ? ANDROID_SOKAK_IDS[sku] : 0
  const videoAdet = Object.hasOwn(ANDROID_VIDEO_IDS, sku) ? ANDROID_VIDEO_IDS[sku] : 0
  if (sku !== ANDROID_BOOST_SKU && !sokakAdet && !videoAdet) hata(400, 'bilinmeyen ürün')
  const at = await saErisimToken(c.env, 'androidpublisher')
  if (!at) hata(503, 'doğrulama servisi hazır değil')
  // sku istemciden gelir ve URL'e girer → encodeURIComponent ŞART (sözleşme notu)
  const r = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PKG}/purchases/products/${encodeURIComponent(sku)}/tokens/${encodeURIComponent(tok)}`,
    { headers: { Authorization: 'Bearer ' + at } })
  if (r.status !== 200) hata(400, 'satın alma doğrulanamadı')
  const d = (await r.json()) as Record<string, unknown>
  // Python `d.get("purchaseState", 1) != 0` HAM karşılaştırma — Number() zorlaması YOK
  // ("0"/null gibi 0-olmayan JSON değerleri Python'da 400'e düşer, burada da düşmeli)
  const ps: unknown = d.purchaseState === undefined ? 1 : d.purchaseState
  if (ps !== 0) hata(400, 'satın alma tamamlanmadı')       // 0 = purchased
  const db = c.env.DB
  // İdempotensi anahtarı orderId (token DEĞİL) — yeniden-tüketimde farklı orderId gelebilir
  const oid = d.orderId === undefined ? tok : pyStr(d.orderId)
  const eski = await db.prepare('SELECT uid FROM iap_transactions WHERE tid = ?1').bind(oid).first()
  if (eski) return c.json({ ok: true, already: true })     // idempotent
  const ts = simdi()
  // Şema notu: Google boost'ta pid kolonuna sku değeri yazılır (iap_transactions pid ?? sku sözleşmesi)
  await db.prepare('INSERT INTO iap_transactions (tid, uid, pid, ts, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)')
    .bind(oid, user, sku, ts).run()

  // ---- SOKAK / VİDEO PAKETİ (Android 1.61) — Apple dalıyla (satır 601-632) simetrik ----
  if (sokakAdet || videoAdet) {
    await kullaniciGarantile(db, user)                     // users satırı yoksa UPDATE hiçbir şeye yazmaz
    const kolon = sokakAdet ? 'sokak_hak' : 'video_hak'
    const adet = sokakAdet || videoAdet
    const yeni = await db.prepare(
      `UPDATE users SET ${kolon} = COALESCE(${kolon}, 0) + ?1, updated_at = ?2 WHERE uid = ?3 RETURNING ${kolon}`)
      .bind(adet, ts, user).first<Record<string, number>>()
    const toplam = Math.trunc(Number(yeni?.[kolon] ?? adet))
    const prof = await getUser(db, user)
    const ad = pyTruthy(prof?.name) ? String(prof!.name) : user.slice(0, 10)
    await adminq(c.env, sokakAdet
      ? `💰 Move Log Sokak Hakkı\n${ad} → ${adet} hak · Android\nÜrün: ${sku}\nToplam hakkı: ${toplam}`
      : `💰 Move Log Video Paketi\n${ad} → ${adet} video · Android\nÜrün: ${sku}\nToplam hakkı: ${toplam}`)
    return sokakAdet ? c.json({ ok: true, sokak: toplam }) : c.json({ ok: true, video: toplam })
  }

  const sayac = await boostArtir(db, user)
  return c.json({ ok: true, boost_mult: 1 + sayac })       // admin bildirimi YOK (iOS'tan farklı)
})

// ---------------------------------------------------------------------------
// App Store Server Notifications V2 + Play RTDN
// ---------------------------------------------------------------------------
const RTDN_AUD_VARSAYILAN = 'https://kisisel-api.nickdegs.com/api/iap/google/bildirim'
const RTDN_SA_VARSAYILAN = 'movelog-deploy@move-log-500805.iam.gserviceaccount.com'
const GOOGLE_ISS = new Set(['https://accounts.google.com', 'accounts.google.com'])

function tuketilebilirMi(pid: string): boolean {
  return Object.hasOwn(SOKAK_IDS, pid) || Object.hasOwn(VIDEO_IDS, pid) || pid === BOOST_2X_ID
}

function epochMs(v: unknown): number {
  if (!pyTruthy(v)) return 0
  const n = Math.floor(Number(v) / 1000)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function rfc3339Sn(iso: string): number {
  if (!iso) return 0
  const t = Math.floor(Date.parse(iso) / 1000)
  return Number.isFinite(t) && t > 0 ? t : 0
}

function pubsubDataCoz(b64: string): Record<string, unknown> {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/')
  s += '='.repeat((4 - (s.length % 4)) % 4)
  return nesne(JSON.parse(td.decode(stdB64Decode(s))))
}

function hataKisa(e: unknown): string {
  return ('hata:' + String(e)).replace(/\s+/g, ' ').slice(0, 80)
}

async function rtdnOidcDogrula(env: Env, auth: string | undefined): Promise<boolean> {
  if (!auth || !auth.startsWith('Bearer ')) return false
  const tok = auth.slice(7).trim()
  if (!tok) return false
  const parca = tok.split('.')
  if (parca.length !== 3) return false
  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try {
    header = JSON.parse(td.decode(b64uDecode(parca[0]))) as Record<string, unknown>
    payload = JSON.parse(td.decode(b64uDecode(parca[1]))) as Record<string, unknown>
  } catch {
    return false
  }
  if (header.alg !== 'RS256') return false
  const keys = await jwksGetir(env, 'jwks:google', 'https://www.googleapis.com/oauth2/v3/certs')
  const jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk || !(await rs256Dogrula(tok, jwk))) return false
  if (!GOOGLE_ISS.has(pyStr(payload.iss))) return false
  const audBeklenen = env.RTDN_AUD || RTDN_AUD_VARSAYILAN
  const audRaw = payload.aud
  const audler = Array.isArray(audRaw) ? audRaw.map((a) => String(a)) : [pyStr(audRaw)]
  if (!audler.includes(audBeklenen)) return false
  if (pyStr(payload.email) !== (env.RTDN_SA || RTDN_SA_VARSAYILAN)) return false
  if (payload.email_verified !== true) return false
  if (Number(payload.exp ?? 0) <= simdi()) return false
  return true
}

async function googleSubV2(env: Env, tok: string): Promise<{ status: number; d: Record<string, unknown> | null }> {
  const at = await saErisimToken(env, 'androidpublisher')
  if (!at) return { status: 503, d: null }
  try {
    const r = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PKG}/purchases/subscriptionsv2/tokens/${encodeURIComponent(tok)}`,
      { headers: { Authorization: 'Bearer ' + at } })
    let d: Record<string, unknown> | null = null
    try { d = nesne(await r.json()) } catch { d = null }
    return { status: r.status, d }
  } catch {
    return { status: 0, d: null }   // ağ → çağıran 500 (Pub/Sub yeniden dener)
  }
}

function googleMaxBitis(d: Record<string, unknown>): number {
  const lineItems = Array.isArray(d.lineItems) ? (d.lineItems as Record<string, unknown>[]) : []
  let m = 0
  for (const li of lineItems) {
    const t = rfc3339Sn(pyStr(nesne(li).expiryTime))
    if (t > m) m = t
  }
  return m
}

function googleUltraMi(d: Record<string, unknown>): boolean {
  const lineItems = Array.isArray(d.lineItems) ? (d.lineItems as Record<string, unknown>[]) : []
  return lineItems.some((li) => pyStr(nesne(li).productId).includes('ultra'))
}

async function iapUidBul(db: D1Database, ...tidler: string[]): Promise<string | null> {
  const dolu = tidler.filter(Boolean)
  if (!dolu.length) return null
  const yer = dolu.map(() => '?').join(',')
  const r = await db.prepare(`SELECT uid FROM iap_transactions WHERE tid IN (${yer}) LIMIT 1`)
    .bind(...dolu).first<{ uid: string }>()
  return r?.uid ?? null
}

// ---------- POST /api/iap/apple/bildirim — App Store Server Notifications V2 (auth YOK) ----------
g.post('/api/iap/apple/bildirim', async (c) => {
  const body = await bodyAl(c)
  const p = await storekitJwsDogrula(pyStr(body.signedPayload))
  if (!p) hata(401, 'geçersiz veya doğrulanamayan bildirim')
  const data = nesne(p.data)
  if (pyStr(data.bundleId) !== IAP_BUNDLE_ID) hata(400, 'bundleId uyuşmuyor')
  const uuid = pyStr(p.notificationUUID)
  if (!uuid) hata(400, 'notificationUUID yok')
  const db = c.env.DB
  const eski = await bildirimKararOku(db, uuid)
  if (bildirimTekrar(eski)) return c.json({ ok: true, tekrar: true })
  const tip = pyStr(p.notificationType)
  const alt = pyStr(p.subtype) || null
  const ortam = pyStr(data.environment) || null
  const kaydet = (satir: { uid?: string | null; pid?: string | null; karar: string; bitis?: number | null }) =>
    bildirimKaydet(db, { id: uuid, platform: 'apple', tip, alt_tip: alt, ortam, ...satir })
  try {
    if (ortam === 'Sandbox') {
      await kaydet({ karar: 'yok-sayildi:sandbox' })
      return c.json({ ok: true })
    }
    if (tip === 'TEST') {
      await kaydet({ karar: 'yok-sayildi:test' })
      return c.json({ ok: true })
    }
    const txJws = pyStr(data.signedTransactionInfo)
    const tx = txJws ? await storekitJwsDogrula(txJws) : null
    if (!tx) hata(400, 'signedTransactionInfo doğrulanamadı')
    let renewal: Record<string, unknown> = {}
    const renJws = pyStr(data.signedRenewalInfo)
    if (renJws) {
      const r = await storekitJwsDogrula(renJws)
      if (r) renewal = r
    }
    const tid = pyStr(tx.transactionId)
    const orig = pyStr(tx.originalTransactionId)
    const pid = pyStr(tx.productId)
    const uid = await iapUidBul(db, orig, tid)
    if (!uid) {
      await kaydet({ pid, karar: 'kullanici-yok' })
      await adminq(c.env, `💳 Move Log bildirim: kullanıcı yok · apple · ${tip}`)
      return c.json({ ok: true })
    }
    const ts = simdi()
    if (tid) {
      await db.prepare(
        'INSERT OR IGNORE INTO iap_transactions (tid, uid, pid, ts, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)')
        .bind(tid, uid, pid || 'apple', ts).run()
    }
    const prof = await getUser(db, uid)
    const ad = kullaniciAdi(prof?.name, uid)
    if (SUB_IDS.has(pid)) {
      const exp = epochMs(tx.expiresDate)
      const grace = epochMs(renewal.gracePeriodExpiresDate)
      const dur = appleAboneDurum(tip, tx.revocationDate, exp, grace, ts)
      const karar = await abonelikUygula(db, uid, {
        aktif: dur.aktif, ultra: ULTRA_IDS.has(pid), bitis: dur.bitis,
      }, { env: c.env, ad, platform: 'apple', tip })
      await kaydet({ uid, pid, karar, bitis: dur.bitis })
      return c.json({ ok: true })
    }
    if (tuketilebilirMi(pid) && (tip === 'REFUND' || tip === 'REVOKE')) {
      await kaydet({ uid, pid, karar: 'yok-sayildi:tuketilebilir-iade' })
      await adminq(c.env, `💸 Move Log iade: ${ad} · ${pid.split('.').pop() || pid}`)
      return c.json({ ok: true })
    }
    await kaydet({ uid, pid, karar: 'yok-sayildi:' + (tip || 'bilinmeyen') })
    return c.json({ ok: true })
  } catch (e) {
    if (e instanceof Hata) throw e
    try { await kaydet({ karar: hataKisa(e) }) } catch { /* yazılamazsa da 500 */ }
    hata(500, 'bildirim işlenemedi')
  }
})

// ---------- POST /api/iap/google/bildirim — Play RTDN (Pub/Sub push, OIDC zorunlu) ----------
g.post('/api/iap/google/bildirim', async (c) => {
  if (!(await rtdnOidcDogrula(c.env, c.req.header('Authorization')))) hata(401, 'geçersiz RTDN token')
  const body = await bodyAl(c)
  const msg = nesne(body.message)
  const mid = pyStr(msg.messageId) || pyStr(msg.message_id)
  if (!mid) hata(400, 'messageId yok')
  const db = c.env.DB
  const eski = await bildirimKararOku(db, mid)
  if (bildirimTekrar(eski)) return c.json({ ok: true, tekrar: true })
  const kaydet = (satir: { tip?: string | null; alt_tip?: string | null; uid?: string | null; pid?: string | null; karar: string; bitis?: number | null }) =>
    bildirimKaydet(db, { id: mid, platform: 'google', ...satir })
  try {
    let dev: Record<string, unknown>
    try {
      dev = pubsubDataCoz(pyStr(msg.data))
    } catch {
      await kaydet({ karar: 'yok-sayildi:govde' })
      return c.json({ ok: true })
    }
    if (pyStr(dev.packageName) !== ANDROID_PKG) {
      await kaydet({ tip: 'paket', karar: 'yok-sayildi:paket' })
      return c.json({ ok: true })
    }
    if ('testNotification' in dev && dev.testNotification !== undefined && dev.testNotification !== null) {
      await kaydet({ tip: 'test', karar: 'yok-sayildi:test' })
      return c.json({ ok: true })
    }
    if (pyTruthy(dev.oneTimeProductNotification)) {
      const ot = nesne(dev.oneTimeProductNotification)
      await kaydet({
        tip: 'tek-seferlik', alt_tip: pyStr(ot.sku) || pyStr(ot.notificationType) || null,
        pid: pyStr(ot.sku) || null, karar: 'yok-sayildi:tek-seferlik',
      })
      return c.json({ ok: true })
    }
    if (pyTruthy(dev.voidedPurchaseNotification)) {
      const v = nesne(dev.voidedPurchaseNotification)
      const tok = pyStr(v.purchaseToken)
      const ptype = v.productType
      const abone = ptype === 1 || ptype === '1' || ptype === 'PRODUCT_TYPE_SUBSCRIPTION'
      const uid = tok ? await iapUidBul(db, tok) : null
      if (abone) {
        if (!uid) {
          await kaydet({ tip: 'voided', alt_tip: pyStr(v.orderId) || null, pid: tok || null, karar: 'kullanici-yok' })
          await adminq(c.env, `💳 Move Log bildirim: kullanıcı yok · google · voided`)
          return c.json({ ok: true })
        }
        const now = simdi()
        const prof = await getUser(db, uid)
        const ad = kullaniciAdi(prof?.name, uid)
        // İade çoğunlukla dönem ORTASINDA gelir: bitiş=şimdi alınırsa premium_until (dönem sonu)
        // "başka hak" korumasına takılır ve iade hiç düşürmez. Bu aboneliğin kendi bitişi Play'den
        // okunur; okunamazsa şimdi kullanılır (koruma devrede kalır) ve Barış'a elle kontrol notu gider.
        const play = await googleSubV2(c.env, tok)
        const kendiBitis = play.status === 200 && play.d ? googleMaxBitis(play.d) : 0
        const bitis = kendiBitis || now
        const karar = await abonelikUygula(db, uid, { aktif: false, ultra: false, bitis, zorlaPasif: true },
          { env: c.env, ad, platform: 'google', tip: 'voided' })
        if (!kendiBitis && karar !== 'dusuruldu')
          await adminq(c.env, `💸 Move Log iade (abonelik) elle kontrol: ${ad} · bitiş okunamadı (${play.status}) · ${karar}`)
        await kaydet({ tip: 'voided', alt_tip: pyStr(v.orderId) || null, uid, pid: tok || null, karar, bitis })
        return c.json({ ok: true })
      }
      // productType 2 (tek seferlik) — otomatik düşme YOK
      const prof = uid ? await getUser(db, uid) : null
      const ad = uid ? kullaniciAdi(prof?.name, uid) : '?'
      await kaydet({ tip: 'voided', alt_tip: pyStr(v.orderId) || null, uid, pid: tok || null, karar: 'yok-sayildi:tuketilebilir-iade' })
      await adminq(c.env, `💸 Move Log iade: ${ad} · ${pyStr(v.orderId) || tok || 'google'}`)
      return c.json({ ok: true })
    }
    if (pyTruthy(dev.subscriptionNotification)) {
      const sn = nesne(dev.subscriptionNotification)
      const tok = pyStr(sn.purchaseToken)
      const subId = pyStr(sn.subscriptionId)
      const ntype = sn.notificationType === undefined ? '' : String(sn.notificationType)
      if (!tok) {
        await kaydet({ tip: ntype || 'sub', alt_tip: subId || null, karar: 'yok-sayildi:token-yok' })
        return c.json({ ok: true })
      }
      const play = await googleSubV2(c.env, tok)
      if (play.status === 404 || play.status === 410) {
        await kaydet({ tip: ntype || 'sub', alt_tip: subId || null, pid: tok, karar: 'yok-sayildi:token-yok' })
        return c.json({ ok: true })
      }
      if (play.status !== 200 || !play.d) hata(500, 'Play abonelik doğrulanamadı')   // 5xx/ağ/503 → Pub/Sub yeniden dener
      const d = play.d
      let uid = await iapUidBul(db, tok)
      const linked = pyStr(d.linkedPurchaseToken)
      if (!uid && linked) {
        uid = await iapUidBul(db, linked)
        if (uid) {
          const ts = simdi()
          await db.prepare(
            "INSERT OR IGNORE INTO iap_transactions (tid, uid, pid, ts, created_at, updated_at) VALUES (?1, ?2, 'google-sub', ?3, ?3, ?3)")
            .bind(tok, uid, ts).run()
        }
      }
      if (!uid) {
        await kaydet({ tip: ntype || 'sub', alt_tip: subId || null, pid: tok, karar: 'kullanici-yok' })
        await adminq(c.env, `💳 Move Log bildirim: kullanıcı yok · google · ${ntype || 'sub'}`)
        return c.json({ ok: true })
      }
      const bitis = googleMaxBitis(d)
      const now = simdi()
      const durum = googleAboneDurum(pyStr(d.subscriptionState), bitis, now)
      if (durum === 'pending' || durum === 'bilinmiyor') {
        await kaydet({
          tip: ntype || 'sub', alt_tip: subId || null, uid, pid: tok,
          karar: durum === 'pending' ? 'yok-sayildi:pending' : 'yok-sayildi:durum-' + pyStr(d.subscriptionState),
          bitis,
        })
        return c.json({ ok: true })
      }
      const prof = await getUser(db, uid)
      const karar = await abonelikUygula(db, uid, {
        aktif: durum === 'aktif', ultra: googleUltraMi(d), bitis,
      }, { env: c.env, ad: kullaniciAdi(prof?.name, uid), platform: 'google', tip: ntype || 'sub' })
      await kaydet({ tip: ntype || 'sub', alt_tip: subId || null, uid, pid: tok, karar, bitis })
      return c.json({ ok: true })
    }
    await kaydet({ karar: 'yok-sayildi:bos' })
    return c.json({ ok: true })
  } catch (e) {
    if (e instanceof Hata) throw e
    try { await kaydet({ karar: hataKisa(e) }) } catch { /* yazılamazsa da 500 */ }
    hata(500, 'bildirim işlenemedi')
  }
})

// ---------- GET /api/integrity/nonce (main.py:1746-1751) ----------
g.get('/api/integrity/nonce', authUser, async (c) => {
  const n = tokenUrlsafe24()
  // kullanıcı başına TEK nonce; yenisi eskisini ezer. Yazım hatası FAIL-OPEN'a düşer (nonce_ok=true kalır).
  try {
    await c.env.KV.put('integrity_nonce:' + c.get('user'), JSON.stringify({ n, ts: simdi() }), { expirationTtl: 600 })
  } catch { /* yutulur */ }
  return c.json({ nonce: n })
})

// ---------- POST /api/integrity (main.py:1754-1780) — FAIL-OPEN (Hooder olayı) ----------
g.post('/api/integrity', authUser, async (c) => {
  const body = await bodyAl(c)
  const user = c.get('user')
  const db = c.env.DB
  const token = pyStr(body.token)
  const enforce = await kvBayrak(c.env, 'INTEGRITY_ENFORCE')
  if (!token) {
    // İstemci token üretemedi (Play Services eski / kota / ağ). Bu HİLE DEĞİL.
    await attStat(db, 'android', 'token_yok')
    return c.json({ ok: !enforce, reason: 'no-token' })
  }
  const payload = await integrityCoz(c.env, token)
  if (payload === null) {
    await attStat(db, 'android', 'dogrulanamadi')
    return c.json({ ok: true, reason: 'unavailable' })     // decode hazır değil → kilitleme yok
  }
  const appV = pyStr(nesne(payload.appIntegrity).appRecognitionVerdict)
  const licV = pyStr(nesne(payload.accountDetails).appLicensingVerdict)
  const devHam = nesne(payload.deviceIntegrity).deviceRecognitionVerdict
  const devV = pyTruthy(devHam) ? devHam : []
  const nrec = pyStr(nesne(payload.requestDetails).nonce)
  let nonceOk = true
  const saved = await kvNonceOku(c.env, 'integrity_nonce:' + user)
  if (saved && nrec) nonceOk = nrec === saved.n && simdi() - saved.ts < 600
  // Anti-korsan/sideload: uygulama Play'den + kullanıcı lisanslı olmalı; cihaz integrity ŞART DEĞİL
  const good = appV === 'PLAY_RECOGNIZED' && (licV === 'LICENSED' || licV === 'UNEVALUATED') && nonceOk
  await attStat(db, 'android', good ? 'gecti' : 'dogrulanamadi')
  return c.json({
    ok: good || !enforce, enforced: enforce,
    verdict: { app: appV, lic: licV, device: devV, nonce_ok: nonceOk },
  })
})

// ---------- GET /api/attest/challenge (main.py:1822-1827) ----------
g.get('/api/attest/challenge', authUser, async (c) => {
  const ch = tokenUrlsafe24()
  try {
    await c.env.KV.put('attest_challenge:' + c.get('user'), JSON.stringify({ n: ch, ts: simdi() }), { expirationTtl: 600 })
  } catch { /* yutulur */ }
  return c.json({ challenge: ch })
})

// ---------- POST /api/attest (main.py:1830-1857) — integrity'den de agresif FAIL-OPEN ----------
g.post('/api/attest', authUser, async (c) => {
  const body = await bodyAl(c)
  const user = c.get('user')
  const db = c.env.DB
  const att = pyStr(body.attestation)
  const enforce = await kvBayrak(c.env, 'APPATTEST_ENFORCE')
  const saved = await kvNonceOku(c.env, 'attest_challenge:' + user)
  const ch = saved && simdi() - saved.ts < 600 ? saved.n : ''
  if (!att || !ch) {
    // attestation gelmedi / challenge süresi geçti → istemci aksaklığı, hile değil → DAİMA ok
    await attStat(db, 'ios', 'token_yok')
    return c.json({ ok: true, reason: 'no-attestation', enforced: enforce })
  }
  let sonuc: AttestSonuc
  try {
    sonuc = await appAttestDogrula(c.env, att, ch)
  } catch (e) {
    console.log('appattest istisna:', String(e).slice(0, 100))
    await attStat(db, 'ios', 'dogrulanamadi')
    return c.json({ ok: true, reason: 'unavailable', enforced: enforce })
  }
  console.log(`appattest user=${user} ok=${sonuc.ok} (${sonuc.why})`)
  await attStat(db, 'ios', sonuc.ok ? 'gecti' : 'dogrulanamadi')
  if (sonuc.ok) {
    // attest_key = cihaz-benzersiz keyId — bedava-aksiyon cihaz-dedup'u BUNA dayanır (korunması ŞART)
    await kullaniciGarantile(db, user)
    const ts = simdi()
    if (sonuc.keyId) {
      await db.prepare('UPDATE users SET attested = ?1, attest_key = ?2, updated_at = ?1 WHERE uid = ?3')
        .bind(ts, sonuc.keyId, user).run()
    } else {
      await db.prepare('UPDATE users SET attested = ?1, updated_at = ?1 WHERE uid = ?2').bind(ts, user).run()
    }
  }
  return c.json({ ok: sonuc.ok || !enforce, enforced: enforce })
})

// ---------- GET /api/local-renders (main.py:2166-2184) ----------
g.get('/api/local-renders', authUser, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  // SÜRÜM İŞARETİ damgası: saatte en çok 1 yazım; yazılamasa da liste döner (try/except eşleniği)
  try {
    const row = await db.prepare('SELECT yerel_son FROM users WHERE uid = ?1').bind(user).first<{ yerel_son: number | null }>()
    const son = Number(row?.yerel_son ?? 0) || 0
    if (Date.now() / 1000 - son > 3600) {
      await kullaniciGarantile(db, user)
      const ts = simdi()
      await db.prepare('UPDATE users SET yerel_son = ?1, updated_at = ?1 WHERE uid = ?2').bind(ts, user).run()
    }
  } catch { /* yutulur */ }
  let lst: Record<string, unknown>[] = []
  try {
    const raw = await c.env.KV.get('yerelq:' + user)
    if (raw) {
      const v = JSON.parse(raw)
      if (Array.isArray(v)) lst = v as Record<string, unknown>[]
    }
  } catch {
    lst = []
  }
  // 7 günden eski iş bayat — filtrelenir ama DEPOYA GERİ YAZILMAZ (main.py:2182-2183 birebir)
  const kesim = Date.now() / 1000 - 7 * 86400
  lst = lst.filter((x) => Number(nesne(x).ts ?? 0) > kesim)
  return c.json({ pending: lst })
})

// ---------- POST /api/local-renders/done (main.py:2187-2201) ----------
g.post('/api/local-renders/done', authUser, async (c) => {
  const body = await bodyAl(c)
  const user = c.get('user')
  const frm = Math.trunc(Number(body.from ?? 0))          // NaN olursa hiçbir kayıt eşleşmez (silinmez)
  let lst: Record<string, unknown>[] = []
  try {
    const raw = await c.env.KV.get('yerelq:' + user)
    if (raw) {
      const v = JSON.parse(raw)
      if (Array.isArray(v)) lst = v as Record<string, unknown>[]
    }
  } catch {
    lst = []
  }
  lst = lst.filter((x) => Math.trunc(Number(nesne(x).from ?? 0)) !== frm)
  try {
    await c.env.KV.put('yerelq:' + user, JSON.stringify(lst))
  } catch { /* yazma hatası sessizce yutulur (main.py:2196-2200) */ }
  return c.json({ ok: true })   // dosya yoksa da ok — idempotent; IDOR yok (anahtar user'dan)
})

// ---------- GET /api/groupvideo (main.py:2879-2882) ----------
g.get('/api/groupvideo', authUser, async (c) => {
  const pref = await jsonGet<string>(c.env.DB, c.get('user'), 'prefs_json', 'group_video')
  return c.json({ pref: pref ?? 'both' })
})

// ---------- PUT /api/groupvideo (main.py:2885-2893) ----------
g.put('/api/groupvideo', authUser, async (c) => {
  const body = await bodyAl(c)
  const pref = pyStr(body.pref)
  if (pref !== 'both' && pref !== 'group' && pref !== 'solo') hata(400, 'pref both|group|solo olmalı')
  const user = c.get('user')
  await kullaniciGarantile(c.env.DB, user)
  await jsonSet(c.env.DB, user, 'prefs_json', 'group_video', pref)
  return c.json({ pref })
})

// ---------- GET /api/safety (main.py:3019-3027) ----------
g.get('/api/safety', authUser, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const row = await db.prepare(
    "SELECT json_extract(prefs_json, '$.safety_buddy') AS b, " +
    "json_extract(prefs_json, '$.safety_arrive') AS a, " +
    "json_extract(prefs_json, '$.safety_stop') AS s FROM users WHERE uid = ?1")
    .bind(user).first<{ b: string | null; a: number | null; s: number | null }>()
  const b = pyTruthy(row?.b) ? String(row!.b) : ''
  const out: Record<string, unknown> = {
    buddy: b,
    arrive: row?.a === null || row?.a === undefined ? true : !!row.a,      // alan yoksa varsayılan TRUE
    longstop: row?.s === null || row?.s === undefined ? true : !!row.s,    // yanıt 'longstop', saklanan 'safety_stop'
  }
  if (b) out.buddy_profile = await profileOf(c.env, db, b)
  return c.json(out)
})

// ---------- PUT /api/safety (main.py:3030-3041) — KISMİ güncelleme ----------
g.put('/api/safety', authUser, async (c) => {
  const body = await bodyAl(c)
  const user = c.get('user')
  const db = c.env.DB
  await kullaniciGarantile(db, user)
  if ('buddy' in body) {
    const b = pyTruthy(body.buddy) ? String(body.buddy) : ''   // '' göndermek buddy'yi TEMİZLER
    if (b) {
      const f = await db.prepare('SELECT 1 AS x FROM friends WHERE uid = ?1 AND friend_uid = ?2').bind(user, b).first()
      if (!f) hata(400, 'güvenlik kişisi arkadaş listenden olmalı')
    }
    await jsonSet(db, user, 'prefs_json', 'safety_buddy', b)
  }
  if ('arrive' in body) await jsonSet(db, user, 'prefs_json', 'safety_arrive', pyTruthy(body.arrive))
  if ('longstop' in body) await jsonSet(db, user, 'prefs_json', 'safety_stop', pyTruthy(body.longstop))
  return c.json({ ok: true })
})

// ---------- POST /api/routes/share (main.py:3045-3084) ----------
const SRB: Record<string, string> = {
  en: "{u} sent you a route to ride 🗺️ Check 'Routes shared with you'.",
  tr: "{u} sana sürmen için bir rota gönderdi 🗺️ 'Sana gelen rotalar'a bak.",
  es: '{u} te envió una ruta para rodar 🗺️', fr: "{u} t'a envoyé un itinéraire à rouler 🗺️",
  de: '{u} hat dir eine Route geschickt 🗺️', it: '{u} ti ha inviato un percorso da guidare 🗺️',
  pt: '{u} te enviou uma rota para pilotar 🗺️', ru: '{u} отправил тебе маршрут 🗺️',
  ja: '{u}さんがルートを送りました🗺️', zh: '{u} 给你发了一条路线 🗺️',
  ko: '{u}님이 달릴 루트를 보냈어요 🗺️', ar: 'أرسل لك {u} مساراً 🗺️', hi: '{u} ने आपको एक रूट भेजा 🗺️',
}

g.post('/api/routes/share', authUser, async (c) => {
  const body = await bodyAl(c)
  const user = c.get('user')
  const db = c.env.DB
  const rid = pyTruthy(body.ride_id) ? String(body.ride_id) : ''
  // kaynak: videos (cloud_videos) → yoksa rides (detected_rides); kendi sürüşü olmalı
  type KaynakRow = { uid: string | null; km: number | null; date: string | null; ts: number; to_ts: number }
  const video = await db.prepare('SELECT uid, km, date, ts, to_ts FROM videos WHERE rid = ?1').bind(rid).first<KaynakRow>()
  const src = video ?? await db.prepare('SELECT uid, km, date, ts, to_ts FROM rides WHERE rid = ?1').bind(rid).first<KaynakRow>()
  // IDOR: sahiplik ihlali 404'e gizlenir (varlık sızdırmaz) — ham uid karşılaştırması (main.py:3051)
  if (!src || src.uid !== user) hata(404, 'rota bulunamadı')
  let targets: string[] = []
  const tou = pyTruthy(body.to_user) ? String(body.to_user) : ''
  if (tou) {
    const f = await db.prepare('SELECT 1 AS x FROM friends WHERE uid = ?1 AND friend_uid = ?2').bind(user, tou).first()
    if (!f) hata(400, 'sadece arkadaşına paylaşabilirsin')
    targets = [tou]
  }
  const cid = pyTruthy(body.to_club) ? String(body.to_club) : ''
  if (cid) {                                     // İKİSİ DE verilirse kulüp KAZANIR (targets ezilir)
    const klp = await db.prepare('SELECT cid FROM clubs WHERE cid = ?1').bind(cid).first()
    const uyeler = klp
      ? (await db.prepare('SELECT uid FROM club_members WHERE cid = ?1').bind(cid).all<{ uid: string }>()).results.map((x) => x.uid)
      : []
    if (!klp || !uyeler.includes(user)) hata(404, 'kulüp bulunamadı')
    targets = uyeler.filter((m) => m !== user)   // gönderen hariç TÜM üyeler
  }
  if (!targets.length) hata(400, 'hedef yok')
  const me = await profileOf(c.env, db, user)
  const ts = simdi()
  const sid = 'sr' + ts + hexRasgele(3)
  await db.batch([
    db.prepare(
      'INSERT INTO shared_routes (sid, from_uid, ride_id, km, date, ts, rideref_ts, rideref_to, created_at, updated_at) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?6, ?6)')
      .bind(sid, user, rid,
        pyTruthy(src.km) ? Number(src.km) : 0,
        pyTruthy(src.date) ? String(src.date) : '',
        ts,
        Math.trunc(Number(src.ts ?? 0) || 0),
        Math.trunc(Number(src.to_ts ?? 0) || 0)),
    ...targets.map((t) =>
      db.prepare('INSERT INTO shared_route_targets (sid, uid, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)').bind(sid, t, ts)),
  ])
  // push metni hedefin dilinde (profiles.lang, yoksa en)
  const yer = targets.map(() => '?').join(',')
  const diller = new Map<string, string | null>()
  for (const r of (await db.prepare(`SELECT uid, lang FROM users WHERE uid IN (${yer})`).bind(...targets)
    .all<{ uid: string; lang: string | null }>()).results) diller.set(r.uid, r.lang)
  const gonderen = pyTruthy(me.name) ? String(me.name) : '@' + (pyTruthy(me.handle) ? String(me.handle) : 'rider')
  for (const t of targets) {
    const lng = pyTruthy(diller.get(t)) ? String(diller.get(t)) : 'en'
    await pushq(c.env, t, 'Move Log', (SRB[lng] ?? SRB.en).replaceAll('{u}', gonderen))
  }
  return c.json({ ok: true, id: sid, sent: targets.length })
})

// ---------- GET /api/routes/shared (main.py:3087-3099) ----------
g.get('/api/routes/shared', authUser, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  // O(N) tam tarama yerine indeksli sorgu (sözleşme cf_mapping); en yeni 50, ts NULL'a karşı COALESCE
  const rows = (await db.prepare(
    'SELECT sr.sid, sr.from_uid, sr.km, sr.date, sr.ts, sr.ride_id, srt.ridden_at ' +
    'FROM shared_route_targets srt JOIN shared_routes sr ON sr.sid = srt.sid ' +
    'WHERE srt.uid = ?1 ORDER BY COALESCE(sr.ts, 0) DESC LIMIT 50')
    .bind(user)
    .all<{ sid: string; from_uid: string; km: number | null; date: string | null; ts: number | null; ride_id: string | null; ridden_at: number | null }>()).results
  const kimler = [...new Set(rows.map((r) => r.from_uid))]
  const adlar = new Map<string, string | null>()
  if (kimler.length) {
    const yer = kimler.map(() => '?').join(',')
    for (const r of (await db.prepare(`SELECT uid, name FROM users WHERE uid IN (${yer})`).bind(...kimler)
      .all<{ uid: string; name: string | null }>()).results) adlar.set(r.uid, r.name)
  }
  const routes = rows.map((r) => ({
    id: r.sid,
    from_name: pyTruthy(adlar.get(r.from_uid)) ? String(adlar.get(r.from_uid)) : r.from_uid,   // _profile_of.name eşleniği
    from: r.from_uid,
    km: r.km,
    date: r.date,
    ts: r.ts,
    ride_id: r.ride_id,
    ridden: !!r.ridden_at,   // işaretleyen uç GRUP 3: POST /api/internal/register-ride
  }))
  return c.json({ routes })
})

export default g
