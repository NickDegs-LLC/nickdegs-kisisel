// imaj-surum-bekcisi — template imajı ↔ beklenen sürüm + SICAK WORKER FLUSH'u (Faz T, 2026-08-31).
// Her 30 dk.
//
// BİLİNEN TUZAK (reference_runpod_warm_worker): yeni imaj push edilip template PATCH'lense bile
// AYAKTA olan eski worker slotları sıcak kalır ve ESKİ kodu koşmaya devam eder (slot, yaratıldığı
// imajı taşır; EXITED slot bile sonraki işte YENİDEN kullanılır). Bu bekçi eski imajlı slotları
// KENDİ temizler.
//
// AKIŞ (endpoint başına):
//   GET /endpoints/{id} → templateId
//   GET /templates/{templateId} → imageName
//   · beklenen sürüm KV'de yoksa: GÖRÜLEN değer TABAN olarak kaydedilir (ilk tur, müdahale yok).
//   · imaj != beklenen  → tespit + bildirim (template'i DEĞİŞTİRMEK yapılandırma işidir; bekçi yapmaz).
//   · imaj != son flush edilen imaj → FLUSH: GraphQL pod listesinde imajı template'ten FARKLI slotlar bulunur,
//     BOŞTA (EXITED) olanlar tek tek podTerminate ile sonlandırılır → RunPod yerine güncel imajla slot kiralar.
//     ⚠️ EMNİYET: her sonlandırmadan hemen önce /health inQueue=0 ve slotun hâlâ EXITED olduğu yeniden
//     doğrulanır; iş koşan (RUNNING) eski slotlara DOKUNULMAZ, sonraki tura kalır. Eski slot kalmayınca
//     sonflush KV'ye yazılır (kalan varsa yazılmaz → 30 dk sonra kaldığı yerden devam).
//   ⚠️ NEDEN wmax 0→N DEĞİL (2026-09-01 ölçümü): anlık 0→N worker'ları BOŞALTMAZ (no-op); doğru yapılsa
//     bile ~60-70 sn karartma + /run 409 ENDPOINT_PAUSED → dispatch retry'ları yanar. podTerminate'te
//     karartma yok, endpoint version/wmax değişmez (deney: b6xr86u223pmnk → 30 sn'de v146 slot geldi).
//
// 🔴 KURU MOD: RunPod'a hiçbir fetch yok; 'YAPARDIM' kaydı düşer.
import type { GorevCtx } from '../takvim'
import { kvJson, kvJsonYaz } from '../lib'
import {
  bildir, endpointler, kuru, kuruOlay, olayYaz, onar, rpGpuDurum, rpHealth, rpPodBilgi, rpPodSonlandir, rpRest, saglamOlay,
} from './bekci-ortak'

