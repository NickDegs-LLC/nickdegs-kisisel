// runpod-saglik — RunPod endpoint bekçisi (Faz T, 2026-08-31). Her 10 dk.
//
// NE ONARIR:
//   1) wmax=0 SESSİZ ARIZASI (bilinen tuzak: endpoint 0'da kalınca /run 409 verir, videolar sessizce
//      durur — reference_runpod_wmax_sifir). Her BİLİNEN endpoint için ayrı ayrı bakılır
//      (movelog-render + movelog-tactical). En son görülen >0 değer KV'de saklanır; 0 görülünce
//      PATCH ile o değere geri açılır ve RE-GET ile DOĞRULANIR.
//   2) Bakiye eşiği → bildirim; kritik eşik → KV 'bulut-kapali' bayrağı (activity-detect bu bayrağı
//      okuyup Premium işi TELEFONA yönlendirir — bekçi 'kuyruğu telefona yönlendirme bayrağı').
//   3) /health 402 (bakiye bitti) → aynı bayrak + bildirim.
//   4) Taktik endpoint HİÇ YOKSA (RunPod worker kotası 20/20 — runpod-tactical.conf) → onarılamaz,
//      Barış'a bildirim + olay. Kota açılınca id wrangler.toml RUNPOD_ENDPOINT_TAC'a yazılır.
//   5) MIG BEKÇİSİ (2026-09-01, Barış "kur"): movelog-render'ın gpuIds'inde MIG dışlaması duruyor mu +
//      worker'lardan biri MIG dilimi mi? İkisi de TESPİT+BİLDİRİM (onarım YOK — aşağıda gerekçe).
//
// 🔴 KURU MOD: ORTAM != 'canli' iken RunPod'a HİÇBİR fetch yapılmaz (bakiye korunur) — yalnız
//    'YAPARDIM' kayıtları düşer. render-bekci.ts ile AYNI mutlak kural.
//
// SAHİPLİK KİRASI: bu bekçi her turun sonunda KV 'bekci:runpod:sahip' anahtarını 1 saat TTL ile
// yeniler. render-bekci o anahtarı görürse kendi wmax/bakiye bloklarını ATLAR (çift PATCH + çift
// bildirim olmaz). Bu bekçi ölürse kira 1 saatte düşer ve render-bekci görevi OTOMATİK devralır.
import type { GorevCtx } from '../takvim'
import { kvJson, kvJsonYaz } from '../lib'
import { bildir, endpointler, kuru, kuruOlay, olayYaz, onar, rpBakiye, rpGpuDurum, rpHealth, rpRest, saglamOlay } from './bekci-ortak'

const BEKCI = 'runpod-saglik'
// 🔴 07.09 — ERKEN UYARI. Eşik 2.0'dı; o noktada ~5 video kalıyor ve Barış'ın planı
// "bakiye bitince Modal'a geçeriz". Geçiş işi (GL testi + handler sarma + dispatch dalı +
// doğrulama) 5 videoluk pencereye SIĞMAZ. Eşik, ölçülen aylık gidişe (~$9,75) göre yaklaşık
// 2,5 haftalık hazırlık payı bırakacak şekilde yükseltildi.
// ⚠️ Bu YALNIZCA uyarı eşiği — bulutu kapatan sert eşik (BULUT_KAPALI_ESIK) DEĞİŞMEDİ,
// yani üretim erken durmaz, sadece haber erken gelir.
const BAKIYE_ESIK = 6.0
const BULUT_KAPALI_ESIK = 0.5  // altında telefona yönlendir
export const SAHIP_ANAHTAR = 'bekci:runpod:sahip'
const KIRA_SN = 3600
// MIG dışlaması — endpoint gpuIds'inde bu token '-' önekli DURMALI (version 159, GraphQL saveEndpoint ile kondu).
// Kök neden: RunPod 24GB havuzuna Blackwell MIG dilimini ekledi; MIG'de OpenGL/EGL yok → Chrome llvmpipe (CPU)
// → 3B render kare kare sürünür, 180sn "harita hazır" zaman aşımı → flyover (reference_runpod_mig_tuzagi).
const MIG_DISLAMA = '-NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb'

type EpDurum = { workersMax?: number; templateId?: string; name?: string }

