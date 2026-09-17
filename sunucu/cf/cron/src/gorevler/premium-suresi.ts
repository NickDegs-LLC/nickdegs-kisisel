// premium-suresi — süresi dolmuş abonelikleri tespit eder (ve izin verilirse düşürür).
//
// NEDEN (uçtan uca tarama, 2026-09-05): `users.premium` TEK YÖNLÜ MANDAL. Tüm kod tabanında
// `SET premium = 1` var (grup6.ts:588/591/672, grup7.ts:684) ama `premium = 0` yapan TEK BİR
// sorgu YOK; cron'da da düşürme yok. `premium_until` yalnız iOS `/api/iap/verify` yolunda
// YAZILIYOR, hiçbir yerde OKUNMUYOR. Yani abonelik iptal edilse bile premium sonsuza dek açık.
//
// ⚠️ NEDEN VARSAYILAN KAPALI: doğru çözüm App Store Server Notifications (sunucu-sunucu) — o uç
// henüz yok. `premium_until` yalnız kullanıcı uygulamayı AÇTIĞINDA tazeleniyor (StoreKit
// `Transaction.updates` → /api/iap/verify). Uygulamayı bir ay açmayan ÖDEYEN bir kullanıcıyı
// yanlışlıkla kesmemek için: 7 gün ek süre + düşürme yalnız KV `premium-dusur = "1"` iken.
// Anahtar yokken görev sadece ÖLÇER ve yöneticiye rapor eder.
//
// GÜVENLİK KURALI: `premium_until IS NULL` olan satıra ASLA dokunulmaz. Bunlar promosyon,
// Android (grup6.ts:685 bilinçli olarak until yazmaz), redeem ve App Store inceleme hesaplarıdır
// (appreview / appreview2 — bunlar kesilirse uygulama incelemede reddedilir).
import type { GorevCtx } from '../takvim'
import { bildirimBekleyen, pushBekleyen, simdi } from '../lib'

// Kullanıcı bildirimi (13 dil) — abonelik bittiğinde premium kapanıyor.
const PT: Record<string, string> = {
  en: 'Your subscription ended', tr: 'Aboneliğin sona erdi', es: 'Tu suscripción ha terminado',
  fr: 'Ton abonnement a pris fin', de: 'Dein Abo ist beendet', it: 'Il tuo abbonamento è terminato',
  pt: 'Sua assinatura terminou', ru: 'Твоя подписка завершилась', ja: 'サブスクリプションが終了しました',
  zh: '你的订阅已结束', ko: '구독이 종료되었습니다', ar: 'انتهى اشتراكك', hi: 'आपकी सदस्यता समाप्त हो गई',
}
const PB: Record<string, string> = {
  en: 'Premium features are off for now. If you renewed, just open the app — it comes back automatically.',
  tr: 'Premium özellikler şimdilik kapalı. Yenilediysen uygulamayı açman yeterli — kendiliğinden geri gelir.',
  es: 'Las funciones Premium están desactivadas. Si renovaste, abre la app y volverán automáticamente.',
  fr: 'Les fonctions Premium sont désactivées. Si tu as renouvelé, ouvre l\'app — elles reviennent toutes seules.',
  de: 'Premium-Funktionen sind vorerst aus. Wenn du verlängert hast, öffne einfach die App — sie kommen automatisch zurück.',
  it: 'Le funzioni Premium sono disattivate. Se hai rinnovato, apri l\'app — tornano da sole.',
  pt: 'Os recursos Premium estão desativados. Se você renovou, abra o app — eles voltam sozinhos.',
  ru: 'Премиум-функции пока отключены. Если ты продлил, просто открой приложение — они вернутся сами.',
  ja: 'プレミアム機能は現在オフです。更新済みならアプリを開くだけで自動的に戻ります。',
  zh: '高级功能暂时关闭。如果你已续订，打开应用即可自动恢复。',
  ko: '프리미엄 기능이 꺼졌습니다. 갱신하셨다면 앱을 열기만 하면 자동으로 돌아옵니다.',
  ar: 'ميزات بريميوم متوقفة حاليًا. إذا جدّدت اشتراكك، افتح التطبيق وستعود تلقائيًا.',
  hi: 'प्रीमियम सुविधाएँ फ़िलहाल बंद हैं। यदि आपने नवीनीकरण किया है, तो ऐप खोलें — वे अपने आप वापस आ जाएँगी।',
}

