// bekci-ortak — KENDİ KENDİNİ ONARAN katmanın ortak çekirdeği (Faz T, 2026-08-31).
//
// SÖZLEŞME (Barış: "sunucudan tamamen bağımsız, kendi kendine çalışan, kendi kendine onaracak"):
//   TESPİT → ONAR → DOĞRULA → D1 bekci_olay'a yaz → gerekirse Barış'a bildirim kuyruğu.
//
// 🔴 KURU/CANLI FARKI (mutlak):
//   ORTAM != 'canli'  → onar() hiçbir şey ÇALIŞTIRMAZ; 'YAPARDIM: <aksiyon>' satırı yazar (sonuc='kuru').
//                       RunPod'a HİÇBİR fetch yapılmaz (bakiye korunur — render-bekci.ts'teki kuralla aynı).
//   ORTAM == 'canli'  → uygula() koşar, dogrula() ile teyit edilir, sonuc onarildi/basarisiz olur.
// Bildirimler kuru modda da yazılır ama gerçek Telegram/Matrix'e GİTMEZ: lib.bildirimBekleyen →
// KV 'bildirim:bekleyen:*' (Faz 3 tüketicisi gönderecek). Yani "bildirim kuyruğu" her iki modda çalışır.
import type { GorevCtx } from '../takvim'
import type { Env } from '../env'
import { bildirimBekleyen, simdi } from '../lib'

export type Sonuc = 'saglam' | 'onarildi' | 'kuru' | 'bildirildi' | 'basarisiz' | 'atlandi'

const OLAY_SQL = `CREATE TABLE IF NOT EXISTS bekci_olay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, bekci TEXT NOT NULL, tespit TEXT NOT NULL,
  aksiyon TEXT NOT NULL, sonuc TEXT NOT NULL, detay_json TEXT)`

let olayHazir = false

/** bekci_olay'a tek satır. Tablo yoksa izolat başına 1 kez yaratılır (migration 0004 ile aynı şema). */
export async function olayYaz(
  env: Env,
  o: { bekci: string; tespit: string; aksiyon: string; sonuc: Sonuc; detay?: Record<string, unknown> },
): Promise<void> {
  try {
    if (!olayHazir) { await env.DB.prepare(OLAY_SQL).run(); olayHazir = true }
    const detay = { ortam: env.ORTAM, ...(o.detay ?? {}) }
    await env.DB.prepare(
      'INSERT INTO bekci_olay (ts, bekci, tespit, aksiyon, sonuc, detay_json) VALUES (?1,?2,?3,?4,?5,?6)')
      .bind(simdi(), o.bekci, o.tespit.slice(0, 120), o.aksiyon.slice(0, 400), o.sonuc,
        JSON.stringify(detay).slice(0, 4000)).run()
  } catch (e) {
    // olay yazımı ASLA bekçiyi düşürmez — konsol logu yeter
    console.log(`[bekci_olay yazılamadı] ${o.bekci}/${o.tespit}: ${String(e).slice(0, 120)}`)
  }
}

/** ORTAM canli değilse KURU: hiçbir dış yazım/onarım yapılmaz. */
export const kuru = (env: Env): boolean => env.ORTAM !== 'canli'

/**
 * TESPİT → ONAR → DOĞRULA çekirdeği.
 * kuru modda uygula() ÇAĞRILMAZ; 'YAPARDIM: ...' kaydı düşer.
 *
 * ⚠️ kuruGecit: kuru modda onarım GERÇEKLEŞMEDİĞİ için aynı tespit her turda yeniden görülür
 * (park edilmiş iş 5 dk'da bir, hayalet kayıt 30 dk'da bir...). Bu alan verilirse aynı nesne için
 * 'kuru' satırı 6 saatte bir yazılır — tablo şişmez, tespit yine görünür. canli'da geçit YOKTUR
 * (onarım gerçekleştiği için tekrar zaten olmaz) ve HER onarım satırı yazılır.
 */
