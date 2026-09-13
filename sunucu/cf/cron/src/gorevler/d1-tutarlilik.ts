// d1-tutarlilik — D1 ↔ R2 tutarsızlıklarını bulur ve KAPATIR. Faz T, 2026-08-31. Her 30 dk.
//
// DÖRT KONTROL:
//  1) HAYALET VİDEO: videos satırı var, r2_key R2'de YOK → kullanıcı listede görür, açınca hata alır.
//     (Geçmişte 90 hayalet kayıt vakası oldu.) → satır SİLİNİR + olay. Emniyet: 1 saatten taze kayıt
//     ELLENMEZ (render-done ile yarışmamak için), turda en fazla 25 silme.
//  2) EMNİYET AĞI — TAKILI PENDING: pending_videos'ta 6 saatten uzun süredir bekleyen kayıt.
//     Normalde pending-reconcile 90 dk'da temizler; hâlâ duruyorsa RECONCILER'IN KENDİSİ bozuktur →
//     render-failed + Barış'a bildirim (sonsuz "Hazırlanıyor" ÖNLENİR).
//  3) ÇİFT KAYIT: aynı vid hem videos hem pending_videos'ta (kilit açılmamış) → pending satırı silinir.
//     Aynı vid hem videos hem failed_videos'ta (çelişki: kullanıcı hem "üretilemedi" hem videoyu görür)
//     → failed satırı silinir.
//  4) BUDAMA: bekci_olay'da 30 günden eski satırlar silinir (tablo şişmesin).
//
// 🔴 KURU MOD: hiçbir DELETE/UPDATE yapılmaz — ne silineceği ölçülüp 'YAPARDIM' olarak yazılır.
import type { GorevCtx } from '../takvim'
import { kvJson, kvJsonYaz } from '../lib'
import { renderFailed } from '../ic'
import { bildir, kuru, onar, saglamOlay } from './bekci-ortak'

