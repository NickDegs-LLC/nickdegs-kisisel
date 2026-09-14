// app.nickdegs.com — sunucudaki nginx `app-nickdegs` sitesinin birebir karşılığı, tek farkla:
// sorgu dizesi korunur. API davet linki `https://app.nickdegs.com/?invite=<kod>` üretir
// (cf/api/src/routes/grup7.ts, POST /api/invite); eski 302 kodu yolda kaybediyordu.
const HEDEF = 'https://nickdegs.com/movelog'

const YASAL = {
  '/privacy': 'https://nickdegs.com/legal/privacy',
  '/privacy.html': 'https://nickdegs.com/legal/privacy',
  '/terms': 'https://nickdegs.com/legal/terms',
  '/terms.html': 'https://nickdegs.com/legal/terms',
}

export default {
  async fetch(req) {
    const u = new URL(req.url)
    if (YASAL[u.pathname]) return Response.redirect(YASAL[u.pathname], 302)
    // Evrensel link dosyaları (AASA / assetlinks) henüz yok — uydurma içerik sunma.
    if (u.pathname.startsWith('/.well-known/')) return new Response('not found', { status: 404 })
    return Response.redirect(HEDEF + u.search, 302)
  },
}