export async function onar(
  c: GorevCtx,
  p: {
    bekci: string; tespit: string; aksiyon: string
    detay?: Record<string, unknown>
    kuruGecit?: string
    uygula: () => Promise<void>
    dogrula?: () => Promise<boolean>
  },
): Promise<Sonuc> {
  const { env, log } = c
  if (kuru(env)) {
    log(`[KURU] ${p.tespit} → YAPARDIM: ${p.aksiyon}`)
    const yaz = () => olayYaz(env, {
      bekci: p.bekci, tespit: p.tespit, aksiyon: `YAPARDIM: ${p.aksiyon}`, sonuc: 'kuru', detay: p.detay,
    })
    if (p.kuruGecit) await gecitli(env, `bekci:kuruonar:${p.bekci}:${p.tespit}:${p.kuruGecit}`, 6, yaz)
    else await yaz()
    return 'kuru'
  }
  try {
    await p.uygula()
    const ok = p.dogrula ? await p.dogrula() : true
    log(`${p.tespit} → ${p.aksiyon} → ${ok ? 'ONARILDI' : 'DOĞRULANAMADI'}`)
    await olayYaz(env, {
      bekci: p.bekci, tespit: p.tespit, aksiyon: p.aksiyon,
      sonuc: ok ? 'onarildi' : 'basarisiz', detay: { ...p.detay, dogrulandi: ok },
    })
    return ok ? 'onarildi' : 'basarisiz'
  } catch (e) {
    const hata = String(e).slice(0, 300)
    log(`${p.tespit} → onarım HATASI: ${hata}`)
    await olayYaz(env, { bekci: p.bekci, tespit: p.tespit, aksiyon: p.aksiyon, sonuc: 'basarisiz', detay: { ...p.detay, hata } })
    return 'basarisiz'
  }
}

/** Aynı konuda 'saat' saat içinde tekrar bildirim/olay yazma (KV TTL kilidi). true = SUSTUR. */
export async function sessizde(env: Env, bekci: string, konu: string, saat = 6): Promise<boolean> {
  const k = `bekci:sessiz:${bekci}:${konu}`
  try {
    if ((await env.KV.get(k)) !== null) return true
    await env.KV.put(k, String(simdi()), { expirationTtl: Math.max(60, Math.round(saat * 3600)) })
  } catch { /* KV okunamadı → sustur değil, bildir */ }
  return false
}

/** Bildirim kuyruğuna yaz (kuru modda da KV'ye düşer) + bekci_olay'a 'bildirildi' satırı. */
export async function bildir(
  c: GorevCtx,
  p: { bekci: string; tespit: string; msg: string; konu?: string; saat?: number; detay?: Record<string, unknown> },
): Promise<Sonuc> {
  const { env, log } = c
  if (await sessizde(env, p.bekci, p.tespit, p.saat ?? 6)) {
    log(`${p.tespit}: sessizlik penceresinde, bildirim atlandı`)
    return 'atlandi'
  }
  await bildirimBekleyen(env, p.msg, p.konu ?? 'Move Log Bekçi')
  log(`${p.tespit}: BİLDİRİM kuyruğa`)
  await olayYaz(env, { bekci: p.bekci, tespit: p.tespit, aksiyon: 'Barış bildirim kuyruğuna yazıldı', sonuc: 'bildirildi', detay: { ...p.detay, msg: p.msg.slice(0, 300) } })
  return 'bildirildi'
}

/** Rutin satırı en fazla 'saat' saatte bir yaz — bekci_olay'ı şişirmeden iz bırakır.
 *  ⚠️ Yalnız RUTİN kayıtlar için: gerçek tespit/onarım satırları ASLA bu kapıdan geçmez. */
async function gecitli(
  env: Env, anahtar: string, saat: number, yaz: () => Promise<void>,
): Promise<void> {
  try {
    if ((await env.KV.get(anahtar)) !== null) return
    await env.KV.put(anahtar, String(simdi()), { expirationTtl: Math.max(60, Math.round(saat * 3600)) })
  } catch { /* KV yoksa yine yaz */ }
  await yaz()
}

