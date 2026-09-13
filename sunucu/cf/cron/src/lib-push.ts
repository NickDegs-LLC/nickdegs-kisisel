// movelog push kütüphanesi — /opt/matrix/scripts/push.py birebir portu (api + cron ortak).
//
// Davranış eşleniği (push.py satır referanslarıyla):
//  · APNs alert  : payload {"aps":{"alert":{"title","body"},"sound":"default"}} (+üst düzey route)
//                  başlıklar authorization/apns-topic/apns-push-type=alert (110-118)
//  · APNs sessiz : {"aps":{"content-available":1}} + extra ("k:v"→p[k]=v, yoksa p[extra]=1);
//                  apns-push-type=background, apns-priority=5 (87-94,105-109)
//  · FCM         : {"message":{"token","data":{title,body,route?},"android":{"priority":"high"}}} (43-61)
//  · FCM sessiz  : data={"silent":extra}; extra yoksa FCM'e sessiz GİTMEZ (63-81,125-127)
//  · hiç token yoksa erken dönüş "token yok" (98-99); token kaynağı D1 push_tokens
//    (profiles.apns[]/fcm[] eşleniği, 0001_init.sql:95)
//
// KURU MOD (gölge güvenlik duvarı): ORTAM === 'canli' DEĞİLSE hiçbir HTTP push çağrısı
// yapılmaz; istek KV "push:kuru:<ts>_<hex>" kaydına yazılır (payload + hedef token sayıları).
// Gerçek APNs/FCM gönderimi YALNIZ ORTAM='canli'. (Barış'ın telefonuna gölgeden bildirim düşmez.)
//
// Önbellekler (KV):
//  · push:apnsjwt  — APNs ES256 JWT, 20 dk (push.py her koşuda taze üretirdi; Apple 20-60 dk kabul eder)
//  · push:fcmtoken — FCM OAuth erişim token'ı, expires_in-60 sn
//
// Sırlar (wrangler secret; adlar SECRETS.md bölüm 1): APNS_AUTH_KEY (p8 PEM içeriği),
// FCM_SERVICE_ACCOUNT (servis hesabı JSON'u). Kimlik sabitleri [vars] ile ezilebilir,
// varsayılanları push.py:12,34 kod sabitleri.

import type { Env } from './env'
import { hexRasgele } from './lib'

// push.py:12 — KID/TEAM/TOPIC; push.py:34 — FCM_PROJECT
const VARSAYILAN = {
  APNS_KEY_ID: 'CAAF5X8DD3',
  APNS_TEAM_ID: 'SZF4T3P583',
  APNS_TOPIC: 'com.nickdegs.kisisel',
  FCM_PROJECT_ID: 'film-ozet',
} as const

const APNS_JWT_KV = 'push:apnsjwt'       // 20 dk önbellek
const APNS_JWT_TTL = 20 * 60
const FCM_TOKEN_KV = 'push:fcmtoken'     // expires_in-60 önbellek
const KURU_TTL = 7 * 86400               // kuru kayıtlar pushq/adminq ile aynı 7 gün TTL

export type PushSonuc = {
  kuru: boolean                          // true = ORTAM gölge, HTTP hiç çağrılmadı
  apnsHedef: number
  fcmHedef: number
  kuruAnahtar?: string                   // kuru modda yazılan KV anahtarı
  sonuclar: { kanal: 'apns' | 'fcm'; token10: string; durum: number | string }[]
  not?: string                           // 'token yok' vb.
}

// ── küçük yardımcılar ───────────────────────────────────────────────────────

function b64url(b: Uint8Array | ArrayBuffer): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''
  for (const x of u) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))

/** PEM gövdesini (PKCS#8) DER'e çevirir — p8 dosyası ve SA private_key aynı biçimde. */
function pemDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u.buffer
}

// ── APNs ES256 JWT (push.py:16-22 make_jwt) ────────────────────────────────

/** Taze APNs JWT üretir (önbelleksiz). WebCrypto ECDSA imzası zaten JWS'in istediği
 *  ham r||s (P1363) biçimindedir — push.py'deki DER→raw dönüşümüne gerek yok. */
