// ⚠️ OTOMATİK ÜRETİLDİ — ELLE DÜZENLEME. Kaynak: /opt/matrix/render-worker/3d/render3d.js (modül kapsamı, satır 1..IIFE)
// Üretici: cf/tools/motor3d/uret.mjs · kaynak SHA-256: 3521c651f58780aab22fa4c04dc7053f4f476e8c661e1a40c386b40fa7d4e15b
// Değişiklik SADECE mekanik: 3 require + IN/MLJS/MLCSS okuması + 2 process.env -> parametre.
// Sayfa/CSS/çizim kodunun TEK BİR KARAKTERİ değişmedi (mühür korunur).
/* eslint-disable */
export function sayfaUret(IN, MLJS, MLCSS, HARITA_TABAN, DEM_TABAN) {
// Gercek 3B flythrough: MapLibre GL + terrain + egimli kamera rota boyunca ucar.
// 2026-08-10: MAPBOX'TAN TAM KOPUŞ — kütüphane imajda gömülü, karolar kendi sunucumuzdan,
// arazi anahtarsız terrarium DEM'den, binalar kendi Protomaps arşivimizden fill-extrusion.
// Girdi: argv[2] = JSON {token,W,H,fps,outMp4,ffmpeg,frames,pitch,zoom,title:{date,totkm},pts:[{lon,lat,t,spd,cum,hr}]}
// Kareler PNG olarak ffmpeg image2pipe stdin'e yazilir -> mp4.
/* puppeteer: sürücüde, sayfada YOK */
/* child_process: sürücüde, sayfada YOK */
/* fs: parametreye taşındı */

/* IN: parametre */
const {token,fps,outMp4,ffmpeg,frames,pitch,zoom,title,pts} = IN;
// 🔴 ZIPLAMA FİKSİ (04.09) — YUMUŞATMA KATSAYILARINI KARE HIZINA NORMALİZE ET.
// Katsayılar (0.35 / 0.012 / 0.02 / 0.06 / 0.05 ...) 60fps'e göre elle ayarlanmış, fps terimi yok.
// TELEFON hattı 30fps koştuğu için her süzgeç yarı hızda ilerliyor: kare başı yer değiştirme ve
// kalıcı gecikme iki katına çıkıyor. 30fps telefon videosunda ÖLÇÜLDÜ: saniyede 3,01 sıçrama,
// taban hareketin 9,2 katı (60fps bulut referansı 1,55/sn ve 4,6x). Aynı fonksiyondaki HUD geçişi
// zaten f/(fps*0.9) ile fps'e bölünüyor — kamera yumuşatmasında unutulmuş.
// a_eff = 1-(1-a60)^(60/fps)  → zaman sabiti fps'ten bağımsız olur.
const _A = (a60) => (fps===60 ? a60 : 1-Math.pow(1-a60, 60/fps));

// İç render çözünürlüğü: 3D'de swiftshader bellek/CPU maliyeti piksele bağlı.
// Küçük çöz -> az bellek (OOM yok) + hızlı çekim (60fps olur). ffmpeg final boyuta lanczos upscale eder.
// rscale<1 = iç çöz DÜŞÜR (CPU/swiftshader bellek); rscale>1 = SUPERSAMPLE (büyük GPU'da çiz,
// lanczos ile küçült -> maksimum keskinlik/anti-alias). İkisinde de ffmpeg final boyuta ölçekler.
const OW=IN.W, OH=IN.H, RS=(IN.rscale && IN.rscale>0)?IN.rscale:1;
const W = RS!==1 ? Math.round(IN.W*RS/2)*2 : IN.W;
const H = RS!==1 ? Math.round(IN.H*RS/2)*2 : IN.H;

function bearing(a,b){
  const r=Math.PI/180; const y=Math.sin((b.lon-a.lon)*r)*Math.cos(b.lat*r);
  const x=Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lon-a.lon)*r);
  return (Math.atan2(y,x)/r+360)%360;
}
function hav(a,b){const R=6371000,r=Math.PI/180;const dla=(b.lat-a.lat)*r,dlo=(b.lon-a.lon)*r;
  const x=Math.sin(dla/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlo/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
const angd=(a,b)=>((a-b+540)%360)-180;   // en kisa acisal fark
// İz zaten map-match ile yola oturtuldu (temiz). Eskiden 26-pencere çift yumuşatma KÖŞELERİ KESİP
// bina içinden geçiyordu. Artık ÇİZGİ birebir map-match noktalarından (pts) çizilir; kamera/marker
// için sadece HAFİF yumuşatma (jitter için), köşe kesmez.
const WINs=4;   // küçük pencere = köşeleri korur (yola sadık), sadece minik jitter giderir
function smooth1(arr){return arr.map((p,i)=>{let a=Math.max(0,i-WINs),b=Math.min(arr.length-1,i+WINs),so=0,sa=0,c=0;
  for(let k=a;k<=b;k++){so+=arr[k].lon;sa+=arr[k].lat;c++;}return {lon:so/c,lat:sa/c};});}
const smPath=smooth1(pts);   // tek hafif geçiş — yalnız kamera/marker için (çizgi pts kullanır)

// ══════════ MAPBOX'SIZ HARİTA (2026-08-10) ══════════
// Barış kararı: Mapbox'tan TAM kopuş. Standard v3'ün foto-gerçekçi binaları/ağaçları gitti;
// yerine kendi Protomaps arşivimizden fill-extrusion bina hacmi + kendi uydu karolarımız.
// Kütüphane CDN'den DEĞİL imajdan okunur -> render anında dış bağımlılık SIFIR.
/* MLJS: parametre (R2) */
/* MLCSS: parametre (R2) */

// Karo uçları: kendi sunucumuz (nginx -> harita-proxy). Ortamdan ezilebilir (test/tatbikat için).
// 2026-08-11: karolar ARTIK CDN'li alan adından. harita.nickdegs.com Cloudflare turuncu bulut
// arkasında (30 gün immutable cache) -> tekrar eden karo ORIGIN'E HİÇ GELMEZ (kanıt: MISS→HIT).
// kisisel-api DNS-only kalmalı (turuncu bulut ücretsiz planda 100MB yükleme sınırı getirir,
// bizde foto/müzik için client_max_body_size 200M var -> yüklemeler kırılırdı).
//
// 🔴 2026-08-31 ÖNEKLİ YOLA GEÇİŞ (sunucusuzlaştırma). ESKİ varsayılan ÇIPLAK yoldu
// (`https://harita.nickdegs.com`) ve o yol nginx -> harita-proxy'ye gider: SUNUCU KAPANINCA 502
// -> 13.000 karo hatası -> render exit(7). Önekli yol (`/{ONEK}/xyz|mvt|yukseklik`) 31.08'de
// `harita-katman` worker'ına route'landı; worker karoları Esri/Hooder/EOX public zincirinden
// verir, sunucu tamamen kapalıyken de 200 döner.
// ⚠️ ÇIPLAK YOLA GEÇME: harita.nickdegs.com/xyz/'e gelen ~4.400 istek/gün HOODER'IN OYUN
// İSTEMCİLERİ'nin (Hooder/2.4 MapLibre iOS, app.realvirtuality.landlord Android) ve o yol
// bilerek route'lanmadı. Bizim tüketicimiz DAİMA önekli yoldan gelir.
// Önek /opt/matrix/secrets/harita-uc.conf (HARITA_UC_ONEK) ile aynıdır; env ile ezilebilir
// (HARITA_TABAN=... -> yerel yan-servis/tatbikat). route-video.py'deki HARITA_UC ile aynı biçim.
const HARITA = HARITA_TABAN || 'https://harita.nickdegs.com/24579d9db6c7c001';
// ULTRA AYRIMI: katman parametresi -> proxy Ultra'ya en yüksek zoom/kaliteli kaynağı verir.
// (Uzak worker'ın isteğinde tier bilgisi URL'de taşınmalı; sunucudaki .aktif-katman dosyası
//  yalnız YEREL taktik render için, uzak istekleri kapsamaz.)
const KATMAN = IN.ultra ? 'ultra' : 'premium';
// 🏢 GERÇEK YÜKSEKLİK (2026-08-11, Barış: "yüzde yüz gerçek — Ultra aboneler"): rota bbox'ı için
// GHS uydu ölçümü (100m grid) + OSM height/levels kuleleri tek istekte çekilir (CF 7g önbellekli).
const _ylons=pts.map(p=>p.lon), _ylats=pts.map(p=>p.lat);
const YBB=[Math.min(..._ylons)-0.02, Math.min(..._ylats)-0.02, Math.max(..._ylons)+0.02, Math.max(..._ylats)+0.02];
const YUK_URL = HARITA + '/yukseklik?bbox=' + YBB.map(v=>v.toFixed(5)).join(',') + '&n=160';
const SAT_URL = HARITA + '/xyz/sat/{z}/{x}/{y}.jpg?k=' + KATMAN;
const STR_URL = HARITA + '/xyz/str/{z}/{x}/{y}.jpg?k=' + KATMAN;
const MVT_URL = HARITA + '/mvt/{z}/{x}/{y}.mvt';
// Arazi: anahtarsız kamu terrarium DEM (AWS elevation-tiles-prod; CORS'lu, doğrulandı).
const DEM_URL = DEM_TABAN || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// Stil: uydu yolunda foto zemin; şehir yolunda açık zemin + vektör (bina çıkarımı style.load'da eklenir).
const MLSTYLE = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tiles: [SAT_URL], tileSize: 256, maxzoom: 19, attribution: '' },
    str: { type: 'raster', tiles: [STR_URL], tileSize: 256, maxzoom: 19, attribution: '' },
    vektor: { type: 'vector', tiles: [MVT_URL], minzoom: 0, maxzoom: 15, attribution: '' }
  },
  layers: IN.satStyle
    ? [{ id: 'zemin', type: 'raster', source: 'sat' }]
    : [{ id: 'zemin', type: 'raster', source: 'str', paint: { 'raster-opacity': 1 } }]
};

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<script>${MLJS}</script>
<style>${MLCSS}</style>
<style>body{margin:0}#map{position:absolute;top:0;left:0;width:${W}px;height:${H}px}
#ov{position:absolute;top:0;left:0;pointer-events:none}
/* Harita motoru logo + attribution YAZILARINI gizle */
.maplibregl-ctrl-logo,.maplibregl-ctrl-attrib,.maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-attrib-inner{display:none!important;opacity:0!important}</style></head>
<body><div id="map"></div><canvas id="ov" width="${W}" height="${H}"></canvas>
<script>
// ŞEHİR YOLU (satStyle=false): kendi vektör karolarımızdan fill-extrusion bina hacmi.
// Mapbox Standard v3'ün pişmiş foto-gerçekçi binaları/ağaçları YOK (Barış 2026-08-10: "düz bina kabul").
// UZUN ROTA (satStyle=true): TAM UYDU + terrarium raster-dem arazi kabartması + globe.
const map=window._map=new maplibregl.Map({container:'map',style:${JSON.stringify(MLSTYLE)},
  ${IN.satStyle?"projection:{type:'globe'},":""}   // v95: uzun rotada GERÇEK KÜRE (MapLibre 5 globe)
  center:[${pts[0].lon},${pts[0].lat}],zoom:${zoom},pitch:${pitch},bearing:0,interactive:false,
  fadeDuration:0,preserveDrawingBuffer:true,antialias:true,maxTileCacheSize:512,attributionControl:false});
