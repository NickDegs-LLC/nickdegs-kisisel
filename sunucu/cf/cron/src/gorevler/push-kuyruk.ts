// push-kuyruk — KV 'push:bekleyen:*' tüketicisi. Sunucudaki push.py timer'ının CF karşılığı.
//
// NEDEN: api/cron görevleri push'u KV'ye YAZIYOR (ortak.ts pushq / lib.ts pushBekleyen) ama
// 2026-08-31 kesim ön kontrolünde ortaya çıktı ki KUYRUĞU OKUYAN kimse yoktu → kesimden sonra
// kullanıcı "videon hazır" bildirimini HİÇ almazdı. Bu görev o halkayı kapatır.
//
// Kuyruk biçimi (ortak.ts:47 ve lib.ts:61 ile birebir):
//   görünür : {user, title, body, route?}
//   sessiz  : {user, silent: <yük|1>}  ← yük `silent` alanının KENDİSİNDE (aşağıdaki TUZAK'a bak)
// KURU MOD: push.ts kendi içinde ORTAM!=='canli' iken HTTP çağrısı yapmaz, 'push:kuru:*' yazar —
// yani gölgede bu görev kuyruğu boşaltır ama telefona bildirim GİTMEZ.
import type { GorevCtx } from '../takvim'
import { pushGonder, pushGonderSessiz } from '../lib-push'

const TAVAN = 200          // tek turda en fazla (Worker CPU/süre emniyeti)

export async function pushKuyruk(c: GorevCtx): Promise<void> {
  const { env, log } = c
  const liste = await env.KV.list({ prefix: 'push:bekleyen:', limit: TAVAN })
  if (!liste.keys.length) { log('kuyruk boş'); return }
  let gonderildi = 0, sessiz = 0, hata = 0, atlandi = 0
  for (const k of liste.keys) {
    let d: Record<string, unknown> | null = null
    try { d = JSON.parse((await env.KV.get(k.name)) || 'null') } catch { d = null }
    if (!d || typeof d.user !== 'string') { await env.KV.delete(k.name); atlandi++; continue }
    try {
      if (d.silent) {
        // 🔴 TUZAK (bulundu+düzeltildi 2026-09-02): burada `d.extra` okunuyordu ama HİÇBİR üretici
        // `extra` alanı yazmıyor — yük `silent` alanının KENDİSİNDE string olarak duruyor:
        //   grup4.ts:423,452 → silent: 'ptt:<pid>:<ad>'   (iOS Push.swift:52 userInfo["ptt"])
        //   grup2.ts:122     → silent: 'live' | 'hrpeek'  (iOS live/hrpeek, Android hrpeek)
        //   rearm.ts:22, activity-detect.ts:251 → silent: 1 (SAYI — yük yok, yalın aps kalmalı)
        // Sonuç: iOS boş uyandırma alıyordu, FCM'e ise (lib-push.ts:243,275 extra'sız atlar)
        // HİÇ gitmiyordu → kulüp telsizi ve saat nabız-uyandırması sessizce ölüydü.
        // main.py:3161-3162 sözleşmesi zaten "silent'ın DEĞERİ = --silent argümanı" diyordu.
        const ek = typeof d.silent === 'string' && d.silent ? d.silent
                 : (d.extra ? String(d.extra) : undefined)
        await pushGonderSessiz(env, d.user as string, ek)
        sessiz++
      } else {
        await pushGonder(env, d.user as string, String(d.title ?? ''), String(d.body ?? ''),
          d.route ? String(d.route) : undefined)
        gonderildi++
      }
      await env.KV.delete(k.name)        // yalnız BAŞARIDA sil; hata olursa sonraki tur dener
    } catch (e) {
      hata++
      log(`push hata (${k.name}): ${String(e).slice(0, 120)}`)
    }
  }
  log(`görünür=${gonderildi} sessiz=${sessiz} hata=${hata} bozuk=${atlandi}` +
      (liste.keys.length >= TAVAN ? ' (kuyrukta daha var)' : ''))
}
