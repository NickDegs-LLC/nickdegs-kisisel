// Google Photorealistic 3D Tiles (Cesium) ile GERÇEK foto-gerçekçi 3B uçuş.
// render3d.js (Mapbox) yerine geçer; AYNI girdi formatı + gkey (Google Maps API key).
// Kareler JPEG olarak ffmpeg image2pipe stdin'e yazılır -> mp4.
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');

const IN = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { fps, outMp4, ffmpeg, frames, title, pts } = IN;
const GKEY = IN.gkey || IN.token;
const OW = IN.W, OH = IN.H, RS = (IN.rscale && IN.rscale > 0) ? IN.rscale : 1;
const W = RS !== 1 ? Math.round(IN.W * RS / 2) * 2 : IN.W;
const H = RS !== 1 ? Math.round(IN.H * RS / 2) * 2 : IN.H;
const TILT = IN.tilt || 24;          // ufka göre bakış açısı (derece); düşük = sinematik/alçak
const DIST = IN.camdist === 'yakin' ? 340 : (IN.camdist === 'uzak' ? 640 : 470);

function bearing(a, b) { const r = Math.PI / 180; const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360; }
function hav(a, b) { const R = 6371000, r = Math.PI / 180; const dla = (b.lat - a.lat) * r, dlo = (b.lon - a.lon) * r;
  const x = Math.sin(dla / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const angd = (a, b) => ((a - b + 540) % 360) - 180;
// hafif yol yumuşatma (jitter için; çizgi ham pts kullanır)
const WINs = 4;
function smooth1(arr) { return arr.map((p, i) => { let a = Math.max(0, i - WINs), b = Math.min(arr.length - 1, i + WINs), so = 0, sa = 0, c = 0;
  for (let k = a; k <= b; k++) { so += arr[k].lon; sa += arr[k].lat; c++; } return { lon: so / c, lat: sa / c }; }); }
const smPath = smooth1(pts);

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://cesium.com/downloads/cesiumjs/releases/1.123/Build/Cesium/Cesium.js"></script>
<style>html,body{margin:0}#c{position:absolute;top:0;left:0;width:${W}px;height:${H}px}
#ov{position:absolute;top:0;left:0;pointer-events:none}
.cesium-widget-credits{font-size:10px!important;opacity:0.55!important}</style></head>
<body><div id="c"></div><canvas id="ov" width="${W}" height="${H}"></canvas>
<script>
window._ready=false; window._err=''; window._G={};
(async()=>{ try{
  Cesium.GoogleMaps.defaultApiKey='${GKEY}';
  const viewer=new Cesium.Viewer('c',{baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,
    navigationHelpButton:false,animation:false,timeline:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,
    imageryProvider:false,requestRenderMode:false,globe:false,skyBox:false,contextOptions:{webgl:{preserveDrawingBuffer:true}}});
  viewer.useBrowserRecommendedResolution=false; viewer.resolutionScale=1;
  viewer.scene.skyAtmosphere.show=true; viewer.scene.fog.enabled=true;
  // sabit gündüz ışığı (gece UTC'de sahne kararmasın)
  viewer.clock.currentTime=Cesium.JulianDate.fromIso8601('2025-06-15T09:00:00Z');
  viewer.scene.light=new Cesium.DirectionalLight({direction:Cesium.Cartesian3.normalize(new Cesium.Cartesian3(0.25,-0.35,-0.9),new Cesium.Cartesian3())});
  const _PAC=${(IN.camMode==='pacman'||IN.camMode==='pakman')?'true':'false'};
  const _CHASE=${(IN.camMode==='chase'||IN.camMode==='arka')?'true':'false'};
  window._tileFail=0; window._lastTileErr='';
  // TILE CONFIG (yeniden yüklemede tekrar uygulanabilsin diye fonksiyon): SSE + dynamic SSE + cache + hata sayacı.
  const _cfgTileset=(t)=>{
    t.maximumScreenSpaceError=_PAC?46:(_CHASE?40:30);
    t.dynamicScreenSpaceError=true; t.dynamicScreenSpaceErrorDensity=_PAC?0.0022:(_CHASE?0.0028:0.0018); t.dynamicScreenSpaceErrorFactor=_PAC?24:(_CHASE?22:16);
    t.cacheBytes=402653184; t.maximumCacheOverflowBytes=134217728;   // 512MB toplam (OOM önle)
    try{ t.tileFailed.addEventListener((e)=>{ window._tileFail++; try{ window._lastTileErr=(e && (e.message||e.statusCode||JSON.stringify(e)))+''; }catch(_x){} }); }catch(_e){}
  };
  let tileset=await Cesium.createGooglePhotorealistic3DTileset();
  _cfgTileset(tileset);
  viewer.scene.primitives.add(tileset);
  window._G={viewer,tileset,Cesium,route:null,marker:null};
  window._glLost=false;
  try{ viewer.canvas.addEventListener('webglcontextlost',()=>{window._glLost=true;},false); }catch(_e){}
  // KALICI FIX: tileset içeriği gelmezse (soğuk worker/geçici Google Tiles sorunu) process İÇİNDE YENİDEN yükle
  // -> re-dispatch'e gerek kalmadan aynı worker'da iyileşir. Siyah render kökten önlenir.
  window._G.reloadTiles=async()=>{
    try{ viewer.scene.primitives.remove(window._G.tileset); }catch(_e){}
    window._tileFail=0; window._lastTileErr='';
    const nt=await Cesium.createGooglePhotorealistic3DTileset();
    _cfgTileset(nt); viewer.scene.primitives.add(nt); window._G.tileset=nt;
  };
  window._G.tileStats=()=>{ try{ const st=window._G.tileset.statistics; return {ready:st.numberOfTilesWithContentReady, total:st.numberOfTilesTotal, fail:window._tileFail, err:window._lastTileErr}; }catch(e){ return {ready:-1,fail:window._tileFail,err:(''+e)}; } };
  window._G.trimTiles=()=>{ try{ window._G.tileset.trimLoadedTiles(); }catch(_e){} };
  window._G.fixSize=()=>{ const v=viewer,cv=v.canvas; cv.width=${W}; cv.height=${H}; cv.style.width='${W}px'; cv.style.height='${H}px'; v.resize(); };
  window._G.fixSize(); window._ready=true;
}catch(e){window._err=e.message;window._ready=true;} })();
// zemin yüksekliklerini örnekle (tüm rota)
window.sampleHeights=async(coords)=>{ const C=window._G.Cesium,s=window._G.viewer.scene;
  try{ const cs=coords.map(c=>C.Cartographic.fromDegrees(c[0],c[1])); const r=await s.sampleHeightMostDetailed(cs);
    return r.map(x=>(x&&x.height!=null)?x.height:20); }catch(e){ return coords.map(()=>20); } };
// rota çizgisi (zemin+4m, parlak) + konum noktası
// Rota yüksekliklerini TILESET yüzeyine clamp'le (GPS alt yerin ~24m altındaydı -> çizgi kayıyordu).
// clampToHeightMostDetailed gerekli tile'ları kendi yükler; yüzeye tam oturunca çizgi Mapbox gibi SABİT durur.
window.clampRoute=async(coords)=>{ const C=window._G.Cesium,s=window._G.viewer.scene,cam=window._G.viewer.camera;
  try{
    // kamerayı rota merkezine al (tile yükleme öncelensin) -> clamp tüm noktaları bulur
    let lon=0,lat=0; for(const c of coords){lon+=c[0];lat+=c[1];} lon/=coords.length; lat/=coords.length;
    cam.setView({destination:C.Cartesian3.fromDegrees(lon,lat,1400)});
    await new Promise(r=>{let n=0;const h=()=>{n++; if(window._G.tileset.tilesLoaded||n>180){s.postRender.removeEventListener(h);r();}}; s.postRender.addEventListener(h);});
    const carts=coords.map(c=>C.Cartesian3.fromDegrees(c[0],c[1],0));
    const r=await s.clampToHeightMostDetailed(carts);
    return r.map(x=>x?C.Cartographic.fromCartesian(x).height:null);
  }catch(e){ window._clampErr=e.message; return coords.map(()=>null); } };
window.addRoute=(coords,heights,lineCol,dotCol)=>{ const C=window._G.Cesium,v=window._G.viewer;
  // ÇİZGİ: overlay canvas'a her karede projekte edilir (globe kapalı photogrammetry'de entity render olmuyor).
  // ESKİ MAPBOX TASARIMI: TAM çizgi (baştan sona), zemine clamp'li -> haritaya kilitli, kaymaz.
  window._G.lineOn = !!(lineCol && lineCol!=='none');
  window._G.lineGlass = (lineCol==='glass');
  window._G.lineClear = (lineCol==='clear');   // renksiz tam şeffaf (en minimal cam)
  window._G.lineCol = window._G.lineOn ? ((window._G.lineGlass||window._G.lineClear) ? 'rgba(255,255,255,0.92)' : lineCol) : null;
  window._G.dotCol = dotCol || '#ff3b30';
  window._G.routeCart = coords.map((c,i)=>C.Cartesian3.fromDegrees(c[0],c[1],heights[i]+1.5));   // 3B rota noktaları (zemin+1.5m)
  // v104 (Barış): çizgi SAHNE İÇİNDE gerçek 3B polyline — binalar örter (depth test), kamerayla birebir
  // aynı karede render edilir (overlay projeksiyon yüzmesi sıfır). Overlay çizgi kapatılır (lineScene).
  if(window._G.lineOn){ try{
    const pos=coords.map((c,i)=>C.Cartesian3.fromDegrees(c[0],c[1],heights[i]+2.6));   // +2.6m: eğimli sokakta segment yola gömülmesin
    const W0=${W};
    const pc=new C.PolylineCollection();
    const mk=(w,r,g,b,a)=>pc.add({positions:pos,width:Math.max(2,Math.round(w)),
      material:C.Material.fromType('Color',{color:new C.Color(r,g,b,a)})});
    if(window._G.lineGlass||window._G.lineClear){
      mk(W0*0.021,0,0,0,0.16); mk(W0*0.017,1,1,1,0.15); mk(W0*0.006,1,1,1,0.90);   // glass: gölge+frosted gövde+rim
    } else {
      const cc=C.Color.fromCssColorString(window._G.lineCol||'#00e5ff');
      mk(W0*0.010,0,0,0,0.28); mk(W0*0.0055,cc.red,cc.green,cc.blue,0.62);
    }
    v.scene.primitives.add(pc);
    window._G.lineScene=true;
  }catch(e){ window._lineErr=e.message; window._G.lineScene=false; } }
  window._G.markerCart = C.Cartesian3.fromDegrees(coords[0][0],coords[0][1],heights[0]+2); };     // konum noktası (overlay projekte+clamp)
window.setMarker=(lon,lat,h)=>{ const C=window._G.Cesium;
  window._G.markerCart=C.Cartesian3.fromDegrees(lon,lat,h+2); };
// Marker'ı ÇİZGİNİN kendi noktalarından (routeCart) indeks-interpolasyonla türet -> nokta TANIM GEREĞİ hep çizgi üstünde,
// asla bina üstüne kaymaz (bağımsız lon/lat/height hesabı kayma yaratıyordu). fi yumuşatılmış kesirli indeks.
window.setMarkerIdx=(fi)=>{ const C=window._G.Cesium, rc=window._G.routeCart; if(!rc||!rc.length) return;
  window._G.markerFi=fi;
  const i0=Math.max(0,Math.min(rc.length-1,Math.floor(fi))), i1=Math.min(rc.length-1,i0+1), fr=fi-i0, a=rc[i0], b=rc[i1];
  window._G.markerCart=new C.Cartesian3(a.x+(b.x-a.x)*fr, a.y+(b.y-a.y)*fr, a.z+(b.z-a.z)*fr); };
// EASED lat/lon (render3d.js glide) + draw()'da çizgiye en yakın 2B noktaya snap -> yumuşak AMA hep çizgi üstünde, bina float yok
window.setMarkerPos=(lon,lat,h,fi)=>{ const C=window._G.Cesium;
  window._G.markerFi=fi;
  window._G.markerCart=C.Cartesian3.fromDegrees(lon,lat,h+2); };
// GRUP SÜRÜŞ (v113): N eş sürücü — her birine kendi renginde sahne çizgisi + indeks-interpolasyonlu marker
window.addRouteMate=(mi,coords,heights,lineCol,dotCol)=>{ const C=window._G.Cesium,v=window._G.viewer;
  window._G.routeCartM=window._G.routeCartM||[]; window._G.markerCartM=window._G.markerCartM||[]; window._G.dotColM=window._G.dotColM||[];
  window._G.dotColM[mi]=dotCol||'#FFD60A';
  window._G.routeCartM[mi]=coords.map((c,i)=>C.Cartesian3.fromDegrees(c[0],c[1],heights[i]+1.5));
  try{
    const pos=coords.map((c,i)=>C.Cartesian3.fromDegrees(c[0],c[1],heights[i]+2.6));
    const W0=${W};
    const pc=new C.PolylineCollection();
    const cc=C.Color.fromCssColorString(lineCol||'#FF9F0A');
    pc.add({positions:pos,width:Math.max(2,Math.round(W0*0.010)),material:C.Material.fromType('Color',{color:new C.Color(0,0,0,0.28)})});
    pc.add({positions:pos,width:Math.max(2,Math.round(W0*0.0055)),material:C.Material.fromType('Color',{color:new C.Color(cc.red,cc.green,cc.blue,0.62)})});
    v.scene.primitives.add(pc);
  }catch(e){ window._line2Err=e.message; }
  window._G.markerCartM[mi]=C.Cartesian3.fromDegrees(coords[0][0],coords[0][1],heights[0]+2); };
window.setMarkerMAll=(fis)=>{ const C=window._G.Cesium, R=window._G.routeCartM||[];
  for(let mi=0;mi<fis.length;mi++){ const rc=R[mi]; if(!rc||!rc.length) continue;
    const fi=fis[mi];
    const i0=Math.max(0,Math.min(rc.length-1,Math.floor(fi))), i1=Math.min(rc.length-1,i0+1), fr=fi-i0, a=rc[i0], b=rc[i1];
    window._G.markerCartM[mi]=new C.Cartesian3(a.x+(b.x-a.x)*fr, a.y+(b.y-a.y)*fr, a.z+(b.z-a.z)*fr); } };
window.setCam=(lon,lat,gh,hd,mbPitch,zoom,floor)=>{ const C=window._G.Cesium,cam=window._G.viewer.camera;
  const range=520*Math.pow(2,16.4-zoom);   // zoom -> kamera mesafesi (her +1 zoom ~ yarı mesafe)
  // ANTI-CLIP: kamera yüksekliği (gh + range*cos(mbPitch)) tabanın altındaysa DİKLEŞTİR (tepeye/binaya girmesin)
  let mp=mbPitch; for(let k=0;k<7 && (gh+range*Math.cos(mp*Math.PI/180))<floor; k++){ mp=Math.max(16,mp-8); }
  const target=C.Cartesian3.fromDegrees(lon,lat,gh);
  cam.lookAtTransform(C.Matrix4.IDENTITY);
  cam.lookAt(target,new C.HeadingPitchRange(hd*Math.PI/180, -(90-mp)*Math.PI/180, range)); };
window.tilesReady=(cap)=>new Promise(res=>{ let w=0; const iv=setInterval(()=>{ w+=200;
  if(window._G.tileset.tilesLoaded||w>=cap){clearInterval(iv);window._G.fixSize();for(let k=0;k<2;k++)window._G.viewer.scene.render();res();} },200); });

// ---- OVERLAY (HUD + intro/outro) — render3d.js ile aynı ----
const ov=document.getElementById('ov'),ctx=ov.getContext('2d');
let _wm=null; const _WM=${JSON.stringify(IN.wm || '')}; if(_WM){ _wm=new Image(); _wm.src=_WM; }
let _av=null; const _AV=${JSON.stringify(IN.avatarImg || '')}; if(_AV){ _av=new Image(); _av.src=_AV; }
const _NAME=${JSON.stringify(IN.name || '')};
const ACC='${IN.lineColor || '#00e5ff'}';
const _Wd=${W}, _Hd=${H}, _mg=Math.round(_Wd*0.05), _S=Math.min(_Wd,_Hd);  // _S: yazı/aralık tabanı — YATAY videoda taşma/üst üste binme fix'i (2026-07-11)
// avatar: foto varsa daireye kırp, yoksa baş-harf mavi dairesi (flat _circ/_initials birebir)
function _drawAvatar(cx,cy,size,a){ const r=size/2;
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,6.2832); ctx.clip();
  if(_av && _av.complete && _av.width){ ctx.globalAlpha=a; ctx.drawImage(_av,cx-r,cy-r,size,size); }
  else { ctx.globalAlpha=a; ctx.fillStyle='rgb(38,86,156)'; ctx.fillRect(cx-r,cy-r,size,size);
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='700 '+Math.round(size*0.42)+'px DejaVu Sans, sans-serif';
    const ini=(_NAME.trim().split(/\\s+/).filter(w=>w!=='&'&&w!=='+').slice(0,2).map(w=>w[0]||'').join('')||'★').toUpperCase(); ctx.fillText(ini,cx,cy+Math.round(size*0.02)); }
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r+Math.round(size*0.026),0,6.2832); ctx.strokeStyle='#fff'; ctx.globalAlpha=0.92*a; ctx.lineWidth=Math.round(size*0.05); ctx.stroke(); ctx.restore(); }
window.drawFadeBlack=(al)=>{ ctx.clearRect(0,0,_Wd,_Hd); ctx.fillStyle='rgba(0,0,0,'+Math.min(1,Math.max(0,al))+')'; ctx.fillRect(0,0,_Wd,_Hd); };
window.blackOver=(al)=>{ if(al>0){ ctx.fillStyle='rgba(0,0,0,'+Math.min(1,al)+')'; ctx.fillRect(0,0,_Wd,_Hd); } };
window.draw=(s)=>{ctx.clearRect(0,0,_Wd,_Hd);
  const G=window._G, C=G.Cesium, cam=G.viewer.scene.camera;
  // MANUEL projeksiyon: kamera matrisleri -> ekran (frameState/GPU-CPU BAĞIMSIZ, deterministik).
  const vm=cam.viewMatrix, pm=cam.frustum.projectionMatrix;
  const proj=(cart)=>{ const v=C.Matrix4.multiplyByVector(vm,new C.Cartesian4(cart.x,cart.y,cart.z,1),new C.Cartesian4());
    const c=C.Matrix4.multiplyByVector(pm,v,new C.Cartesian4());
    if(!(c.w>1e-6)) return null; const x=(c.x/c.w*0.5+0.5)*_Wd, y=(1-(c.y/c.w*0.5+0.5))*_Hd;
    return (isFinite(x)&&isFinite(y))?{x:x,y:y}:null; };
  // Çizgi noktalarını BİR KEZ projekte et -> hem çizgi hem NOKTA aynı ekran noktalarını kullanır (nokta hep çizgi üstünde)
  const RP = G.routeCart ? G.routeCart.map(proj) : null;
  // ROTA ÇİZGİSİ — v104: sahne-içi primitive varsa (lineScene) overlay çizilmez (binalar örtsün);
  // primitive kurulamadıysa eski overlay'e düş (çizgisiz video OLMAZ)
  if(G.lineOn && G.routeCart && !G.lineScene){
    // ESKİ MAPBOX TASARIMI: TAM çizgi (baştan sona), zemine clamp'li -> haritaya kilitli, kaymaz.
    const P2=RP;
    const strokePath=(w,col,blur)=>{ ctx.save(); ctx.lineJoin='round'; ctx.lineCap='round'; ctx.strokeStyle=col; ctx.lineWidth=w;
      if(blur){ctx.shadowColor=col;ctx.shadowBlur=blur;} let on=false; ctx.beginPath();
      for(const p of P2){ if(!p){on=false;continue;} if(!on){ctx.moveTo(p.x,p.y);on=true;}else ctx.lineTo(p.x,p.y); } ctx.stroke(); ctx.restore(); };
    if(G.lineClear){
      // RENKSİZ TAM ŞEFFAF: en minimal cam — yol neredeyse tam görünür, sadece çok ince soluk cam kenarı
      strokePath(Math.round(_Wd*0.013),'rgba(0,0,0,0.10)',0);                               // çok hafif ayrım gölgesi
      strokePath(Math.round(_Wd*0.004),'rgba(255,255,255,0.55)',Math.round(_Wd*0.007));      // ince soluk highlight
    } else if(G.lineGlass){
      // LIQUID GLASS: şeffaf frosted gövde (yol içinden hafif görünür) + parlak ince rim (çık durur, göze batmaz)
      strokePath(Math.round(_Wd*0.021),'rgba(0,0,0,0.16)',0);                              // ince ayrım gölgesi
      strokePath(Math.round(_Wd*0.017),'rgba(255,255,255,0.15)',0);                         // frosted cam gövde
      strokePath(Math.round(_Wd*0.006),'rgba(255,255,255,0.90)',Math.round(_Wd*0.011));     // parlak rim highlight
    } else {
      // İNCE + YARI-ŞEFFAF: yol net görünsün (kullanıcı "çizgi cıvık" dedi) — daha ince + opaklık düşük
      strokePath(Math.round(_Wd*0.010),'rgba(0,0,0,0.28)',0);                          // ince soluk ayrım gölgesi
      ctx.save(); ctx.globalAlpha=0.62;                                                 // çekirdek opaklık düşür
      strokePath(Math.round(_Wd*0.0055),G.lineCol,Math.round(_Wd*0.009));               // ince renkli çekirdek + hafif glow
      ctx.restore();
    }
  }
  // KONUM NOKTASI: eased konumu (markerCart, render3d.js glide) ekrana projekte et -> ÇİZGİYE en yakın 2B noktaya SNAP et.
  // Böylece hareket YUMUŞAK (lat/lon glide) AMA nokta hep çizgi üstünde (bina float/yükseklik sapması yok).
  let q = G.markerCart ? proj(G.markerCart) : null;
  if(q && RP && RP.length>1){
    const fi = (G.markerFi!=null) ? G.markerFi : 0;
    const lo = Math.max(0, Math.floor(fi)-6), hi = Math.min(RP.length-2, Math.floor(fi)+6);   // arama penceresi (paralel yola snap'lemesin)
    let best=null, bestD=Infinity;
    for(let k=lo;k<=hi;k++){ const a=RP[k], b=RP[k+1]; if(!a||!b) continue;
      const dx=b.x-a.x, dy=b.y-a.y, L2=dx*dx+dy*dy;
      let t = L2>1e-9 ? ((q.x-a.x)*dx+(q.y-a.y)*dy)/L2 : 0; t=Math.max(0,Math.min(1,t));
      const px=a.x+dx*t, py=a.y+dy*t, d=(px-q.x)*(px-q.x)+(py-q.y)*(py-q.y);
      if(d<bestD){ bestD=d; best={x:px,y:py}; } }
    if(best) q=best;
  }
  { if(q){ const r=Math.round(_Wd*0.021);
    // EDGE-CLAMP KALDIRILDI: nokta doğrudan çizgi üstünde kalır (kenarda/dışında da). Clamp hızlanınca noktayı
    // kenara çekip çizgiden koparıyor + binalara sokuyordu (render3d.js/Mapbox de clamp'lemez, öylece taşar).
    const cx=q.x, cy=q.y;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx,cy,r,0,6.2832); ctx.fillStyle=(G.dotCol||'#ff3b30'); ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=7; ctx.fill();
    ctx.shadowBlur=0; ctx.lineWidth=Math.round(_Wd*0.006); ctx.strokeStyle='#fff'; ctx.stroke(); ctx.restore(); } }
  if(G.markerCartM){ for(let mi=0;mi<G.markerCartM.length;mi++){ const mc=G.markerCartM[mi]; if(!mc) continue;
    const q2=proj(mc);
    if(q2){ const r2=Math.round(_Wd*0.021);
      ctx.save();
      ctx.beginPath(); ctx.arc(q2.x,q2.y,r2,0,6.2832); ctx.fillStyle=(G.dotColM&&G.dotColM[mi])||'#FFD60A'; ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=7; ctx.fill();
      ctx.shadowBlur=0; ctx.lineWidth=Math.round(_Wd*0.006); ctx.strokeStyle='#fff'; ctx.stroke(); ctx.restore(); } } }
  let g=ctx.createLinearGradient(0,_Hd*0.70,0,_Hd); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,0.72)');
  ctx.fillStyle=g; ctx.fillRect(0,_Hd*0.70,_Wd,_Hd*0.30);
  // --- ŞIK HUD (v96, Barış "cilala"): cam kapsüller + ikonlar + yumuşak beliriş/çekilme (s.hudA) ---
  // Hikaye güvenli alan (v74) korunur: dikeyde üst %13.5 / alt %12.5.
  const _story=_Hd>_Wd, _topY=_story?0.135:0.060, _botY=_story?0.125:0.055, _poiY=_story?0.185:0.115;
  const hudA=(${IN.noHud?'0':'(s.hudA===undefined?1:Math.max(0,Math.min(1,s.hudA)))'});
  const pill=(x,y,w,h)=>{const r=h/2;   // LIQUID GLASS (v99, Barış): koyu zemin YOK — açık cam + ışık kenarı + mercek yanması
    const P=()=>{ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();};
    P(); let g=ctx.createLinearGradient(0,y,0,y+h);   // v102: DAHA şeffaf gövde (Barış: opaklığı düşür)
    g.addColorStop(0,'rgba(255,255,255,0.19)'); g.addColorStop(0.5,'rgba(255,255,255,0.08)'); g.addColorStop(1,'rgba(255,255,255,0.045)');
    ctx.fillStyle=g; ctx.fill();
    let rg=ctx.createLinearGradient(0,y,0,y+h);       // kenar ışığı ultra yumuşak
    rg.addColorStop(0,'rgba(255,255,255,0.50)'); rg.addColorStop(0.4,'rgba(255,255,255,0.16)'); rg.addColorStop(1,'rgba(255,255,255,0.09)');
    P(); ctx.lineWidth=1.3; ctx.strokeStyle=rg; ctx.stroke();
    ctx.save(); P(); ctx.clip();   // mercek yanması: ULTRA yumuşak, geniş yayılım
    let fg=ctx.createRadialGradient(x+h*0.9,y+h*0.1,0,x+h*0.9,y+h*0.1,h*2.3);
    fg.addColorStop(0,'rgba(255,255,255,0.26)'); fg.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=fg; ctx.fillRect(x,y,w,h); ctx.restore();};
  ctx.textAlign='left';
  if(hudA>0.01){ ctx.save(); ctx.globalAlpha=hudA; ctx.textBaseline='middle';
    const slide=(1-hudA)*_Hd*0.02;
    ctx.font='600 '+Math.round(_S*0.030)+'px DejaVu Sans, "Noto Color Emoji", sans-serif';
    const ttxt='📍 '+s.title;
    const th=Math.round(_Hd*0.050), tw=ctx.measureText(ttxt).width+th*1.5;
    const ty=Math.round(_Hd*_topY)-Math.round(th*0.62)-slide;
    pill(_mg,ty,tw,th);
    ctx.shadowColor='rgba(0,0,0,0.55)'; ctx.shadowBlur=7; ctx.fillStyle='rgba(255,255,255,0.97)'; ctx.fillText(ttxt,_mg+th*0.75,ty+th*0.54);
    ctx.font='700 '+Math.round(_S*0.037)+'px DejaVu Sans, "Noto Color Emoji", sans-serif';
    const btxt='🛣️ '+(s.cum/1000).toFixed(1)+' km'+(s.tm?('       🕘 '+s.tm):'')+(s.hr?('       ❤️ '+Math.round(s.hr)):'');
    const bh=Math.round(_Hd*0.058), bw2=ctx.measureText(btxt).width+bh*1.5;
    const by=_Hd-Math.round(_Hd*_botY)-Math.round(bh*0.62)+slide;
    pill(_mg,by,bw2,bh);
    ctx.shadowColor='rgba(0,0,0,0.55)'; ctx.shadowBlur=7; ctx.fillStyle='#fff'; ctx.fillText(btxt,_mg+bh*0.75,by+bh*0.54);
    ctx.restore(); ctx.textBaseline='alphabetic'; }
  if(s.poi && s.poiA>0.15){ ctx.save(); ctx.globalAlpha=Math.min(1,(s.poiA-0.15)/0.5);
    ctx.textAlign='center'; ctx.font='700 '+Math.round(_S*0.044)+'px DejaVu Sans, sans-serif';
    ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=8; ctx.fillStyle='#fff';
    ctx.fillText(s.poi, _Wd/2, Math.round(_Hd*_poiY)); ctx.restore(); }};
