// ⚠️ OTOMATİK ÜRETİLDİ — ELLE DÜZENLEME. Kaynak: /opt/matrix/render-worker/3d/telefon-html.js (satır 33..189)
// Üretici: cf/tools/motor3d/uret.mjs · kaynak SHA-256: 93ffdf0e4a57909739d0f819ecaaa721e931da05161d275270a241945059e2dd
// Değişiklik SADECE mekanik: mod.exports destructuring -> fonksiyon parametresi; fs.writeFileSync -> return.
/* eslint-disable */
export function surucuUret(m) {
  const { HTML, IN, smPath, pts, frames, fps, zoom, pitch, title, W, H, OW, OH } = m;
// Sürücünün ihtiyacı olan Node-tarafı türetilmiş değerler (render3d.js sürücüsüyle AYNI formüller)
const N = pts.length;
let maxSpd = 0, maxI = 0;
for (let i = 0; i < N; i++) { const sp = pts[i].spd || 0; if (sp > maxSpd) { maxSpd = sp; maxI = i; } }
const FIDX = IN.frameIdx || null;
let maxFrame = 0, _bd = 1e9;
for (let f = 0; f < frames; f++) { const fi = FIDX ? FIDX[f] : f * (N - 1) / (frames - 1); const d = Math.abs(fi - maxI); if (d < _bd) { _bd = d; maxFrame = f; } }
const pinFrames = Math.max(30, Math.round(fps * 1.6));
const introN = Math.round(fps * 1.6), outroN = IN.satStyle ? Math.round(fps * 6.0) : Math.round(fps * 3.2);

// ═══ SAYFA-İÇİ SÜRÜCÜ — render3d.js satır ~336-476 + outro'nun BİREBİR taşınması ═══
// Fark SADECE mekanik: `await page.evaluate((a)=>X,(arg))` -> doğrudan `X`; screenshot/ffmpeg yok
// (kareyi ÇAĞIRAN yakalar: WKWebView takeSnapshot / puppeteer screenshot).
const D = {
  frames, fps, zoom, pitch, N, maxI, maxSpd, maxFrame, pinFrames, introN, outroN,
  title, sm: smPath, pts,
  FIDX,
  satStyle: !!IN.satStyle, kabartma: !!IN.kabartma, noHud: !!IN.noHud,
  dwellZoom: IN.dwellZoom, sideAngle: IN.sideAngle, deadzone: IN.deadzone,
  name: IN.name || '', activity: IN.activity || '', stats: IN.stats || [(title && title.totkm || '') + ' km'],
  mates: IN.mates || [],
};
const SURUCU = `
<script>
(function(){
const D=${JSON.stringify(D)};
const {frames,fps,zoom,pitch,N,maxI,maxSpd,maxFrame,pinFrames,introN,outroN,title}=D;
const sm=D.sm, pts=D.pts, FIDX=D.FIDX, IN=D;
// ZIPLAMA FIKSI (04.09) - yumusatma katsayilari 60fps'e gore ayarlanmis, fps terimi yoktu.
// TELEFON hatti 30fps kostugu icin her EMA yari hizda ilerliyor: kare basi yer degistirme ve
// kalici gecikme iki katina cikiyordu. OLCULDU (30fps telefon videosu): saniyede 3,01 sicrama,
// taban hareketin 9,2 kati; 60fps bulut referansi 1,55/sn ve 4,6x.
// a_eff = 1-(1-a60)^(60/fps) -> zaman sabiti kare hizindan bagimsiz.
const _A=(a60)=>(fps===60?a60:1-Math.pow(1-a60,60/fps));
const angd=(a,b)=>((a-b+540)%360)-180;
function bearing(a,b){const la1=a.lat*Math.PI/180,la2=b.lat*Math.PI/180,dl=(b.lon-a.lon)*Math.PI/180;
  const y=Math.sin(dl)*Math.cos(la2),x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dl);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;}
function hav(a,b){const R=6371000,r=Math.PI/180;const dla=(b.lat-a.lat)*r,dlo=(b.lon-a.lon)*r;
  const h=Math.sin(dla/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlo/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));}
// ── sürücü durumu (render3d.js ile birebir başlangıçlar) ──
const Zd=(IN.satStyle?0:(IN.dwellZoom||2.2));
const sideBase=(IN.sideAngle!==undefined?IN.sideAngle:40);
let camB=null, camLon=sm[0].lon, camLat=sm[0].lat, camZ=zoom, camPit=pitch, dw=0, tzS=zoom, tpS=pitch;
const mE=(IN.mates||[]).map(m=>({lon:m.pos2[0][0],lat:m.pos2[0][1]}));
let altT=null, altS=null, alt0=null;
let tcLon=sm[0].lon, tcLat=sm[0].lat;
let mLon=sm[0].lon, mLat=sm[0].lat;
window.MOTOR={frames:frames,fps:fps,introN:introN,outroN:outroN,W:${OW},H:${OH}};
window.motorHazir=async function(){
  // karo ön-ısıtma (v91, satStyle) — render3d ile aynı: 9 durak
  if(IN.satStyle){
    const _i0w=0,_i1w=N-1,_stepw=Math.max(1,Math.floor((_i1w-_i0w)/8));
    for(let _iw=_i0w;_iw<=_i1w;_iw+=_stepw){
      window.setPos(sm[_iw].lon,sm[_iw].lat,sm[_iw].lon,sm[_iw].lat,0,zoom,pitch);
      await window.waitIdle(2500);
    }
  }
  window.setPos(sm[0].lon,sm[0].lat,sm[0].lon,sm[0].lat,0,zoom,pitch);
  await window.waitIdle(420);
  return true;
};
window.introCiz=async function(){
  if(IN.noHud) return false;
  window.drawIntro(IN.name||'',IN.activity||'',(title&&title.date)||'');
  return true;
};
window.kareCiz=async function(f){
  if(IN.kabartma && f%45===0){ try{ window.yukUygula(); }catch(e){} }
  const fi=FIDX?FIDX[f]:f*(N-1)/(frames-1);
  const i0=Math.max(0,Math.min(N-1,Math.floor(fi))), i1=Math.min(N-1,i0+1), fr=fi-i0;
  const L=(a,b)=>a+(b-a)*fr;
  const p={lon:L(pts[i0].lon,pts[i1].lon), lat:L(pts[i0].lat,pts[i1].lat),
           spd:L(pts[i0].spd||0,pts[i1].spd||0), cum:L(pts[i0].cum||0,pts[i1].cum||0),
           dwell:pts[i0].dwell, tm:pts[i0].tm, poi:pts[i0].poi||'', hr:pts[i0].hr};
  const c={lon:L(sm[i0].lon,sm[i1].lon), lat:L(sm[i0].lat,sm[i1].lat)};
  mLon+=(p.lon-mLon)*_A(0.35); mLat+=(p.lat-mLat)*_A(0.35);
  dw+=((p.dwell?1:0)-dw)*0.022;
  let tzRaw=zoom+dw*Zd;
  if(IN.satStyle){
    const _a0=pts[i0].alt, _a1=pts[i1].alt;
    const _ga=(typeof _a0==='number'?_a0:(typeof _a1==='number'?_a1:0));
    const _gb=(typeof _a1==='number'?_a1:_ga);
    const _g=_ga+(_gb-_ga)*fr;
    altT=(altT===null)?_g:altT+(_g-altT)*0.06; altS=(altS===null)?altT:altS+(altT-altS)*0.09;
    if(alt0===null) alt0=altS;
    tzRaw=zoom-(altS-alt0)/1200;
  }
  tzS+=(tzRaw-tzS)*_A(0.012); camZ+=(tzS-camZ)*_A(0.02);
  const tpRaw=IN.satStyle?pitch:(pitch-dw*(pitch-50));
  tpS+=(tpRaw-tpS)*0.012; camPit+=(tpS-camPit)*0.02;
  let j=i0,dd=0; while(j<N-1 && dd<300){dd+=hav(sm[j],sm[j+1]); j++;}
  const tb=bearing({lon:camLon,lat:camLat}, sm[j]);
  camB=(camB===null)?tb:camB+angd(tb,camB)*0.01;
  if(IN.satStyle){
    tcLon+=(mLon-tcLon)*_A(0.22); tcLat+=(mLat-tcLat)*_A(0.22);
    camLon+=(tcLon-camLon)*_A(0.25); camLat+=(tcLat-camLat)*_A(0.25);
  } else {
    tcLon+=(c.lon-tcLon)*_A(0.06); tcLat+=(c.lat-tcLat)*_A(0.06);
    const dpos=hav({lon:camLon,lat:camLat},{lon:tcLon,lat:tcLat});
    const DZ=(IN.deadzone||10);
    // Sert kapi (hata DZ'yi asana dek kamera DURUR, sonra bosalir) tut-bosalt dongusu uretiyordu.
    // Yerine surekli rampa: kazanc DZ..2*DZ arasinda smoothstep ile 0'dan tam degere cikar.
    const _k=Math.max(0,Math.min(1,(dpos-DZ)/DZ));
    const _g=_A(0.05)*(_k*_k*(3-2*_k));
    camLon+=(tcLon-camLon)*_g; camLat+=(tcLat-camLat)*_g;
  }
  const sideOff=sideBase + 4*Math.sin(f/Math.max(1,frames)*Math.PI*2);
  const brg=(((camB+sideOff)%360)+360)%360;
  const mArr=(IN.mates||[]).map((m,i)=>{const pp=m.pos2[Math.min(f,m.pos2.length-1)];const e=mE[i];
    e.lon+=(pp[0]-e.lon)*0.35; e.lat+=(pp[1]-e.lat)*0.35; return [e.lon,e.lat];});
  if(mArr.length) window.setPosAll(mArr);
  window.setPos(mLon,mLat,camLon,camLat,brg,camZ,camPit);
  window.draw({title:title.date+'  •  '+title.totkm+' km', tm:p.tm, spd:p.spd, cum:p.cum, hr:p.hr,
    poi:(p.poi||''), poiA:dw,
    hudA:Math.max(0,Math.min(1, f/(fps*0.9), (frames-1-f)/(fps*0.9)+(IN.satStyle?0:1))),
    pinLon:pts[maxI].lon, pinLat:pts[maxI].lat, pinSpd:maxSpd,
    pinA:Math.max(0,1-Math.abs(f-maxFrame)/pinFrames)});
  await window.waitIdle(IN.satStyle?2000:340);
  window._sonKamera={lon:camLon,lat:camLat,z:camZ,pit:camPit,b:(camB===null?0:camB)};
  return true;
};
// ── OUTRO (render3d.js SEG_LAST bloğunun birebir sayfa-içi hali) ──
let _fit=null,_z0=null,_lo0=null,_la0=null,_p0=null,_b0=null;
window.finalCiz=async function(k){
  if(!IN.satStyle){
    if(IN.noHud) return false;
    if(k===0) window.drawOutro(IN.stats);
    return true;   // çağıran aynı kareyi outroN kez kullanabilir (k>0 çizim değişmez)
  }
  const zoomN=Math.round(fps*4.2), holdN=Math.max(1,outroN-zoomN);
  if(k===0){
    let bw=1e9,be=-1e9,bs=1e9,bn=-1e9;
    for(const p of pts){ if(p.lon<bw)bw=p.lon; if(p.lon>be)be=p.lon; if(p.lat<bs)bs=p.lat; if(p.lat>bn)bn=p.lat; }
    _fit=window.fitInfo(bw,be,bs,bn);
    const s=window._sonKamera||{lon:camLon,lat:camLat,z:camZ,pit:camPit,b:(camB===null?0:camB)};
    _z0=s.z;_lo0=s.lon;_la0=s.lat;_p0=s.pit;_b0=s.b;
  }
  const GLOBE_Z=1.9;
  if(k<zoomN){
    let u=k/Math.max(1,zoomN-1);
    let zz,lo,la;
    if(u<0.5){ let t=u/0.5; t=t*t*(3-2*t);
      zz=_z0+((_fit.zoom-0.2)-_z0)*t; lo=_lo0+(_fit.lon-_lo0)*t; la=_la0+(_fit.lat-_la0)*t; }
    else { let t=(u-0.5)/0.5; t=t*t*(3-2*t);
      zz=(_fit.zoom-0.2)+(GLOBE_Z-(_fit.zoom-0.2))*t; lo=_fit.lon; la=_fit.lat; }
    const pp=_p0*(1-Math.min(1,u*2)), bb=_b0+angd(0,_b0)*Math.min(1,u*2);
    window.setPos(mLon,mLat,lo,la,bb,zz,pp);
    window.draw({title:title.date+'  •  '+title.totkm+' km', tm:'', spd:0, cum:(pts[N-1].cum||0), hr:null, poi:'', poiA:0,
      hudA:Math.max(0,1-u*2.2),
      pinLon:pts[maxI].lon, pinLat:pts[maxI].lat, pinSpd:0, pinA:0});
    await window.waitIdle(1200);
    return true;
  }
  const hk=k-zoomN;
  const rampN=IN.noHud?0:Math.min(holdN,Math.round(fps*0.7));
  if(hk<=rampN && !IN.noHud){
    let a=hk/Math.max(1,rampN); a=a*a*(3-2*a);
    window.drawWorldStats(IN.stats,a);
  }
  return true;
};
})();
</script>`;

const son = HTML.replace('</script></body></html>', '</script>' + SURUCU + '</body></html>');
  return son;
}
