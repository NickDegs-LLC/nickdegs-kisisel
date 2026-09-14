// maliyet — ORTAK GPU bedeli + aylık bütçe tavanı. api / dispatch / cron buradan okur;
// her worker kendi bundle'ına dahil eder (paylaşılan runtime YOK, sadece paylaşılan kaynak).
//
// NEDEN (2026-09-14): grup1.ts ve dispatch/src/index.ts aynı sayıları kopyalıyordu; biri
// güncellenince öteki geride kalıyordu. Motor (RunPod/Modal) KV `dispatch:motor` ile seçildiği
// halde bedel hep RunPod tablosundan bakılıyordu.

export type MotorAd = 'runpod' | 'modal'

// RunPod = filo ortalaması 1195 GPU-sn ≈ $0,375; Modal = 07.09 ölçümü T4 15,4 dk $0,2323
// (CPU+RAM DAHİL), yukarı yuvarlandı; flyover/flat ölçülen 40-60 GPU-sn, muhafazakâr 0,05.
export const MOTOR_MALIYET: Record<MotorAd, Record<string, number>> = {
  runpod: { '3d': 0.38, auto: 0.38, flyover: 0.05, flat: 0.05, sv: 4.9 },
  modal: { '3d': 0.24, auto: 0.24, flyover: 0.05, flat: 0.05, sv: 4.9 },
}

// GPU maliyeti ≤ aylık net gelirin %30'u (premium.monthly $4,99 → net $4,24 → %29,5;
// ultra.monthly $9,99 → net $8,49 → %29,4; Small Business Program kaydı Barış tarafından
// teyit edildi → komisyon %15).
export const BUTCE_VARSAYILAN = { premium: 1.25, ultra: 2.5 }

/** TR günü YYYY-MM-DD — dispatch trGunu / cron trGun ile aynı (UTC+3). */
export const TR_OFS = 3 * 3600
export function trGunu(ts: number): string {
  return new Date((ts + TR_OFS) * 1000).toISOString().slice(0, 10)
}

/** KV 'dispatch:motor' tırnaksız değeri === 'modal' ise 'modal', aksi/hata 'runpod'
 *  (dispatch motorSec'in render dalıyla AYNI anlam). Taktik override'a KARIŞMA. */
export async function motorOku(kv: KVNamespace): Promise<MotorAd> {
  try {
    const v = await kv.get('dispatch:motor')
    return String(v ?? '').replace(/"/g, '') === 'modal' ? 'modal' : 'runpod'
  } catch { return 'runpod' }
}

/** Motora göre tablodan bedel; tabloda yoksa `varsayilan` (çağıranların bugünkü fallback'ı:
 *  dispatch 0.1, grup1 0.02). */
export async function modMaliyet(kv: KVNamespace, mod: string, varsayilan: number): Promise<number> {
  const tablo = MOTOR_MALIYET[await motorOku(kv)]
  const n = tablo[mod]
  return Number.isFinite(n) ? n : varsayilan
}

/** KV 'butce-ultra-usd' / 'butce-premium-usd' sayı ise onu, değilse BUTCE_VARSAYILAN. */
export async function aylikButceLimit(kv: KVNamespace, ultra: boolean): Promise<number> {
  const varsayilan = ultra ? BUTCE_VARSAYILAN.ultra : BUTCE_VARSAYILAN.premium
  try {
    const v = await kv.get(ultra ? 'butce-ultra-usd' : 'butce-premium-usd')
    const n = v === null ? NaN : parseFloat(v)
    return Number.isFinite(n) && n >= 0 ? n : varsayilan
  } catch { return varsayilan }
}

// Oto iş bütçe push'u — cron/src/ic.ts VT dil kümesi (en/tr/es/fr/de/it/pt/ru/ja/zh/ko/ar/hi).
// Desen: lang || 'en' → MAP[l] || MAP.en || MAP.tr.
export const BUTCE_PUSH_AYLIK: Record<string, string> = {
  tr: "Bu ayki video payın doldu. Ayın 1'inde sıfırlanır.",
  en: "You've used this month's video allowance. It resets on the 1st.",
  es: 'Has agotado tu cuota de vídeo de este mes. Se restablece el día 1.',
  fr: 'Tu as épuisé ton quota vidéo de ce mois. Il se réinitialise le 1er.',
  de: 'Dein Videokontingent für diesen Monat ist aufgebraucht. Es wird am 1. zurückgesetzt.',
  it: 'Hai esaurito la quota video di questo mese. Si azzera il giorno 1.',
  pt: 'Você usou a cota de vídeo deste mês. Ela zera no dia 1.',
  ru: 'Месячная квота видео исчерпана. Сброс — 1-го числа.',
  ja: '今月の動画枠を使い切りました。1日にリセットされます。',
  zh: '本月视频额度已用完。每月1日重置。',
  ko: '이번 달 영상 한도를 다 썼어요. 매월 1일에 초기화돼요.',
  ar: 'لقد استنفدت حصتك من الفيديو لهذا الشهر. تُعاد في اليوم الأول.',
  hi: 'इस महीने का वीडियो कोटा खत्म हो गया। यह 1 तारीख को रीसेट होता है।',
}
export const BUTCE_PUSH_GUNLUK: Record<string, string> = {
  tr: 'Günlük üretim kapasitesi doldu, yarın tekrar dene.',
  en: 'Daily production capacity is full, try again tomorrow.',
  es: 'La capacidad de producción diaria está llena, inténtalo mañana.',
  fr: 'La capacité de production quotidienne est atteinte, réessaie demain.',
  de: 'Die tägliche Produktionskapazität ist voll, versuch es morgen nochmal.',
  it: 'La capacità di produzione giornaliera è esaurita, riprova domani.',
  pt: 'A capacidade diária de produção esgotou, tente amanhã.',
  ru: 'Дневная ёмкость производства заполнена, попробуй завтра.',
  ja: '本日の制作枠がいっぱいです。明日また試してね。',
  zh: '今日制作额度已满，请明天再试。',
  ko: '오늘 제작 한도가 찼어요. 내일 다시 시도해 주세요.',
  ar: 'اكتملت سعة الإنتاج اليومية، حاول مرة أخرى غدًا.',
  hi: 'आज की उत्पादन क्षमता भर गई, कल फिर कोशिश करें।',
}

export function butcePushGovde(lang: string | null | undefined, tur: 'aylik' | 'gunluk'): string {
  const m = tur === 'aylik' ? BUTCE_PUSH_AYLIK : BUTCE_PUSH_GUNLUK
  const l = lang || 'en'
  return m[l] || m.en || m.tr
}
