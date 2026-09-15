// IAP abonelik kararı — App Store / Play bildirim uçları + (ileride) birim test.
// D1'siz saf kısım: abonelikKarar / appleAboneDurum / googleAboneDurum.
// D1'li uygulama: abonelikUygula / bildirimKaydet.
//
// DOKUNMA listesi cron/src/gorevler/premium-suresi.ts ile AYNEN aynı — inceleme
// hesapları (appreview / appreview2) hiçbir koşulda düşürülmez.

import { simdi } from './db'
import type { Env } from './env'
import { adminq } from './ortak'

/** premium-suresi.ts DOKUNMA — inceleme hesapları asla düşürülmez. */
export const DOKUNMA = new Set(['appreview', 'appreview2'])

export type AbonelikIstek = {
  aktif: boolean
  ultra: boolean
  bitis: number          // epoch saniye
  zorlaPasif?: boolean
}

export type AbonelikKarar =
  | 'aktif'
  | 'dusuruldu'
  | 'korundu:inceleme'
  | 'korundu:suresiz'
  | 'korundu:baska-hak'

export type AbonelikBaglam = {
  env: Env
  ad: string
  platform: string
  tip: string
}

/** Apple EXPIRED/REVOKE/REFUND ailesi — ayrı dal yazılmaz, durum mantığına girer. */
export const APPLE_PASIF_TIP = new Set(['EXPIRED', 'GRACE_PERIOD_EXPIRED', 'REVOKE', 'REFUND'])

/**
 * Saf karar: mevcut users.premium_until + istek → ne yapılacak.
 * aktif (zorlaPasif değilse) her zaman 'aktif'.
 * pasif korumaları SIRAYLA: inceleme → süresiz (NULL) → başka hak (+1 gün pay) → düşür.
 */
export function abonelikKarar(
  uid: string,
  premiumUntil: number | null | undefined,
  istek: AbonelikIstek,
): AbonelikKarar {
  const aktif = istek.zorlaPasif ? false : istek.aktif
  if (aktif) return 'aktif'
  if (DOKUNMA.has(uid)) return 'korundu:inceleme'
  if (premiumUntil === null || premiumUntil === undefined) return 'korundu:suresiz'
  if (premiumUntil > istek.bitis + 86400) return 'korundu:baska-hak'
  return 'dusuruldu'
}

/** Apple bildirim tipi + işlem tarihleri → aktif mi, bitiş epoch'u ne. */
export function appleAboneDurum(
  notificationType: string,
  revocationDate: unknown,
  exp: number,
  grace: number,
  now: number,
): { aktif: boolean; bitis: number } {
  if (APPLE_PASIF_TIP.has(notificationType) || (revocationDate !== undefined && revocationDate !== null && revocationDate !== 0 && revocationDate !== ''))
    return { aktif: false, bitis: exp || now }
  const bitis = Math.max(exp, grace)
  return { aktif: bitis > now, bitis }
}

export type GoogleAboneDurum = 'aktif' | 'pasif' | 'pending' | 'bilinmiyor'

/** Play subscriptionsv2.subscriptionState (+ bitiş) → durum. Önek isteğe bağlı. */
export function googleAboneDurum(state: string, bitis: number, now: number): GoogleAboneDurum {
  const s = state.replace(/^SUBSCRIPTION_STATE_/, '')
  if (s === 'PENDING') return 'pending'
  if (s === 'ACTIVE' || s === 'IN_GRACE_PERIOD') return 'aktif'
  if (s === 'CANCELED') return bitis > now ? 'aktif' : 'pasif'
  if (s === 'ON_HOLD' || s === 'PAUSED' || s === 'EXPIRED' || s === 'PENDING_PURCHASE_CANCELED') return 'pasif'
  return 'bilinmiyor'
}

async function kullaniciGarantile(db: D1Database, uid: string): Promise<void> {
  const ts = simdi()
  await db.prepare('INSERT INTO users (uid, created_at, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT(uid) DO NOTHING')
    .bind(uid, ts).run()
}

/**
 * Kararı D1'e uygular. aktif → premium aç + premium_until yaz (satır garantili).
 * pasif → korumalar; yalnız 'dusuruldu' yazınca adminq (ctx varsa).
 */
