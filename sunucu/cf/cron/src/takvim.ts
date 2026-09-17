// movelog-cron — görev kaydı + zamanlama. Kaynak plan: cron/tasks.json + cron/GOREVLER.md.
// 3 cron ifadesi (dakikalık '* * * * *' · 10dk '*/10 * * * *' · saatlik '0 * * * *') tek scheduled()'a
// düşer; görevler D1 gorev_takvimi (name, cron_grubu, next_run, last_run, last_ok, hata, enabled)
// üzerinden seçilir. next_run claim'i atomik UPDATE ile — eşzamanlı tetikler aynı görevi iki kez koşamaz
// (flock kilitlerinin CF karşılığı, GOREVLER.md 'tuzaklar' bölümü).
import type { Env } from './env'

import * as activityDetect from './gorevler/activity-detect'
import * as pushKuyruk from './gorevler/push-kuyruk'
import * as bildirimKuyruk from './gorevler/bildirim-kuyruk'
import * as pendingReconcile from './gorevler/pending-reconcile'
import * as yerelqBekcisi from './gorevler/yerelq-bekcisi'
import * as renderBekci from './gorevler/render-bekci'
import * as genreqSupurucu from './gorevler/genreq-supurucu'
import * as broadcast from './gorevler/broadcast'
import * as rearm from './gorevler/rearm'
import * as olayWatch from './gorevler/olay-watch'
import * as grupsurus from './gorevler/grupsurus'
import * as weeklyRecap from './gorevler/weekly-recap'
import * as gunlukRapor from './gorevler/gunluk-rapor'
import * as premiumSuresi from './gorevler/premium-suresi'
import * as rozet from './gorevler/rozet'
import * as hava from './gorevler/hava'
import * as ilkvideoNudge from './gorevler/ilkvideo-nudge'
import * as kulupKarne from './gorevler/kulup-karne'
import * as wrapped from './gorevler/wrapped'
import * as videoKontrol from './gorevler/video-kontrol'
import * as yorumWatch from './gorevler/yorum-watch'
import * as reviewState from './gorevler/review-state'
import * as integrityAuto from './gorevler/integrity-auto'
// ── KENDİ KENDİNİ ONARAN BEKÇİ KATMANI (Faz T, 2026-08-31) ──
import * as runpodSaglik from './gorevler/runpod-saglik'
import * as kuyrukBekcisi from './gorevler/kuyruk-bekcisi'
import * as imajSurumBekcisi from './gorevler/imaj-surum-bekcisi'
import * as videoButunluk from './gorevler/video-butunluk'
import * as d1Tutarlilik from './gorevler/d1-tutarlilik'
import * as kendiKendiniTest from './gorevler/kendi-kendini-test'
import * as attestReceipt from './gorevler/attest-receipt'

export type Grup = 'dakikalik' | 'on_dk' | 'saatlik'

export type Zaman =
  | { tip: 'periyot'; sn: number }                         // her N saniyede (dakika hizalı tetikte)
  | { tip: 'dakika'; dakikalar: number[] }                 // UTC dakika kümesi (rearm 5,35 · olay-watch 3,18,33,48)
  | { tip: 'gunluk'; saat: number }                        // her gün UTC ss:00
  | { tip: 'haftalik'; gun: number; saat: number }         // haftanın günü (0=Pazar) UTC ss:00
  | { tip: 'yillik'; ay: number; gun: number; saat: number } // yılda bir (wrapped: 20 Ara 15:00 UTC)
  | { tip: 'saatmod'; mod: number }                        // saat % mod == 0 (video-kontrol 6h)

export type GorevCtx = { env: Env; now: number; log: (s: string) => void }
export type Gorev = { ad: string; grup: Grup; zaman: Zaman; acik: boolean; kos: (c: GorevCtx) => Promise<void> }

