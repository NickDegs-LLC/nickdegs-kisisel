// grupsurus — movelog-grupsurus.py (296 satır) portu.
// Arkadaş/kulüp çiftlerinin birlikte sürüşü: günün D1 izlerini 30sn ızgarada örnekle,
// <=NEAR_M(300m) yakın + hareketli koşuları bul, çiftleri N-kişilik kümelere birleştir;
// en az biri Premium/Ultra ise ortak 3D iş RENDER_Q'ya (golge: önekli), hepsi free ise günde 1 upsell.
import type { GorevCtx } from '../takvim'
import { UCRETSIZ_MOD } from '../../../ortak/src/mod'
import {
  hav, jsonParse, kvJson, kvJsonYaz, pushBekleyen, renderKuyruk, trGun, trGunAralik, gorunenAd,
} from '../lib'

// 05.11.2026 — Pro'su olmayan sürücüye ortak sürüş bildirimi (12 dil)
const PRO_T: Record<string, string> = {
  en: 'You rode together! 🏍️🏍️', tr: 'Birlikte sürdünüz! 🏍️🏍️', de: 'Ihr seid zusammen gefahren! 🏍️🏍️',
  fr: 'Vous avez roulé ensemble ! 🏍️🏍️', es: '¡Habéis rodado juntos! 🏍️🏍️', it: 'Avete guidato insieme! 🏍️🏍️',
  pt: 'Vocês pilotaram juntos! 🏍️🏍️', ru: 'Вы прокатились вместе! 🏍️🏍️', ja: '一緒に走りましたね！🏍️🏍️',
  zh: '你们一起骑行了！🏍️🏍️', ko: '함께 라이딩했네요! 🏍️🏍️', ar: 'لقد قدتم معًا! 🏍️🏍️',
}
const PRO_B: Record<string, string> = {
  en: 'You rode with {f}. Get Move Log Pro once and your joint 3D ride video is made on your phone.',
  tr: '{f} ile birlikte sürdün. Move Log Pro\'yu bir kez al, ortak 3D sürüş videonuz telefonunda hazırlansın.',
  de: 'Du bist mit {f} gefahren. Hol dir einmalig Move Log Pro und euer gemeinsames 3D-Video entsteht auf deinem Handy.',
  fr: 'Tu as roulé avec {f}. Prends Move Log Pro une fois et votre vidéo 3D commune est créée sur ton téléphone.',
  es: 'Rodaste con {f}. Consigue Move Log Pro una sola vez y vuestro vídeo 3D conjunto se crea en tu teléfono.',
  it: 'Hai guidato con {f}. Prendi Move Log Pro una volta sola e il vostro video 3D comune nasce sul tuo telefono.',
  pt: 'Você pilotou com {f}. Compre o Move Log Pro uma vez e o vídeo 3D conjunto é feito no seu celular.',
  ru: 'Вы ехали с {f}. Купите Move Log Pro один раз — и общее 3D-видео создастся на вашем телефоне.',
  ja: '{f}さんと一緒に走りました。Move Log Proを一度購入すると、共同3D動画がスマホで作られます。',
  zh: '你和{f}一起骑行了。一次性购买 Move Log Pro，你们的 3D 合拍视频就会在手机上生成。',
  ko: '{f}님과 함께 달렸어요. Move Log Pro를 한 번만 구매하면 공동 3D 영상이 휴대폰에서 만들어져요.',
  ar: 'قدتَ مع {f}. اشترِ Move Log Pro مرة واحدة ويُنشأ فيديو الرحلة المشترك ثلاثي الأبعاد على هاتفك.',
}

const GRID = 30, NEAR_M = 300, MIN_DUR = 600, MIN_KM = 2.0, MERGE_GAP = 300, SETTLE = 600, MOVE_KMH = 7

type Nokta = { t: number; lat: number; lon: number; alt: number; spd: number }

