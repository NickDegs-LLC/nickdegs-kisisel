// yerelq-bekcisi — TELEFONDA ÜRETİLEMEYEN videoları buluta devreder.
//
// NEDEN (Barış şikayeti 04.09: "ürete basınca üretmiyor"):
// Otomatik video üretimi `activity-detect.ts:187` gereği flat/flyover modlarında KOŞULSUZ olarak
// telefonun yerel kuyruğuna (KV `yerelq:<uid>`) yazılıyor — bulut maliyeti sıfır olsun diye
// (Barış'ın 26.08 kararı: "bakiye yüklemekten sıkıldım"). Telefon o işi ancak uygulama AÇIKKEN
// üretebiliyor. Uygulama kapalıysa/yükleme hata alırsa iş kuyrukta ÖYLECE KALIYOR:
//   · kurtaran hiçbir mekanizma YOKTU (cron+api genelinde arandı)
//   · `/api/local-renders` 7 günden eskileri sessizce süzüyor → iş yok oluyor
//   · `failed_videos`'a bile düşmüyor → kullanıcı ne video ne hata görüyor
// ÖLÇÜLDÜ 04.09: Semra'nın kuyruğunda 5 iş bekliyordu (03.09'dan 04.09'a), 4'ünün videosu HİÇ
// üretilmemişti; biri telefon yüklemesinde 503 alıp iz bırakmadan kaybolmuştu.
//
// DAVRANIŞ: telefona ÖNCELİK verilir (maliyet sıfır kalsın). Ancak iş YAS_SN'den eskiyse
// telefon bu işi yapamayacak demektir → buluta devredilir ve yerel kuyruktan düşer.
// Bu, "bedava ama belki hiç" yerine "önce bedava dene, olmazsa üret" davranışıdır.
import type { GorevCtx } from '../takvim'
import { kvJson, kvJsonYaz, kvListe, renderKuyruk, simdi } from '../lib'

const YAS_SN = 6 * 3600      // 6 saat: telefon bir gün içinde birkaç kez açılır; açılmadıysa üretmeyecek
const TUR_TAVAN = 3          // tek turda en fazla 3 devir — ani maliyet patlaması olmasın

export async function kos(c: GorevCtx): Promise<void> {
  const { env, log } = c
  const simdiTs = simdi()
  const anahtarlar = await kvListe(env, 'yerelq:', 200)
  if (!anahtarlar.length) { log('yerel kuyruk boş'); return }
  let devredilen = 0, bekleyen = 0, incelenen = 0

  for (const anahtar of anahtarlar) {
    if (devredilen >= TUR_TAVAN) break
    const uid = anahtar.slice('yerelq:'.length)
    if (!uid) continue
    const lst = await kvJson<Record<string, unknown>[]>(env, anahtar, [])
    if (!Array.isArray(lst) || !lst.length) continue
    incelenen += lst.length

    const kalan: Record<string, unknown>[] = []
    for (const is of lst) {
      // `ts` işin kuyruğa girdiği an; yoksa rotanın bitişi (`to`) taban alınır.
      const kuyrukTs = Math.trunc(Number(is.ts ?? is.to ?? 0)) || 0
      const yas = kuyrukTs ? simdiTs - kuyrukTs : 0
      if (devredilen >= TUR_TAVAN || !kuyrukTs || yas < YAS_SN) {
        if (kuyrukTs && yas < YAS_SN) bekleyen++
        kalan.push(is)
        continue
      }
      // 🔴 PARA KORUMASI: video ZATEN ÜRETİLMİŞSE devretme — yoksa aynı rota için ikinci kez
      // GPU parası yanar. ÖLÇÜLDÜ 04.09: Barış'ın kuyruğunda 174 saatlik iki iş vardı ve ikisinin
      // de videosu zaten mevcuttu (ts=1787903025 → 3 video, ts=1787905726 → 2 video); körü körüne
      // devir bunları yeniden üretecekti. Eşleşme `videos.ts` = rotanın başlangıcı üzerinden.
      const baslangic = Math.trunc(Number(is.from ?? 0)) || 0
      if (baslangic) {
        // ⚠️ uid filtresi ŞART: uid'siz sorgu, aynı saniyede rotaya başlayan BAŞKA bir kullanıcının
        // videosunu görüp bu kullanıcının işini sessizce düşürürdü (grup/kulüp sürüşünde segment
        // başlangıçları aynı saniyeye düşebilir). idx_videos_user_ts(uid,ts) de ancak böyle kullanılır.
        const varMi = await env.DB.prepare('SELECT 1 AS x FROM videos WHERE uid = ?1 AND ts = ?2 LIMIT 1')
          .bind(uid, baslangic).first()
        if (varMi) {
          log(`atlandı (video zaten var): ${uid.slice(0, 10)}… from=${baslangic}`)
          continue                      // kuyruktan DÜŞ — telefon da üretmesin, iş bitmiş
        }
      }
      // BULUTA DEVRET — iş gövdesi zaten dispatch'in beklediği biçimde (activity-detect:175 alanları)
      try {
        const job: Record<string, unknown> = { ...is, user: uid, kaynak: 'yerelq-bekcisi' }
        const kid = await renderKuyruk(env, job, 'yerelq-bekcisi:devir')
        devredilen++
        log(`buluta devredildi: ${uid.slice(0, 10)}… from=${is.from} yaş=${Math.floor(yas / 3600)}sa → ${kid}`)
      } catch (e) {
        log(`devir başarısız (${uid.slice(0, 10)}…): ${String(e).slice(0, 120)}`)
        kalan.push(is)          // devredilemedi → kuyrukta kalsın, sonraki tur dener
      }
    }
    if (kalan.length !== lst.length) await kvJsonYaz(env, anahtar, kalan)
  }
  log(`yerel kuyruk: ${incelenen} iş incelendi, ${devredilen} buluta devredildi, ${bekleyen} telefonu bekliyor`)
}