// INTRO — flat/flyover ile BİREBİR: solid koyu bg + avatar (büyüyerek) + isim + aktivite•tarih + alt çizgi, smoothstep alpha
window.drawIntro=(name,activity,date,a)=>{ if(a==null)a=1; ctx.clearRect(0,0,_Wd,_Hd);
  ctx.fillStyle='rgb(8,10,22)'; ctx.fillRect(0,0,_Wd,_Hd);
  const asz=Math.round(_S*0.204*(0.84+0.16*a)), ay=Math.round(_Hd*0.36);
  _drawAvatar(_Wd/2,ay,asz,a);
  const ny=ay+Math.round(asz/2)+Math.round(_S*0.050);
  ctx.textAlign='center'; ctx.textBaseline='middle';
  if(name&&name.trim()){ ctx.fillStyle='rgba(255,255,255,'+a+')'; ctx.font='700 '+Math.round(_S*0.044)+'px DejaVu Sans, sans-serif'; ctx.fillText(name.trim(),_Wd/2,ny); }
  ctx.strokeStyle='rgba(120,200,255,'+(0.86*a)+')'; ctx.lineWidth=3; const lw=Math.round(_S*0.111*a);
  ctx.beginPath(); ctx.moveTo(_Wd/2-lw,ny+Math.round(_S*0.029)); ctx.lineTo(_Wd/2+lw,ny+Math.round(_S*0.029)); ctx.stroke();
  ctx.fillStyle='rgba(160,200,255,'+(0.92*a)+')'; ctx.font='600 '+Math.round(_S*0.028)+'px DejaVu Sans, sans-serif';
  ctx.fillText([activity,date].filter(Boolean).join('  •  '),_Wd/2,ny+Math.round(_S*0.057));
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';};
// OUTRO — flat/flyover ile BİREBİR: kararan harita + vignette üstünde avatar + isim + aktivite + alt çizgi + zengin istatistik + logo
window.drawOutro=(name,activity,stats,a)=>{ if(a==null)a=1; ctx.clearRect(0,0,_Wd,_Hd);
  ctx.fillStyle='rgba(0,0,0,0.66)'; ctx.fillRect(0,0,_Wd,_Hd);
  const rg=ctx.createRadialGradient(_Wd/2,_Hd/2,Math.min(_Wd,_Hd)*0.30,_Wd/2,_Hd/2,Math.max(_Wd,_Hd)*0.62);
  rg.addColorStop(0,'rgba(0,0,0,0)'); rg.addColorStop(1,'rgba(0,0,0,0.42)'); ctx.fillStyle=rg; ctx.fillRect(0,0,_Wd,_Hd);
  const av=Math.round(_S*0.139), ayy=Math.round(_Hd*0.19); _drawAvatar(_Wd/2,ayy,av,a);
  ctx.textAlign='center'; ctx.textBaseline='middle'; const ty=Math.round(_Hd*0.32);
  ctx.fillStyle='rgba(255,255,255,'+a+')'; ctx.font='700 '+Math.round(_S*0.044)+'px DejaVu Sans, sans-serif'; ctx.fillText((name&&name.trim())||'',_Wd/2,ty);
  ctx.fillStyle='rgba(160,200,255,'+(0.9*a)+')'; ctx.font='600 '+Math.round(_S*0.028)+'px DejaVu Sans, sans-serif'; ctx.fillText(activity||'',_Wd/2,ty+Math.round(_S*0.048));
  ctx.strokeStyle='rgba(120,200,255,'+(0.86*a)+')'; ctx.lineWidth=3; const lw=Math.round(_S*0.12*a);
  ctx.beginPath(); ctx.moveTo(_Wd/2-lw,ty+Math.round(_S*0.082)); ctx.lineTo(_Wd/2+lw,ty+Math.round(_S*0.082)); ctx.stroke();
  let yy=ty+Math.round(_S*0.2315); ctx.fillStyle='rgba(255,255,255,'+a+')'; ctx.font='600 '+Math.round(_S*0.028)+'px DejaVu Sans, sans-serif';
  const L=stats&&stats.length?stats:['Özet']; for(const ln of L){ ctx.fillText(ln,_Wd/2,yy); yy+=Math.round(_S*0.065); }
  if(_wm && _wm.complete && _wm.width){ const ww=Math.round(_S*0.14), hh=Math.round(ww*_wm.height/_wm.width); ctx.globalAlpha=0.9*a; ctx.drawImage(_wm,_Wd-ww-Math.round(_Wd*0.04),_Hd-hh-Math.round(_Hd*0.03),ww,hh); ctx.globalAlpha=1; }
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';};
window.clearOv=()=>ctx.clearRect(0,0,_Wd,_Hd);
// FOTOGRAMETRI DETAY OLCUMU (2026-07-12): secili tile'larin geometricError'u — buyuk sehirlerde
// yaprak tile'lar ince (med < ~15), kucuk sehirlerde drape kaba (med > ~30). allTilesLoaded sonrasi
// ayni kamera goruntusunde deterministiktir (SEG dilimleri ayni karari verir).
window._detailStat=()=>{try{const ts=window._G&&window._G.tileset; const sel=(ts&&ts._selectedTiles)||[];
  const ge=sel.map(t=>t.geometricError).filter(x=>typeof x==='number').sort((a,b)=>a-b);
  if(!ge.length)return{n:0};
  return {n:ge.length,min:+ge[0].toFixed(1),med:+ge[Math.floor(ge.length/2)].toFixed(1)};}catch(e){return{err:String(e).slice(0,80)}}};
</script></body></html>`;

(async () => {
  const GPU = process.env.RENDER_GPU === '1';
  const glArgs = GPU
    ? ['--use-gl=angle', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];
  const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 600000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', ...glArgs, `--window-size=${W},${H}`] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 160)));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(HTML, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction('window._ready===true', { timeout: 90000 });
  const err = await page.evaluate(() => window._err);
  if (err) { console.log('CESIUM ERR:', err); process.exit(3); }

  const N = pts.length;
  const coords = pts.map(p => [p.lon, p.lat]);
  // KALICI SİYAH-RENDER FIX (end-to-end): tileset içeriğini GARANTİ ET. Rota merkezine bak, tile'ları bekle;
  // gelmezse (soğuk worker/geçici Google Tiles) process İÇİNDE 4 kez YENİDEN YÜKLE. Aynı worker'da iyileşir,
  // re-dispatch gerekmez. 4 denemede de gelmezse fail-fast (route-video retry/re-dispatch) — ama asla siyah render.
  let _cx = 0, _cy = 0; for (const c of coords) { _cx += c[0]; _cy += c[1]; } _cx /= coords.length; _cy /= coords.length;
  let _tilesOk = false;
  for (let _at = 0; _at < 4 && !_tilesOk; _at++) {
    if (_at > 0) { console.error('TILE reload #' + _at); await page.evaluate(() => window._G.reloadTiles()); }
    await page.evaluate((lo, la) => { const C = window._G.Cesium; window._G.viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lo, la, 1400) }); }, _cx, _cy);
    await page.evaluate(c => window.tilesReady(c), 25000);
    await page.evaluate(() => { for (let k = 0; k < 4; k++) window._G.viewer.scene.render(); });
    const _st = await page.evaluate(() => window._G.tileStats());
    console.error('TILE ENSURE attempt' + _at + '>>', JSON.stringify(_st));
    _tilesOk = _st && (_st.ready | 0) >= 20;
    // WEBGL CONTEXT BOZUK (shader derlenemiyor = GPU/driver sorunu): reload işe yaramaz (aynı context) -> HEMEN çık, fresh worker
    if (!_tilesOk && _st && _st.err && /shader|webgl|context|GL_/i.test(_st.err)) { console.error('WEBGL BOZUK worker -> hızlı re-dispatch (reload boşa)'); break; }
  }
  if (!_tilesOk) { console.error('GOOGLE 3D TILES YÜKLENMEDİ (4 reload) -> fail-fast, re-dispatch'); process.exit(6); }
  await page.evaluate(c => window.tilesReady(c), 15000);
  // DÜŞÜK-DETAY BÖLGE ALGISI (2026-07-12, Barış: "bilinmedik yerlerde otomatik algıla"):
  // Karo-metriği ayrıştırmadı (Ordu min=4 vs İst min=2 — kalite farkını geometrik hata ölçmüyor).
  // DETERMİNİSTİK ÇÖZÜM: Google fotogrametrisinin KESKİN olduğu metropol listesi — rota merkezi
  // ~45 km içindeyse tam kalite (chase serbest); değilse LOWDETAIL: chase -> yandan + yüksek kamera.
  // Liste kaba ama güvenli taraf: bilinmeyen yer = yumuşat (çirkin süpriz yerine temiz geniş açı).
  const METROS = [[41.01,28.98],[39.93,32.86],[38.42,27.14],[36.9,30.7],[40.19,29.06],[37.0,35.32],
   [51.5,-0.13],[48.86,2.35],[52.52,13.41],[48.14,11.58],[50.94,6.96],[53.55,9.99],[52.37,4.9],[50.85,4.35],
   [40.42,-3.7],[41.39,2.17],[37.39,-5.99],[39.47,-0.38],[41.9,12.5],[45.46,9.19],[40.85,14.27],[45.07,7.69],
   [48.21,16.37],[47.37,8.54],[46.2,6.15],[55.68,12.57],[59.33,18.07],[59.91,10.75],[60.17,24.94],
   [38.72,-9.14],[41.15,-8.61],[50.09,14.42],[47.5,19.04],[52.23,21.01],[44.43,26.1],[37.98,23.73],
   [53.35,-6.26],[55.95,-3.19],[53.48,-2.24],[52.49,-1.89],[51.45,-2.59],
   [40.71,-74.01],[34.05,-118.24],[41.88,-87.63],[29.76,-95.37],[33.45,-112.07],[32.72,-117.16],
   [37.77,-122.42],[47.61,-122.33],[25.76,-80.19],[28.54,-81.38],[33.75,-84.39],[42.36,-71.06],
   [38.91,-77.04],[39.95,-75.17],[36.17,-115.14],[39.74,-104.99],[30.27,-97.74],[32.78,-96.8],
   [45.5,-73.57],[43.65,-79.38],[49.28,-123.12],[19.43,-99.13],[-23.55,-46.63],[-22.91,-43.17],
   [-34.6,-58.38],[-33.45,-70.67],[4.71,-74.07],[-12.05,-77.04],
   [35.68,139.69],[34.69,135.5],[35.18,136.9],[43.06,141.35],[33.59,130.4],
   [37.57,126.98],[35.18,129.08],[25.03,121.57],[22.32,114.17],[1.35,103.82],[3.14,101.69],[13.76,100.5],
   [-33.87,151.21],[-37.81,144.96],[-27.47,153.03],[-31.95,115.86],[-36.85,174.76],
   [25.2,55.27],[24.47,54.37],[25.29,51.53],[26.23,50.59],[29.38,47.99],[24.71,46.68],[21.49,39.19],
   [31.05,34.85],[32.08,34.78],[30.04,31.24],[33.89,35.5],[45.42,-75.7],[51.05,-114.07],[53.55,-113.49]];
  const _hav = (a1, o1, a2, o2) => { const R = 6371, dA = (a2 - a1) * Math.PI / 180, dO = (o2 - o1) * Math.PI / 180;
    const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dO / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h)); };
  let _mind = 1e9; for (const m of METROS) { const d = _hav(_cy, _cx, m[0], m[1]); if (d < _mind) _mind = d; }
  const LOWDETAIL = _mind > parseFloat(process.env.RENDER_G3D_METRO_KM || '45');
  console.error('METRO uzaklık:', Math.round(_mind) + ' km -> ' + (LOWDETAIL ? 'LOW DETAIL (chase iptal + yüksek kamera)' : 'tam kalite'));
  // (karo metriği veri toplamak için loglanmaya devam eder)
  try {
    const _dt = await page.evaluate(() => (window._detailStat ? window._detailStat() : null));
    console.error('DETAIL>>', JSON.stringify(_dt));
  } catch (e) {}
  // Zemin yüksekliği: TILESET yüzeyine CLAMP (GPS alt gerçek yüzeyin ~24m ALTINDAydı -> çizgi kayıyordu).
  // Yüzeye tam oturunca çizgi Mapbox gibi haritaya kilitli/SABİT durur. clampRoute tile'ları kendi yükler.
  const _med = (a) => { const s = a.filter(x => typeof x === 'number').sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 20; };
  let heights = await page.evaluate(cs => window.clampRoute(cs), coords);
  const gpsBase = _med(pts.map(p => p.alt));
  if (!heights || heights.every(h => h == null)) {
    const cerr = await page.evaluate(() => window._clampErr);
    console.log('CLAMP FAIL -> GPS fallback:', cerr || '');
    heights = pts.map(p => (typeof p.alt === 'number' ? p.alt : gpsBase));
  } else {
    const cbase = _med(heights);
    heights = heights.map(h => (typeof h === 'number' && isFinite(h)) ? h : cbase);   // clamp'lenemeyen noktaları medyanla doldur
  }
  heights = heights.map((h, i) => { let a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2), s = 0, c = 0; for (let k = a; k <= b; k++) { s += heights[k]; c++; } return s / c; });  // hafif yumuşatma (yüzey gürültüsü)
  await page.evaluate(() => window._G.trimTiles());   // clamp'in yüklediği yüksek-detay tile'ları BOŞALT (GPU OOM/beyaz ekranı önle)
  await page.evaluate((cs, hs, lc, dc) => window.addRoute(cs, hs, lc, dc), coords, heights, IN.lineColor || '#00e5ff', IN.dotColor || '#ff3b30');
  // GRUP SÜRÜŞ (v113): N eş iz — her biri clamp + sahne çizgisi + kare-başına marker indeksi (monoton işaretçi)
  let FI2 = null;
  if (IN.mates && IN.mates.length) {
    FI2 = [];
    for (let mi = 0; mi < IN.mates.length; mi++) {
      const M = IN.mates[mi], coords2 = M.pts2;
      let h2 = await page.evaluate(cs => window.clampRoute(cs), coords2);
      if (!h2 || h2.every(h => h == null)) { console.log('CLAMP2 FAIL -> gpsBase (mate ' + mi + ')'); h2 = coords2.map(() => gpsBase); }
      else { const cb2 = _med(h2); h2 = h2.map(h => (typeof h === 'number' && isFinite(h)) ? h : cb2); }
      h2 = h2.map((h, i) => { let a = Math.max(0, i - 2), b = Math.min(coords2.length - 1, i + 2), sm2 = 0, c = 0; for (let k = a; k <= b; k++) { sm2 += h2[k]; c++; } return sm2 / c; });
      await page.evaluate(() => window._G.trimTiles());
      await page.evaluate((mi2, cs, hs, lc, dc) => window.addRouteMate(mi2, cs, hs, lc, dc), mi, coords2, h2, M.line || '#FF9F0A', M.dot || '#FFD60A');
      // v115: kesirli indeks route-video'dan ZAMAN-tabanlı hazır gelir (M.fi2) — geometrik izdüşüm
      // firkete virajında segment atlayıp ışınlıyordu. Projeksiyon fallback'i sadece eski job'lar için.
      let fiArr;
      if (M.fi2 && M.fi2.length) {
        fiArr = new Array(frames).fill(0).map((_, f) => M.fi2[Math.min(f, M.fi2.length - 1)]);
      } else {
        fiArr = new Array(frames).fill(0);
        let j2 = 0;
        const segT = (j, p2) => { const a = coords2[j], b = coords2[Math.min(j + 1, coords2.length - 1)];
          const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
          return L2 > 1e-12 ? ((p2[0] - a[0]) * dx + (p2[1] - a[1]) * dy) / L2 : 1; };
        for (let f = 0; f < frames; f++) {
          const p2 = M.pos2[Math.min(f, M.pos2.length - 1)];
          while (j2 < coords2.length - 2 && segT(j2, p2) > 1) j2++;
          fiArr[f] = j2 + Math.max(0, Math.min(1, segT(j2, p2)));
        }
      }
      FI2.push(fiArr);
    }
    console.error('GRUP SÜRÜŞ: ' + IN.mates.length + ' eş sürücü, FI2 hazır');
  }

  // FADE flat/flyover ile birebir: ffmpeg fade YOK; intro solid koyu bg'de açılır, outro manuel fade-to-black ile kapanır.
  const vf = RS !== 1 ? ['scale=' + OW + ':' + OH + ':flags=lanczos'] : ['null'];
  const ff = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-vf', vf.join(','),   // sessiz ses kanalı: audio'suz mp4 telefonda AÇILMIYOR
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '24',
    '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outMp4],
    { stdio: ['pipe', 'ignore', 'ignore'] });

  // ==== ESKİ render3d.js KAMERA/PACING MANTIĞI — BİREBİR (sadece harita Google) ====
  // CHASE: 3D'ye özel "tam arkadan hafif yukardan" takip (yan açı yok, daha yakın, sürükleyici).
  // 3 kamera modu: normal (yandan) | chase (orta, hafif yukarıdan arkadan) | pacman (agresif alçak+yakın, tam arkadan sokak üstü)
  const CHASE0 = (IN.camMode === 'chase' || IN.camMode === 'arka');
  const CHASE = CHASE0 && !LOWDETAIL;   // düşük-detay bölgede chase -> yandan (drape çirkinliğini gizler)
  const PACMAN = (IN.camMode === 'pacman' || IN.camMode === 'pakman');
  const BEHIND = CHASE || PACMAN;   // ikisi de tam arkadan (yan açı yok)
  if (CHASE0 && !CHASE) console.error('CHASE -> YANDAN (düşük detay bölge)');
  // pacman = GERÇEK oyun-chase: SOKAK SEVİYESİ, EN YAKIN (mesafe ~43m, yükseklik ~10m), tam arkadan bumper-cam. yandan=60, chase=orta.
  let pitch = IN.pitch || (PACMAN ? 78 : CHASE ? 52 : 60), zoom = IN.zoom || (PACMAN ? 20.0 : CHASE ? 17.1 : 16.4);
  if (LOWDETAIL && !PACMAN) { pitch = Math.min(pitch, 55); zoom = Math.min(zoom, 15.8); }   // yüksek+uzak = drape daha az belli
  const FIDX = IN.frameIdx || null;
  const idxH = (fi) => { const i0 = Math.max(0, Math.min(N - 1, Math.floor(fi))), i1 = Math.min(N - 1, i0 + 1), fr = fi - i0;
    return heights[i0] + (heights[i1] - heights[i0]) * fr; };
  const idleCap = GPU ? 140 : 400;   // kare-başı tile bekleme tavanı (komşu kareler cache'te -> düşük yeter)
  const Zd = (IN.dwellZoom || 2.2);                                  // mola/mekan zoom-in
  const sideBase = BEHIND ? 0 : (IN.sideAngle !== undefined ? IN.sideAngle : 40); // yan bakış açısı (chase/pacman=0, tam arkadan)
  const sm = smPath;
  let camB = null, camLon = sm[0].lon, camLat = sm[0].lat, camZ = zoom, camPit = pitch, dw = 0, tzS = zoom, tpS = pitch;
  let tcLon = sm[0].lon, tcLat = sm[0].lat, mLon = sm[0].lon, mLat = sm[0].lat, mH = idxH(0), mFi = 0, tFi = 0;

  // PARALEL SEGMENT RENDER: segFrom..segTo kare aralığı bu worker'ın payı (yoksa 0..frames = tek parça).
  // Kamera matematiği HER ZAMAN kare 0'dan koşulur (yumuşatma durumu birebir aynı kalır -> segmentler kusursuz ekler);
  // sadece kendi aralığında ekran işi (setCam/tilesReady/draw/screenshot) yapılır. Warmup maliyeti ~ms (saf aritmetik).
  const SEG_FROM = Math.max(0, IN.segFrom | 0);
  const SEG_TO = (IN.segTo && IN.segTo > 0) ? Math.min(frames, IN.segTo | 0) : frames;
  const SEG_FIRST = SEG_FROM === 0, SEG_LAST = SEG_TO >= frames;
  // INTRO — flat birebir: avatarlı solid koyu kart, smoothstep fade (2.7sn); arka planda tile'lar ısınır (SADECE ilk segment)
  if (SEG_FIRST && !IN.noHud) { const brg0 = bearing(sm[0], sm[Math.min(6, N - 1)]);
    await page.evaluate((lo, la, g, b, pt, zm) => window.setCam(lo, la, g, b, pt, zm), sm[0].lon, sm[0].lat, heights[0], brg0, pitch, zoom);
    await page.evaluate(c => window.tilesReady(c), 15000);
    await page.evaluate(() => { window._G.tileset.show = false; });   // intro kartı OPAK -> harita gizli; Cesium'u boşuna render etme (GPU yükü + tile birikimi yok)
    const nIntro = Math.round(fps * 2.7);
    for (let f = 0; f < nIntro; f++) {
      let a = (f < nIntro * 0.42) ? f / (nIntro * 0.42) : (f > nIntro * 0.74) ? Math.max(0, (nIntro - f) / (nIntro * 0.26)) : 1;
      a = a * a * (3 - 2 * a);   // smoothstep
      await page.evaluate((n, ac, d, al) => window.drawIntro(n, ac, d, al), IN.name || '', IN.activity || '', (title && title.date) || '', a);
      const b = await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: W, height: H } });
      ff.stdin.write(b);
    } }
  await page.evaluate(() => { window._G.tileset.show = true; });   // route için haritayı geri aç
  // SİYAH RENDER FAST-FAIL: tile içeriği yüklendi mi doğrula. Google Tiles quota/API sorunuysa tile gelmez ->
  // 25dk siyah render etme, HEMEN non-zero çık (route-video retry/re-dispatch eder). Sebebi de logla.
  await page.evaluate(c => window.tilesReady(c), 20000);
  await page.evaluate(() => { for(let k=0;k<3;k++) window._G.viewer.scene.render(); });
  const _ts = await page.evaluate(() => window._G.tileStats());
  console.error('TILE STATS>>', JSON.stringify(_ts));
  if (!_ts || (_ts.ready|0) < 3) {
    console.error('GOOGLE 3D TILES YÜKLENMEDİ (siyah render önlendi) ready=' + (_ts&&_ts.ready) + ' fail=' + (_ts&&_ts.fail) + ' err=' + (_ts&&_ts.err));
    try { ff.stdin.end(); } catch (_e) {}
    process.exit(6);   // route-video -> retry/re-dispatch
  }
  const fadeInN = Math.round(fps * 0.5);   // rota başında haritayı siyahtan aç (flat fadeN birebir)

  for (let f = 0; f < frames; f++) {
    const fi = FIDX ? FIDX[f] : f * (N - 1) / (frames - 1);
    const i0 = Math.max(0, Math.min(N - 1, Math.floor(fi))), i1 = Math.min(N - 1, i0 + 1), fr = fi - i0;
    const L = (a, b) => a + (b - a) * fr;
    const p = { lon: L(pts[i0].lon, pts[i1].lon), lat: L(pts[i0].lat, pts[i1].lat), cum: L(pts[i0].cum || 0, pts[i1].cum || 0),
      dwell: pts[i0].dwell, tm: pts[i0].tm, poi: pts[i0].poi || '', hr: pts[i0].hr };
    const c = { lon: L(sm[i0].lon, sm[i1].lon), lat: L(sm[i0].lat, sm[i1].lat) };
    // render3d.js (eski mükemmel Mapbox) ile BİREBİR: eased lat/lon (TEK 0.35) -> dönüşü yumuşak keser, glide (indeks-snap köşede sıçratıyordu)
    mLon += (p.lon - mLon) * 0.35; mLat += (p.lat - mLat) * 0.35;
    mFi += (fi - mFi) * 0.35;   // arama penceresi merkezi (nokta ekranda çizgiye en yakın noktaya snap edilir)
    dw += ((p.dwell ? 1 : 0) - dw) * 0.022;                          // mola sinyali yavaş süzülür
    // HIZLANMADA KADRAJDA TUT: nokta (mLon/mLat) kadraj merkezinden (camLon/camLat) uzaklaştıkça yumuşak ZOOM-OUT
    // -> hızlanınca kamera geride kalıp nokta ekran dışına taşmasın (Barış fikri). Çift-yumuşatma ile hafif/yumuşak.
    const _dlag = hav({ lon: camLon, lat: camLat }, { lon: mLon, lat: mLat });
    // Tavan kendini açar: şehir hızında 1.8 (eski davranış birebir), otoyol/uzun rotada gecikme 450m'yi
    // aşarsa 4.5'e kadar büyür -> nokta ASLA ekran dışına kaçmaz (2026-07-05 900km vakası).
    const _zCap = 1.8 + Math.min(2.7, Math.max(0, (_dlag - 450) / 300));
    const _zOut = Math.min(_zCap, Math.max(0, (_dlag - 80) / 150));   // uzaklık arttıkça zoom kademe açılır
    const tzRaw = (BEHIND ? zoom : (zoom + dw * Zd)) - _zOut; tzS += (tzRaw - tzS) * 0.02; camZ += (tzS - camZ) * 0.03;     // çift yumuşatma zoom (biraz daha responsive: zoom-out zamanında yetişsin)
    const tpRaw = BEHIND ? pitch : (pitch - dw * (pitch - 50)); tpS += (tpRaw - tpS) * 0.012; camPit += (tpS - camPit) * 0.02;  // dinamik pitch (arkadan modlar SABİT agresif açı, dwell'de havalanmaz)
    let j = i0, dd = 0; while (j < N - 1 && dd < 300) { dd += hav(sm[j], sm[j + 1]); j++; }        // ~300m ileri bak
    const tb = bearing({ lon: camLon, lat: camLat }, sm[j]);
    camB = (camB === null) ? tb : camB + angd(tb, camB) * 0.01;      // çok yavaş yumuşak dönüş
    // KONUM TAKİBİ — render3d.js (eski MÜKEMMEL) ile BİREBİR: çift yumuşatma + SABİT ORAN (hızdan BAĞIMSIZ).
    // Adaptif oran (dpos'a bağlı) hızlanınca ANİ SIÇRAMA yapıyordu -> kaldırıldı. Sabit 0.05 = tereyağ akış.
    tcLon += (c.lon - tcLon) * 0.06; tcLat += (c.lat - tcLat) * 0.06;                              // ara hedef (ivmeyi yutar)
    const dpos = hav({ lon: camLon, lat: camLat }, { lon: tcLon, lat: tcLat });
    const DZ = (IN.deadzone || 10);
    if (dpos > DZ) { camLon += (tcLon - camLon) * 0.05; camLat += (tcLat - camLat) * 0.05; }        // SABİT oran -> zıplama 0
    const sideOff = sideBase + (BEHIND ? 0 : 4) * Math.sin(f / Math.max(1, frames) * Math.PI * 2);  // eski sistem yan salınım (arkadan modlarda yok)
    const brg = (((camB + sideOff) % 360) + 360) % 360;
    const gh = idxH(fi);
    // Marker yüksekliği de konum (mLon/mLat) ile AYNI oranda süzülür -> hızlanınca ileri noktanın yüksekliğine ışınlanıp bina üstüne çıkmaz
    mH += (gh - mH) * 0.35;
    if (f < SEG_FROM || f >= SEG_TO) continue;   // segment dışı: kamera matematiği koşuldu (durum sürekli), ekran işi YOK
    await page.evaluate((lo, la, g, b, pt, zm) => window.setCam(lo, la, g, b, pt, zm), camLon, camLat, gh, brg, camPit, camZ);
    await page.evaluate((lo, la, h, fi) => window.setMarkerPos(lo, la, h, fi), mLon, mLat, idxH(mFi), mFi);   // eased konum + arama merkezi
    if (FI2) await page.evaluate(fis => window.setMarkerMAll(fis), FI2.map(a => a[f]));   // GRUP SÜRÜŞ: eş sürücü noktaları
    await page.evaluate(c => window.tilesReady(c), idleCap);   // önce tile'lar otursun + kamera render olsun
    await page.evaluate((s) => window.draw(s), { title: title.date + '  •  ' + title.totkm + ' km', tm: p.tm, cum: p.cum, hr: p.hr, poi: (p.poi || ''), poiA: dw,
      hudA: Math.max(0, Math.min(1, f/(fps*0.9), (frames-1-f)/(fps*0.9))) });   // HUD yumuşak belir/çekil; sonra çizgiyi doğru projekte et
    if (f < fadeInN) await page.evaluate(al => window.blackOver(al), 1 - f / fadeInN);   // rota başı: haritayı siyahtan aç (HUD'un üstüne)
    const buf = await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: W, height: H } });
    ff.stdin.write(buf);
    if ((f & 15) === 0 && await page.evaluate(() => window._glLost)) {   // WebGL context loss -> beyaz video ÜRETME, non-zero çık (flyover fallback)
      console.log('WEBGL CONTEXT LOST @frame', f); try { ff.stdin.end(); } catch (_e) {} process.exit(7);
    }
    if (f > 0 && f % 24 === 0) await page.evaluate(() => window._G.trimTiles());   // 45->24: daha SIK boşaltma (tile birikimi bounded -> GPU context OOM/loss önlenir)
  }

  // OUTRO — flat birebir: kararan harita üstünde avatarlı özet paneli (smoothstep 3.4sn) + fade-to-black (SADECE son segment)
  if (SEG_LAST && !IN.noHud) { const sN = Math.round(fps * 3.4);
    for (let f = 0; f < sN; f++) {
      let a = (f < sN * 0.30) ? f / (sN * 0.30) : (f > sN * 0.82) ? Math.max(0, (sN - f) / (sN * 0.18)) : 1;
      a = a * a * (3 - 2 * a);
      await page.evaluate((n, ac, st, al) => window.drawOutro(n, ac, st, al), IN.name || '', IN.activity || '', IN.stats || [(title && title.totkm || '') + ' km'], a);
      const b = await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: W, height: H } });
      ff.stdin.write(b);
    }
    const nFb = Math.round(fps * 0.5);   // temiz fade-to-black kapanış
    for (let f = 0; f < nFb; f++) {
      await page.evaluate(al => window.drawFadeBlack(al), 0.66 + 0.34 * (f / Math.max(1, nFb - 1)));
      const b = await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: W, height: H } });
      ff.stdin.write(b);
    } }

  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log('GOOGLE 3D OK: ' + outMp4);
})();
