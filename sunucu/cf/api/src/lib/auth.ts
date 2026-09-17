// JWT HS256 (WebCrypto) — main.py:122-198 birebir portu.
// Davranış sözleşmesi:
//   - Authorization yok / "Bearer " ile başlamıyor → 401 {"detail":"token yok"}
//   - imza/exp/tv geçersiz                          → 401 {"detail":"token geçersiz/süresi dolmuş"}
//   - tv (token version) HER istekte D1 users.tv ile karşılaştırılır (main.py:163; profil yoksa 0)
//   - alias çözümü: users.alias doluysa kimlik KANONİK hesaba çevrilir (main.py:189-197)
// Secret-kapılı iç uçlar için: secretOk() — secret env'de boş/tanımsızsa FAIL-CLOSED (her istek reddedilir).

import type { MiddlewareHandler } from 'hono'
import type { AppEnv, Env } from './env'
import { hataYanit } from './hata'

const enc = new TextEncoder()

// ---------- base64url (Python _b64/_b64d eşleniği) ----------
export function b64uEncode(b: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  s += '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---------- HMAC anahtarı (izolat-içi cache) ----------
let _keyCache: { secret: string; key: CryptoKey } | null = null

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (_keyCache && _keyCache.secret === secret) return _keyCache.key
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  _keyCache = { secret, key }
  return key
}

// sabit-zaman string karşılaştırma (Python hmac.compare_digest eşleniği)
function sabitEsit(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let acc = 0
  for (let i = 0; i < a.length; i++) acc |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return acc === 0
}

// ---------- imza + exp kontrolü (D1'e BAKMAZ) ----------
// Dönen: {sub, tv} — tv karşılaştırmasını çağıran yapar (verifyJwt / authUser tek D1 sorgusuyla).
async function jwtCoz(env: Env, token: string): Promise<{ sub: string; tv: number } | null> {
  try {
    const parca = token.split('.')
    if (parca.length !== 3) return null
    const [h, p, sig] = parca
    const key = await hmacKey(env.JWT_SECRET)
    const imza = await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`))
    const expSig = b64uEncode(new Uint8Array(imza))
    if (!sabitEsit(sig, expSig)) return null
    const data = JSON.parse(new TextDecoder().decode(b64uDecode(p))) as Record<string, unknown>
    const exp = typeof data.exp === 'number' ? data.exp : 0     // exp yok/bozuk → geçersiz (Python ile aynı sonuç)
    if (exp < Date.now() / 1000) return null
    const sub = data.sub
    if (typeof sub !== 'string' || !sub) return null            // main.py: falsy sub → auth_user 401
    const tv = Math.trunc(Number(data.tv ?? 0))                 // int(data.get("tv", 0))
    if (!Number.isFinite(tv)) return null
    return { sub, tv }
  } catch {
    return null
  }
}

/** D1 users.tv (profil yoksa 0 — main.py _token_versions().get(sub, 0)). */
async function tvOku(env: Env, sub: string): Promise<number> {
  const row = await env.DB.prepare('SELECT tv FROM users WHERE uid = ?1')
    .bind(sub).first<{ tv: number | null }>()
  return row ? Math.trunc(Number(row.tv ?? 0)) : 0
}

/** main.py verify_jwt eşleniği: geçerliyse sub, değilse null. (alias ÇÖZMEZ — onu authUser yapar.) */
export async function verifyJwt(env: Env, token: string): Promise<string | null> {
  const j = await jwtCoz(env, token)
  if (!j) return null
  if (j.tv !== await tvOku(env, j.sub)) return null             // iptal edilmiş token (signout-all bump)
  return j.sub
}

/** main.py make_jwt eşleniği: {sub, exp, tv} HS256. Login uçları (grup3) kullanır. */
export async function makeJwt(env: Env, sub: string, days = 30): Promise<string> {
  const header = b64uEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = b64uEncode(enc.encode(JSON.stringify({
    sub, exp: Math.floor(Date.now() / 1000) + days * 86400, tv: await tvOku(env, sub),
  })))
  const key = await hmacKey(env.JWT_SECRET)
  const sig = b64uEncode(new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`))))
  return `${header}.${payload}.${sig}`
}

/**
 * auth_user middleware'i (main.py:183-198 birebir).
 * Başarıda c.set('user', <kanonik uid>) — route'lar c.get('user') okur.
 * tv + alias TEK D1 sorgusuyla okunur (her istekte D1 — signout-all güvenliği, plan Faz 2 kararı).
 */
