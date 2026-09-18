// kuyruk-bekcisi — takılan render işini kurtarır, kurtaramıyorsa KULLANICIYI KİLİTTE BIRAKMAZ.
// Faz T, 2026-08-31. Her 5 dk.
//
// NEDEN: Cloudflare Queues'un backlog'u binding'den OKUNAMAZ. Bu yüzden iş izleri KV'de tutuluyor:
//   · üretici (lib.renderKuyruk)  → 'render:kuyruk:{rid}'          {t, kaynak, mode, nokta}
//   · tüketici (movelog-dispatch) → 'dispatch:golge:{rid}'          (gölge ack izi)
//                                 → 'dispatch:bekleyen:{rid}'       (PARK: gövde saklandı, retry işe yaramaz)
//                                 → 'dispatch:park-sebep:{rid}'     {t, sebep, ...}  (14.09 — asıl sebep)
// İKİ ŞERİT:
//   A) PARK EDİLMİŞ İŞ — engel kalktıysa (bulut geri açıldı / bütçe dönemi değişti) yeniden
//      kuyrukla. 3 denemede geçmezse veya engel hiç kalkmayacaksa (track yok) →
//      failed_videos + kullanıcıya "üretilemedi" push'u (render-failed eşleniği) →
//      SONSUZ "Hazırlanıyor" ÖNLENİR.
//      Bütçe parkı (butce-aylik/gunluk): engel sürerken yeniden kuyruk/pes/push YOK — dispatch
//      zaten isiBitir ile doğru mesajı yazdı. PES_ET_SAAT bütçe sebeplerine uygulanmaz.
//   B) İZİ KAYIP KUYRUK KAYDI — üretici iz bıraktı ama tüketimin hiçbir kanıtı yok (dispatch 3 retry'ı
//      tüketip mesajı düşürmüş olabilir). Gövde KV'de olmadığı için yeniden gönderilemez → tespit +
//      bildirim + olay; pending_videos satırı varsa temizliği pending-reconcile/d1-tutarlilik yapar.
import type { GorevCtx } from '../takvim'
import type { Env } from '../env'
import { kvJson, kvJsonYaz, kvListe, renderKuyruk, simdi } from '../lib'
import { trGunu, motorOku } from '../../../ortak/src/maliyet'
import { renderFailed } from '../ic'
import { bildir, kuru, olayYaz, onar, saglamOlay } from './bekci-ortak'

const BEKCI = 'kuyruk-bekcisi'
const TAKILI_DK = 12          // bu yaştan sonra "takıldı" say (dispatch retry'ları çoktan bitmiş olur)
// 🔴 FİKS 05.09 — YANLIŞ ALARM: 12 dk tüm modlar için sabitti, ama 3B render'ı GPU'da 15-26 dakika
// sürüyor ve o süre boyunca kanıt kümesindeki dört izin (gölge/park/videos/pending) hiçbiri yok.
// ÖLÇÜLDÜ: 2026-09-05_ozet_1788594112 için "kuyruk izi kayıp" bildirimi, render BİTMEDEN
// 9 dakika ÖNCE gitti. Ağır modlarda eşik render süresinin üstüne çıkarıldı.
const AGIR_MOD_DK = 45
const takiliEsikDk = (mode?: string | null): number =>
  (mode === '3d' ? AGIR_MOD_DK : TAKILI_DK)
const MAX_DENEME = 3          // yeniden kuyruklama üst sınırı
const PES_ET_SAAT = 6         // bu yaştan sonra kurtarılamayan iş kullanıcıya 'üretilemedi' olur
const PARK_ONEK = 'dispatch:bekleyen:'
const IZ_ONEK = 'render:kuyruk:'

const PARK_SEBEP_ONEK = 'dispatch:park-sebep:'

function butceEngeli(sebep: string): boolean {
  return sebep === 'butce-aylik' || sebep === 'butce-gunluk'
}

function butceMesajTr(sebep: string): string {
  if (sebep === 'butce-aylik') return "Bu ayki video payın doldu. Ayın 1'inde sıfırlanır."
  if (sebep === 'butce-gunluk') return 'Günlük üretim kapasitesi doldu, yarın tekrar dene.'
  return 'Video üretilemedi — lütfen tekrar dene.'
}