const uyku = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const BEKCI = 'imaj-surum-bekcisi'
// Beklenen imajların KURULUM VARSAYILANI (KV'de kayıt yoksa taban olarak GÖRÜLEN değer alınır;
// bu tablo yalnız taktik hattının bilinen hedefini belgeler — runpod-tactical.conf ile aynı).
// v6 (2026-09-02, Barış "HALLET ABI"): template egptl6t4pr 31.08'den beri v6 (v2 KARO FİKSİ → v4/v5 statik
// mozaik sidecar → v6 sidecar passthrough). Taban v2'de kalınca bekçi 3 tur boyunca yanlış
// `imaj-uyusmuyor` bildirdi; KV `bekci:imaj:beklenen:yvkajd6x7mp1lj` de v6'ya çekildi.
const BILINEN_HEDEF: Record<string, string> = {
  'movelog-tactical': 'ghcr.io/nickdegs/movelog-tactical:v6',
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, log } = c
  const { bilinen } = endpointler(env)
  if (!bilinen.length) { log('bilinen endpoint yok — atlandı'); return }

  if (kuru(env) || !env.RUNPOD_API_KEY) {
    const neden = kuru(env) ? 'ORTAM=golge' : 'RUNPOD_API_KEY yok'
    for (const e of bilinen) {
      const bek = await kvJson<string>(env, `bekci:imaj:beklenen:${e.id}`, BILINEN_HEDEF[e.ad] ?? '')
      const sonflush = await kvJson<string>(env, `bekci:imaj:sonflush:${e.id}`, '')
      await kuruOlay(env, BEKCI, `imaj-kontrol:${e.ad}`,
        `GET /endpoints/${e.id} → templateId → GET /templates/{t} → imageName; ` +
        `beklenen ile karşılaştır; imaj değiştiyse eski imajlı BOŞTA slotları podTerminate ile temizle`,
        { endpoint: e.ad, id: e.id, beklenen: bek || '(taban yok)', son_flush: sonflush || '(yok)', neden })
    }
    log(`KURU (${neden}): ${bilinen.length} endpoint imaj kontrolü atlandı`)
    return
  }

  for (const e of bilinen) {
    try {
      const cfg = (await rpRest(env, `/endpoints/${e.id}`)) as { templateId?: string }
      const tid = String(cfg.templateId ?? '')
      if (!tid) {
        await olayYaz(env, { bekci: BEKCI, tespit: `template-yok:${e.ad}`, aksiyon: 'okuma sonraki tura', sonuc: 'basarisiz', detay: { id: e.id } })
        continue
      }
      const tpl = (await rpRest(env, `/templates/${tid}`)) as { imageName?: string; name?: string }
      const imaj = String(tpl.imageName ?? '')
      if (!imaj) {
        await olayYaz(env, { bekci: BEKCI, tespit: `imaj-okunamadi:${e.ad}`, aksiyon: 'sonraki tur', sonuc: 'basarisiz', detay: { id: e.id, tid } })
        continue
      }

      // — beklenen sürüm —
      let beklenen = await kvJson<string>(env, `bekci:imaj:beklenen:${e.id}`, '')
      if (!beklenen) {
        beklenen = BILINEN_HEDEF[e.ad] || imaj
        await kvJsonYaz(env, `bekci:imaj:beklenen:${e.id}`, beklenen)
        await olayYaz(env, {
          bekci: BEKCI, tespit: `imaj-taban-kaydedildi:${e.ad}`,
          aksiyon: `beklenen sürüm KV'ye yazıldı: ${beklenen}`, sonuc: 'onarildi',
          detay: { id: e.id, template: tid, gorulen: imaj },
        })
      }
      if (imaj !== beklenen) {
        await bildir(c, {
          bekci: BEKCI, tespit: `imaj-uyusmuyor:${e.ad}`, saat: 12,
          msg: `📦 RunPod '${e.ad}' template'i BEKLENENDEN farklı imaj gösteriyor:\n` +
            `  görülen : ${imaj}\n  beklenen: ${beklenen}\n` +
            `Template'i değiştirmek yapılandırma işidir — bekçi kendiliğinden DEĞİŞTİRMEDİ.`,
          detay: { id: e.id, template: tid, gorulen: imaj, beklenen },
        })
      } else {
        await saglamOlay(env, BEKCI, `imaj:${e.ad}`, { id: e.id, imaj, template: tid })
      }

      // — sıcak worker flush'u —
      const sonflush = await kvJson<string>(env, `bekci:imaj:sonflush:${e.id}`, '')
      if (!sonflush) {
        await kvJsonYaz(env, `bekci:imaj:sonflush:${e.id}`, imaj)   // ilk tur: mevcut hâli taban say
        log(`${e.ad}: flush tabanı kaydedildi (${imaj})`)
        continue
      }
      if (sonflush === imaj) { log(`${e.ad}: imaj değişmemiş, flush gerekmiyor`); continue }

      // imaj DEĞİŞMİŞ → eski imajlı slotlar sıcak kalmış olabilir. GraphQL pod listesinden bul.
      const gd = await rpGpuDurum(env, e.id)
      if (!gd) {
        await olayYaz(env, { bekci: BEKCI, tespit: `pod-listesi-yok:${e.ad}`, aksiyon: 'flush sonraki tura', sonuc: 'basarisiz', detay: { id: e.id, imaj } })
        continue
      }
      const eskiSlot = (p: { imaj: string }) => !!p.imaj && p.imaj !== imaj
      const eski = gd.pods.filter(eskiSlot)
      if (!eski.length) {
        // Slotların hepsi zaten yeni imajda (ör. elle flush edildi ya da hiç sıcak slot yoktu) → taban ilerlet.
        await kvJsonYaz(env, `bekci:imaj:sonflush:${e.id}`, imaj)
        await olayYaz(env, {
          bekci: BEKCI, tespit: `flush-gerekmedi:${e.ad}`, aksiyon: `eski imajlı slot yok, sonflush=${imaj}`,
          sonuc: 'saglam', detay: { id: e.id, eski_imaj: sonflush, yeni_imaj: imaj, slot: gd.pods.length },
        })
        continue
      }
      const bosta = eski.filter((p) => p.durum === 'EXITED')
      const kosan = eski.filter((p) => p.durum !== 'EXITED')
      if (!bosta.length) {
        await olayYaz(env, {
          bekci: BEKCI, tespit: `flush-ertelendi:${e.ad}`,
          aksiyon: `eski imajlı ${kosan.length} slot iş koşuyor (RUNNING) — dokunulmadı, sonraki tura ertelendi`,
          sonuc: 'atlandi', detay: { id: e.id, yeni_imaj: imaj, kosan: kosan.map((p) => `${p.id}:${p.imaj}`) },
        })
        continue
      }

      // onar() detay'ı uygula'dan SONRA kopyalar → aşağıdaki nesne uygula içinde doldurulur, olaya öyle düşer.
      const detay: Record<string, unknown> = {
        id: e.id, eski_imaj: sonflush, yeni_imaj: imaj, hedef: bosta.map((p) => `${p.id}:${p.imaj}`),
        kosan_dokunulmadi: kosan.map((p) => p.id),
      }
      const sonlandirilan: string[] = []
      const atlanan: string[] = []
      await onar(c, {
        bekci: BEKCI, tespit: `sicak-worker-flush:${e.ad}`,
        aksiyon: `yeni imaj (${imaj}) sonrası eski imajlı ${bosta.length} boşta slotu podTerminate ile temizle`,
        detay,
        uygula: async () => {
          for (const p of bosta) {
            // Her slot için ANLIK yeniden bakış: kuyrukta iş varsa slot ona verilebilir → bu turda dokunma.
            const h = await rpHealth(env, e.id)
            const j = (h.j?.jobs ?? {}) as Record<string, number>
            if ((j.inQueue ?? 0) > 0) { atlanan.push(`${p.id}:kuyrukta-is`); continue }
            const anlik = await rpPodBilgi(env, p.id)
            if (!anlik) { atlanan.push(`${p.id}:zaten-yok`); continue }
            if (anlik.durum !== 'EXITED') { atlanan.push(`${p.id}:${anlik.durum}`); continue }
            if (anlik.imaj === imaj) { atlanan.push(`${p.id}:imaj-guncel`); continue }
            await rpPodSonlandir(env, p.id)
            sonlandirilan.push(p.id)
            log(`${e.ad}: eski imajlı slot sonlandırıldı ${p.id} (${anlik.imaj})`)
          }
          detay.sonlandirilan = sonlandirilan
          detay.atlanan = atlanan
        },
        dogrula: async () => {
          // Sonlandırılanlar listeden düşene kadar (≤15 sn) bekle. Başarı ölçütü: eski imajlı BOŞTA slot ya
          // kalmadı ya da yalnız bu turda BİLEREK atlananlar (kuyrukta iş / o an RUNNING) kaldı.
          // Eski slot (boşta veya koşan) hiç kalmadıysa sonflush yazılır; kaldıysa yazılmaz → sonraki tur devam eder.
          const bilerekAtlanan = new Set(atlanan.map((s) => s.split(':')[0]))
          let kalanBosta: string[] = []
          let kalanKosan: string[] = []
          let yeniSlot = -1
          for (let i = 0; i < 4; i++) {
            if (i) await uyku(5000)
            const son = await rpGpuDurum(env, e.id)
            if (!son) return false
            const kalan = son.pods.filter(eskiSlot)
            kalanBosta = kalan.filter((p) => p.durum === 'EXITED').map((p) => p.id)
            kalanKosan = kalan.filter((p) => p.durum !== 'EXITED').map((p) => p.id)
            yeniSlot = son.pods.filter((p) => p.imaj === imaj).length
            if (kalanBosta.every((id) => bilerekAtlanan.has(id))) break
          }
          detay.kalan_bosta = kalanBosta
          detay.kalan_kosan = kalanKosan
          detay.yeni_imajli_slot = yeniSlot
          if (!kalanBosta.every((id) => bilerekAtlanan.has(id))) return false   // sonlandırdığımız slot hâlâ duruyor
          if (!kalanBosta.length && !kalanKosan.length) await kvJsonYaz(env, `bekci:imaj:sonflush:${e.id}`, imaj)
          return true
        },
      })
    } catch (err) {
      await olayYaz(env, {
        bekci: BEKCI, tespit: `okuma-hatasi:${e.ad}`, aksiyon: 'sonraki tura bırakıldı',
        sonuc: 'basarisiz', detay: { id: e.id, hata: String(err).slice(0, 200) },
      })
    }
  }
}
