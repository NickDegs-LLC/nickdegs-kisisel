// movelog-cron — iç yazımlar DOĞRUDAN D1 (cron/tasks.json cf_plan kararı: "HTTP yerine D1 transaction").
// Kaynak davranış: main.py /api/internal/register-ride (1049) · render-done (1107) · render-failed (1243)
// · badges (3684). api/src/routes/grup3.ts'teki portla AYNI SQL/semantik — sapma yok; push'lar kuru
// modda KV 'push:bekleyen'e düşer (lib.pushBekleyen).
import type { Env } from './env'
import { pushBekleyen, simdi, jsonParse, kvJsonYaz, hexRasgele, trGun, hhmm } from './lib'

const int0 = (x: unknown) => { const n = Math.trunc(Number(x ?? 0)); return Number.isFinite(n) ? n : 0 }

function havKm(a1: number, o1: number, a2: number, o2: number): number {
  const rad = (x: number) => (x * Math.PI) / 180
  const dA = rad(a2 - a1); const dO = rad(o2 - o1)
  return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(dA / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dO / 2) ** 2))
}

// main.py:1103 — meydan okuma push başlığı (13 dil; grup3 MT ile birebir)
const MT: Record<string, string> = {
  en: 'Route challenge complete 🏁', tr: 'Rota meydan okuması tamam 🏁', es: '¡Reto de ruta completado! 🏁',
  fr: "Défi d'itinéraire relevé 🏁", de: 'Routen-Challenge geschafft 🏁', it: 'Sfida percorso completata 🏁',
  pt: 'Desafio de rota concluído 🏁', ru: 'Маршрут-вызов пройден 🏁', ja: 'ルートチャレンジ達成🏁',
  zh: '路线挑战完成 🏁', ko: '루트 챌린지 완료 🏁', ar: 'اكتمل تحدي المسار 🏁', hi: 'रूट चैलेंज पूरा 🏁',
}
// main.py:1165/1172 — grup video push (grup3 GT/GB ile birebir)
const GT: Record<string, string> = {
  en: '🏍️🏍️ Your group ride video is ready!', tr: '🏍️🏍️ Birlikte sürüş videonuz hazır!',
  ar: '🏍️🏍️ فيديو رحلتكم المشتركة جاهز!', es: '🏍️🏍️ ¡Vuestro vídeo de ruta juntos está listo!',
  fr: '🏍️🏍️ Votre vidéo de ride à deux est prête !', ru: '🏍️🏍️ Видео вашей совместной поездки готово!',
  de: '🏍️🏍️ Euer gemeinsames Ride-Video ist fertig!', it: '🏍️🏍️ Il video del vostro giro insieme è pronto!',
  pt: '🏍️🏍️ O vídeo do rolê de vocês está pronto!', ja: '🏍️🏍️ グループライド動画ができました！',
  zh: '🏍️🏍️ 你们的结伴骑行视频已生成！', ko: '🏍️🏍️ 함께한 라이딩 영상이 준비됐어요!',
  hi: '🏍️🏍️ आपकी ग्रुप राइड का वीडियो तैयार है!',
}
const GB: Record<string, string> = {
  en: 'You rode together with {f} — watch your joint video in Routes!',
  tr: "{f} ile birlikte sürdünüz — ortak videonuzu Rotalar'da izleyin!",
  ar: 'قدتم معاً أنت و{f} — شاهدا الفيديو المشترك في المسارات!',
  es: 'Habéis rodado juntos con {f} — ¡ved vuestro vídeo en Rutas!',
  fr: 'Vous avez roulé avec {f} — regardez votre vidéo dans Itinéraires !',
  ru: 'Вы прокатились вместе с {f} — смотрите общее видео в разделе Маршруты!',
  de: 'Du bist mit {f} gefahren — schaut euer Video unter Routen an!',
  it: 'Hai guidato insieme a {f} — guarda il vostro video in Percorsi!',
  pt: 'Você pilotou junto com {f} — veja o vídeo em Rotas!',
  ja: '{f}さんと一緒に走りました — ルートで動画を見よう！',
  zh: '你和{f}一起骑行了 — 快去路线里看你们的视频！',
  ko: '{f}님과 함께 라이딩했어요 — 경로에서 영상을 확인하세요!',
  hi: 'आपने {f} के साथ राइड की — रूट्स में अपना वीडियो देखें!',
}
// ---------------------------------------------------------------------------
// 05.09 — VİDEO HAZIR push'u. ÖNCE: sabit Türkçe metin ("Videon hazır 🎬" /
// "Rota videon hazır — Rotalar'da izle."), rota kimliği YOK, `route` alanı YOK.
// ÖLÇÜLDÜ (05.09, Barış): 80 dakikada 3 farklı rota için 4 adet TIPATIP AYNI bildirim
// → hangisinin hangi rota olduğu ayırt edilemiyor, dokununca uygulama sadece açılıyor.
// Ayrıca push_tokens'ın 24 cihazından 16'sı Türkçe DEĞİL (en=15, de=1) ama metin sabit Türkçeydi.
// grup3.ts'teki ikizle BİREBİR tutulacak.
const VT: Record<string, string> = {
  en: 'Your video is ready 🎬', tr: 'Videon hazır 🎬', es: 'Tu vídeo está listo 🎬',
  fr: 'Ta vidéo est prête 🎬', de: 'Dein Video ist fertig 🎬', it: 'Il tuo video è pronto 🎬',
  pt: 'Seu vídeo está pronto 🎬', ru: 'Твоё видео готово 🎬', ja: '動画ができました🎬',
  zh: '你的视频已生成 🎬', ko: '영상이 준비됐어요 🎬', ar: 'الفيديو جاهز 🎬', hi: 'आपका वीडियो तैयार है 🎬',
}
const VTO: Record<string, string> = {
  en: 'Your daily recap is ready 🎬', tr: 'Günlük özetin hazır 🎬', es: 'Tu resumen del día está listo 🎬',
  fr: 'Ton résumé du jour est prêt 🎬', de: 'Deine Tagesübersicht ist fertig 🎬', it: 'Il riepilogo di oggi è pronto 🎬',
  pt: 'Seu resumo do dia está pronto 🎬', ru: 'Дневная сводка готова 🎬', ja: '今日のまとめができました🎬',
  zh: '今日回顾已生成 🎬', ko: '오늘의 요약이 준비됐어요 🎬', ar: 'ملخصك اليومي جاهز 🎬', hi: 'आज का रीकैप तैयार है 🎬',
}
// {d} = kimlik satırı ("05.09 10:41 · 12,4 km"); rotayı tek bakışta ayırt ettirir.
const VB: Record<string, string> = {
  en: "{d} — watch it in Routes.", tr: "{d} — Rotalar'da izle.", es: '{d} — míralo en Rutas.',
  fr: '{d} — à voir dans Itinéraires.', de: '{d} — ansehen unter Routen.', it: '{d} — guardalo in Percorsi.',
  pt: '{d} — assista em Rotas.', ru: '{d} — смотри в разделе «Маршруты».', ja: '{d} — ルートで見てね。',
  zh: '{d} — 去“路线”里观看。', ko: '{d} — 경로에서 확인하세요.', ar: '{d} — شاهده في المسارات.',
  hi: '{d} — रूट्स में देखें।',
}
// telefonda üretilen video: kaynağı açıkça söyle (Barış 05.09: "telefonda üretiliyorsa yazacak")
const VBF: Record<string, string> = {
  en: '{d} · made on your phone — watch it in Routes.',
  tr: "{d} · telefonunda üretildi — Rotalar'da izle.",
  es: '{d} · creado en tu teléfono — míralo en Rutas.',
  fr: '{d} · créé sur ton téléphone — à voir dans Itinéraires.',
  de: '{d} · auf deinem Handy erstellt — ansehen unter Routen.',
  it: '{d} · creato sul tuo telefono — guardalo in Percorsi.',
  pt: '{d} · feito no seu telefone — assista em Rotas.',
  ru: '{d} · создано на твоём телефоне — смотри в «Маршрутах».',
  ja: '{d} · スマホで作成 — ルートで見てね。',
  zh: '{d} · 在你的手机上生成 — 去“路线”里观看。',
  ko: '{d} · 휴대폰에서 제작됨 — 경로에서 확인하세요.',
  ar: '{d} · أُنشئ على هاتفك — شاهده في المسارات.',
  hi: '{d} · आपके फ़ोन पर बना — रूट्स में देखें।',
}
/** "05.09 10:41 · 12,4 km" — bildirimin HANGİ rotaya ait olduğunu söyleyen kimlik satırı. */
export function pushKimlik(ts: number, km: number | null): string {
  const g = trGun(ts)                                   // YYYY-MM-DD
  const parca = [`${g.slice(8, 10)}.${g.slice(5, 7)} ${hhmm(ts)}`]
  if (km && km > 0) parca.push(`${km.toFixed(1)} km`)
  return parca.join(' · ')
}
/** Video-hazır push gövdesi — dil + kimlik + kaynak (telefon/bulut). */
export function videoPush(
  lang: string | null | undefined, ozet: boolean, ts: number, km: number | null, telefon: boolean,
): { title: string; body: string } {
  const l = lang || 'en'
  const govde = telefon ? VBF : VB
  return {
    title: (ozet ? VTO[l] || VTO.en : VT[l] || VT.en),
    body: (govde[l] || govde.en).split('{d}').join(pushKimlik(ts, km)),
  }
}