// 🔴 05.09 (2. tur, adversaryel doğrulama bulgusu): 7 gün DAR. Apple'ın *billing grace period*'u
// 16 güne kadar sürebiliyor ve `premium_until` ancak kullanıcı uygulamayı açıp StoreKit
// `Transaction.updates` tetiklenince tazeleniyor (sunucu-sunucu bildirim ucu YOK). Yanlış kesme
// riskini düşürmek için 21 gün: Apple'ın en uzun grace'i + bir hafta pay.
const EK_SURE_GUN = 21
// İKİNCİ SAVUNMA KATMANI: App Store inceleme hesapları HİÇBİR koşulda düşürülmez.
// (Birinci katman `premium_until IS NULL`; bu liste o katman delinirse devreye girer —
// ör. sandbox satın alma bir şekilde bitiş tarihi yazarsa. Reddedilen bir inceleme,
// kazanılacak abonelik gelirinden çok daha pahalıdır.)
const DOKUNMA = new Set(['appreview', 'appreview2'])

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const esik = now - EK_SURE_GUN * 86400
  // 🔴 17.09 gece (migration 0011, çift katman): aktif/süresiz ULTRA'sı olan satır premium süresi dolsa da
  // DÜŞÜRÜLMEZ (Ultra ⊃ Premium; Ultra kendi tarihiyle yaşar). Ultra'nın kendi bitişi ayrıca aşağıda.
  const r = await env.DB.prepare(
    `SELECT uid, premium_until, ultra FROM users
      WHERE premium = 1 AND premium_until IS NOT NULL AND premium_until < ?1
        AND NOT (ultra = 1 AND (ultra_until IS NULL OR ultra_until >= ?2))`)
    .bind(esik, now).all<{ uid: string; premium_until: number; ultra: number | null }>()
  const dolan = r.results.filter((u) => !DOKUNMA.has(u.uid))
  const korunan = r.results.length - dolan.length
  if (korunan) log(`${korunan} inceleme hesabı korundu (düşürülmedi)`)

  const acik = (await env.KV.get('premium-dusur')) === '1'

  // ULTRA'nın kendi süresi: premium devam etse bile (yıllık Premium + aylık Ultra) Ultra ayrıca düşer.
  const ru = await env.DB.prepare(
    `SELECT uid, ultra_until FROM users
      WHERE ultra = 1 AND ultra_until IS NOT NULL AND ultra_until < ?1`)
    .bind(esik).all<{ uid: string; ultra_until: number }>()
  const ultraDolan = ru.results.filter((u) => !DOKUNMA.has(u.uid))
  if (ultraDolan.length) {
    const uo = ultraDolan.map((u) => `${u.uid} (${Math.floor((now - u.ultra_until) / 86400)} gün önce)`).join(', ')
    if (!acik) log(`⚠️ ${ultraDolan.length} ULTRA süresi dolmuş ama DÜŞÜRME KAPALI: ${uo}`)
    else {
      for (const u of ultraDolan) {
        await env.DB.prepare('UPDATE users SET ultra = 0, updated_at = ?2 WHERE uid = ?1').bind(u.uid, now).run()
        log(`ultra düşürüldü (premium kendi tarihiyle devam): ${u.uid}`)
      }
      await bildirimBekleyen(env, `💳 ${ultraDolan.length} kullanıcının ULTRA'sı süre dolduğu için düşürüldü: ${uo.slice(0, 200)}`, 'Move Log Abonelik')
    }
  }

  if (!dolan.length) { log('süresi dolmuş premium yok'); return }
  const ozet = dolan
    .map((u) => `${u.uid} (${Math.floor((now - u.premium_until) / 86400)} gün önce)`)
    .join(', ')

  if (!acik) {
    log(`⚠️ ${dolan.length} abonelik süresi dolmuş ama DÜŞÜRME KAPALI: ${ozet}`)
    await bildirimBekleyen(env,
      `💳 ${dolan.length} kullanıcının abonelik süresi ${EK_SURE_GUN}+ gün önce doldu ama premium hâlâ AÇIK ` +
      `(KV 'premium-dusur' = "1" yapılmadıkça düşürülmez): ${ozet.slice(0, 200)}`,
      'Move Log Abonelik')
    return
  }

  for (const u of dolan) {
    await env.DB.prepare('UPDATE users SET premium = 0, ultra = 0, updated_at = ?2 WHERE uid = ?1')
      .bind(u.uid, now).run()
    // Düşürme SESSİZ olmasın: kullanıcı neden özelliklerini kaybettiğini bilsin ve geri dönüş
    // yolunu görsün. Abonelik hâlâ geçerliyse uygulamayı açması premium'u geri getirir
    // (/api/iap/verify premium_until'i tazeler).
    const pr = await env.DB.prepare('SELECT lang FROM users WHERE uid = ?1').bind(u.uid)
      .first<{ lang: string | null }>()
    const l = pr?.lang || 'en'
    await pushBekleyen(env, {
      user: u.uid,
      title: PT[l] || PT.en,
      body: PB[l] || PB.en,
    })
    log(`premium düşürüldü: ${u.uid}`)
  }
  await bildirimBekleyen(env,
    `💳 ${dolan.length} kullanıcının premium'u süre dolduğu için düşürüldü: ${ozet.slice(0, 200)}`,
    'Move Log Abonelik')
}
