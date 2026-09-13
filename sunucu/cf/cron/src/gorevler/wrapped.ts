// wrapped — movelog-wrapped.py (36 satır) portu. Yılda 1 kez: 20 Aralık 15:00 UTC (16:00 CET).
// Tüm apns'li kullanıcılara kendi dilinde 'Ride Wrapped hazır' duyurusu (kuru: push:bekleyen).
import type { GorevCtx } from '../takvim'
import { pushBekleyen } from '../lib'

const T: Record<string, string> = {
  en: 'Your 2026 Ride Wrapped is here 🎁', tr: '2026 Sürüş Özetin hazır 🎁', es: 'Tu resumen 2026 está listo 🎁',
  fr: 'Ton bilan 2026 est prêt 🎁', de: 'Dein Jahresrückblick 2026 ist da 🎁', it: 'Il tuo riepilogo 2026 è pronto 🎁',
  pt: 'Sua retrospectiva 2026 chegou 🎁', ru: 'Твои итоги 2026 готовы 🎁', ja: '2026ライドまとめが完成🎁',
  zh: '你的2026骑行年报来了 🎁', ko: '2026 라이딩 결산 도착 🎁', ar: 'ملخص 2026 جاهز 🎁', hi: 'आपका 2026 राइड रैप्ड तैयार 🎁',
}
const B: Record<string, string> = {
  en: 'Total km, longest ride, night rides, badges - your whole year on two wheels. Open your profile and see it!',
  tr: 'Toplam km, en uzun sürüş, gece turları, rozetler - iki teker üstündeki bütün yılın. Profilini aç ve gör!',
  es: 'Km totales, ruta más larga, noches, insignias - todo tu año sobre dos ruedas. ¡Ábrelo en tu perfil!',
  fr: 'Km totaux, plus longue ride, nuits, badges - toute ton année sur deux roues. Ouvre ton profil !',
  de: 'Gesamt-km, längste Fahrt, Nachtfahrten, Abzeichen - dein ganzes Jahr auf zwei Rädern. Öffne dein Profil!',
  it: 'Km totali, giro più lungo, notturne, badge - tutto il tuo anno su due ruote. Apri il profilo!',
  pt: 'Km totais, rolê mais longo, noturnos, insígnias - seu ano inteiro sobre duas rodas. Abra seu perfil!',
  ru: 'Общий километраж, самая длинная поездка, ночные выезды, значки - весь твой год на двух колёсах!',
  ja: '総距離、最長ライド、ナイトライド、バッジ - 二輪の一年をプロフィールでチェック！',
  zh: '总里程、最长骑行、夜骑、徽章 - 你在两个轮子上的一整年。打开个人资料看看！',
  ko: '총 킬로미터, 최장 라이딩, 나이트 라이딩, 배지 - 두 바퀴 위의 한 해. 프로필에서 확인하세요!',
  ar: 'إجمالي الكيلومترات، أطول رحلة، الليلية، الشارات - سنتك كلها على عجلتين. افتح ملفك الشخصي!',
  hi: 'कुल km, सबसे लंबी राइड, नाइट राइड्स, बैज - दो पहियों पर आपका पूरा साल। प्रोफाइल खोलें!',
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, log } = c
  const users = await env.DB.prepare(
    `SELECT DISTINCT u.uid, u.lang FROM users u JOIN push_tokens t ON t.uid = u.uid WHERE t.platform = 'apns'`)
    .all<{ uid: string; lang: string | null }>()
  for (const u of users.results) {
    const lng = u.lang || 'en'
    await pushBekleyen(env, { user: u.uid, title: T[lng] || T.en, body: B[lng] || B.en })
  }
  log(`wrapped duyurusu(kuru): ${users.results.length} kullanıcı`)
}
