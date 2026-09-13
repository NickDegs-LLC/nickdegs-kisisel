// movelog-api — FastAPI backend'in (main.py, 110 uç) Cloudflare Worker portu. GÖLGE MOD.
// 8 grup alt-uygulaması '/' köküne mount edilir; her grup uçlarını TAM yol ile kaydeder.
// Hata biçimi FastAPI ile birebir: {"detail": ...} (lib/hata.ts), 404 = {"detail":"Not Found"}.

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from './lib/env'
import { hataHandler, hataYanit } from './lib/hata'
import grup1 from './routes/grup1'
import grup2 from './routes/grup2'
import grup3 from './routes/grup3'
import grup4 from './routes/grup4'
import grup5 from './routes/grup5'
import grup6 from './routes/grup6'
import grup7 from './routes/grup7'
import grup8 from './routes/grup8'
import motor3d from './routes/motor3d'   // POST /api/motor3d — telefonda video üretme sayfası (harita-proxy.py:397 portu)

const app = new Hono<AppEnv>()

// main.py:118 CORSMiddleware(allow_origins=['*'], allow_methods=['*'], allow_headers=['*']) eşleniği
app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['*'] }))

app.onError((err) => hataHandler(err))
app.notFound(() => hataYanit(404, 'Not Found'))   // FastAPI varsayılan 404 gövdesi

// Gruplar önce mount edilir — grup7 gerçek GET /health'i doldurunca (sözleşme #1) o kazanır,
// aşağıdaki çekirdek /health yalnız yedek (fallback) olarak kalır.
for (const g of [grup1, grup2, grup3, grup4, grup5, grup6, grup7, grup8, motor3d]) app.route('/', g)

// çekirdek sağlık ucu: D1 ping
app.get('/health', async (c) => {
  const r = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>().catch(() => null)
  return c.json({ ok: r?.ok === 1, ortam: c.env.ORTAM, worker: 'movelog-api' })
})

export default app