export async function kos(c: GorevCtx): Promise<void> {
  const { env, log } = c
  const { bilinen, eksik } = endpointler(env)

  // ── 0) hiç kurulmamış endpoint (taktik): onarılamaz, bildir ──
  for (const e of eksik) {
    log(`${e.ad}: endpoint id YOK (kurulmamış)`)
    await bildir(c, {
      bekci: BEKCI, tespit: `endpoint-yok:${e.ad}`,
      msg: `⚠️ RunPod '${e.ad}' endpoint'i KURULU DEĞİL — o hat işi RunPod'a gönderemiyor ` +
        `(iş kaybolmuyor: dispatch KV 'dispatch:bekleyen:*'e alıyor). Kota açılınca ` +
        `endpoint-kur.py + wrangler.toml RUNPOD_ENDPOINT_TAC.`,
      konu: 'Move Log Bekçi', saat: 24, detay: { endpoint: e.ad, wmax_plani: e.wmaxVars },
    })
  }

  // ── KURU TUR: RunPod'a dokunulmaz ──
  if (kuru(env) || !env.RUNPOD_API_KEY) {
    const neden = kuru(env) ? 'ORTAM=golge' : 'RUNPOD_API_KEY yok'
    const bayrak = (await env.KV.get('bulut-kapali')) !== null
    for (const e of bilinen) {
      await kuruOlay(env, BEKCI, `wmax-kontrol:${e.ad}`,
        `GET /endpoints/${e.id} → workersMax==0 ise PATCH workersMax=` +
        `${(await kvJson<number>(env, `bekci:runpod:wmax:${e.id}`, e.wmaxVars))} + RE-GET doğrulama`,
        { endpoint: e.ad, id: e.id, neden })
    }
    await kuruOlay(env, BEKCI, 'bakiye-kontrol',
      `GraphQL clientBalance (UA=movelog-bekci/1.0) → <$${BAKIYE_ESIK} uyarı, ` +
      `<$${BULUT_KAPALI_ESIK} KV 'bulut-kapali' bayrağı (kuyruk telefona yönlenir)`,
      { neden, bulut_kapali_su_an: bayrak, endpoint_sayisi: bilinen.length })
    if (env.RUNPOD_ENDPOINT_ID) {
      await kuruOlay(env, BEKCI, 'mig-kontrol:movelog-render',
        `GraphQL endpoints{gpuIds pods{machine{gpuDisplayName}}} → '${MIG_DISLAMA}' dışlaması yoksa veya ` +
        `bir worker 'MIG' ise bildirim`, { id: env.RUNPOD_ENDPOINT_ID, neden })
    }
    log(`KURU (${neden}): ${bilinen.length} endpoint + bakiye + MIG kontrolü atlandı, bulut-kapali=${bayrak}`)
    await kvJsonYaz(env, SAHIP_ANAHTAR, { bekci: BEKCI, t: Math.floor(Date.now() / 1000) }, KIRA_SN)
    return
  }

  // ── 1) her endpoint: wmax + /health ──
  for (const e of bilinen) {
    try {
      const cfg = (await rpRest(env, `/endpoints/${e.id}`)) as EpDurum
      const wmax = Number(cfg.workersMax ?? -1)
      if (wmax > 0) {
        await kvJsonYaz(env, `bekci:runpod:wmax:${e.id}`, wmax)          // son bilinen iyi değer
        await saglamOlay(env, BEKCI, `wmax:${e.ad}`, { id: e.id, workersMax: wmax, template: cfg.templateId })
        log(`${e.ad}: workersMax=${wmax} ✓`)
      } else if (wmax === 0) {
        const eski = await kvJson<number>(env, `bekci:runpod:wmax:${e.id}`, e.wmaxVars)
        await onar(c, {
          bekci: BEKCI, tespit: `wmax-sifir:${e.ad}`,
          aksiyon: `PATCH /endpoints/${e.id} workersMax=${eski} (sessiz arıza açıldı)`,
          detay: { id: e.id, eski_deger: eski },
          uygula: async () => { await rpRest(env, `/endpoints/${e.id}`, 'PATCH', { workersMax: eski }) },
          dogrula: async () => Number(((await rpRest(env, `/endpoints/${e.id}`)) as EpDurum).workersMax ?? 0) > 0,
        })
        await bildir(c, {
          bekci: BEKCI, tespit: `wmax-sifir-bildirim:${e.ad}`,
          msg: `⚠️ RunPod '${e.ad}' KAPALIYDI (workersMax=0) — bekçi ${eski}'e geri açtı. ` +
            `Video üretimi durmuştu, şimdi akıyor.`, saat: 1, detay: { id: e.id },
        })
      }
    } catch (err) {
      await olayYaz(env, {
        bekci: BEKCI, tespit: `endpoint-okunamadi:${e.ad}`, aksiyon: 'okuma denendi, sonraki tura bırakıldı',
        sonuc: 'basarisiz', detay: { id: e.id, hata: String(err).slice(0, 200) },
      })
    }
    // /health — 402 = bakiye bitti (RunPod bu kodu döndürünce hiçbir iş kabul edilmez)
    try {
      const h = await rpHealth(env, e.id)
      if (h.status === 402) {
        await bulutKapat(c, `${e.ad} /health 402`, { endpoint: e.ad })
      } else if (h.status >= 400) {
        await olayYaz(env, {
          bekci: BEKCI, tespit: `health-hata:${e.ad}`, aksiyon: 'sonraki tura bırakıldı',
          sonuc: 'basarisiz', detay: { id: e.id, status: h.status },
        })
      } else {
        const w = (h.j?.workers ?? {}) as Record<string, number>
        const j = (h.j?.jobs ?? {}) as Record<string, number>
        await saglamOlay(env, BEKCI, `health:${e.ad}`, { id: e.id, workers: w, jobs: j })
      }
    } catch (err) {
      log(`${e.ad}: /health okunamadı — ${String(err).slice(0, 100)}`)
    }
  }

  // ── 2) bakiye ──
  try {
    const bak = await rpBakiye(env)
    const bayrak = (await env.KV.get('bulut-kapali')) !== null
    if (bak === null) {
      await olayYaz(env, { bekci: BEKCI, tespit: 'bakiye-bos-dondu', aksiyon: 'sonraki tur', sonuc: 'basarisiz' })
    } else if (bak < BULUT_KAPALI_ESIK) {
      if (!bayrak) await bulutKapat(c, `bakiye $${bak.toFixed(2)}`, { bakiye: bak })
    } else if (bayrak) {
      await onar(c, {
        bekci: BEKCI, tespit: 'bulut-kapali-geri-ac',
        aksiyon: `KV 'bulut-kapali' bayrağı SİLİNDİ (bakiye $${bak.toFixed(2)}) — kuyruk buluta döndü`,
        detay: { bakiye: bak },
        uygula: async () => { await env.KV.delete('bulut-kapali') },
        dogrula: async () => (await env.KV.get('bulut-kapali')) === null,
      })
      await bildir(c, { bekci: BEKCI, tespit: 'bulut-acildi', saat: 1,
        msg: `☁️ Bulut yeniden açıldı (bakiye $${bak.toFixed(2)}) — videolar buluta döndü.` })
    } else if (bak < BAKIYE_ESIK) {
      await bildir(c, { bekci: BEKCI, tespit: 'bakiye-dusuk', saat: 12,
        msg: `💳 RunPod bakiyesi düşük: $${bak.toFixed(2)} (eşik $${BAKIYE_ESIK}). ` +
          `Ölçülen gidişle ~${Math.max(0, Math.round(bak / 0.375))} adet 3B video kaldı. ` +
          `PLAN (Barış 07.09): bakiye bitince Modal'a geçilecek — hazır test /opt/matrix/modal/gl_test.py, ` +
          `eksik: read:packages yetkili GitHub PAT.`,
        detay: { bakiye: bak } })
    } else {
      await saglamOlay(env, BEKCI, 'bakiye', { bakiye: bak })
    }
    log(`bakiye: ${bak === null ? '?' : '$' + bak.toFixed(2)}`)
  } catch (err) {
    await olayYaz(env, {
      bekci: BEKCI, tespit: 'bakiye-okunamadi', aksiyon: 'sonraki tur (3 turda bildirilir)',
      sonuc: 'basarisiz', detay: { hata: String(err).slice(0, 200) },
    })
  }

  // ── 3) MIG bekçisi — yalnız movelog-render (GPU endpoint; taktik CPU'dur, MIG derdi yok) ──
  if (env.RUNPOD_ENDPOINT_ID) await migKontrol(c, env.RUNPOD_ENDPOINT_ID)

  await kvJsonYaz(env, SAHIP_ANAHTAR, { bekci: BEKCI, t: Math.floor(Date.now() / 1000) }, KIRA_SN)
}

