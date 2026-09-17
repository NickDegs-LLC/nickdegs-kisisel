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

    // VERI/HESAP SILME SAYFASI (17.09) — Play "Data safety" formu uygulama DISINDAN erisilebilen
    // bir silme baglantisi istiyor; sahte link kabul edilmiyor, Google denetliyor.
    if (u.pathname === '/hesap-sil' || u.pathname === '/delete-account'
        || u.pathname === '/delete' || u.pathname === '/sil') {
      return silmeSayfasi(dilTr(req))
    }

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

// Hesap ve veri silme sayfasi (Play Data safety zorunlulugu). Tek dosya, dis kaynak YOK.
function silmeSayfasi(tr) {
  const b = tr ? {
    t: 'Hesap ve veri silme', u: 'Move Log',
    g1: 'Uygulamadan sil (en hizlisi)',
    g1a: 'Move Log\u2019u ac \u2192 <b>Profil</b> sekmesi \u2192 en altta <b>Hesab\u0131 sil</b> \u2192 onayla. Hesab\u0131n an\u0131nda silinir, ayr\u0131ca bir istek g\u00f6ndermene gerek yoktur.',
    g2: 'Uygulaman yoksa / eri\u015femiyorsan',
    g2a: 'Hesab\u0131n\u0131 olu\u015ftururken kulland\u0131\u011f\u0131n e-posta adresinden a\u015fa\u011f\u0131daki adrese \u201chesap silme\u201d yazarak yaz. Kimli\u011fini do\u011frulad\u0131ktan sonra en ge\u00e7 30 g\u00fcn i\u00e7inde sileriz.',
    s1: 'Silinen veriler',
    s1a: 'Hesab\u0131n ve profil bilgilerin (ad, kullan\u0131c\u0131 ad\u0131, avatar), arkada\u015f listen ve arkada\u015flik istekleri, sohbet mesajlar\u0131n, davet kodlar\u0131n, bildirim kay\u0131tlar\u0131n ve cihaz kimli\u011fin <b>an\u0131nda</b> silinir. Gezi kay\u0131tlar\u0131n, olu\u015fturdu\u011fun videolar ve GPS izlerin <b>en ge\u00e7 30 g\u00fcn i\u00e7inde</b> kal\u0131c\u0131 olarak silinir.',
    s2: 'Saklanan veriler',
    s2a: 'Sat\u0131n alma ve abonelik kay\u0131tlar\u0131 (i\u015flem numaras\u0131, \u00fcr\u00fcn, tarih) yasal ve muhasebe y\u00fck\u00fcml\u00fcl\u00fckleri gere\u011fi saklan\u0131r. Bu kay\u0131tlarda ad\u0131n, kullan\u0131c\u0131 ad\u0131n, e-postan veya avatar\u0131n yer almaz; yaln\u0131zca iade ve abonelik e\u015fle\u015ftirmesi i\u00e7in gereken i\u00e7 hesap numaras\u0131 kal\u0131r.',
    i: 'Silme geri al\u0131namaz. Aktif bir aboneli\u011fin varsa hesab\u0131 silmek aboneli\u011fi iptal etmez \u2014 iptali App Store veya Google Play \u00fczerinden yapman gerekir.',
    e: '\u0130leti\u015fim',
  } : {
    t: 'Account and data deletion', u: 'Move Log',
    g1: 'Delete from the app (fastest)',
    g1a: 'Open Move Log \u2192 <b>Profile</b> tab \u2192 <b>Delete account</b> at the bottom \u2192 confirm. Your account is deleted immediately; no request needed.',
    g2: 'If you no longer have the app',
    g2a: 'Email us from the address you used for your account with the subject \u201caccount deletion\u201d. After verifying your identity we delete it within 30 days.',
    s1: 'What is deleted',
    s1a: 'Your account and profile (name, username, avatar), friends and friend requests, chat messages, invite codes, notification records and device identifier are deleted <b>immediately</b>. Your ride records, generated videos and GPS traces are permanently deleted <b>within 30 days</b>.',
    s2: 'What is kept',
    s2a: 'Purchase and subscription records (transaction id, product, date) are retained for legal and accounting obligations. They contain no name, username, email or avatar — only the internal account number needed to match refunds and subscriptions.',
    i: 'Deletion cannot be undone. Deleting your account does not cancel an active subscription \u2014 cancel it in the App Store or Google Play.',
    e: 'Contact',
  }
  const html = `<!doctype html><html lang="${tr ? 'tr' : 'en'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${b.t} \u2014 ${b.u}</title><style>
:root{color-scheme:light dark}
body{margin:0;padding:32px 20px;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:#0a0e17;color:#e6e9ef;display:flex;justify-content:center}
main{max-width:640px;width:100%}
h1{font-size:26px;margin:0 0 4px}
.u{color:#6ea8fe;font-weight:600;margin-bottom:26px}
h2{font-size:17px;margin:26px 0 6px;color:#fff}
p{margin:0 0 10px;color:#c7cdd8}
.k{background:#121826;border:1px solid #1f2937;border-radius:10px;padding:14px 16px;margin:14px 0}
a{color:#6ea8fe}
.uy{border-left:3px solid #f0a020;padding-left:12px;color:#d8c08a;margin-top:22px}
footer{margin-top:30px;font-size:13px;color:#7b8494}
</style></head><body><main>
<h1>${b.t}</h1><div class="u">${b.u}</div>
<div class="k"><h2>${b.g1}</h2><p>${b.g1a}</p></div>
<div class="k"><h2>${b.g2}</h2><p>${b.g2a}</p>
<p><a href="mailto:business@nickdegs.com?subject=Move%20Log%20hesap%20silme">business@nickdegs.com</a></p></div>
<h2>${b.s1}</h2><p>${b.s1a}</p>
<h2>${b.s2}</h2><p>${b.s2a}</p>
<p class="uy">${b.i}</p>
<footer>${b.e}: <a href="mailto:business@nickdegs.com">business@nickdegs.com</a> \u00b7 NickDegs</footer>
</main></body></html>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
