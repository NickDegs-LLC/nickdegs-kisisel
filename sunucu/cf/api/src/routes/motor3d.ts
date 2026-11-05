// POST /api/motor3d — TELEFONDA VİDEO ÜRETME yolunun sunucusuz hâli.
// ═══════════════════════════════════════════════════════════════════════════════════════
// NE YAPAR: buluttaki MapLibre motorunun SAYFASINI telefona verir; telefon (WebRouteVideo.swift)
// WKWebView'da kare kare çekip MP4 yazar. GPU BEDAVA -> RunPod bakiyesi bitse bile kullanıcı
// video üretebilir. Bu yüzden bu uç RunPod'a HİÇ dokunmaz ve dokunmamalıdır.
//
// DAVRANIŞ KAYNAĞI: /opt/matrix/scripts/harita-proxy.py:397-500 (do_POST /motor3d).
//   Eski zincir (sunucu): backend /api/track -> route-video.py (spec.json) -> telefon-html.js (HTML)
//   Yeni zincir (worker): iz.ts (D1/R2)      -> spec.ts               -> sayfa.js + surucu.js
//   Sayfa/sürücü kodu ELLE YAZILMADI: render3d.js + telefon-html.js'ten DERLEME ZAMANINDA
//   mekanik olarak çıkarıldı (cf/tools/motor3d-sablon-uret.sh) — `new Function` Workers'ta yasak.
//   Doğrulandı: aynı spec ile üretilen HTML sunucununkiyle BAYT-BİREBİR (1.505.576 karakter).
//
// SÖZLEŞME (WebRouteVideo.swift:13 Meta): {"html":str,"frames":int,"fps":int,"W":int,"H":int}
//   401 {"detail":"token"}            -> authUser (imza+exp+tv) ile eşdeğer; gövde lib/hata biçimi
//   403 {"detail":"premium gerekli"}  -> harita-proxy.py:446 (nihai 08-28 kararı) BİREBİR
//   400 {"detail":"aralik"} · 404 {"detail":"iz yok"} · 500 {"detail":"spec/html uretilemedi"}
import { Hono } from 'hono'
import type { AppEnv } from '../lib/env'
import { authUser } from '../lib/auth'
import { hata } from '../lib/hata'
import { getUser } from '../lib/db'
import { izOku } from '../motor3d/iz'
import { SpecHata, specUret, type MotorGirdi } from '../motor3d/spec'
import { vendorAl } from '../motor3d/vendor'
import { sayfaUret } from '../motor3d/sayfa'
import { surucuUret } from '../motor3d/surucu'
import { UCRETSIZ_MOD } from '../../../ortak/src/mod'

const g = new Hono<AppEnv>()

const HIZLAR = ['fast', 'medium', 'slow', 'auto'] as const
const KAMERALAR = ['yakin', 'orta', 'uzak'] as const

g.post('/api/motor3d', authUser, async (c) => {
  const user = c.get('user')
  let gov: Record<string, unknown> = {}
  try { gov = (await c.req.json()) as Record<string, unknown> } catch { gov = {} }   // proxy: `or b"{}"`

  const prof = await getUser(c.env.DB, user)
  // ═══ PREMIUM KAPISI (harita-proxy.py:441-446, nihai 2026-08-28) ═══
  // Ücretsiz katmanda video ÜRETİLMEZ (ne telefonda ne bulutta) -> bu ucu yalnız Premium/Ultra kullanır.
  if (!prof?.premium && !UCRETSIZ_MOD) hata(403, 'premium gerekli')   // 03.11 ücretsiz mod: herkes üretir

  const frm = Number(gov.from ?? 0), to = Number(gov.to ?? 0)
  if (!frm || !to || to <= frm || to - frm > 86400) hata(400, 'aralik')

  const iz = await izOku(c.env, user, frm, to)
  if (iz.length < 3) hata(404, 'iz yok')

  const str = (v: unknown, n: number) => String(v ?? '').slice(0, n)
  const girdi: MotorGirdi = {
    frm, to,
    speed: (HIZLAR as readonly string[]).includes(String(gov.speed)) ? (gov.speed as MotorGirdi['speed']) : 'medium',
    acttype: str(gov.type || 'moto', 10),
    line: str(gov.line || '#00E5FF', 12),
    dot: str(gov.dot || '#FF3B30', 12),
    camdist: (KAMERALAR as readonly string[]).includes(String(gov.camdist)) ? (gov.camdist as MotorGirdi['camdist']) : 'orta',
    aspect9x16: gov.aspect === '9:16',
    name: str(prof?.name ?? '', 40),
  }

  // ═══ 05.11.2026 ORTAK SÜRÜŞ (telefonda) ═══
  // İş kaydındaki `grup` anahtarı → KV grupvid:{anahtar} = {users,from,to} (cron grupsurus yazar;
  // yalnız KARŞILIKLI ARKADAŞ kümeleri). İsteyen bu kümenin üyesi DEĞİLSE eş izleri EKLENMEZ —
  // anahtarı tahmin eden biri başkasının konumunu göremez. Eş izi alınamazsa tek kişilik video çıkar.
  const grup = typeof gov.grup === 'string' ? gov.grup.slice(0, 200) : ''
  if (grup) {
    try {
      const kayit = await c.env.KV.get<{ users: string[]; from: number; to: number }>(`grupvid:${grup}`, 'json')
      if (kayit && Array.isArray(kayit.users) && kayit.users.includes(user)) {
        const RENK = [['#FF9F0A', '#FFD60A'], ['#BF5AF2', '#FF7AB6'], ['#30D158', '#A3FF6B'], ['#FF453A', '#FFB4A9']]
        const esler = kayit.users.filter((u) => u !== user).slice(0, 4)
        girdi.mates = []
        for (let i = 0; i < esler.length; i++) {
          const ez = await izOku(c.env, esler[i], frm, to)
          if (ez.length >= 3) girdi.mates.push({ iz: ez, line: RENK[i][0], dot: RENK[i][1] })
        }
      }
    } catch (e) { console.error('motor3d grup:', String(e).slice(0, 200)) }
  }

  let spec
  try {
    // token: harita-katman YUTAR (matching.js/geokod.js) — ama BOŞ olamaz:
    // route-video.py:31 `MB = MB or "yok"` ve map_match `if not MB: return None` ->
    // boş token map-match'i TAMAMEN atlatır, geometri değişirdi. Varsayılan 'yok' o tuzağı kapatır.
    const r = await specUret(iz, girdi, c.env.HARITA_UC, c.env.MAPBOX_TOKEN || 'yok', c.env.HARITA)
    spec = r.spec
    // route-video.py'nin print'lerinin eşleniği — map-match oturmazsa SESSİZ kalmasın
    console.log(`motor3d user=${user} iz=${iz.length} pts=${(spec.pts as unknown[]).length} kare=${spec.frames}` + (r.log.length ? ' | ' + r.log.join(' | ') : ''))
  } catch (e) {
    if (e instanceof SpecHata) hata(e.kod, e.detay)
    console.error('motor3d spec hata:', e)
    hata(500, 'spec uretilemedi')
  }

  let html: string
  try {
    const { js, css } = await vendorAl(c.env, c.executionCtx)
    html = surucuUret(sayfaUret(spec, js, css, '', ''))
  } catch (e) {
    console.error('motor3d html hata:', e)
    hata(500, 'html uretilemedi')
  }

  return c.json({ html, frames: spec.frames, fps: spec.fps, W: spec.W, H: spec.H })
})

export default g