export async function apnsJwtUret(p8pem: string, kid: string, team: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8', pemDer(p8pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const h = b64urlJson({ alg: 'ES256', kid })                       // push.py:18
  const p = b64urlJson({ iss: team, iat: Math.floor(Date.now() / 1000) })  // push.py:19
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${h}.${p}`))
  return `${h}.${p}.${b64url(sig)}`
}

/** APNs JWT — KV'de 20 dk önbellekli. Önbellek okunamazsa/yazılamazsa taze üretim sürer. */
export async function apnsJwt(env: Env): Promise<string> {
  try {
    const c = await env.KV.get(APNS_JWT_KV)
    if (c) return c
  } catch { /* önbellek arızası gönderimi durdurmaz */ }
  if (!env.APNS_AUTH_KEY) throw new Error('APNS_AUTH_KEY sırrı yüklü değil')
  const jwt = await apnsJwtUret(
    env.APNS_AUTH_KEY,
    env.APNS_KEY_ID || VARSAYILAN.APNS_KEY_ID,
    env.APNS_TEAM_ID || VARSAYILAN.APNS_TEAM_ID)
  try { await env.KV.put(APNS_JWT_KV, jwt, { expirationTtl: APNS_JWT_TTL }) } catch { /* yut */ }
  return jwt
}

// ── FCM OAuth erişim token'ı (push.py:35-41 _fcm_access_token) ─────────────

/** SA JSON'dan RS256 imzalı OAuth istem JWT'si kurup token uçundan erişim token'ı alır
 *  (google-auth kütüphanesinin yaptığının eli); önbelleksiz. Token İSTEĞİ push değildir. */
export async function fcmTokenAl(saJson: string): Promise<{ token: string; expires_in: number }> {
  const sa = JSON.parse(saJson) as {
    client_email: string; private_key: string; private_key_id?: string; token_uri?: string
  }
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const key = await crypto.subtle.importKey(
    'pkcs8', pemDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const iat = Math.floor(Date.now() / 1000)
  const h = b64urlJson({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id })
  const p = b64urlJson({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',   // push.py:39
    aud: tokenUri, iat, exp: iat + 3600,
  })
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`))
  const istem = `${h}.${p}.${b64url(sig)}`
  const r = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: istem }),
  })
  if (!r.ok) throw new Error(`fcm token alınamadı: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
  const j = await r.json() as { access_token?: string; expires_in?: number }
  if (!j.access_token) throw new Error('fcm token alınamadı: access_token yok')
  return { token: j.access_token, expires_in: j.expires_in ?? 3600 }
}

/** FCM erişim token'ı — KV'de (expires_in-60) sn önbellekli. */
export async function fcmAccessToken(env: Env): Promise<string> {
  try {
    const c = await env.KV.get(FCM_TOKEN_KV)
    if (c) return c
  } catch { /* yut */ }
  if (!env.FCM_SERVICE_ACCOUNT) throw new Error('FCM_SERVICE_ACCOUNT sırrı yüklü değil')
  const { token, expires_in } = await fcmTokenAl(env.FCM_SERVICE_ACCOUNT)
  try {
    await env.KV.put(FCM_TOKEN_KV, token, { expirationTtl: Math.max(60, expires_in - 60) })
  } catch { /* yut */ }
  return token
}

// ── token kaynağı (push.py:24-30 profile_tokens → D1 push_tokens) ──────────

export async function pushTokenlar(env: Env, uid: string): Promise<{ apns: string[]; fcm: string[] }> {
  try {
    const r = await env.DB.prepare(
      'SELECT token, platform FROM push_tokens WHERE uid = ?1 ORDER BY updated_at DESC')
      .bind(uid).all<{ token: string; platform: string }>()
    const rows = r.results ?? []
    return {
      apns: rows.filter((x) => x.platform === 'apns').map((x) => x.token),
      fcm: rows.filter((x) => x.platform === 'fcm').map((x) => x.token),
    }
  } catch {
    return { apns: [], fcm: [] }   // push.py:29-30 "token okunamadı" → boş listeler
  }
}

// ── kuru mod kaydı ─────────────────────────────────────────────────────────

async function kuruKaydet(env: Env, kayit: Record<string, unknown>,
  apnsHedef: number, fcmHedef: number): Promise<string | undefined> {
  const anahtar = `push:kuru:${Date.now()}_${hexRasgele(4)}`
  try {
    await env.KV.put(anahtar, JSON.stringify({
      ...kayit, apns_hedef: apnsHedef, fcm_hedef: fcmHedef, ts: new Date().toISOString(),
    }), { expirationTtl: KURU_TTL })
    return anahtar
  } catch { return undefined }     // kuru kayıt yazılamasa da istek akışı bozulmaz
}

// ── görünür push (push.py main alert dalı: 100-124) ────────────────────────

export async function pushGonder(
  env: Env, user: string, title: string, body: string, route?: string,
): Promise<PushSonuc> {
  const { apns, fcm } = await pushTokenlar(env, user)
  const sonuc: PushSonuc = { kuru: env.ORTAM !== 'canli', apnsHedef: apns.length,
    fcmHedef: fcm.length, sonuclar: [] }
  if (!apns.length && !fcm.length) { sonuc.not = 'token yok'; return sonuc }  // push.py:98-99

  // payload'lar iki modda da aynı kurulur (parite kanıtı kuru kayıtta görünür)
  const apnsPayload: Record<string, unknown> = {
    aps: { alert: { title, body }, sound: 'default' } }             // push.py:112
  if (route) apnsPayload.route = route                              // push.py:113-115
  const fcmData: Record<string, string> = { title, body }           // push.py:50
  if (route) fcmData.route = route                                  // push.py:51-52

  if (sonuc.kuru) {                                                 // ORTAM=golge → HTTP YOK
    sonuc.kuruAnahtar = await kuruKaydet(env,
      { tur: 'alert', user, apns_payload: apnsPayload, fcm_data: fcmData },
      apns.length, fcm.length)
    return sonuc
  }

  // ── YALNIZ ORTAM=canli ──
  if (apns.length) {
    try {
      const jwt = await apnsJwt(env)
      const topic = env.APNS_TOPIC || VARSAYILAN.APNS_TOPIC
      for (const t of apns) {
        try {
          const r = await fetch(`https://api.push.apple.com/3/device/${t}`, {
            method: 'POST',
            headers: { authorization: `bearer ${jwt}`, 'apns-topic': topic,
              'apns-push-type': 'alert', 'content-type': 'application/json' },  // push.py:117
            body: JSON.stringify(apnsPayload),
          })
          sonuc.sonuclar.push({ kanal: 'apns', token10: t.slice(0, 10), durum: r.status })
        } catch (e) {
          sonuc.sonuclar.push({ kanal: 'apns', token10: t.slice(0, 10), durum: String(e) })
        }
      }
    } catch (e) {                                                   // JWT üretilemedi → apns atlanır
      for (const t of apns)
        sonuc.sonuclar.push({ kanal: 'apns', token10: t.slice(0, 10), durum: `jwt: ${String(e)}` })
    }
  }
  if (fcm.length) await fcmToplu(env, fcm, fcmData, sonuc)          // push.py:120-124
  return sonuc
}

