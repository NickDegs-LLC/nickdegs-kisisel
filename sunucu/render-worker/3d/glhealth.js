// GPU SAĞLIK TESTİ (~8-12sn): worker'ın WebGL'i GERÇEKTEN çalışıyor mu?
// Üretim (render-google3d.js) ile BİREBİR aynı flag'ler + asıl kırılan işlem olan SHADER DERLEME denenir.
// Çıktı: "OK <renderer>" (exit 0) | "BROKEN <sebep>" (exit 1).
// Amaç: bozuk-GL worker'a 25-35dk render başlatmadan 10 saniyede yakala -> rp_handler re-dispatch + refresh_worker (worker ÖLDÜRÜLÜR).
const puppeteer = require('puppeteer');

(async () => {
  let b;
  try {
    b = await puppeteer.launch({ headless: 'new', protocolTimeout: 45000,
      args: ['--no-sandbox', '--disable-setuid-sandbox',
             '--use-gl=angle', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl',
             '--window-size=320,240'] });
    const p = await b.newPage();
    const r = await p.evaluate(() => {
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2');
        if (!gl) return { ok: false, why: 'webgl2 yok' };
        // SHADER DERLE (bozuk worker'larda kırılan asıl işlem: createShader null döner)
        const vs = gl.createShader(gl.VERTEX_SHADER);
        if (!vs) return { ok: false, why: 'createShader null (GL bozuk)' };
        gl.shaderSource(vs, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}');
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS))
          return { ok: false, why: 'shader derlenemedi: ' + gl.getShaderInfoLog(vs) };
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        const ren = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        // GPU worker'da SwiftShader = donanım GL yok = Google 3D pratikte imkansız -> bozuk say
        if (/swiftshader/i.test(String(ren))) return { ok: false, why: 'SwiftShader (donanım GL yok): ' + ren };
        // 2026-09-01: llvmpipe = Mesa YAZILIMSAL GL. MIG diliminde (RTX PRO 6000 MIG 1g.24gb) OpenGL/EGL yok,
        // Chrome sessizce buna düşer: shader derlenir, test "OK" derdi ama 3B kare kare ~50x yavaş sürünür,
        // 180sn "harita hazır" zaman aşımı -> flyover (Semra'nın videosu 71 dk'da bitmedi). Donanım yok = BOZUK.
        if (/llvmpipe|softpipe/i.test(String(ren))) return { ok: false, why: 'llvmpipe (yazılımsal GL, donanım yok): ' + ren };
        return { ok: true, ren: String(ren) };
      } catch (e) { return { ok: false, why: 'exception: ' + e.message.slice(0, 120) }; }
    });
    if (r.ok) { console.log('OK ' + r.ren); process.exit(0); }
    console.log('BROKEN ' + r.why); process.exit(1);
  } catch (e) {
    console.log('BROKEN launch: ' + e.message.slice(0, 120)); process.exit(1);
  } finally { if (b) try { await b.close(); } catch (_) {} }
})();