// 18.09: rozet push başlığı (BT) + BADGE_DEFS KALDIRILDI — rozet kazanma özelliği çıktı.

/** pushreq/<dosya>.json eşleniği (render-done/failed pushları; kimlikli anahtar). */
async function pushreq(env: Env, dosyaAdi: string, kayit: Record<string, unknown>): Promise<void> {
  await kvJsonYaz(env, `push:bekleyen:${dosyaAdi}`, kayit, 7 * 86400)
}

/** main.py:1049 register-ride — partial-merge upsert + paylaşılan-rota eşleştirici. */
export async function registerRide(env: Env, body: Record<string, unknown>): Promise<void> {
  const rid = String(body.ride_id ?? '')
  if (!rid) return
  const now = simdi()
  const prev = await env.DB.prepare('SELECT uid, date, ts, to_ts, ride_type, km, lat, lon FROM rides WHERE rid = ?1')
    .bind(rid).first<{ uid: string | null; date: string | null; ts: number; to_ts: number; ride_type: string | null; km: number | null; lat: number | null; lon: number | null }>()
  const date = (body.date as string) || prev?.date || null
  const ts = int0(body.ts || prev?.ts || 0)
  const to = int0(body.to || prev?.to_ts || 0)
  const tip = (body.type as string) || prev?.ride_type || ''
  const uid = (body.user as string) || prev?.uid || null
  const km = body.km !== null && body.km !== undefined ? Number(body.km) : (prev?.km ?? null)
  const lat = body.lat !== null && body.lat !== undefined ? Number(body.lat) : (prev?.lat ?? null)
  const lon = body.lon !== null && body.lon !== undefined ? Number(body.lon) : (prev?.lon ?? null)
  await env.DB.prepare(
    `INSERT INTO rides (rid, uid, date, ts, to_ts, ride_type, km, lat, lon, uploaded, track_key, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,NULL,?10,?10)
     ON CONFLICT(rid) DO UPDATE SET uid=?2, date=?3, ts=?4, to_ts=?5, ride_type=?6, km=?7, lat=?8, lon=?9,
       uploaded=0, track_key=NULL, updated_at=?10`)
    .bind(rid, uid, date, ts, to, tip, km, lat, lon, now).run()
  // paylaşılan rota eşleştirici (main.py:1070-1102): km ±%25 + başlangıç ≤2km
  const u = (body.user as string) || null
  const k = Number(body.km || 0) || 0
  if (!u || k <= 1) return
  const adaylar = await env.DB.prepare(
    `SELECT sr.sid, sr.from_uid, sr.ride_id, sr.km, sr.ts FROM shared_routes sr
     JOIN shared_route_targets t ON t.sid = sr.sid WHERE t.uid = ?1 AND t.ridden_at IS NULL`)
    .bind(u).all<{ sid: string; from_uid: string; ride_id: string | null; km: number | null; ts: number }>()
  const la = body.lat ?? null
  const lo = body.lon ?? null
  for (const sr of adaylar.results) {
    if (int0(body.ts) <= int0(sr.ts || 0)) continue
    const skm = Number(sr.km || 0) || 0
    if (skm <= 1 || Math.abs(k - skm) / skm > 0.25) continue
    if (la !== null && sr.ride_id) {
      const src = await env.DB.prepare('SELECT lat, lon FROM rides WHERE rid = ?1').bind(sr.ride_id)
        .first<{ lat: number | null; lon: number | null }>()
      if (src?.lat !== null && src?.lat !== undefined && src) {
        if (havKm(Number(la), Number(lo), Number(src.lat), Number(src.lon)) > 2.0) continue
      }
    }
    await env.DB.prepare('UPDATE shared_route_targets SET ridden_at = ?1, updated_at = ?1 WHERE sid = ?2 AND uid = ?3')
      .bind(simdi(), sr.sid, u).run()
    const up = await env.DB.prepare('SELECT name, handle, lang FROM users WHERE uid=?1').bind(u)
      .first<{ name: string | null; handle: string | null; lang: string | null }>()
    const fp = await env.DB.prepare('SELECT name, lang FROM users WHERE uid=?1').bind(sr.from_uid)
      .first<{ name: string | null; lang: string | null }>()
    const rn = up?.name || up?.handle || 'Rider'
    await pushBekleyen(env, { user: sr.from_uid, title: MT[fp?.lang || 'en'] || MT.en, body: `${rn}: ${k.toFixed(1)} km ✅` })
    await pushBekleyen(env, { user: u, title: MT[up?.lang || 'en'] || MT.en, body: `${fp?.name || '?'} → ${k.toFixed(1)} km ✅` })
  }
}