async function parkKayitSil(env: Env, rid: string, parkKey: string): Promise<void> {
  await env.KV.delete(parkKey)
  // 18.09: taktik kalktı ama ESKİ 'dispatch:taktik:ertelendi:*' kayıtları KV'de kalmış olabilir;
  // yoldaki park'lar temizlenirken onlar da silinsin (silme yoksa no-op, zararsız).
  await env.KV.delete(`dispatch:taktik:ertelendi:${rid}`)
  await env.KV.delete(`${PARK_SEBEP_ONEK}${rid}`)
}

/** Engel kendiliğinden kalkabilir mi? (kalkmayacaksa boşuna 3 tur beklemeyiz)
 *  Mevcut sebepler: davranış değişmez. Bütçe sebepleri eklendi. */
function kurtarilabilir(sebep: string): boolean {
  // 18.09: 'endpoint-yok' / 'presign-yok' / 'ozel-muzik' taktik hattına aitti; YOLDA KALMIŞ eski
  // park kayıtları için 'endpoint-yok' ve 'presign-yok' KURTARILABİLİR bırakıldı — aksi hâlde
  // MAX_DENEME'siz doğrudan 'pes' edilir ve kullanıcıya gereksiz "üretilemedi" push'u gider.
  return sebep === 'endpoint-yok' || sebep === 'bakiye' || sebep === '' || sebep === 'presign-yok'
    || sebep === 'butce-aylik' || sebep === 'butce-gunluk'
    || sebep === 'secret-yok'  // NEDEN: MODAL_SECRET sonradan konabilir; MAX_DENEME zaten var
}

