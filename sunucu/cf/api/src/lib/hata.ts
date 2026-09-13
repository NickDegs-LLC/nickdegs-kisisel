// FastAPI HTTPException eşleniği — hata gövdesi BİREBİR {"detail": ...} biçiminde.
// Kullanım (iki yol, ikisi de aynı gövdeyi üretir):
//   1) throw yeni akış:   hata(401, 'token yok')            → index.ts onError yakalar
//   2) doğrudan Response: return hataYanit(404, 'video bulunamadı')

export class Hata extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail))
    this.name = 'Hata'
  }
}

/** FastAPI raise HTTPException(status, detail) eşleniği — fırlatır, onError yakalar. */
export function hata(status: number, detail: unknown): never {
  throw new Hata(status, detail)
}

/** {"detail": ...} JSON gövdesi ile ham Response (middleware/route içinden doğrudan dönmek için). */
export function hataYanit(status: number, detail: unknown): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** index.ts app.onError için: Hata → {"detail"}, bilinmeyen → Starlette gibi düz-metin 500. */
export function hataHandler(err: Error): Response {
  if (err instanceof Hata) return hataYanit(err.status, err.detail)
  // FastAPI/Starlette yakalanmamış istisnada text/plain "Internal Server Error" döner — birebir.
  console.error('yakalanmamis hata:', err.stack || err.message)
  return new Response('Internal Server Error', {
    status: 500,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