/** main.py:1107 render-done — video kaydı + pending/failed temizliği + gpucost + push. */
export async function renderDone(env: Env, body: Record<string, unknown>): Promise<void> {
  const rid = String(body.ride_id ?? '')
  const key = String(body.key ?? '')
  if (!rid || !key) return
  const now = simdi()
  const gusers: string[] = (Array.isArray(body.users) ? body.users : []).filter((x: unknown) => !!x).map(String)
  const grup = !!body.group && gusers.length >= 2
  const user0 = (body.user as string) ?? null
  const cvUid = grup ? (user0 || gusers[0]) : user0
  const ts = int0(body.ts); const to = int0(body.to); const size = int0(body.size)
  const mode = 'mode' in body ? body.mode : 'flyover'
  const speed = 'speed' in body ? body.speed : 'medium'
  const aspect = 'aspect' in body ? body.aspect : '16:9'
  const tip = 'type' in body ? body.type : ''
  const usersJson = grup ? JSON.stringify(gusers) : null
  const videoYaz = (vrid: string, vuid: string | null) => env.DB.prepare(
    `INSERT INTO videos (rid, uid, r2_key, date, ts, to_ts, ride_type, mode, speed, aspect, size, km, done_at, is_group, users_json, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL,?12,?13,?14,?15,?15)
     ON CONFLICT(rid) DO UPDATE SET uid=?2, r2_key=?3, date=?4, ts=?5, to_ts=?6, ride_type=?7, mode=?8,
       speed=?9, aspect=?10, size=?11, km=NULL, done_at=?12, is_group=?13, users_json=?14, updated_at=?15`)
    .bind(vrid, vuid, key, (body.date as string) ?? null, ts, to, tip, mode, speed, aspect, size, now, grup ? 1 : 0, usersJson, now)
  // 🔴 FİKS 05.09 — ÇİFT BİLDİRİM: `videos` upsert'i idempotent ama push HER çağrıda yeniden
  // kuyruğa giriyordu (anahtar `${rid}_${simdi()}` → saniye farkı = ayrı anahtar = ayrı bildirim).
  // Aynı rid'i üç bağımsız tetikleyici bitmiş sayabiliyor: RunPod'un render-done çağrısı,
  // pending-reconcile FINALIZE (dakikalık, callback'le YARIŞIYOR) ve yetim süpürmesi.
  // Upsert'ten ÖNCE bakıyoruz: satır zaten varsa kullanıcıya ikinci kez haber verilmez.
  const onceden = await env.DB.prepare('SELECT done_at FROM videos WHERE rid = ?1').bind(rid)
    .first<{ done_at: number | null }>()
  const yazimlar = [videoYaz(rid, cvUid)]
  if (grup) for (let i = 1; i < gusers.length; i++) yazimlar.push(videoYaz(`${rid}_w${i + 1}`, gusers[i]))
  await env.DB.batch(yazimlar)
  if (grup && ts && to) {
    // 'sadece ortak video' tercihi: ±900sn örtüşen soloları gizle (main.py:1133-1144)
    const ph = gusers.map((_, i) => `?${i + 1}`).join(',')
    const n = gusers.length
    const solo = await env.DB.prepare(
      `SELECT v.rid FROM videos v JOIN users u ON u.uid = v.uid
       WHERE v.uid IN (${ph}) AND COALESCE(v.is_group,0)=0 AND v.ts < ?${n + 1} AND v.to_ts > ?${n + 2}
         AND json_extract(u.prefs_json,'$.group_video')='group' AND v.rid NOT IN (SELECT rid FROM deleted_rides)`)
      .bind(...gusers, to + 900, ts - 900).all<{ rid: string }>()
    if (solo.results.length) {
      await env.DB.batch(solo.results.map((r) =>
        env.DB.prepare('INSERT OR IGNORE INTO deleted_rides (rid, created_at, updated_at) VALUES (?1,?2,?2)').bind(r.rid, now)))
    }
  }
  const gs = int0(body.gpu_secs)
  if (body.user && gs > 0) {
    const ay = new Date().toISOString().slice(0, 7)
    const g3d = body.ultra && body.mode === '3d' ? gs : 0
    await env.DB.prepare(
      `INSERT INTO gpu_costs (uid, month, secs, videos, g3d_secs, created_at, updated_at) VALUES (?1,?2,?3,1,?4,?5,?5)
       ON CONFLICT(uid, month) DO UPDATE SET secs=secs+?3, videos=videos+1, g3d_secs=g3d_secs+?4, updated_at=?5`)
      .bind(String(body.user), ay, gs, g3d, now).run()
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pending_videos WHERE vid = ?1').bind(rid),
    env.DB.prepare('DELETE FROM failed_videos WHERE vid = ?1').bind(rid),
    env.DB.prepare('DELETE FROM deleted_rides WHERE rid = ?1').bind(rid),
  ])
  const ridSan = rid.split('/').join('_')
  if (grup) {
    const ph = gusers.map((_, i) => `?${i + 1}`).join(',')
    const profs = await env.DB.prepare(`SELECT uid, name, handle, lang FROM users WHERE uid IN (${ph})`)
      .bind(...gusers).all<{ uid: string; name: string | null; handle: string | null; lang: string | null }>()
    const pm = new Map(profs.results.map((r) => [r.uid, r]))
    const nm = (x: string) => ((pm.get(x)?.name || pm.get(x)?.handle || '').trim()) || 'your friend'
    const gts = simdi()
    for (const gu of gusers) {
      const digerleri = gusers.filter((x) => x !== gu).map(nm).join(', ')
      const lng = pm.get(gu)?.lang || 'en'
      await pushreq(env, `${ridSan}_${gu}_${gts}`,
        { user: gu, title: GT[lng] || GT.en, body: (GB[lng] || GB.en).split('{f}').join(digerleri), ts: gts })
    }
  } else if (user0) {
    // aynı video için ikinci kez haber verme (yarışan tetikleyiciler); `nopush` = geç kurtarma
    if (onceden?.done_at || body.nopush) return
    const pts = simdi()
    const pr = await env.DB.prepare('SELECT lang FROM users WHERE uid = ?1').bind(user0)
      .first<{ lang: string | null }>()
    const rk = await env.DB.prepare('SELECT km FROM rides WHERE rid = ?1').bind(rid)
      .first<{ km: number | null }>()
    const v = videoPush(pr?.lang, rid.includes('_ozet'), ts || simdi(), rk?.km ?? null, !!body.telefon)
    const pt = (body.ptitle as string) || v.title
    const pb = (body.pbody as string) || v.body
    // 🔴 anahtar ARTIK zamansız: aynı rid ikinci kez kuyruğa yazılamaz (KV üzerinde ikinci kilit).
    // `route:'videos'` → bildirime dokununca Videolar sekmesi açılır (App.swift:99-104,
    // MainActivity.kt:23 zaten anlıyor; 1.62 için istemci güncellemesi GEREKMİYOR).
    await pushreq(env, ridSan, { user: user0, title: pt, body: pb, ts: pts, route: 'videos' })
  }
}