/** 'saglam' satırı (kontrol edildi, müdahale gerekmedi). */
export async function saglamOlay(
  env: Env, bekci: string, tespit: string, detay?: Record<string, unknown>, saat = 6,
): Promise<void> {
  await gecitli(env, `bekci:saglam:${bekci}:${tespit}`, saat, () =>
    olayYaz(env, { bekci, tespit, aksiyon: 'kontrol edildi, müdahale gerekmedi', sonuc: 'saglam', detay }))
}

/** Rutin KURU tur satırı ('YAPARDIM: ...'), aynı kapıdan. */
export async function kuruOlay(
  env: Env, bekci: string, tespit: string, aksiyon: string, detay?: Record<string, unknown>, saat = 6,
): Promise<void> {
  await gecitli(env, `bekci:kuru:${bekci}:${tespit}`, saat, () =>
    olayYaz(env, { bekci, tespit, aksiyon: `YAPARDIM: ${aksiyon}`, sonuc: 'kuru', detay }))
}

/** Rutin 'atlandi' satırı (ör. sahiplik kirası nedeniyle bloğun atlanması). */
export async function atlandiOlay(
  env: Env, bekci: string, tespit: string, aksiyon: string, detay?: Record<string, unknown>, saat = 12,
): Promise<void> {
  await gecitli(env, `bekci:atla:${bekci}:${tespit}`, saat, () =>
    olayYaz(env, { bekci, tespit, aksiyon, sonuc: 'atlandi', detay }))
}

// ───────────────────────── RunPod erişimi (yalnız ORTAM=canli) ─────────────────────────
// ⚠️ Bu fonksiyonlar KURU modda ÇAĞRILMAZ — çağıran bekçi kuru(env) ile erken döner.
// GraphQL ucu User-Agent'sız 403 verir (movelog-render-bekci.py:105-111 dersi).

export type Endpoint = { ad: string; id: string; wmaxVars: number }

/** Bu kurulumun bildiği RunPod endpoint'leri. Taktik id'si boşsa (kota 20/20) 'yok' olarak raporlanır.
 *
 * ⚠️ wmaxVars = wmax=0 SESSİZ ARIZASINDA geri açılacak DEĞER (KV'de kayıt yoksa taban).
 *    KOTA DEVRİ 2026-08-31 (Barış onayı): movelog-render 15 -> 12, boşalan 3 worker taktiğe geçti.
 *    Buradaki 15 kalsaydı bekçi ilk wmax=0 arızasında render'ı 15'e geri açar, toplam 23/20 olur ve
 *    kota devri SESSİZCE geri alınırdı. Toplam her zaman 12 + 3 + (flux 2 · upscale 1 · sp-llm 1 ·
 *    whisper 1) = 20 olmalı. */
export function endpointler(env: Env): { bilinen: Endpoint[]; eksik: Endpoint[] } {
  const hepsi: Endpoint[] = [
    { ad: 'movelog-render', id: env.RUNPOD_ENDPOINT_ID ?? '', wmaxVars: 12 },
    { ad: 'movelog-tactical', id: env.RUNPOD_ENDPOINT_TAC ?? '', wmaxVars: 3 },
  ]
  return { bilinen: hepsi.filter((e) => !!e.id), eksik: hepsi.filter((e) => !e.id) }
}