const BEKCI = 'd1-tutarlilik'
const TAZE_KORUMA = 3600        // 1 saatten taze videos satırına dokunma (render-done yarışı)
const EMNIYET_SAAT = 6          // pending emniyet ağı (pending-reconcile 90 dk'da yapmalıydı)
const TARA = 60                 // her turda R2'de aranacak videos satırı (dönerli imleç)
const MAX_SIL = 25

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c

  // ═══ 1) HAYALET VİDEO ═══
  const toplam = Number((await env.DB.prepare('SELECT COUNT(*) n FROM videos').first<{ n: number }>())?.n ?? 0)
  const imlec = toplam ? (await kvJson<number>(env, 'bekci:d1:imlec', 0)) % Math.max(1, toplam) : 0
  const vids = await env.DB.prepare(
    'SELECT rid, uid, r2_key, done_at FROM videos ORDER BY rid LIMIT ?1 OFFSET ?2')
    .bind(TARA, imlec).all<{ rid: string; uid: string | null; r2_key: string | null; done_at: number | null }>()
  await kvJsonYaz(env, 'bekci:d1:imlec', imlec + vids.results.length)

  const hayaletler: { rid: string; uid: string | null; key: string }[] = []
  for (const v of vids.results) {
    if (now - Number(v.done_at ?? 0) < TAZE_KORUMA) continue
    const key = v.r2_key || ''
    if (!key) { hayaletler.push({ rid: v.rid, uid: v.uid, key: '(boş)' }); continue }
    try { if (!(await env.R2.head(key))) hayaletler.push({ rid: v.rid, uid: v.uid, key }) } catch { /* R2 hatası: sonraki tur */ }
  }
  if (hayaletler.length) {
    const kesim = hayaletler.slice(0, MAX_SIL)
    await onar(c, {
      bekci: BEKCI, tespit: 'hayalet-video',
      aksiyon: `videos'tan ${kesim.length} satır SİL (R2'de karşılığı yok)`,
      detay: { taranan: vids.results.length, imlec, toplam, kayitlar: kesim.map((h) => ({ rid: h.rid, uid: h.uid, key: h.key })) },
      kuruGecit: kesim.map((h) => h.rid).join(',').slice(0, 60),
      uygula: async () => {
        await env.DB.batch(kesim.map((h) => env.DB.prepare('DELETE FROM videos WHERE rid = ?1').bind(h.rid)))
      },
      dogrula: async () =>
        (await env.DB.prepare('SELECT COUNT(*) n FROM videos WHERE rid = ?1').bind(kesim[0].rid).first<{ n: number }>())?.n === 0,
    })
    await bildir(c, {
      bekci: BEKCI, tespit: 'hayalet-video-bildirim', saat: 12,
      msg: `👻 ${hayaletler.length} hayalet video kaydı bulundu (D1'de var, R2'de yok) — ` +
        `${kuru(env) ? 'kuru mod: SİLİNMEDİ, kayıt tutuldu' : 'temizlendi'}. Örnek: ` +
        kesim.slice(0, 3).map((h) => h.rid.slice(0, 30)).join(', '),
      detay: { adet: hayaletler.length },
    })
  } else {
    await saglamOlay(env, BEKCI, 'hayalet-yok', { taranan: vids.results.length, toplam, imlec })
  }

  // ═══ 2) EMNİYET AĞI — TAKILI PENDING ═══
  const takili = await env.DB.prepare(
    'SELECT vid, uid, queued_at FROM pending_videos WHERE queued_at < ?1 ORDER BY queued_at LIMIT 20')
    .bind(now - EMNIYET_SAAT * 3600).all<{ vid: string; uid: string; queued_at: number }>()
  for (const p of takili.results) {
    const yasSaat = Math.round((now - p.queued_at) / 360) / 10
    await onar(c, {
      bekci: BEKCI, tespit: 'pending-emniyet-agi',
      aksiyon: `render-failed (${yasSaat} saattir "Hazırlanıyor"da; pending-reconcile 90 dk'da temizlemeliydi)`,
      detay: { vid: p.vid, uid: p.uid, yas_saat: yasSaat }, kuruGecit: p.vid,
      uygula: async () => { await renderFailed(env, p.vid, p.uid, 'Video üretilemedi — lütfen tekrar dene.') },
      dogrula: async () =>
        (await env.DB.prepare('SELECT 1 x FROM pending_videos WHERE vid = ?1').bind(p.vid).first()) === null,
    })
  }
  if (takili.results.length) {
    await bildir(c, {
      bekci: BEKCI, tespit: 'reconciler-bozuk', saat: 6,
      msg: `⚠️ ${takili.results.length} iş ${EMNIYET_SAAT}+ saattir pending'de kaldı — pending-reconcile ` +
        `görevini yapmıyor olabilir. Emniyet ağı devreye girdi (kullanıcılar "üretilemedi" bildirimi aldı).`,
      detay: { adet: takili.results.length },
    })
  }

  // ═══ 3) ÇİFT KAYIT ═══
  const ciftPend = await env.DB.prepare(
    'SELECT p.vid FROM pending_videos p JOIN videos v ON v.rid = p.vid LIMIT 25').all<{ vid: string }>()
  if (ciftPend.results.length) {
    await onar(c, {
      bekci: BEKCI, tespit: 'cift-kayit-pending',
      aksiyon: `videosu HAZIR olan ${ciftPend.results.length} pending satırı silinir (kilit açılır)`,
      detay: { vidler: ciftPend.results.map((x) => x.vid).slice(0, 10) }, kuruGecit: String(ciftPend.results.length),
      uygula: async () => {
        await env.DB.batch(ciftPend.results.map((x) => env.DB.prepare('DELETE FROM pending_videos WHERE vid = ?1').bind(x.vid)))
      },
      dogrula: async () =>
        (await env.DB.prepare('SELECT COUNT(*) n FROM pending_videos p JOIN videos v ON v.rid = p.vid').first<{ n: number }>())?.n === 0,
    })
  }
  const ciftFail = await env.DB.prepare(
    'SELECT f.vid FROM failed_videos f JOIN videos v ON v.rid = f.vid LIMIT 25').all<{ vid: string }>()
  if (ciftFail.results.length) {
    await onar(c, {
      bekci: BEKCI, tespit: 'cift-kayit-failed',
      aksiyon: `videosu VAR olan ${ciftFail.results.length} failed satırı silinir (çelişki kapatılır)`,
      detay: { vidler: ciftFail.results.map((x) => x.vid).slice(0, 10) }, kuruGecit: String(ciftFail.results.length),
      uygula: async () => {
        await env.DB.batch(ciftFail.results.map((x) => env.DB.prepare('DELETE FROM failed_videos WHERE vid = ?1').bind(x.vid)))
      },
      dogrula: async () =>
        (await env.DB.prepare('SELECT COUNT(*) n FROM failed_videos f JOIN videos v ON v.rid = f.vid').first<{ n: number }>())?.n === 0,
    })
  }
  if (!ciftPend.results.length && !ciftFail.results.length) {
    await saglamOlay(env, BEKCI, 'cift-kayit-yok')
  }

  // ═══ 4) BUDAMA ═══
  const eski = Number((await env.DB.prepare('SELECT COUNT(*) n FROM bekci_olay WHERE ts < ?1')
    .bind(now - 30 * 86400).first<{ n: number }>().catch(() => null))?.n ?? 0)
  if (eski > 0) {
    await onar(c, {
      bekci: BEKCI, tespit: 'olay-budama', aksiyon: `bekci_olay'dan 30 günden eski ${eski} satır silinir`,
      detay: { adet: eski }, kuruGecit: 'budama',
      uygula: async () => { await env.DB.prepare('DELETE FROM bekci_olay WHERE ts < ?1').bind(now - 30 * 86400).run() },
    })
  }

  log(`hayalet=${hayaletler.length} takili_pending=${takili.results.length} ` +
    `cift(pend/fail)=${ciftPend.results.length}/${ciftFail.results.length} budanacak=${eski}`)
  await saglamOlay(env, BEKCI, 'tur-ozeti', {
    videos_toplam: toplam, taranan: vids.results.length, hayalet: hayaletler.length,
    takili_pending: takili.results.length, cift_pending: ciftPend.results.length,
    cift_failed: ciftFail.results.length, budanacak: eski,
  }, 1)
}