// tasks.json tetik_grubu alanlarıyla birebir (2026-08-30 itiraz düzeltmeleri dahil:
// rearm/olay-watch/review-state dakikalık grupta; saatlik günlükler saat başına yuvarlandı).
export const GOREVLER: Gorev[] = [
  { ad: 'activity-detect',   grup: 'dakikalik', zaman: { tip: 'periyot', sn: 60 },   acik: true,  kos: activityDetect.kos },
  { ad: 'push-kuyruk',       grup: 'dakikalik', zaman: { tip: 'periyot', sn: 60 },   acik: true,  kos: pushKuyruk.pushKuyruk },
  // 05.09: 'bildirim:bekleyen'/'adminq:bekleyen' kuyruklarının TÜKETİCİSİ YOKTU — 53 bekçi alarmı
  // (RunPod endpoint yok, video teslim sorunu, gönderilemeyen istekler) sessizce çürüyordu.
  { ad: 'bildirim-kuyruk',   grup: 'on_dk',     zaman: { tip: 'periyot', sn: 600 },  acik: true,  kos: bildirimKuyruk.kos },
  { ad: 'pending-reconcile', grup: 'dakikalik', zaman: { tip: 'periyot', sn: 60 },   acik: true,  kos: pendingReconcile.kos },
  { ad: 'broadcast',         grup: 'dakikalik', zaman: { tip: 'periyot', sn: 60 },   acik: true,  kos: broadcast.kos },
  { ad: 'genreq-supurucu',   grup: 'dakikalik', zaman: { tip: 'periyot', sn: 120 },  acik: true,  kos: genreqSupurucu.kos },
  // 04.09: telefonda takılan otomatik videoları 6 saat sonra buluta devreder (bkz. yerelq-bekcisi.ts)
  { ad: 'yerelq-bekcisi',    grup: 'on_dk',     zaman: { tip: 'periyot', sn: 600 },  acik: true,  kos: yerelqBekcisi.kos },
  { ad: 'rearm',             grup: 'dakikalik', zaman: { tip: 'dakika', dakikalar: [5, 35] }, acik: true, kos: rearm.kos },
  { ad: 'olay-watch',        grup: 'dakikalik', zaman: { tip: 'dakika', dakikalar: [3, 18, 33, 48] }, acik: true, kos: olayWatch.kos },
  { ad: 'review-state',      grup: 'dakikalik', zaman: { tip: 'periyot', sn: 720 },  acik: false, kos: reviewState.kos }, // sunucuda DISABLED — kapalı portlandı (tasks.json unit_durum)
  { ad: 'render-bekci',      grup: 'on_dk',     zaman: { tip: 'periyot', sn: 600 },  acik: true,  kos: renderBekci.kos },
  { ad: 'grupsurus',         grup: 'on_dk',     zaman: { tip: 'periyot', sn: 600 },  acik: true,  kos: grupsurus.kos },
  { ad: 'integrity-auto',    grup: 'on_dk',     zaman: { tip: 'periyot', sn: 1800 }, acik: true,  kos: integrityAuto.kos },
  { ad: 'yorum-watch',       grup: 'on_dk',     zaman: { tip: 'periyot', sn: 1800 }, acik: true,  kos: yorumWatch.kos },
  { ad: 'video-kontrol',     grup: 'saatlik',   zaman: { tip: 'saatmod', mod: 6 },   acik: true,  kos: videoKontrol.kos },
  { ad: 'gunluk-rapor',      grup: 'saatlik',   zaman: { tip: 'gunluk', saat: 6 },   acik: true,  kos: gunlukRapor.kos },
  // 05.09: premium TEK YÖNLÜ mandaldı (premium=0 yapan tek sorgu yoktu). Görev ÖLÇER;
  // düşürme yalnız KV 'premium-dusur' = "1" iken yapılır (bkz. premium-suresi.ts başlığı).
  { ad: 'premium-suresi',    grup: 'saatlik',   zaman: { tip: 'gunluk', saat: 7 },   acik: true,  kos: premiumSuresi.kos },
  { ad: 'hava',              grup: 'saatlik',   zaman: { tip: 'gunluk', saat: 16 },  acik: true,  kos: hava.kos },
  { ad: 'ilkvideo-nudge',    grup: 'saatlik',   zaman: { tip: 'gunluk', saat: 16 },  acik: true,  kos: ilkvideoNudge.kos },
  { ad: 'rozet',             grup: 'saatlik',   zaman: { tip: 'gunluk', saat: 18 },  acik: true,  kos: rozet.kos },
  { ad: 'kulup-karne',       grup: 'saatlik',   zaman: { tip: 'haftalik', gun: 0, saat: 16 }, acik: true, kos: kulupKarne.kos },
  { ad: 'weekly-recap',      grup: 'saatlik',   zaman: { tip: 'haftalik', gun: 0, saat: 16 }, acik: true, kos: weeklyRecap.kos },
  { ad: 'wrapped',           grup: 'saatlik',   zaman: { tip: 'yillik', ay: 12, gun: 20, saat: 15 }, acik: true, kos: wrapped.kos },

  // ── BEKÇİ KATMANI (kendi kendini onarma; hepsi ORTAM=golge'de KURU koşar, canli'da onarır) ──
  // Tempolar: kullanıcıyı en çabuk etkileyen (kuyruk) en sık; RunPod yapılandırması 10 dk;
  // imaj/D1 tutarlılığı 30 dk; bayt bütünlüğü 3 saat; uçtan uca duman testi saatlik.
  { ad: 'kuyruk-bekcisi',      grup: 'dakikalik', zaman: { tip: 'periyot', sn: 300 },  acik: true, kos: kuyrukBekcisi.kos },
  { ad: 'runpod-saglik',       grup: 'on_dk',     zaman: { tip: 'periyot', sn: 600 },  acik: true, kos: runpodSaglik.kos },
  { ad: 'imaj-surum-bekcisi',  grup: 'on_dk',     zaman: { tip: 'periyot', sn: 1800 }, acik: true, kos: imajSurumBekcisi.kos },
  { ad: 'd1-tutarlilik',       grup: 'on_dk',     zaman: { tip: 'periyot', sn: 1800 }, acik: true, kos: d1Tutarlilik.kos },
  { ad: 'kendi-kendini-test',  grup: 'saatlik',   zaman: { tip: 'periyot', sn: 3600 }, acik: true, kos: kendiKendiniTest.kos },
  { ad: 'video-butunluk',      grup: 'saatlik',   zaman: { tip: 'saatmod', mod: 3 },   acik: true, kos: videoButunluk.kos },
  // 17.09: App Attest receipt'ini Apple'da tazeler → alan 17 = dolandırıcılık risk metriği
  // (cihazın 30 günlük attest anahtarı sayısı). İstek yolunda OLAMAZ: erken çağrı 304 yer.
  { ad: 'attest-receipt',      grup: 'saatlik',   zaman: { tip: 'gunluk', saat: 9 },   acik: true, kos: attestReceipt.kos },
]