export async function rpRest(
  env: Env, yol: string, method: 'GET' | 'PATCH' = 'GET', body?: unknown,
): Promise<unknown> {
  const r = await fetch('https://rest.runpod.io/v1' + yol, {
    method,
    headers: { authorization: `Bearer ${env.RUNPOD_API_KEY}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`RunPod REST ${method} ${yol} HTTP ${r.status}`)
  return r.json()
}

/** /v2/{id}/health — HTTP kodunu da döndürür (402 = bakiye bitti sinyali). */
export async function rpHealth(env: Env, id: string): Promise<{ status: number; j: Record<string, unknown> | null }> {
  const r = await fetch(`https://api.runpod.ai/v2/${id}/health`, {
    headers: { authorization: `Bearer ${env.RUNPOD_API_KEY}` },
  })
  let j: Record<string, unknown> | null = null
  try { j = (await r.json()) as Record<string, unknown> } catch { j = null }
  return { status: r.status, j }
}

/** GraphQL — User-Agent ŞART (UA'sız 403); introspection KAPALI, alan adları elle doğrulanmış olmalı. */
async function rpGraphql<T>(env: Env, query: string): Promise<T> {
  const r = await fetch(`https://api.runpod.io/graphql?api_key=${env.RUNPOD_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'movelog-bekci/1.0' },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}`)
  const j = (await r.json()) as { data?: T; errors?: { message?: string }[] }
  if (j.errors?.length) throw new Error(`GraphQL: ${String(j.errors[0]?.message ?? '?').slice(0, 160)}`)
  return j.data as T
}

/** GraphQL clientBalance. */
export async function rpBakiye(env: Env): Promise<number | null> {
  const d = await rpGraphql<{ myself?: { clientBalance?: number | null } }>(env, 'query { myself { clientBalance } }')
  return d?.myself?.clientBalance ?? null
}

export type GpuDurum = {
  version: number
  gpuIds: string                                     // havuz + '-Kart' dışlamaları (REST'te MIG GÖRÜNMEZ, burada görünür)
  pods: { id: string; durum: string; gpu: string; imaj: string }[] // endpoint'in worker slotları (EXITED = boşta; imaj = slot YARATILDIĞINDAKİ imaj, template değişince GÜNCELLENMEZ)
}

/** Endpoint'in gpuIds'i + worker'larının GPU adı/imajı (MIG bekçisi + imaj flush'u). REST /endpoints bunu VERMEZ
 *  (2026-09-01 dersi: gpuTypeIds listesinde MIG dilimi görünmüyordu ama scheduler dağıtıyordu) — yalnız GraphQL güvenilir. */
export async function rpGpuDurum(env: Env, id: string): Promise<GpuDurum | null> {
  type Ep = { id: string; version?: number; gpuIds?: string | null
    pods?: { id: string; desiredStatus?: string | null; imageName?: string | null; machine?: { gpuDisplayName?: string | null } | null }[] | null }
  const d = await rpGraphql<{ myself?: { endpoints?: Ep[] | null } }>(env,
    'query { myself { endpoints { id version gpuIds pods { id desiredStatus imageName machine { gpuDisplayName } } } } }')
  const ep = (d?.myself?.endpoints ?? []).find((e) => e.id === id)
  if (!ep) return null
  return {
    version: Number(ep.version ?? -1),
    gpuIds: String(ep.gpuIds ?? ''),
    pods: (ep.pods ?? []).map((p) => ({
      id: p.id, durum: String(p.desiredStatus ?? '?'), gpu: String(p.machine?.gpuDisplayName ?? '?'),
      imaj: String(p.imageName ?? ''),
    })),
  }
}

/** Tek worker slotunun ANLIK durumu (sonlandırmadan hemen önce yeniden bakılır). null = slot artık yok. */
export async function rpPodBilgi(env: Env, podId: string): Promise<{ durum: string; imaj: string } | null> {
  const d = await rpGraphql<{ pod?: { id: string; desiredStatus?: string | null; imageName?: string | null } | null }>(env,
    `query { pod(input:{podId:${JSON.stringify(podId)}}) { id desiredStatus imageName } }`)
  if (!d?.pod) return null
  return { durum: String(d.pod.desiredStatus ?? '?'), imaj: String(d.pod.imageName ?? '') }
}

/** Serverless worker slotunu SONLANDIR (GraphQL podTerminate). 2026-09-01 deneyi (b6xr86u223pmnk): slot listeden
 *  düşer, RunPod yerine GÜNCEL template imajıyla yeni slot kiralar; endpoint version/wmax DEĞİŞMEZ, /run 409 yok.
 *  wmax 0→N flush'unun (60-70 sn karartma + ENDPOINT_PAUSED) yerine geçer. Yalnız EXITED (boşta) slotlara uygula. */
export async function rpPodSonlandir(env: Env, podId: string): Promise<void> {
  await rpGraphql<{ podTerminate?: unknown }>(env, `mutation { podTerminate(input:{podId:${JSON.stringify(podId)}}) }`)
}