/** main.py:1243 render-failed — pencere pending'ten taşınır + kullanıcı push'u. */
export async function renderFailed(env: Env, rid: string, user: string | null, reason: string, bildir = true): Promise<void> {
  if (!rid) return
  const now = simdi()
  const pv = await env.DB.prepare('SELECT date, ts, to_ts, ride_type, mode FROM pending_videos WHERE vid = ?1')
    .bind(rid).first<{ date: string | null; ts: number; to_ts: number; ride_type: string | null; mode: string | null }>()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pending_videos WHERE vid = ?1').bind(rid),
    env.DB.prepare(
      `INSERT INTO failed_videos (vid, uid, reason, failed_at, date, ts, to_ts, ride_type, mode, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
       ON CONFLICT(vid) DO UPDATE SET uid=?2, reason=?3, failed_at=?4, date=?5, ts=?6, to_ts=?7, ride_type=?8, mode=?9, updated_at=?10`)
      .bind(rid, user, reason.trim() || 'GPS verisi yetersiz', now,
        pv?.date ?? null, pv?.ts ?? null, pv?.to_ts ?? null, pv?.ride_type ?? null, pv?.mode ?? null, now),
  ])
  if (user && bildir) {
    const pts = simdi()
    await pushreq(env, `fail_${rid.split('/').join('_')}_${pts}`,
      { user, title: 'Video oluşturulamadı', body: reason.trim() || 'Bu rota için yeterli GPS verisi yok.', ts: pts })
  }
}

// 18.09: rozetEkle() KALDIRILDI — tek çağıranı silinen gorevler/rozet.ts idi.
// ⚠️ users.badges_json KOLONU DURUYOR (veri kaybı olmasın); artık yazılmıyor.

export { hexRasgele }