export const authUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return hataYanit(401, 'token yok')
  const j = await jwtCoz(c.env, auth.slice(7))
  if (!j) return hataYanit(401, 'token geçersiz/süresi dolmuş')
  const row = await c.env.DB.prepare('SELECT tv, alias, device_id, device_seen FROM users WHERE uid = ?1')
    .bind(j.sub).first<{ tv: number | null; alias: string | null; device_id: string | null; device_seen: number | null }>()
  const tvDb = row ? Math.trunc(Number(row.tv ?? 0)) : 0
  if (j.tv !== tvDb) return hataYanit(401, 'token geçersiz/süresi dolmuş')

  // ---------------------------------------------------------------------------
  // TEK CİHAZ ZORLAMASI (17.09, Barış: "herkes tek cihazdan girecek" + "her istekte zorla")
  // Neden burada: cihazBagla() yalnız token BASILAN uçlarda çalışıyordu; mevcut kullanıcılar
  // aylardır yeniden giriş yapmadığı için (jeton 30 gün + sessiz yenileme) kural fiilen hiç
  // devreye girmiyordu — 17.09'da sahada ölçüldü (55 hesabın 0'ı bağlanmıştı).
  // Maliyet: yukarıdaki satır ZATEN her istekte okunuyordu; iki kolon eklendi, ek sorgu YOK.
  // Yazma yalnız (a) ilk bağlamada, (b) uyuşmazlıkta, (c) saatte bir device_seen tazelemesinde.
  // FAIL-OPEN: hata yutulur, istek normal akışına devam eder.
  if (row) {
    const cihaz = (c.req.header('X-Device-Id') || '').trim().slice(0, 128)
    if (cihaz) {
      const bagli = (row.device_id || '').trim()
      const now = Math.floor(Date.now() / 1000)
      try {
        if (!bagli) {
          await c.env.DB.prepare('UPDATE users SET device_id = ?2, device_seen = ?3 WHERE uid = ?1')
            .bind(j.sub, cihaz, now).run()
        } else if (bagli !== cihaz) {
          // BAŞKA CİHAZ: tüm oturumlar düşer. device_id BİLEREK değiştirilmez — isteği yapan
          // taraf kopyalanmış jeton olabilir; bağlamayı ona devretmek hırsıza bağlamayı verirdi.
          // Kimse kazanmaz; bir sonraki GERÇEK giriş cihazBagla ile yeniden bağlar (son giren kazanır).
          await c.env.DB.prepare('UPDATE users SET tv = tv + 1, updated_at = ?2 WHERE uid = ?1')
            .bind(j.sub, now).run()
          return hataYanit(401, 'token geçersiz/süresi dolmuş')
        } else if (now - Math.trunc(Number(row.device_seen ?? 0)) > 3600) {
          // aynı cihaz: her istekte yazma, saatte bir yeter
          await c.env.DB.prepare('UPDATE users SET device_seen = ?2 WHERE uid = ?1').bind(j.sub, now).run()
        }
      } catch (e) {
        console.log('cihaz zorlama atlandi:', String(e).slice(0, 120))
      }
    }
  }
  // SİLİNMİŞ HESAP kontrolü (grup8 DELETE /api/account damgası + sözleşme cf_mapping isteği):
  // profil silinince tv kaydı da gider ve tv=0 eski token teknik olarak geçerdi (main.py TUZAK-3).
  // Yalnız users satırı YOKKEN bakılır — yeniden kayıt olan kullanıcı (satır yeniden oluşur)
  // eski damgaya takılmaz; normal isteklere ek KV okuması binmez. Okunamazsa Python davranışı kalır.
  if (!row) {
    let silinmis = false
    try { silinmis = (await c.env.KV.get(`deleted:${j.sub}`)) !== null } catch { silinmis = false }
    if (silinmis) return hataYanit(401, 'token geçersiz/süresi dolmuş')
  }
  c.set('user', row?.alias || j.sub)   // alias doluysa kanonik hesaba yönlendir (veri TAŞINMAZ)
  await next()
}

/**
 * Secret-kapılı iç/admin uçlar için yardımcı (main.py 1052 / 1871 deseni).
 * FAIL-CLOSED: secret env'de boş/tanımsızsa HER istek reddedilir.
 * Hata mesajı UCA ÖZGÜdür, helper karar verir mesajı route yazar:
 *   register-ride/render-done/render-failed/admin/*: hataYanit(403, 'yetkisiz')
 *   GET /api/internal/music:                          hataYanit(403, 'no')
 */
export function secretOk(secret: string | undefined, verilen: unknown): boolean {
  return !!secret && verilen === secret
}