window._ready=false;
// 🛟 KARO HATASI SAYACI (2026-08-11): worker'ın ağı/DNS'i bozuksa TÜM karolar "Failed to fetch"
// olur -> harita BEMBEYAZ ama render "başarıyla" biter (V128/V129'da yaşandı: iki worker'dan biri
// beyaz üretti — harita.nickdegs.com yeni açıldığı için negatif DNS önbelleği şüphesi).
// Beyaz video üretmek yerine SAY ve node tarafı erken çıksın -> taze worker'a re-dispatch.
window._tileHata=0;
// GERÇEK YÜKSEKLİK: grid bilinear + OSM kulesi (~70m yakınsa birebir değer; kule > grid).
window._yuk=null; window._yukDone={};
if(${IN.kabartma?'true':'false'}){
  fetch('${YUK_URL}').then(r=>r.json()).then(d=>{window._yuk=d;}).catch(e=>{});
}
window._yukOrnek=(lon,lat)=>{
  const d=window._yuk; if(!d) return null;
  for(const k of d.kule){ const dx=(k[0]-lon)*Math.cos(lat*0.01745), dy=k[1]-lat;
    if(dx*dx+dy*dy < 0.0000004) return k[2]; }          // ~70 m -> OSM birebir
  const [a,b,c2,e]=d.bbox, n=d.n;
  let fx=(lon-a)/(c2-a)*(n-1), fy=(lat-b)/(e-b)*(n-1);
  if(fx<0||fy<0||fx>n-1||fy>n-1) return null;
  const x0=Math.floor(fx), y0=Math.floor(fy), x1=Math.min(n-1,x0+1), y1=Math.min(n-1,y0+1);
  const tx=fx-x0, ty=fy-y0, g=d.grid;
  const v=g[y0*n+x0]*(1-tx)*(1-ty)+g[y0*n+x1]*tx*(1-ty)+g[y1*n+x0]*(1-tx)*ty+g[y1*n+x1]*tx*ty;
  return v>0.5? v : null;
};
window.yukUygula=()=>{
  if(!window._yuk) return 0;
  let n=0;
  try{
    const fs2=map.querySourceFeatures('vektor',{sourceLayer:'buildings'});
    for(const f of fs2){
      if(f.id===undefined||window._yukDone[f.id]) continue;
      window._yukDone[f.id]=1;
      try{
        let cs=f.geometry.coordinates; while(Array.isArray(cs[0][0])) cs=cs[0];
        let sx=0,sy=0; for(const c3 of cs){sx+=c3[0];sy+=c3[1];}
        const h=window._yukOrnek(sx/cs.length, sy/cs.length);
        if(h) { map.setFeatureState({source:'vektor',sourceLayer:'buildings',id:f.id},{h:Math.max(3.5,h)}); n++; }
      }catch(e){}
    }
  }catch(e){}
  return n;
};
map.on('error',e=>{ const m=String((e&&e.error&&e.error.message)||''); if(m.indexOf('Failed to fetch')>=0||m.indexOf('AJAXError')>=0) window._tileHata++; });
map.on('style.load',()=>{
  try{
    // MAPBOX'SIZ 3B (2026-08-10): Standard v3'ün pişmiş binaları/ağaçları yok; kendi Protomaps
    // vektör karolarımızdan fill-extrusion ile bina hacmi çıkarılır (Barış: "düz bina kabul").
    // Yükseklik OSM'den; yoksa 9 m varsayılan (tek katlıdan yüksek, blok hissi verir).
    // 2026-08-10: binalar artık ULTRA'ya özel (Premium'da YOK) ve uydu zemininde DE çizilir.
    // Eskiden yalnız satStyle=false dalındaydı; o dal Google 3D yüzünden üretimde erişilmezdi.
    // 2026-08-11 ÜRÜN KARARI (Barış): 3B binalar KABARTMALI sekmesine bağlı — Premium DE Ultra DA
    // seçebilir. Normal mod = kusursuz düz uydu (bina yok). Ultra'nın tek farkı cila/dalga efekti.
    if(${IN.kabartma?'true':'false'}){
      // Binalar OSM+Microsoft harmanı (proxy). Yükseklik: karo height > GHS uydu > id-hash yedek.
      // Palet uydu-doğal tonlar; minzoom 13 (proxy z13-14'ü z15'ten sentezler — her zoom'da bina).
      map.addLayer({id:'binalar',type:'fill-extrusion',source:'vektor','source-layer':'buildings',
        minzoom:13,
        paint:{'fill-extrusion-color':['match',['%',['coalesce',['id'],7],5],
                 0,'#b08a72', 1,'#d8cdb8', 2,'#c4bba8', 3,'#c2a184', '#d0c7b5'],   // uydu-doğal tonlar (Barış: boyalı kutu olmasın)
               // YÜKSEKLİK ÖNCELİĞİ (11.08, Barış: "Protomaps'in kendi verisinden"):
               // ① karodaki height (Protomaps=OSM, BİREBİR — Sapphire 261m) ② GHS uydu ölçümü
               // (feature-state, mahalle profili) ③ id-hash yedek. Eski sıra GHS'i öne alıyordu
               // -> 261m'lik kule 22m'lik hücre ortalamasına EZİLİYORDU. Düzeltildi.
               'fill-extrusion-height':['case',['has','height'],['to-number',['get','height']],
                 ['coalesce',['feature-state','h'],
                   ['+',7,['%',['coalesce',['id'],7],9]]]],
               'fill-extrusion-height-transition':{duration:0,delay:0},
               'fill-extrusion-base':['case',['has','min_height'],['to-number',['get','min_height']],0],
               'fill-extrusion-vertical-gradient':true,
               'fill-extrusion-opacity':0.9}});
    }
    map.setLight({anchor:'map',position:[1.5,200,35],color:'#fff',intensity:0.45});   // canlı-renk binalar için güçlendirilmiş ışık (varyant kıyasıyla seçildi)   // gündüz yönlü ışık
  }catch(e){ console.log('config hata:',e); }
  if(${IN.satStyle?'true':'false'}){ try{   // uydu stilinde 3B arazi kabartması + atmosfer ufku
    map.addSource('dem',{type:'raster-dem',tiles:['${DEM_URL}'],tileSize:256,maxzoom:14,encoding:'terrarium'});
    map.setTerrain({source:'dem',exaggeration:1.0});   // v91: uzun rotada kabartma DÜZ (1.15 bile belirgin pompalıyordu; bu zoom'larda görsel kayıp yok)
    map.setSky({'sky-color':'#4b8fd6','horizon-color':'#cfe0f0','fog-color':'#dbe7f3',
                'sky-horizon-blend':0.55,'horizon-fog-blend':0.55,'fog-ground-blend':0.30,'atmosphere-blend':0.85});
  }catch(e){ console.log('terrain hata:',e); } }
  // rota çizgisi + konum: binalardan SONRA eklenir -> üstte çizilir (MapLibre'de slot yok, sıra belirler)
  map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:${JSON.stringify(pts.map(p=>[p.lon,p.lat]))}}}});
  // ═══ 3B ROTA ŞERİDİ — custom WebGL (v139, Barış 2026-08-28) ═══
  // NEDEN: MapLibre'nin type:'line' katmanı terrain açıkken araziye DRAPE edilir (DEM yüzeyine
  // yapışır). Köprü/viyadük DEM'de yok (kaba terrarium) -> yol yukarıdayken çizgi altındaki
  // vadi/dere yatağına iniyor, Barış'ın gördüğü "köprüde yere sabitleme" bu.
  // MapLibre'de 'line-z-offset' YOK (6.6.0'da bile; o özellik Mapbox GL v3'e özgü) -> sürüm
  // yükseltmek çözmez. Çözüm: rotayı kendi WebGL katmanımızda GERÇEK YÜKSEKLİKTE çizmek.
  // z = max(GPS alt, DEM) + 2m  -> köprüde GPS kazanır (çizgi yukarıda), düz yolda DEM kazanır
  // (GPS gürültüsü çizgiyi yerin altına sokmaz). renderingMode:'3d' + depth test sayesinde
  // arazi sırtı çizgiyi DOĞRU gizler (overlay'de olmayan kazanç).
  window._RP3 = ${JSON.stringify(pts.map(p=>[p.lon,p.lat,(typeof p.alt==='number'?p.alt:null)]))};
  // ═══ ARAZİ YÜKSEKLİĞİNİ KENDİMİZ ÖLÇ (v140) ═══
  // map.queryTerrainElevation KULLANILMAZ: vendor'da getDEMElevation, karo yoksa 0 doner
  // yani karo YÜKLÜ DEĞİLKEN null değil **0** döner. 0'ı geçerli yükseklik sayınca "veri tam"
  // sanılıyor, geometri hiçbir arazi karosu gelmeden donuyor ve şerit araziden ~5 m AŞAĞIDA
  // kalıyordu -> yamaçta yutuluyor, gidiş-dönüşte biri diğerini örtüyordu.
  // Çözüm: terrarium DEM karosunu doğrudan okuyup rakımı biz hesaplıyoruz (deterministik:
  // aynı rota = aynı video; karo yükleme yarışı yok, private API yok).
  window._demZ = null;
  window._demHesapla = async function(){
    const P=window._RP3, Z=12, N=Math.pow(2,Z), U=${JSON.stringify(DEM_URL)};
    const kon=(lat,lon)=>{ const rad=lat*Math.PI/180;
      return [ (lon+180)/360*N,
               (1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*N ]; };
    const gerek=new Set();
    for(const p of P){ const c=kon(p[1],p[0]); gerek.add(Math.floor(c[0])+'/'+Math.floor(c[1])); }
    const kar={};
    for(const k of gerek){
      const xy=k.split('/');
      try{
        const r=await fetch(U.replace('{z}',Z).replace('{x}',xy[0]).replace('{y}',xy[1]));
        if(!r.ok){ kar[k]=null; continue; }
        const im=await createImageBitmap(await r.blob());
        const cv=new OffscreenCanvas(im.width,im.height), cx=cv.getContext('2d');
        cx.drawImage(im,0,0); kar[k]=cx.getImageData(0,0,im.width,im.height);
      }catch(e){ kar[k]=null; }
    }
    let n=0;
    window._demZ=P.map(p=>{
      const c=kon(p[1],p[0]), k=Math.floor(c[0])+'/'+Math.floor(c[1]), g=kar[k];
      if(!g) return null;
      const ix=Math.min(g.width-1, Math.floor((c[0]-Math.floor(c[0]))*g.width));
      const iy=Math.min(g.height-1,Math.floor((c[1]-Math.floor(c[1]))*g.height));
      const o=(iy*g.width+ix)*4;
      n++; return (g.data[o]*256+g.data[o+1]+g.data[o+2]/256)-32768;   // terrarium formülü
    });
    return n+'/'+P.length;
  };
  const _RCOL = ${JSON.stringify(IN.lineColor||'#00e5ff')};
  function _hex2rgb(h){ const n=parseInt(h.replace('#',''),16);
    return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255]; }
  const rline3d = {
    id:'rline3d', type:'custom', renderingMode:'3d',
    onAdd(m, gl){
      this.map=m; this.hazir=false;
      // EKRAN-UZAYI kalınlık: yan kaydırma PROJEKSİYONDAN SONRA yapılır, yoksa eğik kamerada
      // ön plan şişer (ilk denemede oldu). MapLibre'nin kendi line katmanı da böyle çalışır.
      const vs=gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs,'attribute vec3 a_pos;attribute vec3 a_nxt;attribute float a_side;'+
        'uniform mat4 u_matrix;uniform vec2 u_vp;uniform float u_half;'+
        // ⚠️ KAMERA ARKASI: w<=0 olan noktada perspektif bölme işareti ters döner; ekran-uzayı
        // yön vektörü bozulur ve ŞERİT PATLAR (çizginin uzak/geçilmiş kısmı kayboluyordu).
        // Böyle vertex'i kadraj dışına atıyoruz — MapLibre'nin kendi line katmanı da
        // bu noktaları CPU'da kırpar; bizde karşılığı bu.
        'void main(){vec4 p0=u_matrix*vec4(a_pos,1.0);vec4 p1=u_matrix*vec4(a_nxt,1.0);'+
        'if(p0.w<=0.0){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}'+
        'vec2 s0=(p0.xy/p0.w)*u_vp;'+
        'vec2 s1=(p1.w>0.0)?((p1.xy/p1.w)*u_vp):(s0+vec2(1.0,0.0));'+
        'vec2 d=s1-s0;float L=length(d);vec2 dir=(L>1e-6)?d/L:vec2(1.0,0.0);'+
        'vec2 nrm=vec2(-dir.y,dir.x);vec2 off=nrm*u_half*a_side;'+
        'gl_Position=vec4(p0.xy+(off/u_vp)*p0.w,p0.z,p0.w);}');
      gl.compileShader(vs);
      const fs=gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs,'precision mediump float;uniform vec4 u_col;void main(){gl_FragColor=u_col;}');
      gl.compileShader(fs);
      const pr=gl.createProgram(); gl.attachShader(pr,vs); gl.attachShader(pr,fs); gl.linkProgram(pr);
      if(!gl.getProgramParameter(pr,gl.LINK_STATUS)){ console.log('rline3d link hata:',gl.getProgramInfoLog(pr)); return; }
      this.pr=pr;
      this.aPos=gl.getAttribLocation(pr,'a_pos'); this.aNxt=gl.getAttribLocation(pr,'a_nxt');
      this.aSide=gl.getAttribLocation(pr,'a_side');
      this.uMat=gl.getUniformLocation(pr,'u_matrix'); this.uHalf=gl.getUniformLocation(pr,'u_half');
      this.uCol=gl.getUniformLocation(pr,'u_col'); this.uVp=gl.getUniformLocation(pr,'u_vp');
      this.buf=gl.createBuffer();
    },
    // Geometriyi BİR KEZ kur: terrain karoları geldikten sonra (DEM sorgusu doğru olsun).
    kur(gl){
      const P=window._RP3; const n=P.length; if(n<2){ this.hazir=true; this.say=0; return; }
      const M=new Array(n);
      let demOk=0, demYok=0;
      // 1. geçiş: bilinen arazi yüksekliklerini topla
      const D=new Array(n);
      const _dz=window._demZ;
      for(let i=0;i<n;i++){
        const d=_dz?_dz[i]:null;
        if(typeof d==='number' && isFinite(d)){ D[i]=d; demOk++; } else { D[i]=null; demYok++; }
      }
      // 2. geçiş: BOŞLUK DOLDURMA — uzak karolar henüz yüklenmemişse en yakın bilinen
      // araziyi kullan. Yoksa o noktalarda sadece GPS kalıyor; GPS bu rotalarda araziden
      // ortalama 5 m DÜŞÜK ölçülüyor (ölçüldü) -> çizgi yerin altında kalıp KAYBOLUYORDU.
      for(let i=0;i<n;i++){
        if(D[i]!==null) continue;
        let a=i-1,b=i+1;
        while(a>=0 && D[a]===null) a--;
        while(b<n && D[b]===null) b++;
        const va=(a>=0)?D[a]:null, vb=(b<n)?D[b]:null;
        D[i]=(va!==null&&vb!==null)?Math.max(va,vb):(va!==null?va:(vb!==null?vb:null));
      }
      for(let i=0;i<n;i++){
        const lon=P[i][0], lat=P[i][1];
        let z=(typeof P[i][2]==='number')?P[i][2]:null;
        if(D[i]!==null) z=(z===null)?D[i]:Math.max(z,D[i]);
        if(z===null) z=0;
        const mc=maplibregl.MercatorCoordinate.fromLngLat({lng:lon,lat:lat}, z+8);
        M[i]=[mc.x,mc.y,mc.z];
      }
      window._RP3DEM=demOk;
      // Arazi henüz tam yüklenmediyse geometri EKSİK kalır -> sonraki karede yeniden kur.
      // (kare sınırı: sonsuz yeniden-kurma olmasın; 400 nokta için maliyeti önemsiz)
      this._tur=(this._tur||0)+1;
      const tamam=true;   // _demZ ön-ısıtmada dolduruldu -> tek seferde kur
      // şerit: her nokta için 2 vertex (sol/sağ), TRIANGLE_STRIP.
      // Yön shader'da ekran-uzayında hesaplanır -> vertex'e KOMŞU noktayı taşıyoruz.
      const V=new Float32Array(n*2*7);
      for(let i=0;i<n;i++){
        const a=M[i];
        // komşu: son noktada bir öncekinden ileri yön üret (sıfır uzunluk olmasın)
        const nb=(i<n-1)?M[i+1]:[2*M[i][0]-M[i-1][0], 2*M[i][1]-M[i-1][1], M[i][2]];
        for(let s=0;s<2;s++){
          const o=(i*2+s)*7;
          V[o]=a[0];  V[o+1]=a[1];  V[o+2]=a[2];
          V[o+3]=nb[0]; V[o+4]=nb[1]; V[o+5]=nb[2];
          V[o+6]=(s===0?-1:1);
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buf);
      gl.bufferData(gl.ARRAY_BUFFER,V,gl.STATIC_DRAW);
      this.say=n*2; this.hazir=tamam;
      if(tamam) console.log('rline3d hazır:',n,'nokta, arazi eşleşen:',demOk,'/',n,'tur:',this._tur);
    },
    render(gl,args){
      if(!this.pr) return;
      if(!this.hazir){ if(!window._demZ) return; this.kur(gl); }
      if(!this.say) return;
      // MapLibre 5.x: args.defaultProjectionData.mainMatrix — eski API'de düz matris
      const mtx=(args&&args.defaultProjectionData&&args.defaultProjectionData.mainMatrix)?args.defaultProjectionData.mainMatrix:args;
      const cv=gl.canvas, vpx=cv.width, vpy=cv.height;
      gl.useProgram(this.pr);
      gl.uniformMatrix4fv(this.uMat,false,mtx);
      gl.uniform2f(this.uVp,vpx*0.5,vpy*0.5);      // NDC -> piksel ölçeği
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buf);
      gl.enableVertexAttribArray(this.aPos);  gl.vertexAttribPointer(this.aPos,3,gl.FLOAT,false,28,0);
      gl.enableVertexAttribArray(this.aNxt);  gl.vertexAttribPointer(this.aNxt,3,gl.FLOAT,false,28,12);
      gl.enableVertexAttribArray(this.aSide); gl.vertexAttribPointer(this.aSide,1,gl.FLOAT,false,28,24);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
      // DERİNLİK ÖNYARGISI: sadece yükseklik ofseti (+8m) YETMEDİ — uzak mesafede depth buffer
      // hassasiyeti düştüğü için çizginin uzak yarısı arazinin altında kalıp KAYBOLUYORDU
      // (ölçüldü: +2m'de yarısı, +8m'de üst kısmı yok). polygonOffset çizgiyi derinlik
      // testinde kameraya doğru kaydırır: yanlış gizlenme biter, gerçek tepe-arkası
      // gizlenmesi (asıl kazanç) korunur.
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-8,-8);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      const c=_hex2rgb(_RCOL);
      // ölçek: motor rscale ile küçük tuval kullanabiliyor -> kalınlık tuvale göre ölçeklenir
      const k=vpy/${JSON.stringify(IN.H||832)};
      // 1) siyah kenarlık (9px) 2) renkli iz (5px) — eski iki line katmanının birebir karşılığı
      gl.uniform1f(this.uHalf,4.5*k); gl.uniform4f(this.uCol,0,0,0,0.55);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,this.say);
      gl.uniform1f(this.uHalf,2.5*k); gl.uniform4f(this.uCol,c[0],c[1],c[2],1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,this.say);
      gl.disable(gl.POLYGON_OFFSET_FILL);   // MapLibre'nin kendi katmanlarını etkilemesin
      gl.depthMask(true);
    }
  };
  map.addLayer(rline3d);
  map.addSource('pos',{type:'geojson',data:{type:'Feature',geometry:{type:'Point',coordinates:[${pts[0].lon},${pts[0].lat}]}}});
  map.addLayer({id:'posdot',type:'circle',source:'pos',paint:{'circle-radius':9,'circle-color':'${IN.dotColor||"#ff3b30"}','circle-stroke-width':3,'circle-stroke-color':'#fff'}});
  if(${IN.satStyle?'true':'false'}){ try{ map.setLayoutProperty('posdot','visibility','none'); }catch(e){} }   // v93: uzun rotada nokta OVERLAY'de çizilir (arazi sırtı 3D katmandaki noktayı örtüp "yerin altına" sokuyordu)
  ${(IN.mates&&IN.mates.length)?`
  // GRUP SÜRÜŞ (v113): N eş sürücü — her birine kendi renginde iz + nokta
  window._mateCols=${JSON.stringify(IN.mates.map(m=>m.dot||'#FFD60A'))};
  ${IN.mates.map((m,i)=>`
  map.addSource('route2_${i}',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:${JSON.stringify(m.pts2)}}}});
  map.addLayer({id:'rline2g_${i}',type:'line',source:'route2_${i}',paint:{'line-color':'#000','line-width':9,'line-opacity':0.55},layout:{'line-cap':'round','line-join':'round'}});
  map.addLayer({id:'rline2_${i}',type:'line',source:'route2_${i}',paint:{'line-color':'${m.line||"#FF9F0A"}','line-width':5},layout:{'line-cap':'round','line-join':'round'}});
  map.addSource('pos2_${i}',{type:'geojson',data:{type:'Feature',geometry:{type:'Point',coordinates:[${m.pos2[0][0]},${m.pos2[0][1]}]}}});
  map.addLayer({id:'posdot2_${i}',type:'circle',source:'pos2_${i}',paint:{'circle-radius':9,'circle-color':'${m.dot||"#FFD60A"}','circle-stroke-width':3,'circle-stroke-color':'#fff'}});
  ${IN.satStyle?`try{ map.setLayoutProperty('posdot2_${i}','visibility','none'); }catch(e){}`:''}`).join('')}`:''}
  window._ready=true;
});
const ov=document.getElementById('ov'),ctx=ov.getContext('2d');
function rr(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
let _wm=null; const _WM=${JSON.stringify(IN.wm||"")};
if(_WM){ _wm=new Image(); _wm.src=_WM; }
const ACC='${IN.lineColor||"#00e5ff"}';
const _Wd=${W}, _Hd=${H}, _mg=Math.round(_Wd*0.05), _S=Math.min(_Wd,_Hd);  // _S: yazı/aralık tabanı — YATAY videoda taşma/üst üste binme fix'i (2026-07-11)
function drawBolt(x,y,sz,col){ ctx.save(); ctx.fillStyle=col; ctx.shadowColor='rgba(0,0,0,0.55)'; ctx.shadowBlur=sz*0.18;
  ctx.beginPath(); ctx.moveTo(x+sz*0.58,y); ctx.lineTo(x+sz*0.12,y+sz*0.56); ctx.lineTo(x+sz*0.46,y+sz*0.56);
  ctx.lineTo(x+sz*0.30,y+sz); ctx.lineTo(x+sz*0.86,y+sz*0.40); ctx.lineTo(x+sz*0.50,y+sz*0.40); ctx.closePath(); ctx.fill(); ctx.restore(); }
window.draw=(s)=>{ctx.clearRect(0,0,_Wd,_Hd);
  if(${IN.satStyle?'true':'false'} && window._mpos){
    // v93: nokta overlay'de — HER ZAMAN görünür, arazi/sırt örtemez (harita katmanındaki kopya gizli)
    try{ const q=map.project(window._mpos);
      if(q&&isFinite(q.x)&&isFinite(q.y)){
        ctx.save(); ctx.beginPath(); ctx.arc(q.x,q.y,Math.round(_S*0.011),0,Math.PI*2);
        ctx.fillStyle='${IN.dotColor||"#ff3b30"}'; ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=6; ctx.fill();
        ctx.shadowBlur=0; ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.stroke(); ctx.restore();
      } }catch(e){}
  }
  if(${(IN.satStyle&&IN.mates&&IN.mates.length)?'true':'false'} && window._mposM){
    for(let mi=0;mi<window._mposM.length;mi++){
      try{ const q2=map.project(window._mposM[mi]);
        if(q2&&isFinite(q2.x)&&isFinite(q2.y)){
          ctx.save(); ctx.beginPath(); ctx.arc(q2.x,q2.y,Math.round(_S*0.011),0,Math.PI*2);
          ctx.fillStyle=(window._mateCols&&window._mateCols[mi])||'#FFD60A'; ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=6; ctx.fill();
          ctx.shadowBlur=0; ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.stroke(); ctx.restore();
        } }catch(e){}
    }
  }
  // --- ŞIK HUD (v96, Barış "cilala"): cam kapsüller + ikonlar + yumuşak beliriş/çekilme (s.hudA) ---
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
    const slide=(1-hudA)*_Hd*0.02;   // belirirken hafif süzülme
    // ÜST kapsül: 📍 tarih • toplam km
    ctx.font='600 '+Math.round(_S*0.030)+'px DejaVu Sans, "Noto Color Emoji", sans-serif';
    const ttxt='📍 '+s.title;
    const th=Math.round(_Hd*0.050), tw=ctx.measureText(ttxt).width+th*1.5;
    const ty=Math.round(_Hd*_topY)-Math.round(th*0.62)-slide;
    pill(_mg,ty,tw,th);
    ctx.shadowColor='rgba(0,0,0,0.55)'; ctx.shadowBlur=7; ctx.fillStyle='rgba(255,255,255,0.97)'; ctx.fillText(ttxt,_mg+th*0.75,ty+th*0.54);
    // ALT kapsül: 🛣️ mesafe  🕘 saat  ❤️ nabız
    ctx.font='700 '+Math.round(_S*0.037)+'px DejaVu Sans, "Noto Color Emoji", sans-serif';
    const btxt='🛣️ '+(s.cum/1000).toFixed(1)+' km'+(s.tm?('       🕘 '+s.tm):'')+(s.hr?('       ❤️ '+Math.round(s.hr)):'');
    const bh=Math.round(_Hd*0.058), bw2=ctx.measureText(btxt).width+bh*1.5;
    const by=_Hd-Math.round(_Hd*_botY)-Math.round(bh*0.62)+slide;
    pill(_mg,by,bw2,bh);
    ctx.shadowColor='rgba(0,0,0,0.55)'; ctx.shadowBlur=7; ctx.fillStyle='#fff'; ctx.fillText(btxt,_mg+bh*0.75,by+bh*0.54);
    ctx.restore(); ctx.textBaseline='alphabetic'; }
  // MEKAN adı (dwell'de ortada fade-in)
  if(s.poi && s.poiA>0.15){ ctx.save(); ctx.globalAlpha=Math.min(1,(s.poiA-0.15)/0.5);
    ctx.textAlign='center'; ctx.font='700 '+Math.round(_S*0.044)+'px DejaVu Sans, sans-serif';
    ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=8; ctx.fillStyle='#fff';
    ctx.fillText(s.poi, _Wd/2, Math.round(_Hd*_poiY)); ctx.restore(); }
  // (EN HIZLI NOKTA iğnesi KALDIRILDI — hız tespiti yanlış olduğu için peak hız de gösterilmiyor)
  // MINIK kaynak attribution (köşede, lisans uyumu) — sağ alt, soluk.
  // 2026-08-10: Mapbox'tan kopunca metin GERÇEK kaynaklara güncellendi. Eski "© Mapbox" hem YANLIŞ
  // (artık kullanılmıyor) hem EKSİKTİ. Zorunlu olanlar: Esri World Imagery (Esri/Maxar) + OSM
  // (kendi Protomaps arşivimiz OSM türevi). Silme — lisans gereği görünmek zorunda.
  ctx.save(); ctx.globalAlpha=0.45; ctx.fillStyle='#fff'; ctx.font='400 '+Math.round(_S*0.017)+'px DejaVu Sans, sans-serif';
  ctx.textAlign='right'; ctx.fillText('© OpenStreetMap · Esri, Maxar', _Wd-Math.round(_Wd*0.018), _Hd-Math.round(_Hd*0.010)); ctx.restore(); ctx.textAlign='left';
  // FREE logo (KENDİ logomuz) — sağ alt küçük
  if(_wm && _wm.complete && _wm.width){ const ww=Math.round(_S*0.12), hh=Math.round(ww*_wm.height/_wm.width); ctx.globalAlpha=0.85; ctx.drawImage(_wm,_Wd-ww-Math.round(_Wd*0.03),_Hd-hh-Math.round(_Hd*0.085),ww,hh); ctx.globalAlpha=1; }};