/**
 * MIG bekçisi: iki tespit, ikisi de BİLDİRİM (oto-onarım yok).
 *   a) DIŞLAMA DRIFT'İ — gpuIds'de MIG_DISLAMA token'ı yoksa (ya da '-'siz bir MIG token'ı havuza girmişse).
 *      Onarım = GraphQL saveEndpoint, TÜM alanlarıyla (id,name,templateId,gpuIds,idleTimeout,scaler*,workers*,
 *      networkVolumeId,locations); eksik/yanlış alan endpoint'i bozar, REST PATCH ise no-op → Barış'a bırakılır.
 *   b) MIG WORKER — pod'lardan birinin gpuDisplayName'i 'MIG' içeriyorsa dışlama delinmiş demektir. Worker
 *      öldürülmez (koşan işi keser); iş zaten glhealth'te yakalanmalı (imaj tarafı), burası kanıt + bildirim.
 *   REST /endpoints bu bilgiyi VERMEZ (gpuTypeIds'te MIG görünmüyordu) — bu yüzden GraphQL.
 */
async function migKontrol(c: GorevCtx, id: string): Promise<void> {
  const { env, log } = c
  let d
  try {
    d = await rpGpuDurum(env, id)
  } catch (err) {
    await olayYaz(env, {
      bekci: BEKCI, tespit: 'mig-okunamadi', aksiyon: 'GraphQL okunamadı, sonraki tura bırakıldı',
      sonuc: 'basarisiz', detay: { id, hata: String(err).slice(0, 200) },
    })
    return
  }
  if (!d) {
    await olayYaz(env, {
      bekci: BEKCI, tespit: 'mig-endpoint-yok', aksiyon: 'GraphQL endpoints listesinde id yok, sonraki tur',
      sonuc: 'basarisiz', detay: { id },
    })
    return
  }
  const tokenlar = d.gpuIds.split(',').map((t) => t.trim()).filter(Boolean)
  const dislamaVar = tokenlar.includes(MIG_DISLAMA)
  const migHavuzda = tokenlar.filter((t) => !t.startsWith('-') && /MIG/i.test(t))
  const migPodlar = d.pods.filter((p) => /MIG/i.test(p.gpu))
  // GPU dağılımı (kanıt/iz): {"RTX A4500": 9, "RTX 4000 Ada": 2, ...}
  const dagilim: Record<string, number> = {}
  for (const p of d.pods) dagilim[p.gpu] = (dagilim[p.gpu] ?? 0) + 1
  const detay = { id, version: d.version, gpuIds: d.gpuIds, dagilim, pod_sayisi: d.pods.length }

  if (!dislamaVar || migHavuzda.length) {
    log(`MIG DIŞLAMASI YOK/DELİK (version ${d.version}): ${d.gpuIds}`)
    await bildir(c, {
      bekci: BEKCI, tespit: 'mig-dislama-dustu', saat: 6,
      msg: `🔴 RunPod movelog-render gpuIds'de MIG dışlaması ${dislamaVar ? 'delinmiş' : 'YOK'} (version ${d.version})` +
        (migHavuzda.length ? ` — havuzda: ${migHavuzda.join(' | ')}` : '') +
        `. 3B videolar MIG dilimine düşüp llvmpipe'a (CPU, ~50x yavaş → flyover) kayabilir. ` +
        `Onarım: GraphQL saveEndpoint ile '${MIG_DISLAMA}' dışlamasını geri ekle (REST PATCH işe yaramaz; ` +
        `bkz memory reference_runpod_mig_tuzagi). Bekçi endpoint'i kendisi yazmaz.`,
      detay,
    })
  } else {
    await saglamOlay(env, BEKCI, 'mig-dislama', detay)
  }

  if (migPodlar.length) {
    const liste = migPodlar.map((p) => `${p.id} (${p.durum}, ${p.gpu})`).join(', ')
    log(`MIG WORKER VAR: ${liste}`)
    await bildir(c, {
      bekci: BEKCI, tespit: 'mig-worker', saat: 3,
      msg: `🔴 movelog-render'da MIG worker görüldü: ${liste}. MIG'de OpenGL yok → o worker'daki 3B render ` +
        `llvmpipe'a düşer (kare kare sürünür / flyover). Dışlama delinmiş; gpuIds'i ve RunPod havuzunu kontrol et. ` +
        `Bekçi worker'ı öldürmez (koşan işi keser).`,
      detay: { ...detay, mig_podlar: migPodlar },
    })
  } else {
    await saglamOlay(env, BEKCI, 'mig-worker', { id, dagilim })
  }
  const ozet = Object.entries(dagilim).map(([g, n]) => `${g}×${n}`).join(', ') || 'worker yok'
  log(`MIG: dışlama ${dislamaVar ? '✓' : 'YOK'} (v${d.version}), MIG worker ${migPodlar.length}, GPU'lar: ${ozet}`)
}

/** Bulutu kapat: KV bayrağı + bildirim. Bayrak = 'kuyruğu telefona yönlendir' (activity-detect okur). */
async function bulutKapat(c: GorevCtx, neden: string, detay: Record<string, unknown>): Promise<void> {
  const { env } = c
  await onar(c, {
    bekci: BEKCI, tespit: 'bulut-kapatilmali',
    aksiyon: `KV 'bulut-kapali' bayrağı KONDU (${neden}) — Premium işler TELEFONDA üretilecek`,
    detay,
    uygula: async () => { await kvJsonYaz(env, 'bulut-kapali', neden) },
    dogrula: async () => (await env.KV.get('bulut-kapali')) !== null,
  })
  await bildir(c, {
    bekci: BEKCI, tespit: 'bulut-kapandi', saat: 6,
    msg: `📱 Bulut kapatıldı (${neden}) — Premium videolar artık TELEFONDA üretilecek. ` +
      `Bakiye yüklenince otomatik buluta döner.`, detay,
  })
}
