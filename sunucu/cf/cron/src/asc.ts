// App Store Connect API — ES256 JWT (WebCrypto) + istek yardımcısı.
// /opt/matrix/kisisel-app/asc.py eşleniği. Sırlar (ASC_KEY_ID/ASC_ISSUER_ID/ASC_P8) yüklenmediyse
// çağıran görev kendini 'anahtar yok' diye atlar (fail-soft; SECRETS.md'ye ekleme kararı Barış'a).
import type { Env } from './env'

function b64u(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemCoz(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function ascHazir(env: Env): boolean {
  return !!(env.ASC_KEY_ID && env.ASC_ISSUER_ID && env.ASC_P8)
}

async function ascJwt(env: Env): Promise<string> {
  const enc = new TextEncoder()
  const now = Math.floor(Date.now() / 1000)
  const h = b64u(enc.encode(JSON.stringify({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' })))
  const p = b64u(enc.encode(JSON.stringify({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })))
  const key = await crypto.subtle.importKey('pkcs8', pemCoz(env.ASC_P8!),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${h}.${p}`))
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`
}

export async function ascGet(env: Env, yol: string): Promise<{ status: number; data: unknown }> {
  const tk = await ascJwt(env)
  const r = await fetch('https://api.appstoreconnect.apple.com' + yol, { headers: { authorization: `Bearer ${tk}` } })
  let data: unknown = null
  try { data = await r.json() } catch { /* boş gövde */ }
  return { status: r.status, data }
}