window.drawIntro=(name,activity,date)=>{ctx.clearRect(0,0,_Wd,_Hd);
  // YATAY FIX (2026-07-11): yazı boyutu + satır aralığı kısa kenara (_S) bağlı — dikeyde birebir aynı,
  // yatayda satırlar artık üst üste binmez (eski hali fontu genişlikten, aralığı yükseklikten alıyordu).
  ctx.fillStyle='rgba(6,8,18,0.86)'; ctx.fillRect(0,0,_Wd,_Hd);
  ctx.textAlign='center';
  const ny=Math.round(_Hd*0.455);
  ctx.fillStyle='#fff'; ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=10;
  ctx.font='700 '+Math.round(_S*0.062)+'px DejaVu Sans, sans-serif';
  ctx.fillText((name&&name.trim())||'Move Log', _Wd/2, ny);
  ctx.shadowBlur=0; ctx.strokeStyle=ACC; ctx.lineWidth=3;
  const lw=Math.round(_S*0.09), uy=ny+Math.round(_S*0.053);
  ctx.beginPath(); ctx.moveTo(_Wd/2-lw,uy); ctx.lineTo(_Wd/2+lw,uy); ctx.stroke();
  ctx.fillStyle=ACC; ctx.font='600 '+Math.round(_S*0.040)+'px DejaVu Sans, sans-serif';
  ctx.fillText([activity,date].filter(Boolean).join('  •  '), _Wd/2, ny+Math.round(_S*0.169));
  ctx.textAlign='left';};