/** Engel ŞU AN kalktı mı? Bütçe: park t'sinin TR günü/ayı (dispatch trGunu / aylikButce ile aynı). */
async function engelKalkti(env: Env, sebep: string, t0: number, now: number, mode?: string | null): Promise<boolean> {
  if (sebep === 'butce-gunluk') return t0 > 0 && trGunu(t0) !== trGunu(now)
  if (sebep === 'butce-aylik') return t0 > 0 && trGunu(t0).slice(0, 7) !== trGunu(now).slice(0, 7)
  if (sebep === 'endpoint-yok') return true   // 18.09: taktik endpoint'i kalktı; 1 deneme hakkı
  if (sebep === 'secret-yok') return true  // NEDEN: sır gelince retry; MAX_DENEME pes eder
  if (sebep === 'bakiye') {
    // NEDEN: Modal 402 üretmez — motor modal ise park bakiye yüzünden beklemesin.
    if ((await motorOku(env.KV)) === 'modal') return true
    return (await env.KV.get('bulut-kapali')) === null
  }
  if (sebep === '') return (await env.KV.get('bulut-kapali')) === null
  if (sebep === 'presign-yok') return true            // yapılandırma düzelmiş olabilir; 1 deneme hakkı
  return false                                         // ozel-muzik / user-yok / track-yok: veri eksik
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  let kurtarilan = 0, pesEdilen = 0, izsiz = 0

  // ═══ ŞERİT A: park edilmiş işler ═══
  const parkKeys = await kvListe(env, PARK_ONEK, 300)
  for (const k of parkKeys) {
    const rid = k.slice(PARK_ONEK.length)
    if (!rid) continue
    const govde = await kvJson<Record<string, unknown> | null>(env, k, null)
    const park = await kvJson<{ t?: number; sebep?: string }>(env, `${PARK_SEBEP_ONEK}${rid}`, {})
    // 18.09: taktik kalktı, bu anahtar artık YAZILMIYOR. Ama TTL 7 gün — bu deploy'dan ÖNCE
    // park edilmiş işlerin sebep/t bilgisi hâlâ burada olabilir; drenaj penceresi boyunca okunur.
    const ert = await kvJson<{ t?: number; sebep?: string }>(env, `dispatch:taktik:ertelendi:${rid}`, {})
    const sebep = String(park.sebep ?? ert.sebep ?? '')
    // yaş: park-sebep t > erteleme izi > üretici izi > ilk görülme
    const izT = (await kvJson<{ t?: number }>(env, `${IZ_ONEK}${rid}`, {})).t
    let t0 = Number(park.t ?? ert.t ?? izT ?? 0)
    if (!t0) {
      t0 = await kvJson<number>(env, `bekci:kuyruk:ilk:${rid}`, 0)
      if (!t0) { await kvJsonYaz(env, `bekci:kuyruk:ilk:${rid}`, now, 8 * 86400); t0 = now }
    }
    const yas = now - t0
    if (yas < TAKILI_DK * 60) { log(`park ${rid}: taze (${yas}s) — bekle`); continue }

    const deneme = await kvJson<number>(env, `bekci:kuyruk:deneme:${rid}`, 0)
    const parkMode = typeof govde?.mode === 'string' ? govde.mode : null
    const kalkti = await engelKalkti(env, sebep, t0, now, parkMode)

    // Bütçe engeli sürerken: yeniden kuyruklama YOK, pes YOK, push YOK — yalnız log.
    if (butceEngeli(sebep) && !kalkti) {
      log(`park ${rid}: bütçe engeli sürüyor (${sebep}), yaş ${yas}s — bekleniyor`)
      continue
    }

    // — kurtarma denemesi —
    if (govde && kalkti && deneme < MAX_DENEME && kurtarilabilir(sebep)) {
      const temiz = { ...govde }
      const eskiRid = String(temiz.ride_id ?? rid)
      temiz.ride_id = eskiRid.startsWith('golge:') ? eskiRid.slice(6) : eskiRid  // çift önek olmasın
      const s = await onar(c, {
        bekci: BEKCI, tespit: `park-is-kurtarma${sebep ? ':' + sebep : ''}`,
        aksiyon: `RENDER_Q'ya yeniden gönder (deneme ${deneme + 1}/${MAX_DENEME}) + park kayıtları silinir`,
        detay: { rid, sebep, yas_sn: yas, deneme: deneme + 1, mode: govde.mode ?? null },
        kuruGecit: rid,
        uygula: async () => {
          await renderKuyruk(env, temiz, 'kuyruk-bekcisi')
          await kvJsonYaz(env, `bekci:kuyruk:deneme:${rid}`, deneme + 1, 8 * 86400)
          await parkKayitSil(env, rid, k)
        },
        dogrula: async () => (await env.KV.get(k)) === null,
      })
      if (s === 'onarildi' || s === 'kuru') kurtarilan++
      continue
    }

    // — pes: kullanıcıyı kilitte bırakma —
    // PES_ET_SAAT bütçe sebeplerine UYGULANMAZ (engel kalkınca deneme sayacıyla kurtarılır).
    const pesSebebi = !kurtarilabilir(sebep) ? `engel kalıcı (${sebep})`
      : deneme >= MAX_DENEME ? `${MAX_DENEME} deneme geçmedi`
        : (!butceEngeli(sebep) && yas > PES_ET_SAAT * 3600)
          ? `${PES_ET_SAAT} saattir engel kalkmadı (${sebep || 'bilinmiyor'})` : ''
    if (!pesSebebi) { log(`park ${rid}: engel sürüyor (${sebep}), yaş ${yas}s — bekleniyor`); continue }

    const vid = String(govde?.vid ?? govde?.ride_id ?? rid).replace(/^golge:/, '')
    const uid = (govde?.user as string) ?? null
    const oto = !!govde?.oto
    const failMsg = butceEngeli(sebep) ? butceMesajTr(sebep) : 'Video üretilemedi — lütfen tekrar dene.'
    const kullaniciPush = !(oto && butceEngeli(sebep))
    const s = await onar(c, {
      bekci: BEKCI, tespit: `park-is-pes:${sebep || 'bilinmiyor'}`,
      aksiyon: `render-failed: pending_videos'tan çıkar → failed_videos` +
        (kullaniciPush ? ` + kullanıcıya "${failMsg.slice(0, 40)}" push'u` : ' (oto+bütçe: push yok)') +
        ` (${pesSebebi})`,
      detay: { rid, vid, uid, sebep, yas_sn: yas, deneme, oto },
      kuruGecit: rid,
      uygula: async () => {
        await renderFailed(env, vid, uid, failMsg, kullaniciPush)
        await parkKayitSil(env, rid, k)
        await env.KV.delete(`bekci:kuyruk:deneme:${rid}`)
      },
      dogrula: async () =>
        (await env.DB.prepare('SELECT 1 x FROM failed_videos WHERE vid = ?1').bind(vid).first()) !== null,
    })
    if (s === 'onarildi' || s === 'kuru') pesEdilen++
    await bildir(c, {
      bekci: BEKCI, tespit: 'is-uretilemedi', saat: 6,
      msg: kullaniciPush
        ? `🚫 Bir video üretilemedi ve kullanıcıya bildirildi: ${vid.slice(0, 34)} (${pesSebebi}).`
        : `🚫 Bir video üretilemedi (oto+bütçe, kullanıcı push yok): ${vid.slice(0, 34)} (${pesSebebi}).`,
      detay: { vid, sebep },
    })
  }

  // ═══ ŞERİT B: izi kayıp kuyruk kayıtları ═══
  const izKeys = await kvListe(env, IZ_ONEK, 500)
  for (const k of izKeys) {
    const id = k.slice(IZ_ONEK.length)
    if (!id) continue
    const iz = await kvJson<{ t?: number; kaynak?: string; mode?: string }>(env, k, {})
    const yas = now - Number(iz.t ?? 0)
    if (!iz.t || yas < takiliEsikDk(iz.mode) * 60) continue
    if ((await env.KV.get(`bekci:kuyruk:izsiz:${id}`)) !== null) continue   // bir kez raporlandı
    const cip = id.replace(/^golge:/, '')
    const kanit =
      (await env.KV.get(`dispatch:golge:${id}`)) !== null ||                // gölge ack izi
      (await env.KV.get(`${PARK_ONEK}${id}`)) !== null ||                   // bilinçli park
      (await env.DB.prepare('SELECT 1 x FROM videos WHERE rid = ?1 OR rid = ?2').bind(id, cip).first()) !== null ||
      (await env.DB.prepare('SELECT 1 x FROM pending_videos WHERE vid = ?1 OR vid = ?2').bind(id, cip).first()) !== null
    if (kanit) continue
    izsiz++
    await kvJsonYaz(env, `bekci:kuyruk:izsiz:${id}`, now, 7 * 86400)
    await olayYaz(env, {
      bekci: BEKCI, tespit: 'kuyruk-izi-kayip',
      aksiyon: 'yeniden gönderilemez (gövde KV\'de yok) — tespit kaydedildi, bildirim kuyruğuna',
      sonuc: kuru(env) ? 'kuru' : 'bildirildi',
      detay: { rid: id, yas_sn: yas, kaynak: iz.kaynak ?? null, mode: iz.mode ?? null },
    })
    await bildir(c, {
      bekci: BEKCI, tespit: 'kuyruk-izi-kayip-bildirim', saat: 6,
      msg: `🕳️ Kuyruğa bırakılan iş tüketilmemiş görünüyor: ${id.slice(0, 40)} ` +
        `(yaş ${Math.round(yas / 60)} dk, kaynak ${iz.kaynak ?? '?'}). Gövde saklanmadığı için yeniden gönderilemedi.`,
      detay: { rid: id },
    })
  }

  if (!kurtarilan && !pesEdilen && !izsiz) {
    await saglamOlay(env, BEKCI, 'kuyruk-temiz', { park: parkKeys.length, iz: izKeys.length })
  }
  log(`park=${parkKeys.length} iz=${izKeys.length} · kurtarılan=${kurtarilan} pes=${pesEdilen} izsiz=${izsiz}`)
  await kvJsonYaz(env, 'bekci:kuyruk:son', { t: simdi(), park: parkKeys.length, iz: izKeys.length, kurtarilan, pesEdilen, izsiz }, 7 * 86400)
}
