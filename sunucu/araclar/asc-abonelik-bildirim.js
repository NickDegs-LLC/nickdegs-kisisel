// App Store abonelik bildirimleri (V2) — ASC URL oku/yaz + App Store Server API test bildirimi.
// Kullanım (Mac):  node asc-abonelik-bildirim.js oku | yaz | test
// Anahtarlar: ~/.nickdegs/imza/apple (ASC API 34Z5BMUJ8F, In-App Purchase B3HV7576P4). Değer basılmaz.
const fs = require('fs'), crypto = require('crypto'), os = require('os')
const A = os.homedir() + '/.nickdegs/imza/apple'
const conf = Object.fromEntries(fs.readFileSync(A + '/asc.conf', 'utf8').split('\n')
  .map((l) => l.replace(/^export\s+/, '').match(/^([A-Z_]+)=["']?(.*?)["']?$/)).filter(Boolean).map((m) => [m[1], m[2]]))
const APP_ID = '6780779399', BUNDLE = 'com.nickdegs.kisisel'
const URL_BILDIRIM = 'https://kisisel-api.nickdegs.com/api/iap/apple/bildirim'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function jwt(kid, keyFile, ekPayload) {
  const now = Math.floor(Date.now() / 1000)
  const h = b64({ alg: 'ES256', kid, typ: 'JWT' })
  const p = b64({ iss: conf.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1', ...ekPayload })
  const s = crypto.sign('sha256', Buffer.from(h + '.' + p), { key: fs.readFileSync(keyFile), dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${h}.${p}.${s}`
}
const ascJwt = () => jwt('34Z5BMUJ8F', A + '/AuthKey_34Z5BMUJ8F.p8', {})
const iapJwt = () => jwt(conf.IAP_SUBSCRIPTION_KEY_ID, A + `/SubscriptionKey_${conf.IAP_SUBSCRIPTION_KEY_ID}.p8`, { bid: BUNDLE })
const alanlar = 'subscriptionStatusUrl,subscriptionStatusUrlVersion,subscriptionStatusUrlForSandbox,subscriptionStatusUrlVersionForSandbox'
async function oku() {
  const r = await fetch(`https://api.appstoreconnect.apple.com/v1/apps/${APP_ID}?fields[apps]=${alanlar}`, { headers: { Authorization: 'Bearer ' + ascJwt() } })
  const j = await r.json(); console.log('ASC oku', r.status, JSON.stringify(j.data ? j.data.attributes : j).slice(0, 500))
}
async function yaz() {
  const body = { data: { type: 'apps', id: APP_ID, attributes: {
    subscriptionStatusUrl: URL_BILDIRIM, subscriptionStatusUrlVersion: 'V2',
    subscriptionStatusUrlForSandbox: URL_BILDIRIM, subscriptionStatusUrlVersionForSandbox: 'V2' } } }
  const r = await fetch(`https://api.appstoreconnect.apple.com/v1/apps/${APP_ID}`, { method: 'PATCH',
    headers: { Authorization: 'Bearer ' + ascJwt(), 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json(); console.log('ASC yaz', r.status, JSON.stringify(j.data ? j.data.attributes : j).slice(0, 500))
}
async function test() {
  for (const [ad, host] of [['production', 'api.storekit.itunes.apple.com'], ['sandbox', 'api.storekit-sandbox.itunes.apple.com']]) {
    const r = await fetch(`https://${host}/inApps/v1/notifications/test`, { method: 'POST', headers: { Authorization: 'Bearer ' + iapJwt() } })
    const j = await r.json().catch(() => ({})); console.log('test iste', ad, r.status, JSON.stringify(j).slice(0, 200))
    if (!j.testNotificationToken) continue
    await new Promise((ok) => setTimeout(ok, 15000))
    const s = await fetch(`https://${host}/inApps/v1/notifications/test/${j.testNotificationToken}`, { headers: { Authorization: 'Bearer ' + iapJwt() } })
    const d = await s.json().catch(() => ({}))
    console.log('test sonuc', ad, s.status, JSON.stringify({ sendAttempts: d.sendAttempts, uuid: d.signedPayload ? JSON.parse(Buffer.from(d.signedPayload.split('.')[1], 'base64url')).notificationUUID : null }))
  }
}
const mod = process.argv[2]
;({ oku, yaz, test }[mod] || (() => { console.log('kullanım: oku | yaz | test'); process.exit(2) }))()
  .catch((e) => { console.error('HATA', String(e).slice(0, 200)); process.exit(1) })