window.drawOutro=(lines)=>{ctx.clearRect(0,0,_Wd,_Hd);
  // YATAY FIX: satır adımı ve fontlar _S tabanlı (dikey birebir korunur)
  ctx.fillStyle='rgba(6,8,18,0.88)'; ctx.fillRect(0,0,_Wd,_Hd);
  ctx.textAlign='center'; ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=10;
  const L=lines&&lines.length?lines:['Özet'];
  let y=Math.round(_Hd*0.5-_S*0.1067*(L.length-1));
  for(let i=0;i<L.length;i++){ ctx.fillStyle=i===0?'#fff':ACC;
    ctx.font=(i===0?'700 ':'600 ')+Math.round(_S*(i===0?0.055:0.040))+'px DejaVu Sans, sans-serif';
    ctx.fillText(L[i], _Wd/2, y); y+=Math.round(_S*0.169); }
  ctx.shadowBlur=0; ctx.textAlign='left';};
window.setPos=(mlon,mlat,clon,clat,brg,zm,pit)=>{map.getSource('pos').setData({type:'Feature',geometry:{type:'Point',coordinates:[mlon,mlat]}});
  window._mpos=[mlon,mlat];
  map.jumpTo({center:[clon,clat],zoom:zm,pitch:pit,bearing:brg});};
