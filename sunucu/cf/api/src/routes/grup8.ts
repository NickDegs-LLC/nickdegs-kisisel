// grup8 — hesap silme + handle + interkom + rozetler + wrapped + liderlik + kullanıcı arama (7 uç)
// Sözleşme: cf/contracts/grup8.json · davranış kaynağı: /opt/movelog/backend/main.py
//
// Kapsanan uçlar:
//   DELETE /api/account            (main.py:2748 delete_account)
//   PUT    /api/handle             (main.py:3000 set_handle)
//   GET    /api/intercom/:cid/token(main.py:3368 intercom_token)
//   GET    /api/badges             (main.py:3678 get_badges)
//   GET    /api/wrapped            (main.py:3708 wrapped)
//   GET    /api/leaderboard        (main.py:3730 leaderboard)
//   GET    /api/users/find         (main.py:3894 find_users)
//
// NOTLAR (grup8 kararları):
//  · /api/account: Python profiles.pop() apns/fcm push token'larını da profille birlikte
//    düşürüyordu — D1'de push_tokens ayrı tablo olduğundan DELETE push_tokens eklendi (birebir sonuç).
//    friends temizliği tek DELETE (uid=? OR friend_uid=?) — Python yalnız fr[user] içindeki karşı
//    taraflardan siler ama _make_friends hep iki yön yazdığından küme aynı; şemadaki
//    idx_friends_reverse yorumu da bu deseni öngörüyor. dm_reads yalnız uid=? silinir (Python
//    read.pop(user) gibi; karşı tarafların read kayıtları Python'da da kalır). seen → users.last_seen_at
//    zaten satırla gider. Silme sonrası KV'ye 'deleted:<uid>' damgası yazılır (cf_mapping isteği);
//    kontrolün kendisi lib/auth.ts authUser'a eklenmeli — aşağıdaki lib notuna bakın.
//  · /api/handle: şemada users.handle UNIQUE DEĞİL (yalnız NOCASE index) → cf_mapping'in "UNIQUE
//    constraint ile 409" planı uygulanamadı; Python'daki kontrol-sonra-yaz (TOCTOU dahil) birebir
//    taşındı. UNIQUE index migration'ı ayrı karar (db grubunun dosyası — dokunulmadı).
//  · /api/users/find: Python'un "önce dict sırasıyla 15 topla SONRA sırala" davranışı ORDER BY rowid
//    tam-tarama + JS filtre ile birebir taklit edildi (LIKE kullanılmadı — q'daki %/_ joker sayılmasın).
//  · round1(): Python round(x,1) BİREBİR — toFixed(20) tam-ondalık açılım + yarıda-çifte
//    (naif x*10 varyantı 0.35/0.45/1.05 gibi değerlerde sapıyordu; 8508 değer fuzz, 0 fark).
//  · cmpPy(): Python str kıyası kod-noktası sırası — JS `<` UTF-16 kod-birimi (emoji'li adlarda fark).
//  · sv-kapali bayrağı → lib/ortak svKapali (varlık kontrolü). İstek başına 1 okuma.
//    ✅ ÇÖZÜLDÜ (bütünleştirme 08-30): tüm gruplar tek KV anahtarı 'sv_off' okur (lib/ortak.ts kararı).
//  · Denetim düzeltmeleri (08-30): normHandle Python str.strip() kümesiyle (BOM strip EDİLMEZ);
//    /api/users/find uzunluk kapıları kod-noktası sayısıyla (len(qq) eşleniği — emoji sorgu sapması);
//    sv_off KV okuması try/catch (os.path.exists asla fırlatmaz).
//  · LIVEKIT_KEY/SECRET/URL Env tipinde yok — yerel tip genişletmesiyle okunur (lib notuna bakın).

import { Hono } from 'hono'
import type { AppEnv } from '../lib/env'
import { authUser, b64uEncode } from '../lib/auth'
import { simdi, BARIS_UID } from '../lib/db'
import { hataYanit } from '../lib/hata'
import { svKapali } from '../lib/ortak'

const g = new Hono<AppEnv>()
const enc = new TextEncoder()

// ---------- sabitler ----------

// main.py:3673-3675 — SADECE Türkçe, hard-coded (app tarafı çeviriyor; sözleşme aynen korur)
const BADGE_DEFS = {
  km1000: '1.000 km Kulübü', km5000: '5.000 km Kulübü', night: 'Gece Kartalı',
  cities5: '5 Bölge Gezgini', streak7: '7 Gün Seri', longride: 'Uzun Yol Ustası',
  first: 'İlk Sürüş', social: 'Yol Arkadaşı',
} as const

// main.py:2931-2932 (‘moveLog’ girdisi işlevsiz-fazlalık — giriş zaten lower; belge amaçlı korundu)
const HANDLE_RE = /^[a-z0-9_.]{3,20}$/
const HANDLE_REZERVE = new Set(['admin', 'moveLog', 'movelog', 'support', 'destek', 'apple', 'review', 'system'])

// LiveKit sırları artık lib/env.ts Env tipinde (bütünleştirme 08-30) — yerel tip uyumluluk için kaldı.
// wrangler secret put LIVEKIT_KEY / LIVEKIT_SECRET (+ [vars] LIVEKIT_URL) gerekiyor.
type LiveKitVars = { LIVEKIT_KEY?: string; LIVEKIT_SECRET?: string; LIVEKIT_URL?: string }