const UP_T: Record<string, string> = {
  en: 'You two rode together! 🏍️🏍️', tr: 'Birlikte sürdünüz! 🏍️🏍️', ar: 'لقد قدتما معاً! 🏍️🏍️',
  es: '¡Habéis rodado juntos! 🏍️🏍️', fr: 'Vous avez roulé ensemble ! 🏍️🏍️', ru: 'Вы прокатились вместе! 🏍️🏍️',
  de: 'Ihr seid zusammen gefahren! 🏍️🏍️', it: 'Avete guidato insieme! 🏍️🏍️', pt: 'Vocês pilotaram juntos! 🏍️🏍️',
  ja: '一緒に走りましたね！🏍️🏍️', zh: '你们一起骑行了！🏍️🏍️', ko: '함께 라이딩했네요! 🏍️🏍️', hi: 'आपने साथ में राइड की! 🏍️🏍️',
}
const UP_B: Record<string, string> = {
  en: "We spotted your ride with {f}. With Premium, you'd both get an epic joint 3D video of rides like this — automatically!",
  tr: "{f} ile sürüşünüzü fark ettik. Premium'la böyle sürüşlerin muhteşem ortak 3D videosu ikinize de otomatik gelirdi!",
  ar: 'لاحظنا رحلتك مع {f}. مع بريميوم، ستحصلان تلقائياً على فيديو ثلاثي الأبعاد مشترك رائع لمثل هذه الرحلات!',
  es: 'Vimos tu ruta con {f}. ¡Con Premium, ambos recibiríais automáticamente un épico vídeo 3D conjunto!',
  fr: "On a repéré votre ride avec {f}. Avec Premium, vous recevriez tous les deux une superbe vidéo 3D commune — automatiquement !",
  ru: 'Мы заметили вашу поездку с {f}. С Premium вы оба автоматически получали бы эпичное совместное 3D-видео!',
  de: 'Wir haben eure Fahrt mit {f} bemerkt. Mit Premium bekämt ihr beide automatisch ein episches gemeinsames 3D-Video!',
  it: 'Abbiamo notato il tuo giro con {f}. Con Premium, ricevereste entrambi un epico video 3D insieme — automaticamente!',
  pt: 'Vimos seu rolê com {f}. Com o Premium, vocês dois receberiam automaticamente um vídeo 3D conjunto épico!',
  ja: '{f}さんとのライドを検知しました。プレミアムなら、こんなライドの共同3D動画が自動で二人に届きます！',
  zh: '我们发现你和{f}一起骑行了。有了高级版，你们俩都会自动收到超赞的双人3D视频！',
  ko: '{f}님과의 라이딩을 감지했어요. 프리미엄이라면 이런 라이딩의 멋진 공동 3D 영상이 두 분께 자동으로 도착해요!',
  hi: 'हमने {f} के साथ आपकी राइड देखी। प्रीमियम के साथ, आप दोनों को ऐसी राइड्स का शानदार 3D वीडियो अपने आप मिलता!',
}

function sampleAt(P: Nokta[], tt: number, maxGap = 120): { lat: number; lon: number; spd: number } | null {
  // bisect_left eşleniği
  let lo = 0, hi = P.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].t < tt) lo = m + 1; else hi = m }
  if (lo <= 0 || lo >= P.length) return null
  const a = P[lo - 1], b = P[lo]
  if (b.t - a.t > maxGap) return null
  const fr = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 0
  return { lat: a.lat + (b.lat - a.lat) * fr, lon: a.lon + (b.lon - a.lon) * fr, spd: a.spd + (b.spd - a.spd) * fr }
}