export async function abonelikUygula(
  db: D1Database,
  uid: string,
  istek: AbonelikIstek,
  ctx?: AbonelikBaglam,
): Promise<AbonelikKarar> {
  const ts = simdi()
  if (!(istek.zorlaPasif ? false : istek.aktif)) {
    const row = await db.prepare('SELECT premium_until FROM users WHERE uid = ?1')
      .bind(uid).first<{ premium_until: number | null }>()
    const karar = abonelikKarar(uid, row ? row.premium_until : null, istek)
    if (karar === 'dusuruldu') {
      await db.prepare('UPDATE users SET premium = 0, ultra = 0, updated_at = ?1 WHERE uid = ?2')
        .bind(ts, uid).run()
      if (ctx) {
        await adminq(ctx.env, `💳 Move Log abonelik bitti: ${ctx.ad} · ${ctx.platform} · ${ctx.tip}`)
      }
    }
    return karar
  }
  await kullaniciGarantile(db, uid)
  // Başka kaynağın hakkını BOZMA (SET ifadeleri satırın ESKİ değerleriyle hesaplanır):
  //  · süresiz hak (premium=1, premium_until NULL = promo/redeem/inceleme) süresiz kalır, ultra'sı korunur;
  //  · premium_until yalnız UZAR (ör. Android Ultra'sı daha uzunsa Apple Premium yenilemesi kısaltmaz);
  //  · ultra: bu abonelik ultra ise 1; değilse daha uzun süren başka hak varsa eski değer, yoksa 0.
  await db.prepare(
    `UPDATE users SET premium = 1,
       ultra = CASE WHEN ?1 = 1 THEN 1
                    WHEN premium = 1 AND premium_until IS NULL THEN COALESCE(ultra, 0)
                    WHEN COALESCE(premium_until, 0) > ?2 + 86400 THEN COALESCE(ultra, 0)
                    ELSE 0 END,
       premium_until = CASE WHEN premium = 1 AND premium_until IS NULL THEN NULL
                            ELSE MAX(COALESCE(premium_until, 0), ?2) END,
       updated_at = ?3
     WHERE uid = ?4`)
    .bind(istek.ultra ? 1 : 0, istek.bitis, ts, uid).run()
  return 'aktif'
}

export type BildirimSatir = {
  id: string
  platform: 'apple' | 'google'
  tip?: string | null
  alt_tip?: string | null
  ortam?: string | null
  uid?: string | null
  pid?: string | null
  karar: string
  bitis?: number | null
}

export async function bildirimKaydet(db: D1Database, s: BildirimSatir, ts = simdi()): Promise<void> {
  await db.prepare(
    `INSERT INTO iap_bildirim (id, platform, tip, alt_tip, ortam, uid, pid, karar, bitis, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(id) DO UPDATE SET
       platform = excluded.platform, tip = excluded.tip, alt_tip = excluded.alt_tip,
       ortam = excluded.ortam, uid = excluded.uid, pid = excluded.pid,
       karar = excluded.karar, bitis = excluded.bitis`)
    .bind(
      s.id, s.platform, s.tip ?? null, s.alt_tip ?? null, s.ortam ?? null,
      s.uid ?? null, s.pid ?? null, s.karar, s.bitis ?? null, ts,
    ).run()
}

/** Varsa karar metni; yoksa null. 'hata:*' kayıtları yeniden işlensin diye tekrar sayılmaz. */
export async function bildirimKararOku(db: D1Database, id: string): Promise<string | null> {
  const r = await db.prepare('SELECT karar FROM iap_bildirim WHERE id = ?1').bind(id)
    .first<{ karar: string | null }>()
  return r ? (r.karar ?? '') : null
}

export function bildirimTekrar(karar: string | null): boolean {
  if (karar === null) return false
  return !karar.startsWith('hata:')
}

/** Kullanıcı görünen adı (adminq); yoksa uid'nin kısa hali. */
export function kullaniciAdi(name: string | null | undefined, uid: string): string {
  return name ? String(name) : uid.slice(0, 10)
}