// ---------- yardımcılar ----------

// Python str.strip() beyazboşluk kümesi (str.isspace()==True olan karakterler).
// JS trim()/\s'ten farkı: ﻿ (BOM) Python'da boşluk DEĞİL (strip edilmez!), \x1c-\x1f ve \x85 ise boşluktur.
const PYWS = '\\t\\n\\x0b\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const PYSTRIP = new RegExp(`^[${PYWS}]+|[${PYWS}]+$`, 'g')

/** main.py:2935 _norm_handle: str(s or "").strip().lstrip("@").lower() — sıra AYNI (tekrar trim YOK). */
function normHandle(s: unknown): string {
  const ham = s ? String(s) : ''            // Python `s or ""`: falsy (0/false/None/'') → ''
  return ham.replace(PYSTRIP, '').replace(/^@+/, '').toLowerCase()
}

/** JSON kolonu güvenli parse; bozuk/boşsa varsayılan. */
function parseJson<T>(s: string | null | undefined, dflt: T): T {
  if (!s) return dflt
  try { return JSON.parse(s) as T } catch { return dflt }
}

/** main.py:1390 `p.get("avatar") or {"type":"initials"}` — boş dict de Python'da falsy → fallback. */
function avatarOf(avatarJson: string | null | undefined): Record<string, unknown> {
  const a = parseJson<Record<string, unknown> | null>(avatarJson ?? null, null)
  if (a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).length > 0) return a
  return { type: 'initials' }
}

/** users.badges_json → string[] (main.py `p.get("badges") or []`). */
function badgesOf(badgesJson: string | null | undefined): unknown[] {
  const b = parseJson<unknown>(badgesJson ?? null, null)
  return Array.isArray(b) ? b : []
}

/**
 * Python round(x, 1) BİREBİR eşleniği. Python, double'ın GERÇEK ikili değerinin ondalık
 * açılımını yuvarlar (yarıda çifte). Naif `x*10` yaklaşımı FP çarpım hatasıyla kalanı yapay
 * 0.5'e taşır/kaçırır: 0.35→0.4 (Python 0.3), 0.45→0.4 (Python 0.5), 1.05→1 (Python 1.1)...
 * Burada toFixed(20) tam açılımı verir (double kesirleri sonlu ondalıktır; |x|≥~0.05 için
 * ulp ≥ ~1e-18 olduğundan 20 hane karar için yeterli — kanıt: 8508 değerlik fuzz, 0 fark).
 * Sonuç string'ten parse edilir (Number() korrekt yuvarlar = CPython dtoa).
 */
function round1(x: number): number {
  if (!Number.isFinite(x)) return x
  const neg = x < 0
  const ax = Math.abs(x)
  if (ax >= 1e21) return x                        // toFixed üstel gösterime döner; bu büyüklükte kesir yok
  const s = ax.toFixed(20)
  const dot = s.indexOf('.')
  const tam = s.slice(0, dot)
  const kesir = s.slice(dot + 1)                  // 20 hane
  const d1 = kesir.charCodeAt(0) - 48             // onda birler basamağı
  const kuyruk = kesir.slice(1)                   // kalan 19 hane — .x5 sınırıyla kıyas
  const SINIR = '5000000000000000000'
  const yukari = kuyruk > SINIR ? true : kuyruk < SINIR ? false : d1 % 2 === 1  // tam yarı → çifte
  let d = d1 + (yukari ? 1 : 0)
  let t = tam
  if (d === 10) { d = 0; t = String(BigInt(tam) + 1n) }
  const r = Number(`${t}.${d}`)
  return neg ? -r : r
}

/**
 * Python str karşılaştırması eşleniği — kod NOKTASI sırası. JS `<` UTF-16 kod BİRİMİ kıyaslar;
 * astral karakter (emoji'li isim) U+E000-U+FFFF aralığındaki karaktere karşı ters sonuç verir.
 * (Handle'lar ASCII olduğundan orada fark doğmaz ama tutarlılık için ikisi de bunu kullanır.)
 */
function cmpPy(a: string, b: string): number {
  const ia = a[Symbol.iterator](), ib = b[Symbol.iterator]()
  for (;;) {
    const x = ia.next(), y = ib.next()
    if (x.done && y.done) return 0
    if (x.done) return -1
    if (y.done) return 1
    const cx = (x.value as string).codePointAt(0)!, cy = (y.value as string).codePointAt(0)!
    if (cx !== cy) return cx - cy
  }
}