function findJointRuns(P1: Nokta[], P2: Nokta[]): [number, number, number][] {
  if (P1.length < 5 || P2.length < 5) return []
  const t0 = Math.max(P1[0].t, P2[0].t), t1 = Math.min(P1[P1.length - 1].t, P2[P2.length - 1].t)
  if (t1 - t0 < MIN_DUR) return []
  const runs: [number, number][] = []
  let cur: [number, number] | null = null
  for (let tt = t0; tt <= t1; tt += GRID) {
    const a = sampleAt(P1, tt), b = sampleAt(P2, tt)
    let ok = false
    if (a && b) {
      const d = hav(a, b)
      const moving = a.spd > MOVE_KMH || b.spd > MOVE_KMH
      ok = d <= NEAR_M && moving
    }
    if (ok) cur = cur === null ? [tt, tt] : [cur[0], tt]
    else if (cur) { runs.push(cur); cur = null }
  }
  if (cur) runs.push(cur)
  const merged: [number, number][] = []
  for (const r of runs) {
    if (merged.length && r[0] - merged[merged.length - 1][1] <= MERGE_GAP) merged[merged.length - 1][1] = r[1]
    else merged.push([r[0], r[1]])
  }
  const out: [number, number, number][] = []
  for (const [st, en] of merged) {
    if (en - st < MIN_DUR) continue
    const seg = P1.filter((p) => st <= p.t && p.t <= en)
    let km = 0
    for (let i = 1; i < seg.length; i++) km += hav(seg[i - 1], seg[i])
    km /= 1000
    if (km < MIN_KM) continue
    const mov = seg.filter((p) => p.spd > MOVE_KMH).length
    if (seg.length && mov / seg.length < 0.4) continue  // oturma/kamp eleme
    out.push([st, en, km])
  }
  return out
}

