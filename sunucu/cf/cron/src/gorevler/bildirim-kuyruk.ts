// bildirim-kuyruk — KV 'bildirim:bekleyen:*' ve 'adminq:bekleyen:*' tüketicisi.
//
// NEDEN (uçtan uca tarama, 2026-09-05): bu iki kuyruğa YAZAN çok, OKUYAN hiç kimse yoktu.
//   yazıcılar: lib.ts bildirimBekleyen · activity-detect · render-bekci · olay-watch · yorum-watch
//              · bekci-ortak · broadcast · ortak.ts adminq
//   okuyucu  : YOK  →  grep 'bildirim:bekleyen' sadece yazıcıları buluyordu.
// ÖLÇÜLDÜ: 53 kayıt, en eskisi 30.08 — hepsi 7 günlük TTL ile sessizce çürüyordu. İçlerinde
// "RunPod endpoint'i KURULU DEĞİL", "2 video isteği 30 dk'dır gönderilemiyor", "VİDEO TESLİM
// SORUNU" gibi gerçek arıza alarmları vardı. Yani sistem arızayı GÖRÜYOR ama KİMSEYE SÖYLEMİYORDU.
//
// TESLİM YOLU: yeni bir dış servis/sır EKLENMEDİ — alarm, yöneticiye (admin kullanıcılara) zaten
// çalışan APNs/FCM hattından push olarak gider (push:bekleyen üzerinden, push-kuyruk teslim eder).
//
// SÜZGEÇ: 'aktivite' ve 'gün özeti' konuları kullanıcının ZATEN aldığı bildirimlerin kopyası
// (activity-detect kendi push'unu ayrıca atıyor) → teslim edilmez, sessizce düşülür.
import type { GorevCtx } from '../takvim'
import type { Env } from '../env'
import { pushBekleyen } from '../lib'

const ONEKLER = ['bildirim:bekleyen:', 'adminq:bekleyen:']
const TAVAN = 60              // tek turda okunacak en fazla kayıt
const PUSH_TAVAN = 3          // tek turda en fazla bu kadar ayrı push; fazlası tek özet olur
const BAYAT_SN = 24 * 3600    // bundan eski alarm bildirilmez (sadece sayılır ve düşülür)
// kullanıcının kendi bildirimini zaten aldığı konular — yöneticiye ikinci kez gitmesin
const KOPYA_KONULAR = new Set(['aktivite', 'gün özeti'])

async function adminler(env: Env): Promise<string[]> {
  const r = await env.DB.prepare('SELECT uid FROM users WHERE admin = 1').all<{ uid: string }>()
  return r.results.map((x) => x.uid)
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const hedef = await adminler(env)
  if (!hedef.length) { log('admin kullanıcı yok — kuyruk olduğu gibi bırakıldı'); return }

  type Kayit = { key: string; msg: string; konu: string; ts: number }
  const alarmlar: Kayit[] = []
  let kopya = 0, bayat = 0, bozuk = 0, toplam = 0

  for (const onek of ONEKLER) {
    const liste = await env.KV.list({ prefix: onek, limit: TAVAN })
    for (const k of liste.keys) {
      toplam++
      let d: Record<string, unknown> | null = null
      try { d = JSON.parse((await env.KV.get(k.name)) || 'null') } catch { d = null }
      if (!d || typeof d.msg !== 'string' || !d.msg) { await env.KV.delete(k.name); bozuk++; continue }
      const konu = typeof d.konu === 'string' ? d.konu : 'Move Log'
      if (KOPYA_KONULAR.has(konu)) { await env.KV.delete(k.name); kopya++; continue }
      // anahtar biçimi: <önek><epoch_ms>_<hex> → yaş buradan çıkar
      const msEpoch = Number(k.name.slice(onek.length).split('_')[0])
      const ts = Number.isFinite(msEpoch) && msEpoch > 0 ? Math.floor(msEpoch / 1000) : now
      if (now - ts > BAYAT_SN) { await env.KV.delete(k.name); bayat++; continue }
      alarmlar.push({ key: k.name, msg: d.msg, konu, ts })
    }
  }

  if (!alarmlar.length) {
    log(`teslim edilecek alarm yok (kopya=${kopya} bayat=${bayat} bozuk=${bozuk} tarandı=${toplam})`)
    return
  }
  alarmlar.sort((a, b) => a.ts - b.ts)

  const kirp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  const gonder = async (title: string, body: string): Promise<void> => {
    for (const u of hedef) await pushBekleyen(env, { user: u, title, body, route: 'videos' })
  }

  if (alarmlar.length <= PUSH_TAVAN) {
    for (const a of alarmlar) await gonder(kirp(a.konu, 40), kirp(a.msg.split('\n').join(' '), 240))
  } else {
    // çok alarm var → tek özet push'u (bildirim yağmuru olmasın)
    const bas = alarmlar.slice(0, PUSH_TAVAN)
      .map((a) => `• ${kirp(a.msg.split('\n')[0], 90)}`).join('\n')
    await gonder(`Move Log Bekçi — ${alarmlar.length} uyarı`,
      `${bas}\n… ve ${alarmlar.length - PUSH_TAVAN} tane daha`)
  }
  for (const a of alarmlar) { try { await env.KV.delete(a.key) } catch { /* sonraki tur */ } }
  log(`teslim=${alarmlar.length} admin=${hedef.length} kopya=${kopya} bayat=${bayat} bozuk=${bozuk}`)
}