/** LiveKit erişim JWT'si (main.py:3380-3390 claims birebir; PyJWT → WebCrypto HMAC-SHA256). */
async function livekitJwt(apiKey: string, secret: string, user: string, ad: string, room: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64uEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = b64uEncode(enc.encode(JSON.stringify({
    iss: apiKey, sub: user, nbf: now, exp: now + 6 * 3600, name: ad,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  })))
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = b64uEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`))))
  return `${header}.${payload}.${sig}`
}

// ── kulüp odası sınırı (LiveKit Cloud geçişi, 2026-09-02) ────────────────────
// Self-host'ta sınır sunucu yapılandırmasındaydı: livekit.yaml `room.max_participants: 12` +
// `empty_timeout: 300`. LiveKit Cloud'da yaml YOK; odalar join anında varsayılanlarla açılıyor →
// 14 kişilik yük testinde 14'ü de girdi (ÖLÇÜLDÜ 02.09). Sınır hem eski davranış hem de ücretsiz
// katman kotası (5.000 katılımcı-dk/ay) için anlamlı → odayı token vermeden ÖNCE açıkça yaratıyoruz.
// CreateRoom idempotenttir: oda varsa LiveKit mevcut odayı döner, ayarları DEĞİŞTİRMEZ.
const ODA_SINIR = 12
const ODA_BOS_SN = 300

/** Yönetim JWT'si — erişim token'ıyla aynı imza, farklı grant.
 *  ⚠️ ÖLÇÜLDÜ 02.09: `roomCreate` TEK BAŞINA yetmez — `ListParticipants` **roomAdmin + o odanın adı**
 *  ister, aksi hâlde 401 döner ve fail-open yüzünden sınır sessizce uygulanmaz (ilk denemede öyle oldu). */
async function livekitYoneticiJwt(apiKey: string, secret: string, room: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64uEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = b64uEncode(enc.encode(JSON.stringify({
    iss: apiKey, sub: 'movelog-api', nbf: now, exp: now + 300,
    video: { roomCreate: true, roomAdmin: true, room },
  })))
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = b64uEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`))))
  return `${header}.${payload}.${sig}`
}

/** Twirp yardımcı — hata/zaman aşımı `null` döner (çağıran fail-open davranır). 2 sn tavan
 *  (ÖLÇÜLDÜ: sağlıklı çağrı ~200 ms). */
