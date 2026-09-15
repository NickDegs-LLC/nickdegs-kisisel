// app.nickdegs.com — sunucusuz yönlendirici.
// Davet: API `https://app.nickdegs.com/?invite=<kod>` üretir (cf/api/src/routes/grup7.ts).
// Geçerli invite varsa mağazaya atmak yerine kodu gösteren sayfa döner; uygulama
// movelog://invite?code= ile açılır. Invite yoksa eski 302 (sorgu korunarak) kalır.
const HEDEF = 'https://nickdegs.com/movelog'

const YASAL = {
  '/privacy': 'https://nickdegs.com/legal/privacy',
  '/privacy.html': 'https://nickdegs.com/legal/privacy',
  '/terms': 'https://nickdegs.com/legal/terms',
  '/terms.html': 'https://nickdegs.com/legal/terms',
}

const DAVET_RE = /^[A-Za-z0-9_-]{6,32}$/
const IOS_MAGAZA = 'https://apps.apple.com/app/id6780779399'
const AND_MAGAZA = 'https://play.google.com/store/apps/details?id=com.nickdegs.movelog'

const AASA = {
  applinks: {
    details: [{
      appIDs: ['SZF4T3P583.com.nickdegs.kisisel'],
      components: [{ '/': '/', '?': { invite: '?*' }, comment: 'arkadaş daveti' }],
    }],
  },
}

// Parmak izi = Play uygulama İMZA anahtarı (androidpublisher generatedApks, versionCode 1789402801, 15.09).
const ASSETLINKS = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: 'com.nickdegs.movelog',
    sha256_cert_fingerprints: ['F9:A4:01:66:F8:37:BC:BC:BE:7C:79:55:41:2B:64:12:44:6C:66:61:B1:2F:0E:F9:B2:9E:C9:24:49:EA:1D:B6'],
  },
}]

export default {
  async fetch(req) {
    const u = new URL(req.url)
    if (YASAL[u.pathname]) return Response.redirect(YASAL[u.pathname], 302)

    // Apple Universal Links (AASA). JSON — Apple application/json kabul eder.
    if (u.pathname === '/.well-known/apple-app-site-association') {
      return json(AASA)
    }
    // Play Digital Asset Links — Android App Links doğrulaması (manifest autoVerify).
    if (u.pathname === '/.well-known/assetlinks.json') return json(ASSETLINKS)
    if (u.pathname.startsWith('/.well-known/')) return new Response('not found', { status: 404 })

    const invite = (u.searchParams.get('invite') || '').trim()
    if (DAVET_RE.test(invite)) return davetSayfasi(invite, dilTr(req))

    return Response.redirect(HEDEF + u.search, 302)
  },
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function dilTr(req) {
  const al = (req.headers.get('accept-language') || '').toLowerCase()
  return /(^|,|;|\s)tr(-|$|,|;)/.test(al) || al.startsWith('tr')
}

function kacis(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function davetSayfasi(kod, tr) {
  const T = tr ? {
    title: "Move Log'a davet edildin",
    copy: 'Kodu kopyala',
    copied: 'Kopyalandı',
    open: 'Uygulamada aç',
    ios: 'App Store',
    and: 'Google Play',
    hint: "Uygulamayı yükledikten sonra bu linke tekrar dokun ya da Profil → Davet kodu gir",
  } : {
    title: "You've been invited to Move Log",
    copy: 'Copy code',
    copied: 'Copied',
    open: 'Open in app',
    ios: 'App Store',
    and: 'Google Play',
    hint: 'After installing the app, tap this link again or go to Profile → Enter invite code',
  }
  const kodHtml = kacis(kod)
  const kodJs = JSON.stringify(kod)
  const html = `<!doctype html>
<html lang="${tr ? 'tr' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#05070c">
<title>${kacis(T.title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100%;background:#05070c;color:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}
body{display:flex;align-items:center;justify-content:center;padding:28px 20px}
.wrap{width:100%;max-width:420px;text-align:center}
h1{font-size:1.45rem;font-weight:800;letter-spacing:-.02em;margin-bottom:8px}
.sub{color:#9aa4b2;font-size:.92rem;margin-bottom:22px}
.code{font-size:1.85rem;font-weight:700;letter-spacing:.08em;padding:18px 14px;border-radius:16px;
  background:#111827;border:1px solid rgba(255,255,255,.12);user-select:all;-webkit-user-select:all;
  word-break:break-all;margin-bottom:16px}
button,.btn{display:block;width:100%;padding:14px 16px;border-radius:14px;font-size:1rem;font-weight:650;
  text-decoration:none;border:0;cursor:pointer;margin-top:10px}
#copy{background:#1f2937;color:#fff}
#open{background:#00e5ff;color:#041016}
.stores{display:flex;gap:10px;margin-top:10px}
.stores a{flex:1;background:#1f2937;color:#fff;text-align:center}
.hint{color:#9aa4b2;font-size:.82rem;line-height:1.45;margin-top:22px}
</style>
</head>
<body>
<div class="wrap">
  <h1>${kacis(T.title)}</h1>
  <p class="sub">Move Log</p>
  <div class="code" id="kod">${kodHtml}</div>
  <button id="copy" type="button">${kacis(T.copy)}</button>
  <button id="open" type="button">${kacis(T.open)}</button>
  <div class="stores">
    <a class="btn" href="${IOS_MAGAZA}">${kacis(T.ios)}</a>
    <a class="btn" href="${AND_MAGAZA}">${kacis(T.and)}</a>
  </div>
  <p class="hint">${kacis(T.hint)}</p>
</div>
<script>
(function(){
  var KOD = ${kodJs};
  var COPY = ${JSON.stringify(T.copy)};
  var COPIED = ${JSON.stringify(T.copied)};
  var IOS = ${JSON.stringify(IOS_MAGAZA)};
  var AND = ${JSON.stringify(AND_MAGAZA)};
  function magaza(){
    if (document.hidden) return;
    var ua = navigator.userAgent || '';
    location.href = /iPhone|iPad|iPod/i.test(ua) ? IOS : AND;
  }
  document.getElementById('open').onclick = function(){
    location.href = 'movelog://invite?code=' + encodeURIComponent(KOD);
    setTimeout(magaza, 1500);
  };
  document.getElementById('copy').onclick = function(){
    var b = document.getElementById('copy');
    function ok(){ b.textContent = COPIED; setTimeout(function(){ b.textContent = COPY; }, 1600); }
    function yedek(){
      var a = document.createElement('textarea'); a.value = KOD; document.body.appendChild(a); a.select();
      try { document.execCommand('copy'); ok(); } catch (e) {}
      document.body.removeChild(a);
    }
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(KOD).then(ok).catch(yedek);
    else yedek();
  };
})();
</script>
</body>
</html>`
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