window.setPosAll=(arr)=>{for(let i=0;i<arr.length;i++){try{map.getSource('pos2_'+i).setData({type:'Feature',geometry:{type:'Point',coordinates:arr[i]}});}catch(e){}} window._mposM=arr;};
window.fitInfo=(w,e,s,n)=>{const c=map.cameraForBounds([[w,s],[e,n]],{padding:90});
  const ct=c.center; return {lon:(ct.lng!==undefined?ct.lng:ct[0]),lat:(ct.lat!==undefined?ct.lat:ct[1]),zoom:c.zoom};};
window.drawWorldStats=(lines,a)=>{if(a===undefined)a=1; ctx.clearRect(0,0,_Wd,_Hd);   // dünya finali: şık bilgi kartı (yumuşak belirir)
  const L=(lines&&lines.length?lines:['']);
  ctx.save(); ctx.globalAlpha=Math.max(0,Math.min(1,a));
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='700 '+Math.round(_S*0.042)+'px DejaVu Sans, "Noto Color Emoji", sans-serif';
  let mw=0; for(const ln of L){ mw=Math.max(mw,ctx.measureText(ln).width); }
  const lh=Math.round(_S*0.0924), pad=Math.round(_S*0.05);
  const cw=mw+pad*2, chh=L.length*lh+pad*1.2, cx=(_Wd-cw)/2, cy=_Hd*0.80-chh/2+( (1-a)*_Hd*0.02 );
  const r=Math.round(_S*0.039); ctx.beginPath(); ctx.moveTo(cx+r,cy); ctx.arcTo(cx+cw,cy,cx+cw,cy+chh,r); ctx.arcTo(cx+cw,cy+chh,cx,cy+chh,r); ctx.arcTo(cx,cy+chh,cx,cy,r); ctx.arcTo(cx,cy,cx+cw,cy,r); ctx.closePath();
  ctx.fillStyle='rgba(8,12,22,0.60)'; ctx.fill(); ctx.lineWidth=1.5; ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.stroke();
  ctx.fillStyle='#fff';
  let yy=cy+pad*0.6+lh*0.5; for(const ln of L){ ctx.fillText(ln,_Wd/2,yy); yy+=lh; }
  ctx.restore(); ctx.textBaseline='alphabetic';};
window.waitIdle=(cap)=>new Promise(res=>{
  // AKILLI BEKLEME (v89): önce BİR kare render et (yeni konumun karo istekleri kuyruğa girsin) —
  // v80'de anında dönüş, istekler daha atılmadan "yüklü" sanıp BEYAZ kare bırakıyordu.
  map.triggerRepaint();
  requestAnimationFrame(()=>{
    if(map.areTilesLoaded&&map.areTilesLoaded()&&map.loaded()) return res();
    let d=false;const ok=()=>{if(!d){d=true;res();}};map.once('idle',ok);setTimeout(ok,cap);
  });});
</script></body></html>`;


  return { HTML, IN, smPath, pts, frames, fps, zoom, pitch, title, W, H, OW, OH };
}
