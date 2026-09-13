#!/usr/bin/env node
// TELEFON SAYFASI TEST SÜRÜCÜSÜ — WKWebView'ın yapacağının birebir simülasyonu:
// sayfayı yükle, motorHazir -> intro -> kareCiz(0..N) -> finalCiz(0..M), her adımda screenshot -> ffmpeg.
// Kullanım: node telefon-test.js <sayfa.html> <cikti.mp4> [maxKare]
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');

(async () => {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  const out = process.argv[3];
  const cap = parseInt(process.argv[4] || '0', 10);
  const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 600000,
    args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader',
           '--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window._ready===true', { timeout: 60000 });
  const M = await page.evaluate(() => window.MOTOR);
  await page.setViewport({ width: M.W, height: M.H, deviceScaleFactor: 1 });
  await new Promise(r => setTimeout(r, 1200));
  const frames = cap > 0 ? Math.min(cap, M.frames) : M.frames;
  const fd = 0.8, dur = (M.introN + frames + M.outroN) / M.fps;
  const ff = spawn('ffmpeg', ['-y','-f','image2pipe','-framerate',String(M.fps),'-i','-',
    '-f','lavfi','-i','anullsrc=r=44100:cl=stereo',
    '-vf',`fade=t=in:st=0:d=${fd},fade=t=out:st=${Math.max(0,dur-fd).toFixed(2)}:d=${fd}`,
    '-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-crf','25',
    '-c:a','aac','-shortest','-movflags','+faststart',out], { stdio: ['pipe','ignore','inherit'] });
  const shot = () => page.screenshot({ type:'jpeg', quality:92, clip:{x:0,y:0,width:M.W,height:M.H} });
  await page.evaluate(() => window.motorHazir());
  console.log('hazır; intro...');
  if (await page.evaluate(() => window.introCiz())) {
    const b = await shot();
    for (let k = 0; k < M.introN; k++) ff.stdin.write(b);
  }
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate(x => window.kareCiz(x), f);
    ff.stdin.write(await shot());
    if (f % 120 === 0) console.log(`kare ${f}/${frames} (${((Date.now()-t0)/1000)|0}s)`);
  }
  console.log('outro...');
  for (let k = 0; k < M.outroN; k++) {
    await page.evaluate(x => window.finalCiz(x), k);
    ff.stdin.write(await shot());
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log('TELEFON-SIM OK: ' + out);
})().catch(e => { console.error('HATA:', e.message); process.exit(1); });