/** Bir sonraki koşum zamanı (epoch sn, UTC) — her zaman > now. */
export function sonrakiKosum(z: Zaman, now: number): number {
  const dk = 60
  switch (z.tip) {
    case 'periyot': {
      // dakika hizalı: bir sonraki 'periyot katı' dakika başı (tetikler dakika başında gelir)
      const p = Math.max(dk, Math.round(z.sn / dk) * dk)
      return (Math.floor(now / p) + 1) * p
    }
    case 'dakika': {
      const d = new Date(now * 1000)
      for (let ek = 0; ek <= 120; ek++) {
        const aday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes() + ek, 0))
        const t = Math.floor(aday.getTime() / 1000)
        if (t > now && z.dakikalar.includes(aday.getUTCMinutes())) return t
      }
      return now + 3600 // erişilmez — emniyet
    }
    case 'gunluk': {
      const d = new Date(now * 1000)
      let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), z.saat, 0, 0) / 1000
      if (t <= now) t += 86400
      return t
    }
    case 'haftalik': {
      const d = new Date(now * 1000)
      let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), z.saat, 0, 0) / 1000
      let gunFark = (z.gun - new Date(t * 1000).getUTCDay() + 7) % 7
      t += gunFark * 86400
      if (t <= now) t += 7 * 86400
      return t
    }
    case 'yillik': {
      const d = new Date(now * 1000)
      let t = Date.UTC(d.getUTCFullYear(), z.ay - 1, z.gun, z.saat, 0, 0) / 1000
      if (t <= now) t = Date.UTC(d.getUTCFullYear() + 1, z.ay - 1, z.gun, z.saat, 0, 0) / 1000
      return t
    }
    case 'saatmod': {
      const d = new Date(now * 1000)
      for (let ek = 1; ek <= 24; ek++) {
        const aday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + ek, 0, 0) / 1000
        if (new Date(aday * 1000).getUTCHours() % z.mod === 0) return aday
      }
      return now + 6 * 3600
    }
  }
}