// ── sessiz push (push.py --silent dalı: 87-94, 105-109, 125-127) ───────────

export async function pushGonderSessiz(env: Env, user: string, extra?: string): Promise<PushSonuc> {
  const { apns, fcm } = await pushTokenlar(env, user)
  const sonuc: PushSonuc = { kuru: env.ORTAM !== 'canli', apnsHedef: apns.length,
    fcmHedef: fcm.length, sonuclar: [] }
  if (!apns.length && !fcm.length) { sonuc.not = 'token yok'; return sonuc }

  // push.py:87-94 _silent_payload — extra "k:v" → p[k]=v, düz "x" → p[x]=1, yoksa yalın aps
  const apnsPayload: Record<string, unknown> = { aps: { 'content-available': 1 } }
  if (extra) {
    if (extra.includes(':')) {
      const i = extra.indexOf(':')
      apnsPayload[extra.slice(0, i)] = extra.slice(i + 1)
    } else apnsPayload[extra] = 1
  }
  const fcmData = extra ? { silent: String(extra) } : null          // push.py:72,125-127

  if (sonuc.kuru) {
    sonuc.kuruAnahtar = await kuruKaydet(env,
      { tur: 'sessiz', user, extra: extra ?? null, apns_payload: apnsPayload, fcm_data: fcmData },
      apns.length, fcmData ? fcm.length : 0)
    return sonuc
  }

  // ── YALNIZ ORTAM=canli ──
  if (apns.length) {
    try {
      const jwt = await apnsJwt(env)
      const topic = env.APNS_TOPIC || VARSAYILAN.APNS_TOPIC
      for (const t of apns) {
        try {
          const r = await fetch(`https://api.push.apple.com/3/device/${t}`, {
            method: 'POST',
            headers: { authorization: `bearer ${jwt}`, 'apns-topic': topic,
              'apns-push-type': 'background', 'apns-priority': '5',            // push.py:107-108
              'content-type': 'application/json' },
            body: JSON.stringify(apnsPayload),
          })
          sonuc.sonuclar.push({ kanal: 'apns', token10: t.slice(0, 10), durum: r.status })
        } catch (e) {
          sonuc.sonuclar.push({ kanal: 'apns', token10: t.slice(0, 10), durum: String(e) })
        }
      }
    } catch (e) {
      for (const t of apns)
        sonuc.sonuclar.push({ kanal: 'apns', token10: t.slice(0, 10), durum: `jwt: ${String(e)}` })
    }
  }
  if (fcm.length && fcmData) await fcmToplu(env, fcm, fcmData, sonuc)  // sessiz+extrasız FCM'e gitmez
  return sonuc
}

/** FCM HTTP v1 toplu gönderim (push.py:53-61/73-81 döngüleri). Token alınamazsa dal atlanır. */
async function fcmToplu(env: Env, tokens: string[],
  data: Record<string, string>, sonuc: PushSonuc): Promise<void> {
  let at: string
  try { at = await fcmAccessToken(env) } catch (e) {
    for (const t of tokens)
      sonuc.sonuclar.push({ kanal: 'fcm', token10: t.slice(0, 10), durum: `oauth: ${String(e)}` })
    return                                                          // push.py:48-49
  }
  const proje = env.FCM_PROJECT_ID || VARSAYILAN.FCM_PROJECT_ID
  for (const t of tokens) {
    try {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${proje}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: { token: t, data, android: { priority: 'high' } } }),  // push.py:58
      })
      sonuc.sonuclar.push({ kanal: 'fcm', token10: t.slice(0, 10), durum: r.status })
    } catch (e) {
      sonuc.sonuclar.push({ kanal: 'fcm', token10: t.slice(0, 10), durum: String(e) })
    }
  }
}