export async function kos(c: GorevCtx): Promise<void> {
  const { env, now, log } = c
  const gun = trGun(now)
  const [g0, g1] = trGunAralik(gun)
  // bugün aktif cihazlar
  const aktif = await env.DB.prepare('SELECT DISTINCT device FROM positions WHERE ts >= ?1 AND ts < ?2')
    .bind(g0, g1).all<{ device: string }>()
  const aktifSet = new Set(aktif.results.map((r) => r.device))
  if (!aktifSet.size) { log('bugün aktif cihaz yok'); return }
  const users = await env.DB.prepare(
    'SELECT uid, name, handle, lang, premium, pro, tracker_id, prefs_json FROM users WHERE tracker_id IS NOT NULL')
    .all<{ uid: string; name: string | null; handle: string | null; lang: string | null; premium: number | null; pro: number | null; tracker_id: string; prefs_json: string | null }>()
  const userDev = new Map<string, string>()
  const prof = new Map<string, (typeof users.results)[number]>()
  for (const u of users.results) {
    prof.set(u.uid, u)
    if (aktifSet.has(u.tracker_id)) userDev.set(u.uid, u.tracker_id)
  }
  // 05.11.2026 (Barış): YALNIZ TANIDIKLAR = kabul edilmiş arkadaş (friends; bekleyen istekler
  // friend_requests'te) VEYA aynı kulübün üyesi. Rastgele / tanımadığın biri hiçbir zaman eşleşmez.
  const pairs = new Set<string>()
  const arkadas = new Set<string>()          // TÜM tanıdık çiftleri (arkadaş + kulüp; aktiflik şartsız) — küme denetimi
  const fr = await env.DB.prepare('SELECT uid, friend_uid FROM friends').all<{ uid: string; friend_uid: string }>()
  for (const f of fr.results) {
    if (f.uid !== f.friend_uid) arkadas.add([f.uid, f.friend_uid].sort().join('|'))
    if (f.uid !== f.friend_uid && userDev.has(f.uid) && userDev.has(f.friend_uid)) {
      pairs.add([f.uid, f.friend_uid].sort().join('|'))
    }
  }
  // 05.11.2026 (Barış: "kulüp de ekleyelim"): AYNI KULÜPTEKİLER de tanıdık sayılır. Kulübe yalnız
  // davet KODUYLA girilir (/api/clubs/join) → yine rastgele biri değil.
  const cm = await env.DB.prepare('SELECT cid, uid FROM club_members').all<{ cid: string; uid: string }>()
  const clubUyeler = new Map<string, string[]>()
  for (const r of cm.results) {
    if (!clubUyeler.has(r.cid)) clubUyeler.set(r.cid, [])
    clubUyeler.get(r.cid)!.push(r.uid)
  }
  for (const mem of clubUyeler.values()) {
    for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) {
      const k = [mem[i], mem[j]].sort().join('|')
      arkadas.add(k)
      if (userDev.has(mem[i]) && userDev.has(mem[j])) pairs.add(k)
    }
  }
  const hepsiArkadas = (uyeler: Iterable<string>): boolean => {
    const a = [...uyeler]
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      if (!arkadas.has([a[i], a[j]].sort().join('|'))) return false
    }
    return true
  }
  if (!pairs.size) { log('bugün aktif arkadaş çifti yok'); return }
  log(`aday çift: ${pairs.size}`)

  const sent = await kvJson<Record<string, number>>(env, 'grupsurus:sent', {})
  let changed = false
  const posCache = new Map<string, Nokta[]>()
  const yukle = async (uid: string): Promise<Nokta[]> => {
    if (posCache.has(uid)) return posCache.get(uid)!
    const rows = await env.DB.prepare(
      'SELECT ts, lat, lon, alt, spd FROM positions WHERE device = ?1 AND ts >= ?2 AND ts < ?3 ORDER BY ts')
      .bind(userDev.get(uid), g0, g1).all<{ ts: number; lat: number; lon: number; alt: number | null; spd: number | null }>()
    const P: Nokta[] = rows.results.map((p) => ({ t: p.ts, lat: p.lat, lon: p.lon, alt: p.alt ?? 0, spd: 0 }))
    for (let i = 1; i < P.length; i++) {
      const dt = P[i].t - P[i - 1].t
      P[i].spd = dt > 0 ? (hav(P[i - 1], P[i]) / dt) * 3.6 : 0
    }
    posCache.set(uid, P)
    return P
  }

  // 1) ikili koşular
  type Aday = { members: Set<string>; st: number; en: number; km: number }
  const cands: Aday[] = []
  for (const pk of [...pairs].sort()) {
    const [u1, u2] = pk.split('|')
    const pr1 = jsonParse<Record<string, unknown>>(prof.get(u1)?.prefs_json ?? null, {})
    const pr2 = jsonParse<Record<string, unknown>>(prof.get(u2)?.prefs_json ?? null, {})
    if (pr1.group_video === 'solo' || pr2.group_video === 'solo') continue  // solo seçen HİÇ girmez
    const P1 = await yukle(u1), P2 = await yukle(u2)
    for (const [st, en, km] of findJointRuns(P1, P2)) {
      if (now - en < SETTLE) { log(`${u1}+${u2}: koşu taze (${Math.trunc(now - en)}sn), bekliyor`); continue }
      cands.push({ members: new Set([u1, u2]), st, en, km })
    }
  }
  // 2) küme birleştirme (N kişi)
  let merged = true
  while (merged) {
    merged = false
    dis: for (let i = 0; i < cands.length; i++) {
      for (let j = i + 1; j < cands.length; j++) {
        const a = cands[i], b = cands[j]
        const kesisim = [...a.members].some((x) => b.members.has(x))
        // 05.11: birleşen kümede HERKES birbirinin arkadaşı olmalı (A–B, B–C arkadaş ama A–C değilse
        // ayrı videolar kalır; A'nın videosunda tanımadığı C görünmez)
        if (kesisim && Math.min(a.en, b.en) - Math.max(a.st, b.st) >= 300 &&
            hepsiArkadas(new Set([...a.members, ...b.members]))) {
          for (const x of b.members) a.members.add(x)
          a.st = Math.min(a.st, b.st); a.en = Math.max(a.en, b.en); a.km = Math.max(a.km, b.km)
          cands.splice(j, 1); merged = true; break dis
        }
      }
    }
  }
  // 3) küme başına tek ortak video
  for (const cand of cands) {
    let members = [...cand.members].sort()
    const { st, en, km } = cand
    const pfx = `${gun}_${members.join('+')}_`
    const kod = Math.trunc(st / 600)
    if (Object.keys(sent).some((k) => k.startsWith(pfx) && /^\d+$/.test(k.slice(pfx.length)) &&
      Math.abs(Number(k.slice(pfx.length)) - kod) <= 1)) continue
    const names = new Map(members.map((u) => [u, gorunenAd(prof.get(u)).trim() || 'Rider']))
    const tiers = new Map(members.map((u) => [u, prof.get(u)?.premium ? 1 : 0]))
    log(`BİRLİKTE SÜRÜŞ (${members.length} kişi): ${members.map((u) => names.get(u)).join(' + ')} ${km.toFixed(1)}km`)
    if (!UCRETSIZ_MOD && ![...tiers.values()].some((t) => t > 0)) {
      // hepsi free: günde 1 upsell
      const upk = `up_${gun}_${members.join('+')}`
      if (!(upk in sent)) {
        for (const u of members) {
          const others = members.filter((x) => x !== u).map((x) => names.get(x)).join(', ')
          const lng = prof.get(u)?.lang || 'en'
          await pushBekleyen(env, {
            user: u, title: UP_T[lng] || UP_T.en, body: (UP_B[lng] || UP_B.en).replace('{f}', others),
          })
        }
        sent[upk] = now; changed = true
        log('  -> upsell push (hepsi free)')
      }
      continue
    }
    // track1 = en yüksek katman; kamera onu takip eder
    members = members.sort((a, b) => (tiers.get(b)! - tiers.get(a)!) || (a < b ? -1 : 1))
    const lead = members[0]
    const mkTrack = (P: Nokta[]) => P.filter((p) => st - 30 <= p.t && p.t <= en + 30)
      .map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, spd: Math.round(p.spd * 10) / 10, alt: p.alt }))
    const t1 = mkTrack(posCache.get(lead) ?? [])
    const mates: { track: unknown[]; name: string }[] = []
    const gusers: string[] = [lead]
    for (const u of members.slice(1)) {
      const tm = mkTrack(posCache.get(u) ?? [])
      if (tm.length >= 3) { mates.push({ track: tm, name: names.get(u)! }); gusers.push(u) }
    }
    if (t1.length < 3 || !mates.length) { log('  -> iz çok kısa, atlandı'); continue }
    const rid = `${gun}_grup_${Math.trunc(st)}`
    // kulüp etiketi: 3+ kişi aynı kulüpteyse video adı kulüp adı
    let vidName = names.get(lead)!
    if (members.length >= 3) {
      for (const [cid, mem] of clubUyeler) {
        if (members.every((u) => mem.includes(u))) {
          const cl = await env.DB.prepare('SELECT name FROM clubs WHERE cid = ?1').bind(cid).first<{ name: string }>()
          if (cl?.name) { vidName = cl.name; for (const m of mates) m.name = '' }
          break
        }
      }
    }
    const leadPrefs = jsonParse<Record<string, unknown>>(prof.get(lead)?.prefs_json ?? null, {})
    const job: Record<string, unknown> = {
      device: userDev.get(lead), user: lead, users: gusers, name: vidName,
      from: Math.trunc(st), to: Math.trunc(en), day: gun, ride_id: rid, type: 'moto', mode: '3d',
      speed: 'medium', aspect: '16:9', premium: true, ts: now, track: t1, mates,
      line: (leadPrefs.video_line as string) || '#00e5ff', dot: (leadPrefs.video_dot as string) || '#ff3b30',
      // ⚠️ MOTOR SÖZLEŞMESİ — DEĞİŞTİRMEDEN ÖNCE OKU: bu bayrak "Ultra katmanı" DEĞİL, karo
      // tavanı demek. render3d.js:72 `IN.ultra ? 'ultra' : 'premium'` → `?k=` → karo.js:33
      // `tavan = k==='premium' ? 17 : 18`. true yapmak z18 = kare başına 4 KAT karo ve o yük
      // Hooder'ın ORTAK haritasına biner. Barış 18.09: "Herkes z17 (mevcut Premium)".
      // Bayrağın başka etkisi YOK: Google 3B dalları GOOGLE_3D_OLU=1 ile ölü, satStyle zaten
      // ondan bağımsız true, çıkıntılı bina `kabartma`ya bağlı (mühürlü false).
      ultra: false,
    }
    // 🔴 18.09 Barış: chase (takip) kamerası artık TÜM grup videolarında — ek maliyet yok,
    // aynı render, farklı kamera açısı. Eskiden Ultra'lı üye varsa açılıyordu.
    job.cam = 'chase'
    if (UCRETSIZ_MOD) {
      // 05.11.2026 ORTAK SÜRÜŞ TELEFONDA: bulut YOK. Her üyenin telefon kuyruğuna (yerelq) bir 3D iş
      // yazılır; iş `grup` anahtarını taşır, /api/motor3d bu anahtarla KV'deki üye listesini okuyup
      // (istekte bulunan üye mi diye bakarak) diğer sürücülerin izlerini sunucuda ekler.
      // Her telefon KENDİ izini öne alır (kamera kendini takip eder), diğerleri eş sürücü olur.
      const gkey = `${gun}_${Math.trunc(st)}_${gusers.join('+')}`.slice(0, 200)
      await kvJsonYaz(env, `grupvid:${gkey}`, { users: gusers, from: Math.trunc(st), to: Math.trunc(en), ts: now }, 14 * 86400)
      let yazilan = 0
      for (const u of gusers) {
        const pr = jsonParse<Record<string, unknown>>(prof.get(u)?.prefs_json ?? null, {})
        if (pr.group_video === 'solo') continue
        // 05.11.2026 MOVE LOG PRO: ortak video YALNIZ Pro sahibine. Pro'su olmayana o gün o grup için
        // TEK bildirim: "X ile birlikte sürdün — Pro ile ortak videonuz hazır".
        if (!Number(prof.get(u)?.pro ?? 0)) {
          const upk = `pro_up_${gun}_${u}_${gusers.join('+')}`
          if (!(upk in sent)) {
            const others = gusers.filter((x) => x !== u).map((x) => names.get(x)).join(', ')
            const lng = prof.get(u)?.lang || 'en'
            await pushBekleyen(env, { user: u, title: PRO_T[lng] || PRO_T.en, body: (PRO_B[lng] || PRO_B.en).replace('{f}', others), route: 'pro' })
            sent[upk] = now; changed = true
          }
          continue
        }
        const lst = await kvJson<Record<string, unknown>[]>(env, `yerelq:${u}`, [])
        // `from`+1: aynı anda başlayan kendi sürüş işiyle (from anahtarı) çakışmasın
        const frm = Math.trunc(st) + 1
        if (lst.some((x) => x.grup === gkey || Math.trunc(Number(x.from ?? 0)) === frm)) continue
        lst.push({ from: frm, to: Math.trunc(en), type: 'moto', mode: '3d', speed: 'medium', aspect: '16:9',
          line: (pr.video_line as string) || '#00e5ff', dot: (pr.video_dot as string) || '#ff3b30',
          ride_id: rid, ts: now, grup: gkey })
        await kvJsonYaz(env, `yerelq:${u}`, lst.slice(-10))
        yazilan++
      }
      log(`  -> TELEFON kuyruğu ortak video: ${gkey} • ${yazilan}/${gusers.length} üye`)
      sent[`${pfx}${kod}`] = now; changed = true
      continue
    }
    const kid = await renderKuyruk(env, job, 'grupsurus')
    log(`  -> KUYRUK grup videosu: ${kid} • ${gusers.length} sürücü`)
    sent[`${pfx}${kod}`] = now; changed = true
  }
  if (changed) await kvJsonYaz(env, 'grupsurus:sent', sent, 14 * 86400)
}