async function lkTwirp(lk: LiveKitVars, metot: string, oda: string, govde: unknown): Promise<Record<string, unknown> | null> {
  const taban = (lk.LIVEKIT_URL || '').replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/+$/, '')
  if (!taban || !lk.LIVEKIT_KEY || !lk.LIVEKIT_SECRET) return null
  try {
    const jwt = await livekitYoneticiJwt(lk.LIVEKIT_KEY, lk.LIVEKIT_SECRET, oda)
    const y = await fetch(`${taban}/twirp/livekit.RoomService/${metot}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(govde),
      signal: AbortSignal.timeout(2000),
    })
    if (!y.ok) return null
    return (await y.json()) as Record<string, unknown>
  } catch { return null }
}

/** Odayı 12 kişi + 300 sn boş-zaman ayarıyla hazırlar (idempotent).
 *  ⚠️ ÖLÇÜLDÜ 02.09: LiveKit **Cloud `max_participants` alanını UYGULAMIYOR** — max=3 olan odaya
 *  5 katılımcı sorunsuz girdi (oda sid'i değişmeden). Alan yine de konuyor: (a) `empty_timeout`
 *  UYGULANIYOR, (b) self-host'a dönülürse sınır kendiliğinden işler, (c) niyet kayıtlı kalır.
 *  GERÇEK sınır aşağıdaki `odaDolu()` ile BİZDE. */
async function odayiHazirla(lk: LiveKitVars, room: string): Promise<void> {
  await lkTwirp(lk, 'CreateRoom', room, { name: room, max_participants: ODA_SINIR, empty_timeout: ODA_BOS_SN })
}

/** Sınırı BİZ uygularız: token vermeden önce odadaki katılımcı sayısına bakılır.
 *  fail-open: LiveKit'e ulaşılamazsa (null) kapı AÇIK kalır — geçici bir API arızası
 *  telsizi kilitlemesin. Kontrol-sonra-davran yarışı bilinçli kabul edildi (yumuşak tavan):
 *  aynı anda iki kişi girerse 13 olabilir, bir sonraki istek durur. */
async function odaDolu(lk: LiveKitVars, room: string): Promise<boolean> {
  const y = await lkTwirp(lk, 'ListParticipants', room, { room })
  const p = y?.participants
  return Array.isArray(p) && p.length >= ODA_SINIR
}

// _profile_of için gereken users kolon alt-kümesi (main.py:1388-1410)
type ProfilKaynak = {
  uid: string; name: string | null; handle: string | null; avatar_json: string | null
  premium: number | null; ultra: number | null; admin: number | null
  sokak_hak: number | null; video_hak: number | null
  free_tactical_used: number | null; attest_key: string | null
}

type ProfilOut = {
  username: string; name: string; handle: string; avatar: Record<string, unknown>
  premium: boolean; ultra: boolean; sv_off: boolean; sokak_hak: number; video_hak: number
  sokak_hediye: false; free_tactical: boolean; admin: boolean
  status?: 'friend' | 'outgoing' | 'incoming' | 'none'
}

/**
 * main.py:1388-1410 _profile_of eşleniği (satır yoksa Python'daki boş-profil davranışı).
 * svOff/ftEnabled/ftDevices istek başına BİR kez okunur, satırlara dağıtılır (sözleşme TUZAK-1).
 */
function profileOf(uid: string, r: ProfilKaynak | undefined,
                   svOff: boolean, ftEnabled: boolean, ftDevices: Set<string>): ProfilOut {
  const ultra = !!r?.ultra, admin = !!r?.admin
  const attest = r?.attest_key || ''
  return {
    username: uid,
    name: r?.name || uid,                             // p.get("name") or u
    handle: r?.handle || '',
    avatar: avatarOf(r?.avatar_json),
    premium: !!r?.premium,
    ultra: ultra || admin,                            // Ultra tier (admin bypass) — main.py:1393
    sv_off: svOff,
    sokak_hak: Math.trunc(Number(r?.sokak_hak ?? 0) || 0),
    video_hak: Math.trunc(Number(r?.video_hak ?? 0) || 0),
    sokak_hediye: false,                              // 2026-08-28: her zaman False (main.py:1404)
    free_tactical: !!(ftEnabled && !(ultra || admin) && !r?.free_tactical_used
                      && (!attest || !ftDevices.has(attest))),
    admin,
  }
}

// ---------- R2 toplu temizlik yardımcıları (hesap silme) ----------

/** Önek altındaki tüm anahtarlar. R2.list 1000'de keser → cursor ile sayfalanır. */
async function r2Anahtarlar(r2: R2Bucket, onek: string, tavan = 20_000): Promise<string[]> {
  const cikti: string[] = []
  let imlec: string | undefined
  for (let tur = 0; tur < 50 && cikti.length < tavan; tur++) {
    const s = await r2.list({ prefix: onek, limit: 1000, cursor: imlec })
    for (const o of s.objects) cikti.push(o.key)
    if (!s.truncated) break
    imlec = s.cursor
  }
  return cikti
}

/** R2 toplu silme sınırı 1000 anahtar → gruplara böl. */
async function r2Sil(r2: R2Bucket, anahtarlar: string[]): Promise<void> {
  for (let i = 0; i < anahtarlar.length; i += 1000) await r2.delete(anahtarlar.slice(i, i + 1000))
}

// ---------- DELETE /api/account (main.py:2748) ----------
// ⚠️ 17.09 KAPSAM GENİŞLETİLDİ — eski davranış ("rides/videos/kulüp üyeliği/R2 videoları BİLEREK
// kalır", TUZAK-1, Python paritesi) ARTIK GEÇERSİZ. Gerekçe: silme sayfasında kullanıcıya YAZILI
// taahhüt verildi (movelog.realvirtuality.app/delete):
//   "…arkadaş listen, sohbet mesajların, davet kodların, bildirim kayıtların ve cihaz kimliğin
//    ANINDA silinir. Gezi kayıtların, oluşturduğun videolar ve GPS izlerin EN GEÇ 30 GÜN İÇİNDE
//    kalıcı olarak silinir."
// Python paritesi bu taahhüdün önüne geçemez. Hepsi tek istekte silinir (anında ⊂ 30 gün içinde).
// SAKLANAN: iap_transactions / iap_bildirim — yasal + muhasebe yükümlülüğü (sayfada da yazıyor).
// KENDİLİĞİNDEN DÜŞEN: ptt/ (1 gün) + voicemsg/ (30 gün) klipleri R2 lifecycle ile (grup4 notu).
// İdempotent: ikinci çağrı da 200 döner (DELETE'ler 0 satır etkiler).
//
// 🔴 SIRA HAYATİ: tracker_id ve R2 anahtarları users/rides/videos satırlarından OKUNUR. users satırı
// önce silinirse GPS izleri (positions.device) ve R2 nesneleri SAHİPSİZ kalır, bir daha ASLA
// silinemez — taahhüt sessizce yalana döner. Bu yüzden: ÖNCE OKU → SONRA SİL.
g.delete('/api/account', authUser, async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  // 1) SİLMEDEN ÖNCE OKU — satırlar gidince bir daha erişilemeyecek bağlar
  const prof = await db.prepare('SELECT tracker_id FROM users WHERE uid = ?1')
    .bind(user).first<{ tracker_id: string | null }>()
  const tracker = (prof?.tracker_id || '').trim()
  // uid'i NULL eski kayıtlar Barış'a aittir (_own kuralı, main.py:255) — onlar da sahibiyle gitmeli
  const vids = await db.prepare('SELECT r2_key FROM videos WHERE uid = ?1 OR (uid IS NULL AND ?1 = ?2)')
    .bind(user, BARIS_UID).all<{ r2_key: string }>()
  const izler = await db.prepare(
    `SELECT track_key FROM rides WHERE (uid = ?1 OR (uid IS NULL AND ?1 = ?2))
       AND track_key IS NOT NULL AND track_key <> ''`)
    .bind(user, BARIS_UID).all<{ track_key: string }>()

  // 2) GPS izleri (positions) — batch'ten ÖNCE ve PARÇALI.
  //    positions'ta uid YOK; tek bağ users.tracker_id → positions.device. Tek DELETE 60k+ satır
  //    demek (ölçüldü: en büyük cihaz 61.700) → atomik batch'e konsa hepsi geri sarılabilir ve
  //    kullanıcı hesabını HİÇ silemezdi. Burada yarıda kalırsa hesap duruyor, tekrar deneme tamamlar.
  //    🔒 KORUMA: tracker_id'yi başka bir hesap da kullanıyorsa DOKUNMA — onun GPS'i silinmesin.
  //    (Bugünkü veride çakışma yok, ölçüldü; koruma ileriye dönük.)
  let silinenNokta = 0
  if (tracker) {
    const paylasan = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE tracker_id = ?1 AND uid <> ?2')
      .bind(tracker, user).first<{ n: number }>()
    if ((paylasan?.n ?? 0) === 0) {
      for (let tur = 0; tur < 200; tur++) {
        const r = await db.prepare(
          'DELETE FROM positions WHERE rowid IN (SELECT rowid FROM positions WHERE device = ?1 LIMIT 2000)')
          .bind(tracker).run()
        const n = r.meta?.changes ?? 0
        silinenNokta += n
        if (n === 0) break
      }
    } else console.log('positions atlandi: tracker_id paylasimli')
  }

  // 3) tek atomik batch (D1 batch = tek transaction) — sözleşme cf_mapping isteği
  await db.batch([
    db.prepare('DELETE FROM users WHERE uid = ?1').bind(user),                       // profiles.pop + seen(last_seen_at)
    db.prepare('DELETE FROM push_tokens WHERE uid = ?1').bind(user),                 // profil içindeki apns/fcm listeleri (D1'de ayrı tablo)
    db.prepare('DELETE FROM friends WHERE uid = ?1 OR friend_uid = ?1').bind(user),  // iki yön (main.py:2753-2757)
    db.prepare('DELETE FROM dm_messages WHERE user_a = ?1 OR user_b = ?1').bind(user), // 'a|b' anahtarında user (self-DM dahil)
    db.prepare('DELETE FROM dm_reads WHERE uid = ?1').bind(user),                    // read.pop(user) — karşı tarafınki Python'da da kalır
    db.prepare('DELETE FROM invites WHERE by_uid = ?1').bind(user),                  // by==user token'ları
    db.prepare('DELETE FROM friend_requests WHERE target_uid = ?1 OR requester_uid = ?1').bind(user), // freqs iki yön
    // ↓ 17.09 eklendi — sayfadaki "gezi kayıtların, videoların ve GPS izlerin" taahhüdünün karşılığı
    db.prepare('DELETE FROM rides WHERE uid = ?1 OR (uid IS NULL AND ?1 = ?2)').bind(user, BARIS_UID),
    db.prepare('DELETE FROM videos WHERE uid = ?1 OR (uid IS NULL AND ?1 = ?2)').bind(user, BARIS_UID),
    db.prepare('DELETE FROM activities WHERE uid = ?1').bind(user),                  // günlük özet metinleri
    db.prepare('DELETE FROM feedbacks WHERE uid = ?1').bind(user),                   // ad + handle + serbest metin İÇERİR
    db.prepare('DELETE FROM pending_videos WHERE uid = ?1').bind(user),
    db.prepare('DELETE FROM failed_videos WHERE uid = ?1').bind(user),
    db.prepare('DELETE FROM render_counts WHERE uid = ?1').bind(user),
    db.prepare('DELETE FROM gpu_costs WHERE uid = ?1').bind(user),
    db.prepare('DELETE FROM ride_type_overrides WHERE uid = ?1').bind(user),
    db.prepare('DELETE FROM shared_routes WHERE from_uid = ?1').bind(user),
    db.prepare('DELETE FROM shared_route_targets WHERE uid = ?1').bind(user),
    db.prepare('DELETE FROM club_members WHERE uid = ?1').bind(user),
    // kulüp: yalnız BAŞKA üyesi kalmayanı sil — dolu kulübü yok etmek DİĞER üyelerin verisini siler
    db.prepare(`DELETE FROM clubs WHERE owner_uid = ?1
                  AND NOT EXISTS (SELECT 1 FROM club_members m WHERE m.cid = clubs.cid AND m.uid <> ?1)`).bind(user),
    // telsiz ACL'i uid taşır (users_json); klipler lifecycle ile düşer ama kimlik referansı kalmasın
    db.prepare(`DELETE FROM ptt_acl WHERE users_json IS NOT NULL
                  AND EXISTS (SELECT 1 FROM json_each(ptt_acl.users_json) WHERE value = ?1)`).bind(user),
    // 🔴 17.09 EKLENDİ: App Attest anahtarları (migration 0009/0010) hesap silmede UNUTULMUŞTU.
    // users satırı gidiyor ama key_id + pubkey + receipt + uid burada kalıyordu; silme sayfası
    // "cihaz kimliğin ANINDA silinir" diyor → doğrudan çelişki. `uid = ?1` olduğu için başka
    // kullanıcının cihaz anahtarına dokunulmaz.
    db.prepare('DELETE FROM attest_keys WHERE uid = ?1').bind(user),
  ])

  // 4) R2 nesneleri — batch'ten SONRA. (Önce silinip batch geri sarılsaydı, YAŞAYAN bir hesabın
  //    videoları yok olurdu.) Anahtarlar tahminle türetilmiyor: videos.r2_key ve rides.track_key
  //    tabloda YAZAN gerçek anahtarlar; müzik/fotoğraf önekle listelenir.
  const taban = user.split('/').pop() || user
  let anahtarlar: string[] = [`avatars/${taban}.jpg`]                   // path-traversal koruması aynen (main.py:2773-2776)
  try {
    anahtarlar = anahtarlar.concat(
      vids.results.map((v) => v.r2_key),                                // videos/<rid>.mp4
      izler.results.map((t) => t.track_key),                            // tracks/<ts>.json — ham GPS izi
      await r2Anahtarlar(c.env.R2, `usermusic/${user}/`),               // yüklediği müzikler
      await r2Anahtarlar(c.env.R2, `ridephotos/${user}_`),              // gezi fotoğrafları (<uid>_<session>/…)
      // 🔴 17.09 EKLENDİ: 120KB üstü render isteği kuyruk yerine R2'ye yazılıyor
      // (grup1.ts:640 `genreq/${user}_${ts}.json`) ve GÖMÜLÜ GPS İZİ taşıyor. `genreq-supurucu`
      // cron'u bu nesneleri SİLMEZ, yeniden kuyruklar → hesap silindikten sonra rota/GPS R2'de
      // kalıyordu. Sayfadaki 30 gün taahhüdünün kapsamına giriyor.
      await r2Anahtarlar(c.env.R2, `genreq/${user}_`),                  // bekleyen render isteği (rota/GPS içerir)
    )
    await r2Sil(c.env.R2, anahtarlar)
  } catch (e) {
    // R2 çökerse hesap yine silinmiş olur; kalanlar KAYIT ALTINA alınır ki taahhüt sessizce yalana dönmesin
    console.error('hesap silme R2 temizligi basarisiz:', String(e).slice(0, 200))
    try { await c.env.KV.put(`silme-r2-kalan:${user}`, JSON.stringify(anahtarlar).slice(0, 24_000)) } catch { /* yut */ }
  }

  // cf_mapping: silinen kullanıcının tv kaydı da gittiğinden tv=0 eski token verify'ı GEÇEBİLİR →
  // damga buraya yazılır; reddetme kontrolü lib/auth.ts authUser'da (✅ bütünleştirme 08-30 eklendi).
  await c.env.KV.put(`deleted:${user}`, String(simdi()))
  // 17.09 gece (Cursor e2e #13): kullanıcıya özel TTL'siz KV kalıntıları — yerel render kuyruğu
  // (`yerelq:`) ve eski yol attest challenge'ı. Silinemezse hesap yine silinmiş sayılır.
  for (const k of [`yerelq:${user}`, `attest_challenge:${user}`]) {
    try { await c.env.KV.delete(k) } catch { /* yut */ }
  }
  console.log(`hesap silindi: ${user} · gps=${silinenNokta} · r2=${anahtarlar.length}`)
  return c.json({ ok: true, deleted: user })
})

// ---------- PUT /api/handle (main.py:3000) ----------
g.put('/api/handle', authUser, async (c) => {
  const user = c.get('user')
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const h = normHandle(body['handle'])
  if (!HANDLE_RE.test(h)) return hataYanit(400, '3-20 karakter: küçük harf, rakam, _ ve .')
  if (HANDLE_REZERVE.has(h)) return hataYanit(409, 'bu kullanıcı adı alınamaz')
  // _by_handle: lower() karşılaştırma → NOCASE index (idx_users_handle); ORDER BY rowid = dict sırasındaki ilk
  const sahip = await c.env.DB
    .prepare('SELECT uid FROM users WHERE handle = ?1 COLLATE NOCASE ORDER BY rowid LIMIT 1')
    .bind(h).first<{ uid: string }>()
  if (sahip && sahip.uid !== user) return hataYanit(409, 'bu kullanıcı adı alınmış')
  // profiles.setdefault(user, {})["handle"] = h — profil yoksa OLUŞUR → upsert
  const t = simdi()
  await c.env.DB.prepare(
    `INSERT INTO users (uid, handle, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT(uid) DO UPDATE SET handle = excluded.handle, updated_at = excluded.updated_at`)
    .bind(user, h, t).run()
  return c.json({ ok: true, handle: h })
})

// ---------- GET /api/intercom/:cid/token (main.py:3368) ----------
g.get('/api/intercom/:cid/token', authUser, async (c) => {
  const lk = c.env as unknown as LiveKitVars
  // 02.09: URL de zorunlu — silinen self-host adresine düşen varsayılan kaldırıldı (bkz. grup5.ts)
  if (!lk.LIVEKIT_KEY || !lk.LIVEKIT_URL) return hataYanit(503, 'interkom kapalı')
  const user = c.get('user')
  const cid = c.req.param('cid')
  const db = c.env.DB
  const [uRes, mRes] = await db.batch([
    db.prepare('SELECT ultra, name, handle FROM users WHERE uid = ?1').bind(user),
    db.prepare('SELECT 1 AS x FROM club_members WHERE cid = ?1 AND uid = ?2').bind(cid, user),
  ])
  const prof = uRes.results[0] as { ultra: number | null; name: string | null; handle: string | null } | undefined
  // TUZAK: _is_ultra admin bypass İÇERMEZ (yalnız p.ultra, main.py:3124-3126) — asimetri aynen korunur
  if (!prof?.ultra) return hataYanit(402, 'Ultra gerekli')
  // kulüp yok VEYA üye değil → aynı 404 (IDOR: kulüp varlığı sızmaz)
  if (mRes.results.length === 0) return hataYanit(404, 'kulüp yok')
  const room = `club_${cid}`
  await odayiHazirla(lk, room)                    // empty_timeout 300 + niyet (hata yutulur)
  if (await odaDolu(lk, room)) return hataYanit(503, `telsiz dolu (en fazla ${ODA_SINIR} kişi)`)
  const token = await livekitJwt(lk.LIVEKIT_KEY, lk.LIVEKIT_SECRET ?? '', user,
                                 prof.name || prof.handle || 'Rider', room)
  return c.json({ url: lk.LIVEKIT_URL, token, room })
})

// ---------- GET /api/badges (main.py:3678) ----------
g.get('/api/badges', authUser, async (c) => {
  const row = await c.env.DB.prepare('SELECT badges_json FROM users WHERE uid = ?1')
    .bind(c.get('user')).first<{ badges_json: string | null }>()
  return c.json({ badges: badgesOf(row?.badges_json), defs: BADGE_DEFS })
})

// ---------- GET /api/wrapped (main.py:3708) ----------
// Yıl sınırı TR (sabit UTC+3, DST YOK — main.py:28) ile hesaplanır. Filtre HAM uid = user:
// _own() BARIS_UID fallback'i ve ORNEK_UID istisnası bu uçta YOK (sözleşme TUZAK-4).
g.get('/api/wrapped', authUser, async (c) => {
  const user = c.get('user')
  const nowS = Date.now() / 1000
  const yil = new Date((nowS + 10800) * 1000).getUTCFullYear()            // datetime.now(TR).year
  const y0 = Date.UTC(yil, 0, 1) / 1000 - 10800                           // datetime(yr,1,1,tzinfo=TR).timestamp()
  const db = c.env.DB
  const [agg, prof] = await db.batch([
    db.prepare(
      `SELECT COUNT(*)                                    AS rides,
              SUM(COALESCE(km, 0))                        AS km,
              MAX(COALESCE(km, 0))                        AS longest,
              SUM(MAX(0, to_ts - ts))                     AS secs,
              SUM(CASE WHEN CAST(strftime('%H', ts + 10800, 'unixepoch') AS INTEGER) >= 22
                         OR CAST(strftime('%H', ts + 10800, 'unixepoch') AS INTEGER) < 5
                       THEN 1 ELSE 0 END)                 AS nights
         FROM rides WHERE uid = ?1 AND ts >= ?2`).bind(user, y0),
    db.prepare('SELECT badges_json FROM users WHERE uid = ?1').bind(user),
  ])
  const a = agg.results[0] as { rides: number; km: number | null; longest: number | null; secs: number | null; nights: number | null } | undefined
  const p = prof.results[0] as { badges_json: string | null } | undefined
  return c.json({
    year: yil,
    km: round1(a?.km ?? 0),
    rides: a?.rides ?? 0,
    hours: round1((a?.secs ?? 0) / 3600),
    longest_km: round1(a?.longest ?? 0),
    night_rides: a?.nights ?? 0,
    badges: badgesOf(p?.badges_json),
  })
})

// ---------- GET /api/leaderboard (main.py:3730) ----------
// GİZLİLİK: kapsam SADECE self + arkadaşlar + kulüp arkadaşları; 0 km üyeler de listelenir.
// Toplama HAM uid ile (etiketsiz/boş uid kimseye sayılmaz — sözleşme TUZAK-2); ORNEK_UID'e özel muamele yok.
g.get('/api/leaderboard', authUser, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const [frRes, clRes] = await db.batch([
    db.prepare('SELECT friend_uid FROM friends WHERE uid = ?1').bind(user),
    db.prepare(
      `SELECT DISTINCT cm2.uid AS uid FROM club_members cm
         JOIN club_members cm2 ON cm2.cid = cm.cid WHERE cm.uid = ?1`).bind(user),
  ])
  const kapsam = new Set<string>([user])
  for (const r of frRes.results as { friend_uid: string }[]) kapsam.add(r.friend_uid)
  for (const r of clRes.results as { uid: string }[]) kapsam.add(r.uid)

  const ids = [...kapsam]
  const ph = ids.map((_, i) => `?${i + 2}`).join(',')                     // ?1 = hafta sınırı
  const wk = Date.now() / 1000 - 7 * 86400                                // time.time() float, Python gibi
  const ph1 = ids.map((_, i) => `?${i + 1}`).join(',')
  const [statRes, profRes] = await db.batch([
    db.prepare(
      `SELECT uid, SUM(COALESCE(km, 0)) AS km, COUNT(*) AS rides, SUM(MAX(0, to_ts - ts)) AS secs
         FROM rides WHERE ts >= ?1 AND uid IN (${ph}) GROUP BY uid`).bind(wk, ...ids),
    db.prepare(`SELECT uid, name, handle, avatar_json FROM users WHERE uid IN (${ph1})`).bind(...ids),
  ])
  const stats = new Map<string, { km: number; rides: number; secs: number }>()
  for (const r of statRes.results as { uid: string; km: number | null; rides: number; secs: number | null }[])
    stats.set(r.uid, { km: r.km ?? 0, rides: r.rides, secs: r.secs ?? 0 })
  const profs = new Map<string, { name: string | null; handle: string | null; avatar_json: string | null }>()
  for (const r of profRes.results as { uid: string; name: string | null; handle: string | null; avatar_json: string | null }[])
    profs.set(r.uid, r)

  type Satir = { username: string; name: string; handle: string; avatar: Record<string, unknown>; km: number; rides: number; secs: number; rank: number }
  const rows: Satir[] = ids.map((u) => {
    const st = stats.get(u) ?? { km: 0, rides: 0, secs: 0 }
    const p = profs.get(u)
    return {
      username: u, name: p?.name || u, handle: p?.handle || '', avatar: avatarOf(p?.avatar_json),
      km: round1(st.km), rides: st.rides, secs: st.secs, rank: 0,
    }
  })
  // sıralama YUVARLANMIŞ km üstünden (Python satır kurulduktan sonra sıralar); ad kod-NOKTASI kıyası (cmpPy)
  rows.sort((a, b) => {
    if (a.km !== b.km) return b.km - a.km
    if (a.rides !== b.rides) return b.rides - a.rides
    return cmpPy(a.name, b.name)
  })
  rows.forEach((r, i) => { r.rank = i + 1 })
  return c.json({ week: rows, me: rows.find((r) => r.username === user)?.rank ?? 0 })
})

// ---------- GET /api/users/find (main.py:3894) ----------
// TUZAK-1 aynen: 15-kesme SIRALAMADAN ÖNCE, tarama sırasına göre (ORDER BY rowid ≈ dict sırası).
// LIKE bilerek YOK: q'daki % ve _ joker sayılmasın (Python startswith/in literal'dir).
g.get('/api/users/find', authUser, async (c) => {
  const user = c.get('user')
  const qq = normHandle(c.req.query('q') ?? '')
  const qqLen = [...qq].length      // Python len() = kod NOKTASI sayısı; JS .length UTF-16 birimi (emoji sorguda sapar)
  if (qqLen < 2) return c.json({ users: [] })
  const db = c.env.DB
  const [frRes, outRes, inRes, ftRes, usersRes] = await db.batch([
    db.prepare('SELECT friend_uid FROM friends WHERE uid = ?1').bind(user),
    db.prepare('SELECT target_uid FROM friend_requests WHERE requester_uid = ?1').bind(user),   // my_out
    db.prepare('SELECT requester_uid FROM friend_requests WHERE target_uid = ?1').bind(user),   // my_in
    db.prepare(`SELECT value_json FROM config WHERE key = 'free_tactical_enabled'`),
    db.prepare(
      `SELECT uid, name, handle, avatar_json, premium, ultra, admin,
              sokak_hak, video_hak, free_tactical_used, attest_key
         FROM users ORDER BY rowid`),                                     // dict iterasyon sırası eşleniği
  ])
  const myFriends = new Set((frRes.results as { friend_uid: string }[]).map((r) => r.friend_uid))
  const myOut = new Set((outRes.results as { target_uid: string }[]).map((r) => r.target_uid))
  const myIn = new Set((inRes.results as { requester_uid: string }[]).map((r) => r.requester_uid))
  const ftCfg = ftRes.results[0] as { value_json: string } | undefined
  const ftEnabled = ftCfg ? !!parseJson<unknown>(ftCfg.value_json, true) : true  // db.get(..., True)
  const svOff = await svKapali(c.env)            // lib/ortak — tek KV anahtarı 'sv_off'; hata yutulur (os.path.exists eşleniği)

  const eslesen: ProfilKaynak[] = []
  for (const r of usersRes.results as ProfilKaynak[]) {
    if (r.uid === user) continue
    const h = (r.handle || '').toLowerCase()
    const nm = (r.name || '').toLowerCase()
    if (!(h.startsWith(qq) || (qqLen >= 3 && nm.includes(qq)))) continue
    eslesen.push(r)
    if (eslesen.length >= 15) break
  }

  // free_tactical cihaz-dedup: yalnız eşleşenlerin attest anahtarları sorgulanır
  const anahtarlar = eslesen.map((r) => r.attest_key).filter((k): k is string => !!k)
  const ftDevices = new Set<string>()
  if (anahtarlar.length > 0) {
    const dp = anahtarlar.map((_, i) => `?${i + 1}`).join(',')
    const dRes = await db.prepare(`SELECT attest_key FROM free_tactical_devices WHERE attest_key IN (${dp})`)
      .bind(...anahtarlar).all<{ attest_key: string }>()
    for (const r of dRes.results) ftDevices.add(r.attest_key)
  }

  const out: ProfilOut[] = eslesen.map((r) => {
    const p = profileOf(r.uid, r, svOff, ftEnabled, ftDevices)
    p.status = myFriends.has(r.uid) ? 'friend'
             : myOut.has(r.uid) ? 'outgoing'
             : myIn.has(r.uid) ? 'incoming' : 'none'
    return p
  })
  // sort anahtarı main.py:3918 birebir: (status != 'friend', not handle.lower().startswith(qq), HAM handle)
  out.sort((a, b) => {
    const a0 = a.status !== 'friend' ? 1 : 0, b0 = b.status !== 'friend' ? 1 : 0
    if (a0 !== b0) return a0 - b0
    const a1 = (a.handle || '').toLowerCase().startsWith(qq) ? 0 : 1
    const b1 = (b.handle || '').toLowerCase().startsWith(qq) ? 0 : 1
    if (a1 !== b1) return a1 - b1
    return cmpPy(a.handle, b.handle)
  })
  return c.json({ users: out })
})

export default g
