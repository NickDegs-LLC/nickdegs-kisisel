// movelog-cron — ortak yardımcılar. Kaynaklar: /opt/matrix/scripts/movelog_yerel.py + api lib/ortak.ts
// KURU MOD SÖZLEŞMESİ (Barış — gölge kurulum):
//   · kullanıcı push'u  → KV 'push:bekleyen:*'      (GERÇEK APNs/FCM ASLA; Faz 3 tüketicisi gönderecek)
//   · Barış bildirimi   → KV 'bildirim:bekleyen:*'  (Matrix/ntfy/Telegram eşleniği, kuru)
//   · RunPod dispatch   → RENDER_Q; ORTAM=golge iken ride_id 'golge:' önekli (dispatch gerçek iş atmaz)
import type { Env } from './env'

export const BARIS_UID = 'u69be3f7e960e'
export const TR_OFSET = 3 * 3600 // TR = UTC+3 (scriptlerdeki timezone(timedelta(hours=3)) eşleniği)

export const simdi = () => Math.floor(Date.now() / 1000)

export function hexRasgele(bayt: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bayt))
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** TR (UTC+3) günü 'YYYY-MM-DD' */
export function trGun(ts: number): string {
  return new Date((ts + TR_OFSET) * 1000).toISOString().slice(0, 10)
}
/** TR saati (0-23) */
export function trSaat(ts: number): number {
  return new Date((ts + TR_OFSET) * 1000).getUTCHours()
}
/** TR 'HH:MM' */
export function hhmm(ts: number): string {
  return new Date((ts + TR_OFSET) * 1000).toISOString().slice(11, 16)
}
/** TR gününün epoch aralığı [başlangıç, bitiş) */
export function trGunAralik(gun: string): [number, number] {
  const g0 = Math.floor(Date.parse(gun + 'T00:00:00Z') / 1000) - TR_OFSET
  return [g0, g0 + 86400]
}

/** haversine — METRE (activity-detect.py hav eşleniği) */
export function hav(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000
  const rad = (x: number) => (x * Math.PI) / 180
  const dA = rad(b.lat - a.lat)
  const dO = rad(b.lon - a.lon)
  const h = Math.sin(dA / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dO / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function jsonParse<T>(s: string | null | undefined, dflt: T): T {
  if (!s) return dflt
  try { return JSON.parse(s) as T } catch { return dflt }
}

export async function kvJson<T>(env: Env, key: string, dflt: T): Promise<T> {
  try { return jsonParse(await env.KV.get(key), dflt) } catch { return dflt }
}
export async function kvJsonYaz(env: Env, key: string, val: unknown, ttlSn?: number): Promise<void> {
  try {
    await env.KV.put(key, JSON.stringify(val), ttlSn ? { expirationTtl: Math.max(60, ttlSn) } : undefined)
  } catch { /* kuyruk yazımı asla görevi düşürmez */ }
}

/** Kullanıcı push'u — KURU: KV kaydı (api lib/ortak pushq ile aynı önek/şekil; silent alanı eklendi). */
export async function pushBekleyen(
  env: Env, kayit: { user: string; title?: string; body?: string; route?: string; silent?: number | string },
): Promise<void> {
  await kvJsonYaz(env, `push:bekleyen:${Date.now()}_${hexRasgele(4)}`, kayit, 7 * 86400)
}

/** Barış bildirimi (notify-admin.sh / tg-notify.sh / reply.sh eşleniği) — KURU: KV kaydı. */
export async function bildirimBekleyen(env: Env, msg: string, konu?: string): Promise<void> {
  await kvJsonYaz(env, `bildirim:bekleyen:${Date.now()}_${hexRasgele(4)}`,
    { msg, konu: konu ?? 'Move Log', kaynak: 'movelog-cron' }, 7 * 86400)
}

/** RENDER_Q'ya iş bırak. ORTAM=golge → ride_id 'golge:' önekli (MUTLAK KURAL: gerçek RunPod işi YOK). */
export async function renderKuyruk(env: Env, job: Record<string, unknown>, kaynak: string): Promise<string> {
  const rid = String(job.ride_id ?? '?')
  const golge = env.ORTAM === 'golge'
  const mesaj = { ...job, ride_id: golge ? `golge:${rid}` : rid, kaynak }
  await env.RENDER_Q.send(mesaj)
  await kvJsonYaz(env, `render:kuyruk:${golge ? 'golge:' : ''}${rid}`,
    { t: simdi(), kaynak, mode: job.mode ?? null, nokta: Array.isArray(job.track) ? job.track.length : 0 }, 86400)
  return golge ? `golge:${rid}` : rid
}

/** KV list — tüm anahtarlar (cursor'lı). */
export async function kvListe(env: Env, prefix: string, sinir = 1000): Promise<string[]> {
  const out: string[] = []
  let cursor: string | undefined
  for (;;) {
    const r = await env.KV.list({ prefix, cursor, limit: 1000 })
    for (const k of r.keys) out.push(k.name)
    if (out.length >= sinir || r.list_complete) break
    cursor = (r as { cursor?: string }).cursor
    if (!cursor) break
  }
  return out.slice(0, sinir)
}

// users tablosu — cron görevlerinin sık okuduğu kolonlar
export type ProfilRow = {
  uid: string; name: string | null; handle: string | null; alias: string | null; lang: string | null
  premium: number | null; admin: number | null
  tracker_id: string | null; summary_enabled: number | null; summary_hour: number | null
  yerel_son: number | null; last_seen_at: number | null; welcomed: number | null
  prefs_json: string | null; state_json: string | null; badges_json: string | null; tv: number
}
export const PROFIL_KOLON =
  'uid, name, handle, alias, lang, premium, admin, tracker_id, summary_enabled, summary_hour, yerel_son, last_seen_at, welcomed, prefs_json, state_json, badges_json, tv'

export function gorunenAd(p: { name?: string | null; handle?: string | null; uid?: string } | null | undefined): string {
  return (p?.name || p?.handle || (p?.uid ?? '').slice(0, 8) || '?') as string
}

/** push token'ı olan kullanıcı kümesi (profiles[u].apns/fcm eşleniği) — platform haritasıyla. */
export async function pushluKullanicilar(env: Env): Promise<Map<string, Set<string>>> {
  const r = await env.DB.prepare('SELECT uid, platform FROM push_tokens').all<{ uid: string; platform: string }>()
  const m = new Map<string, Set<string>>()
  for (const row of r.results) {
    if (!m.has(row.uid)) m.set(row.uid, new Set())
    m.get(row.uid)!.add(row.platform)
  }
  return m
}
