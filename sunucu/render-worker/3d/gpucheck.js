// GPU teşhis: birçok GL flag kombinasyonunu dener, her birinin WebGL renderer'ını yazar.
// Amaç: NVIDIA L4'ü gerçekten kullanan kombinasyonu bulmak (SwiftShader değil).
const puppeteer = require('puppeteer');

const BASE = ['--no-sandbox','--disable-setuid-sandbox','--ignore-gpu-blocklist','--enable-webgl','--window-size=600,400'];
const COMBOS = {
  'A_angle_gl_noVulkan': ['--use-gl=angle','--use-angle=gl','--disable-features=Vulkan','--enable-gpu'],
  'B_use_gl_egl':        ['--use-gl=egl','--enable-gpu'],
  'C_angle_glegl':       ['--use-gl=angle','--use-angle=gl-egl','--enable-gpu'],
  'D_angle_vulkan':      ['--use-gl=angle','--use-angle=vulkan','--enable-gpu','--enable-features=Vulkan'],
  'E_angle_gl_ozone':    ['--use-gl=angle','--use-angle=gl','--ozone-platform=headless','--disable-features=Vulkan','--enable-gpu'],
  'F_egl_surfaceless':   ['--use-gl=egl','--ozone-platform=surfaceless','--enable-gpu'],
};

async function tryCombo(name, args) {
  let b;
  try {
    b = await puppeteer.launch({headless:'new',protocolTimeout:30000,args:[...BASE,...args]});
    const p = await b.newPage();
    const info = await p.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return {webgl:false};
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return {r: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)};
    });
    return name + ' => ' + (info.webgl===false ? 'NO_WEBGL' : info.r);
  } catch (e) {
    return name + ' => ERR ' + e.message.slice(0,80);
  } finally { if (b) try { await b.close(); } catch(_){} }
}

(async () => {
  for (const [name, args] of Object.entries(COMBOS)) {
    console.log(await tryCombo(name, args));
  }
})();
