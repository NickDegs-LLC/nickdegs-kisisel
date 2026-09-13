#!/usr/bin/env python3
# TAKTİK ROTA RENDER v1 (gaming aboneliği): çizgi YOK — uydu üstten, gimbal reticle hedefi izler.
# Kamera hedefi takip eder; HUD: hız/mesafe/koordinat/REC. Süre=29.3sn (mevcut ses hattıyla birebir).
import os, sys, math, json, random, urllib.request, io
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops, ImageEnhance, ImageOps
random.seed(4)
SC=os.environ.get("TAC_WORKDIR", os.path.dirname(os.path.abspath(__file__))+"/work")
OUT=f"{SC}/tacframes"; os.makedirs(OUT, exist_ok=True)
for o in os.listdir(OUT): os.remove(f"{OUT}/{o}")
MB=[l.split('=',1)[1].strip() for l in open('/opt/matrix/secrets/mapbox.conf') if l.startswith('MAPBOX_PUBLIC_TOKEN=')][0]
# TAŞIMA (RunPod, 2026-08-30): harita taban ucu env'den. VARSAYILAN = bugünkü yerel proxy ->
# env yokken davranış BİREBİR AYNI. Yalnız taban-URL parametrik; yol/parametre/eşik DOKUNULMADI.
_HT=os.environ.get("HARITA_TABAN","http://127.0.0.1:8890").rstrip("/")
_H_STATIK=os.environ.get("HARITA_STATIK",_HT).rstrip("/")
_H_GEO=os.environ.get("HARITA_GEOCODING",_HT).rstrip("/")
def _retcol():
    _h=os.environ.get("TAC_RETCOL","")
    if _h.startswith("#") and len(_h)==7:
        try:
            r,g,b=int(_h[1:3],16),int(_h[3:5],16),int(_h[5:7],16)
            lt=(min(255,r+35),min(255,g+35),min(255,b+35))
            return (r,g,b),lt
        except ValueError: pass
    return (255,90,80),(255,120,110)
RETC,RETL=_retcol()
def sm(a): return max(0.0,min(1.0,a))**2*(3-2*max(0.0,min(1.0,a)))
W=int(os.environ.get("TAC_W","1080")); H=int(os.environ.get("TAC_H","1920")); FPS=30; DUR=float(os.environ.get("TAC_DUR","20.6")); N=int(FPS*DUR)
# HUD TEMASI (Barış 2026-07-25, Faz1): default(yeşil recon) / thermal / night(gece görüş) / day
_THEME=os.environ.get("TAC_THEME","default")
_THEMES={
 "default":{"acc":(150,255,235),"amb":(255,190,90),"grade":"recon"},
 "thermal":{"acc":(255,180,70), "amb":(255,235,140),"grade":"thermal"},
 "night":  {"acc":(120,220,255),"amb":(150,210,255),"grade":"darknight"},   # GECE: karanlık uydu + zoom-termal (yeşil NV kaldırıldı, göz yormaz)
 "day":    {"acc":(120,205,255),"amb":(255,205,110),"grade":"day"},
}
_TH=_THEMES.get(_THEME,_THEMES["default"]); HUDA=_TH["acc"]; _GRADE=_TH["grade"]
TEAL=HUDA; GRAY=(170,180,185); RED=(255,90,80); AMB=_TH["amb"]; WHITE=(240,255,250); DIM=(90,110,112)
_AUTO_NF=1.0   # OTONOM görüş: o karenin gece-fraksiyonu (1=gece NV, 0=gündüz); loop kare-kare günceller
def _sun_elev(lat,lon,epoch):
    """Güneş yükseklik açısı (derece). <-4° ~ karanlık. Otonom gece/gündüz geçişi için."""
    jd=epoch/86400.0+2440587.5; n=jd-2451545.0
    L=(280.460+0.9856474*n)%360; g=math.radians((357.528+0.9856003*n)%360)
    lam=math.radians(L+1.915*math.sin(g)+0.020*math.sin(2*g)); eps=math.radians(23.439-0.0000004*n)
    dec=math.asin(math.sin(eps)*math.sin(lam)); ra=math.atan2(math.cos(eps)*math.sin(lam),math.cos(lam))
    gmst=(18.697374558+24.06570982441908*n)%24; lst=(gmst*15+lon)%360
    ha=math.radians((lst-math.degrees(ra))%360); latr=math.radians(lat)
    return math.degrees(math.asin(math.sin(latr)*math.sin(dec)+math.cos(latr)*math.cos(dec)*math.cos(ha)))
_FDIR=os.path.dirname(os.path.abspath(__file__))+"/fonts"   # ASKERİ/TAKTİK HUD fontu (Chakra Petch — angular military-tech)
def F(s): return ImageFont.truetype(_FDIR+"/ChakraPetch-SemiBold.ttf", s)
def FBD(s): return ImageFont.truetype(_FDIR+"/ChakraPetch-Bold.ttf", s)
FB,FM,FS,FTT=FBD(42),F(31),F(23),F(16)

pts=json.load(open(f"{SC}/route.json"))
la=[p["lat"] for p in pts]; lo=[p["lon"] for p in pts]; sp=[p["spd"] for p in pts]
# --- Web Mercator ---
def merc(lon,lat):
    x=lon*math.pi/180.0
    y=math.log(math.tan(math.pi/4+lat*math.pi/360.0))
    return x,y
PAD=0.22
mx=[merc(o,a)[0] for o,a in zip(lo,la)]; my=[merc(o,a)[1] for o,a in zip(lo,la)]
dx=max(mx)-min(mx); dy=max(my)-min(my)
bx0=min(mx)-dx*PAD; bx1=max(mx)+dx*PAD; by0=min(my)-dy*PAD; by1=max(my)+dy*PAD
def inv(x,y):
    return x*180.0/math.pi, (2*math.atan(math.exp(y))-math.pi/2)*180.0/math.pi
lon0,lat0=inv(bx0,by0); lon1,lat1=inv(bx1,by1)
IMG_PX=1280
u=(f"{_H_STATIK}/styles/v1/mapbox/satellite-v9/static/"
   f"[{lon0:.6f},{lat0:.6f},{lon1:.6f},{lat1:.6f}]/{IMG_PX}x{IMG_PX}@2x?access_token={MB}")
BIG=Image.open(io.BytesIO(urllib.request.urlopen(u,timeout=60).read())).convert("RGB")
BW,BH=BIG.size
# mapbox fit: oranı koruyarak sığdırır -> ölçek=min, merkez=bbox merkezi
s=min(BW/(bx1-bx0), BH/(by1-by0))
cx=(bx0+bx1)/2; cy=(by0+by1)/2
def px(lon,lat):
    x,y=merc(lon,lat)
    return BW/2+(x-cx)*s, BH/2-(y-cy)*s
# --- zaman örnekleme: sürüşü DUR süresine sıkıştır + yumuşat ---
def resample(vals,n):
    out=[]
    for i in range(n):
        f=i*(len(vals)-1)/(n-1); j=int(f); g=f-j
        out.append(vals[j]*(1-g)+vals[min(j+1,len(vals)-1)]*g)
    return out
def _arc_param(px,py,n):
    # MESAFE-tabanlı kare parametresi: kareleri arc-length'e EŞİT dağıt -> sabit kamera tempo.
    # (INDEX-resample zaman/mesafe çarpıtıyordu: git-gel/duruşlu ilçede ~15km 1 saniyeye sıkışıp
    #  "aşırı ilçeye ışınlanıp geri" oluyordu. arc-eşit = hiçbir bölüm sıkışmaz/ışınlanmaz. Barış 2026-07-28.)
    N2=len(px)
    if N2<2: return [0.0]*n
    cum=[0.0]
    for i in range(1,N2): cum.append(cum[-1]+math.hypot(px[i]-px[i-1],py[i]-py[i-1]))
    tot=cum[-1] or 1.0
    idxs=[]; j=0
    for i in range(n):
        t=tot*i/max(1,(n-1))
        while j<N2-1 and cum[j+1]<t: j+=1
        seg=(cum[j+1]-cum[j]) if j<N2-1 else 1.0
        f=((t-cum[j])/seg) if seg>1e-9 else 0.0
        idxs.append(j+f)
    return idxs
def _pick(vals,idxs):
    out=[]
    for fi in idxs:
        j=int(fi); g=fi-j
        out.append(vals[j]*(1-g)+vals[min(j+1,len(vals)-1)]*g)
    return out
def smooth(vals,k=21):
    out=[]
    for i in range(len(vals)):
        w=vals[max(0,i-k):i+k+1]; out.append(sum(w)/len(w))
    return out
def ease_vel(px,py,win):
    # HIZ (velocity) yumuşatma: yol GEOMETRİSİ aynı kalır (pinpoint), sadece hızlanma/yavaşlama yumuşar
    # -> ani hız değişiminde MARKÖR ZIPLAMASI biter (Barış: "hafif ivmeli"). Toplam mesafe korunur.
    N2=len(px)
    if N2<4 or win<2: return list(px),list(py)
    d=[0.0]+[math.hypot(px[i]-px[i-1],py[i]-py[i-1]) for i in range(1,N2)]
    cum=[0.0]
    for i in range(1,N2): cum.append(cum[-1]+d[i])
    tot=cum[-1]
    if tot<1e-6: return list(px),list(py)
    ds=smooth(d,win); ss=sum(ds) or 1.0
    tgt=[0.0]
    for i in range(1,N2): tgt.append(tgt[-1]+ds[i]*tot/ss)   # yumuşatılmış hızla eşit-toplam ilerleme
    ox=[]; oy=[]; j=0
    for i in range(N2):
        t=min(tot,tgt[i])
        while j<N2-1 and cum[j+1]<t: j+=1
        seg=(cum[j+1]-cum[j]) if j<N2-1 else 1.0
        f=((t-cum[j])/seg) if seg>1e-9 else 0.0
        k=min(j+1,N2-1)
        ox.append(px[j]+(px[k]-px[j])*f); oy.append(py[j]+(py[k]-py[j])*f)
    return ox,oy
PXS=[px(o,a) for o,a in zip(lo,la)]
# OTONOM YUMUŞATMA: kare başına metre büyüdükçe pencere KÜÇÜLÜR (koy/viraj kesme = denize düşme biter)
_MPU0=6378137*math.cos(sum(la)/len(la)*math.pi/180)
_plen=sum(math.hypot(PXS[i][0]-PXS[i-1][0],PXS[i][1]-PXS[i-1][1]) for i in range(1,len(PXS)))/s*_MPU0 if len(PXS)>1 else 1
_mpf=max(1.0,_plen/N)
_K=max(1,min(3,int(60/_mpf)))   # NOKTA-ATIŞI: hafif (kısa rota marker tam yolda)
_apar=_arc_param([p[0] for p in PXS],[p[1] for p in PXS],N)   # MESAFE-eşit kare parametresi (ışınlanma fix)
X=smooth(_pick([p[0] for p in PXS],_apar),_K); Y=smooth(_pick([p[1] for p in PXS],_apar),_K)
# ease_vel KALDIRILDI: _arc_param zaten eşit-mesafe (sabit tempo) veriyor; ease_vel'in smooth-hızı
# git-geli/duruşları tekrar çarpıtıp ışınlanmaya katkı yapıyordu.
# rota DOĞAL son anına kadar oynar (yumuşatma YOK -> sert kesmeyle outro başlar)
SPD=smooth(_pick(sp,_apar),9)
SIG=smooth(_pick([p.get("sig",1.0) for p in pts],_apar),5)   # sinyal güveni (1=tam kilit, 0=zayıf/belirsiz); arc-eşit (konumla senkron)
# kümülatif mesafe (km)
DTOT=[0.0]
for i in range(1,N):
    DTOT.append(DTOT[-1]+math.hypot(X[i]-X[i-1],Y[i]-Y[i-1])/s*6371000*math.cos(sum(la)/len(la)*math.pi/180)/1000/6371000*1000)
# gerçek metre: merc birim -> metre ~ R*cos(lat)
MPU=6378137*math.cos(sum(la)/len(la)*math.pi/180)
DTOT=[0.0]
for i in range(1,N):
    DTOT.append(DTOT[-1]+math.hypot(X[i]-X[i-1],Y[i]-Y[i-1])/s*MPU/1000)
LATS=smooth(_pick(la,_apar),2); LONS=smooth(_pick(lo,_apar),2)   # NOKTA-ATIŞI: arc-eşit (X/Y ile senkron marker), köşe kesme yok
# --- ZOOM ENHANCE denetim dalışı (yalnız GENİŞ rotalarda): dibe in -> incele -> geri çık ---
_SPANM=_MPU0*(bx1-bx0)
# DENETİM ZOOM'ları: UZUN modda sık, RASTGELE yer. Ayrı karo YOK -> aynı canlı görüntüde
# KADEMELİ zoom-in (dur-dur) -> hedef HAREKETE devam eder -> kademeli zoom-out. Işınlanma/donma imkansız.
import urllib.request as _ur, io as _io
def _tmpx(z):
    """`_dtile` görüntüsünün GERÇEK raster m/px'i.
    ⚠️ KÖK HATA (Barış 2026-08-04, deneyle kanıtlandı): `_ATILES` karolara `_mppz(z)` yazıyordu;
    oysa `_dtile` 1280x1280**@2x** ister -> 2560px raster, gerçek çözünürlük `_mppz(z)/2`.
    Ölçüm: z13, iki karo merkezi 1500m ayrık -> beklenen kayma 416px ölçüldü = 3,61 m/px
    (`_mppz(13)`=7,22 olsaydı 208px çıkardı). Yani karolar 2 KAT BÜYÜK çiziliyordu.
    Karo merkezi doğru yerdeydi ama merkezden uzaklaştıkça yer kayıyordu -> karo değişince
    görüntü zıplıyor, örtüşen karolarda 'iç içe geçme/yarım şehir'. Aylardır 'crossfade',
    'hizalama', 'kaynak farkı' sanılan şeyin gerçek sebebi budur."""
    return _mppz(z)/2.0

def _dtile(lat,lon,z=16,_size="1280x1280"):
    # logo/attribution=false: birleştirilen karolarda dağınık "mapbox" logosu olmasın (temiz mozaik)
    _u=f"{_H_STATIK}/styles/v1/mapbox/satellite-v9/static/{lon},{lat},{z},0/{_size}@2x?access_token={MB}&logo=false&attribution=false"
    return Image.open(_io.BytesIO(_ur.urlopen(_u,timeout=50).read())).convert("RGB")
# >>>KARO-FIKSI (Barış onayı 2026-08-31) — SESSİZ KARO ARIZASI ---------------------------------
# ARIZA: karo çekimi hata alınca `_dtiles_par._one` sessizce None döndürüyordu; çağıran taraf
# (satır ~866 `if _t is not None`, ~922 `if _tl is None: continue`) o karoyu DÜŞÜRÜYOR -> bölge
# kaba karoyla render ediliyor ve loga HİÇBİR ŞEY düşmüyordu. Ölçüm (2026-08-31, aynı route.json,
# 450 kare): host↔host 0/450, host↔konteyner 0/450, konteyner↔konteyner 134/450. Sunucuda karo
# localhost'tan (8890) geliyordu; RunPod'da internetten gelecek -> risk büyüyor.
# FİKS: geçici hatada (ağ/timeout/5xx/bozuk gövde) yeniden deneme + başarısız-karo sayacı; eşik
# aşılırsa iş BAŞARISIZ (route_gen exit!=0 -> render_job sh() RuntimeError -> rp_handler_tac
# ok:false -> kuyruk bekçisi yeniden kuyruğa alır). Kalıcı 4xx (404/400/403) YENİDEN DENENMEZ.
# MÜHÜR: mevcut satırların HİÇBİRİ değişmedi; `_dtile` adı aşağıda sarmalayıcıya bağlanıyor, böylece
# hem `_dtiles_par` hem HBIG ızgarası (satır ~920) tek noktadan korunuyor. Davranış sabitlerine
# (zoom kademeleri, pacing, confidence 0.35, _WINMIN, _ATILES mantığı, CH/OVL/FPS/PAD) DOKUNULMADI.
import time as _tm, threading as _th, urllib.error as _uerr
_dtile_ham=_dtile                                    # mühürlü orijinal çekim (sarmalayıcı bunu çağırır)
_TILE_TOTAL=0; _TILE_FAIL=0; _TILE_RETRY_OK=0; _TILE_KILIT=_th.Lock()
_TILE_BEKLE=(0.3,0.8,2.0)                            # 3 yeniden deneme, kısa artan bekleme (sn)
_TILE_FAIL_ORAN=float(os.environ.get("TAC_TILE_FAIL_ORAN","0.02"))   # oran > %2  -> iş BAŞARISIZ
_TILE_FAIL_MUTLAK=int(os.environ.get("TAC_TILE_FAIL_MUTLAK","8"))    # mutlak > 8 -> iş BAŞARISIZ
def _karo_kalici(e):
    """KALICI sonuç mu? 4xx (404/400/403) = karo gerçekten yok/erişilemez -> yeniden deneme İŞE YARAMAZ.
    408 (timeout) ve 429 (hız limiti) geçicidir -> yeniden denenir."""
    return (isinstance(e,_uerr.HTTPError) and 400<=int(getattr(e,"code",0) or 0)<500
            and int(getattr(e,"code",0) or 0) not in (408,429))
def _dtile_yeniden(lat,lon,z=16,_size="1280x1280"):
    """_dtile + yeniden deneme + sayaç. Tükenirse İSTİSNA fırlatır (çağıranın gördüğü davranış aynı)
    ama artık SAYILIR; eşik denetimi `_karo_denetle()` işi düşürür."""
    global _TILE_TOTAL,_TILE_FAIL,_TILE_RETRY_OK
    with _TILE_KILIT: _TILE_TOTAL+=1
    _son=None
    for _d in range(len(_TILE_BEKLE)+1):             # ilk deneme + 3 yeniden deneme
        try:
            _im=_dtile_ham(lat,lon,z,_size=_size)
            if _d:
                with _TILE_KILIT: _TILE_RETRY_OK+=1  # yeniden denemeyle KURTARILDI
            return _im
        except Exception as _e:
            _son=_e
            if _karo_kalici(_e): break               # kalıcı -> ısrar etme
            if _d<len(_TILE_BEKLE): _tm.sleep(_TILE_BEKLE[_d])
    with _TILE_KILIT: _TILE_FAIL+=1
    if os.environ.get("TAC_ECHO")=="1":
        print(f"KARO HATA: z{z} {lat:.5f},{lon:.5f} -> {type(_son).__name__}: {str(_son)[:120]}", flush=True)
    raise _son if isinstance(_son,BaseException) else RuntimeError("karo çekilemedi")
def _karo_denetle():
    """EŞİK: başarısız oran > %2 VEYA mutlak başarısız > 8 -> RuntimeError ile iş BAŞARISIZ.
    (Eşikler TAC_TILE_FAIL_ORAN / TAC_TILE_FAIL_MUTLAK ile ayarlanabilir.)"""
    with _TILE_KILIT: _t,_f,_r=_TILE_TOTAL,_TILE_FAIL,_TILE_RETRY_OK
    if os.environ.get("TAC_ECHO")=="1":
        print(f"KARO: total={_t} fail={_f} oran=%{(100.0*_f/_t if _t else 0.0):.2f} retry_kurtarma={_r}", flush=True)
    if _t and (_f>_TILE_FAIL_MUTLAK or (_f/float(_t))>_TILE_FAIL_ORAN):
        raise RuntimeError(f"karo çekimi güvenilmez: {_f}/{_t}")
_dtile=_dtile_yeniden                                # TÜM çağrı yerleri sarmalayıcıdan geçer
# <<<KARO-FIKSI ---------------------------------------------------------------------------------
def _dtiles_par(coords, workers=12):
    """PARALEL karo çekme (Barış 2026-07-27 "baştan sona net"): yüksek-çöz karo sayısı arttı -> seri fetch
    'takılı' görünüyordu. coords=[(lat,lon,z),...] -> [img|None] (girişle AYNI sırada, chunk/determinizm korunur)."""
    import concurrent.futures as _cf
    _res=[None]*len(coords)
    def _one(_ix):
        _c=coords[_ix]
        try: return _ix,_dtile(_c[0],_c[1],_c[2],_size=(_c[3] if len(_c)>3 else "1280x1280"))
        except Exception: return _ix,None
    with _cf.ThreadPoolExecutor(max_workers=workers) as _ex:
        for _ix,_im in _ex.map(_one, range(len(coords))): _res[_ix]=_im
    _karo_denetle()   # KARO-FIKSI: eşik aşıldıysa RuntimeError -> iş BAŞARISIZ (sessiz kaba karo YOK)
    return _res
def _urban_score(im):
    """Merkez bölgede YAPILAŞMA/detay (crisp z16 kenar yoğunluğu): NV/zoom yalnız ŞEHİR gibi yapılı yerde.
    z16'da kalibre (7 nokta): şehir kenar≥0.24, kırsal/boş≤0.11 -> eşik 0.16 temiz ayırır."""
    w,h=im.size
    c=im.crop((int(w*0.28),int(h*0.24),int(w*0.72),int(h*0.62))).resize((96,96))
    _edge=(sum(ImageOps.grayscale(c).filter(ImageFilter.FIND_EDGES).getdata())/(96*96))/255.0
    return max(0.0,min(1.0,(_edge-0.185)/0.095))   # eşik 0.185: net şehir (edge≥0.24) açar, hafif banliyö/teras dışlanır
def _road_density(lat,lon,fine=False):
    """GÜVENİLİR kentsel tespit: Mapbox STREETS katmanı (yol+bina ağı). Teraslı tarlanın YOLU yok -> ayırır.
    KABA (z15, ~1.9km kutu): aday bulma; şehir 0.09-0.11, boş kırsal 0.03-0.05.
    İNCE (z16, ~950m kutu — Barış 2026-07-30 "optimum şehir algıla, dağda NV açma"): sınır keskinliği 2x.
    z16 KALİBRASYON (16 nokta ölçüldü): İstanbul/Ankara/İzmir/Samsun/Ünye 0.100-0.113, Elazığ/Ordu/Giresun
    0.085-0.090, Tunceli(kasaba) 0.064, Pertek/köy/dağ/otoyol 0.025-0.052 -> (d-0.055)/0.033 ile
    ŞEHİR=0.90-1.00, kasaba=0.28, KIR/DAĞ=0.00 (tam ayrım)."""
    try:
        _z=16 if fine else 15
        _u=f"{_H_STATIK}/styles/v1/mapbox/streets-v12/static/{lon},{lat},{_z},0/512x512@2x?access_token={MB}&logo=false&attribution=false"
        _im=Image.open(_io.BytesIO(_ur.urlopen(_u,timeout=40).read())).convert("RGB").resize((128,128))
        _d=(sum(ImageOps.grayscale(_im).filter(ImageFilter.FIND_EDGES).getdata())/(128*128))/255.0   # yol/bina kenar yoğunluğu
        if fine: return max(0.0,min(1.0,(_d-0.055)/0.033))
        return max(0.0,min(1.0,(_d-0.058)/0.045))   # 0.058=boş kırsal tavanı, 0.10+=net şehir -> 1.0
    except Exception: return 0.0
def _dpx(lat,lon,clat,clon,z=16,px=2560):
    # z16 karo (px=2560) içinde (lat,lon) piksel konumu, merkez (clat,clon)
    import math as _m
    sc=px/(360.0)*(2**z)/256.0*256.0    # basit yakınlaşma; küçük alanda yeterli
    # daha doğru: web mercator metre/px
    mpp=156543.03392*_m.cos(_m.radians(clat))/(2**z)/2.0   # @2x
    dx=(lon-clon)*_m.pi/180.0*6378137*_m.cos(_m.radians(clat))/mpp
    dy=-(lat-clat)*_m.pi/180.0*6378137/mpp
    return px/2+dx, px/2+dy
# ⚠️ DALIŞ (ZOOM ENHANCE) MEKANİZMASI KOMPLE KALDIRILDI (Barış 2026-08-03).
# NEDEN: rampası `_stepz` ile 4 basamağa bölünüyordu -> 1 dalış = 8 görünür zoom,
# 6 dalış = ~48 zoom ("elli tane zoom in/out, kafam patlayacak"). Ayrıca dalış
# kamerayı BAŞKA bir konuma (rota üstünde rastgele nokta) taşıyıp geri getiriyordu
# -> "bir yanda başka konumlardan değişme oluyor" + punch efekti yığılması.
# Kapatmak yerine SİLİNDİ: DIVES boş kalır, render döngüsündeki dalış blokları
# hiç çalışmaz (boş liste üzerinde dönerler). Geri istenirse bu blok geri konur.
DIVES=[]      # BOŞ — dalış yok
_DIN,_DH,_DOUT=1.4,1.2,1.4      # yavaş kademeli in (1.4sn) - hareketli tut (1.2) - yavaş kademeli out (1.4)
# ---- YER ETİKETLERİ: SÜREKLİ güncel konum (şehir + yakınlaşınca mahalle) + şehir-değişim vurgusu ----
PLACES=[]; ORIG_DEST=("","")
_LOC_city=[""]*N; _LOC_hood=[""]*N
def _rgeo2(lat,lon):
    # TEK çağrı -> (yerel=mahalle/kasaba, şehir/il) — context'ten üst şehir çıkarılır
    try:
        # language=en -> GLOBAL romanizasyon: Latin-dışı şehirler (東京->Tokyo, 台北->Taipei, Тверской->Tverskoy)
        # hem Chakra fontunda render olur hem İngilizce TTS okuyabilir; Latin/Türkçe isimler AYNI kalır
        _u=(f"{_H_GEO}/geocoding/v5/mapbox.places/{lon},{lat}.json"
            f"?access_token={MB}&types=neighborhood,locality,place&limit=1&language=en")
        _d=json.load(_ur.urlopen(_u,timeout=15)); f=_d.get("features",[])
        if not f: return ("","")
        _loc=f[0]["text"]; _city=""
        for _c in f[0].get("context",[]):
            _cid=str(_c.get("id",""))
            if _cid.startswith("place") or _cid.startswith("region"): _city=_c["text"]; break
        if not _city: _city=_loc
        # GLOBAL GÜVENLİK: language=en'e rağmen bazı mahallelerin İngilizcesi yok (Kahire vb. Arapça döner).
        # Latin-dışı ismi ETİKETTE gösterme (Chakra kutu çıkarır) / SESTE okutma -> şehre düş, o da Latin-dışıysa boş.
        _islat=lambda s: bool(s) and all(ord(ch)<0x250 for ch in s)   # Latin+Türkçe+Avrupa aksanları OK; CJK/Arapça/Kiril hariç
        if not _islat(_loc): _loc=""                 # Latin-dışı mahalle -> gösterme
        if not _islat(_city): _city=_loc             # Latin-dışı şehir -> mahalleye düş (o da boşsa boş = etiket/anons yok)
        return (_loc.upper()[:20], _city.upper()[:20])
    except Exception: return ("","")
# yol boyunca örnekle (tek tarama), kare-kare en yakın konumu göster
# ÖNEMLİ: örnekleme COĞRAFİ mesafeye bağlı (~8km'de bir) — kısa süreli uzun rotada ara ilçeler kaçmasın (Baskil vb.)
_gpts=min(28,max(6,int(_SPANM/8000),int(DUR/10)))
_gsam=[]
for _k in range(_gpts):
    _fr=_k/max(1,_gpts-1); _di=int((N-1)*_fr); _gsam.append((_fr,)+_rgeo2(LATS[_di],LONS[_di]))
for _i in range(N):
    _pr=_i/max(1,N-1); _b=min(_gsam,key=lambda s:abs(s[0]-_pr))
    _LOC_hood[_i]=_b[1]; _LOC_city[_i]=_b[2]
# ===== KENTSEL HARİTA (Barış: ŞEHİR=yeterli, HIZDAN BAĞIMSIZ) — zoom/NV kararı KONUMA bağlı =====
# Rota boyunca z16 karo örnekle -> urban_score. Şehirden geçince (otoyolda hızlı bile olsan) kamera
# yavaşlar+zoom+NV (aşağıda _z0=max(hız,urban)). Bu, gece uzun yolculukta şehir-içi NV'yi garanti eder.
_LOC_URB=[0.0]*N; _usam=[]
try:
    # ROTA UZUNLUĞUNA göre örnekle (D-B span'a DEĞİL): 900km winding rotada _SPANM 113km'di -> 22 örnek -> şehirler kaçtı.
    _rkm=sum(math.hypot((LATS[_k]-LATS[_k-1])*111.32,(LONS[_k]-LONS[_k-1])*111.32*math.cos(LATS[_k]*math.pi/180.0)) for _k in range(1,N))
    # ADAY TARAMASI (recall): ~4km'de bir (eski 7km bazı şehirleri komple ATLIYORDU) + PARALEL (sıklaştırma
    # süreyi uzatmasın; giriş sırasıyla eşlenir -> deterministik/chunk-güvenli).
    _upts=min(220,max(10,int(_rkm/4)))
    _uidx=[int((N-1)*(_k/max(1,_upts-1))) for _k in range(_upts)]
    from concurrent.futures import ThreadPoolExecutor as _TPE0
    with _TPE0(max_workers=10) as _ex0:
        _uvals=list(_ex0.map(lambda _d2: _road_density(LATS[_d2],LONS[_d2]), _uidx))
    _usam=[(_uidx[_k]/max(1,N-1),_uvals[_k],LATS[_uidx[_k]],LONS[_uidx[_k]]) for _k in range(_upts)]
    _uw=1.0/max(1,_upts-1)                                   # örnek aralığı (frac)
    for _i in range(N):
        _pr=_i/max(1,N-1)
        _LOC_URB[_i]=max((s[1] for s in _usam if abs(s[0]-_pr)<=_uw*1.0), default=0.0)   # ±1 örnek MAX: şehir TEPESİ korunur
    # ===== İNCE DOĞRULAMA — "zoom/NV yalnız GERÇEK şehirde" (Barış 2026-07-30: "yolun üzerinde olmayan yerlerde
    # zoom-in ve night vision olursa çok çirkin görünür, dağdan bayırdan gidiyor") =====
    # KÖK NEDEN: yukarıdaki kaba tarama ~7km'de bir örnekler ve ±1 örnek MAX ile YAYAR -> tek bir şehir örneği
    # ±7km'lik dağ/kır kesimini de "kentsel" yapıyordu -> NV/zoom bomboş dağ yolunda açılıyordu. (Ölçüldü: NV'nin
    # açıldığı Pertek noktalarında gerçek yol-yoğunluğu 0.049-0.055 = KIRSAL, ama ±7km'deki şehirden 1.0 miras almış.)
    # ÇÖZÜM: kaba haritanın kentsel dediği ADAY bölgelerde ~1.2km aralıkla YENİDEN örnekle ve her noktaya EN YAKIN
    # ince örneği ata (MAX-yayma YOK) -> kentsel bölge gerçek sınırlarına oturur, dağ/kır 0'a döner.
    try:
        _cumd=[0.0]*N
        for _i in range(1,N):
            _cumd[_i]=_cumd[_i-1]+math.hypot((LATS[_i]-LATS[_i-1])*111320.0,(LONS[_i]-LONS[_i-1])*111320.0*math.cos(LATS[_i]*math.pi/180.0))
        _cand=[_i for _i in range(N) if _LOC_URB[_i]>0.10]
        if _cand:
            _MARG=1500.0; _STEPF=700.0                        # aday bölgeye ±1.5km pay, 700m aralıkla ince örnek (z16 kutusu 950m -> örtüşür, sınır keskin)
            _zones=[]; _s=_cand[0]; _p=_cand[0]
            for _i in _cand[1:]:
                if _cumd[_i]-_cumd[_p]>_MARG*2: _zones.append((_s,_p)); _s=_i
                _p=_i
            _zones.append((_s,_p))
            _fi=[]                                            # ince örnek alınacak kare indeksleri
            for (_a,_b) in _zones:
                _d0=max(0.0,_cumd[_a]-_MARG); _d1=min(_cumd[N-1],_cumd[_b]+_MARG)
                _dd=_d0; _j=0
                while _dd<=_d1 and len(_fi)<240:
                    while _j<N-1 and _cumd[_j]<_dd: _j+=1
                    if not _fi or _j!=_fi[-1]: _fi.append(_j)
                    _dd+=_STEPF
            if _fi:
                from concurrent.futures import ThreadPoolExecutor as _TPE
                with _TPE(max_workers=10) as _ex:              # paralel (deterministik: giriş sırasıyla eşlenir)
                    _fv=list(_ex.map(lambda _k: _road_density(LATS[_k],LONS[_k],fine=True), _fi))
                _fs=[(_cumd[_fi[_m]],_fv[_m]) for _m in range(len(_fi))]
                _zi=set()
                for (_a,_b) in _zones: _zi.update(range(_a,_b+1))
                for _i in _zi:                                 # EN YAKIN ince örnek (yayma yok); menzil dışı -> 0
                    _best=min(_fs,key=lambda s:abs(s[0]-_cumd[_i]))
                    _LOC_URB[_i]=_best[1] if abs(_best[0]-_cumd[_i])<=_STEPF else 0.0
                # KISA BOŞLUK KÖPRÜSÜ (Barış 2026-07-30 "çok hızlı açılıp kapanıyor, kafası karışabilir"): birbirine
                # <1.2km yakın iki kentsel kesim arasındaki kısa kır boşluğu kentsel sayılır -> NV kapanıp hemen
                # yeniden açılmaz, TEK kesintisiz epizot olur (bitişik kasaba/mahalle zinciri). Uzun kır boşlukları
                # (>1.2km) dokunulmaz -> dağ/bayırda NV açılmaz kuralı korunur.
                # İKİ SEVİYE: 0.15 = zoom sürekliliği, 0.58 = NV eşiği (_z0≈_LU0*0.96 -> NV için _LU0>0.573).
                # NV seviyesinde köprülemezsek şehirler arası 1km'lik boşlukta NV kapanıp hemen açılır (titreme).
                _brc=0
                for _thr in (0.58,0.15):
                    _runs=[]; _st3=None
                    for _i in range(N):
                        _u3=_LOC_URB[_i]>_thr
                        if _u3 and _st3 is None: _st3=_i
                        if (not _u3) and _st3 is not None: _runs.append((_st3,_i-1)); _st3=None
                    if _st3 is not None: _runs.append((_st3,N-1))
                    for _r3 in range(len(_runs)-1):
                        _e3=_runs[_r3][1]; _s3=_runs[_r3+1][0]
                        if _cumd[_s3]-_cumd[_e3]<1200.0:
                            _fl=min(_LOC_URB[_e3],_LOC_URB[_s3])
                            for _m3 in range(_e3+1,_s3): _LOC_URB[_m3]=max(_LOC_URB[_m3],_fl)
                            _brc+=1
                if _brc: print(f"KÖPRÜ: {_brc} kısa boşluk birleştirildi (NV aç-kapa titremesi önlendi)", flush=True)
                print(f"İNCE KENTSEL: {len(_zones)} aday bölge, {len(_fi)} ince örnek -> kentsel-kare {sum(1 for x in _LOC_URB if x>0.15)/max(1,N):.3f} (kaba yayma temizlendi)", flush=True)
    except Exception as _fe:
        print("ince kentsel hata:", _fe, flush=True)
    _LOC_URB=smooth(_LOC_URB,3)                              # sadece hafif kenar-yumuşatma (tepe düşmez)
    print(f"KENTSEL HARİTA: {_rkm:.0f}km, {_upts} örnek, kentsel-kare oranı={sum(1 for x in _LOC_URB if x>0.15)/max(1,N):.2f}", flush=True)
except Exception as _ue:
    print("kentsel harita hata:", _ue, flush=True)
# ŞEHİR DEĞİŞİM anları (uzun rota: "MALATYA'ya girdin" vurgusu) + başlık ORIG->DEST
if _SPANM>2000 and _gsam:
    _pc=""
    for (_fr,_lc,_ct) in _gsam:
        if _ct and _ct!=_pc: PLACES.append((_fr,_ct)); _pc=_ct
    ORIG_DEST=(_gsam[0][2], _gsam[-1][2])
def _stepz(q, nstep=4):
    # 0..1 -> kademeli (nstep basamak): HIZLI yaklaş, sonra belirgin DUR (nefes)
    seg=q*nstep; i=int(min(nstep-1,seg)); f=seg-i
    _mv=0.42                            # basamağın ilk %42'sinde hareket, kalan %58 DUR (görülür duraklama)
    if f<_mv:
        g=f/_mv; e=g*g*(3-2*g)          # yumuşak ivmeli yaklaşma
    else:
        e=1.0                           # DUR
    return (i+e)/nstep

# ===== SABİT EKRAN AKIŞI (askeri uydu takibi): uydu sabit tempoda pan eder -> zıplama YOK, son ışınlanma YOK =====
# Ekran mesafesi = yer-mesafesi / pencere(zoom). Her kareye EŞİT EKRAN-mesafesi düşer:
# şehirde (zoom yakın) yer yavaş ilerler (dwell/detay), otoyolda (zoom uzak) hızlı — ama EKRANDA hep sabit tempo.
_zenv=[0.0]*N
_WINMIN=[]   # ekran-hızı tabanlı asgari pencere (pacing blokunda dolar)
             # ⚠️ tanım BURADA olmalı: _film_base'in yanına koyunca (daha aşağıda)
             # modül sırası gereği dolu listeyi tekrar boşaltıp fiksi etkisiz bırakıyordu.
if _SPANM>2000:
    _V_LO=32.0; _V_HI=88.0
    _LA0=list(LATS); _LO0=list(LONS); _SP0=list(SPD); _DT0=list(DTOT); _SG0=list(SIG); _LU0=list(_LOC_URB)
    _coslat_a=math.cos(sum(la)/len(la)*math.pi/180)
    # ŞEHİR = otomatik zoom (hızdan bağımsız): _z0 = max(hız-bazlı, kentsel). Şehirden hızlı geçsen de zoom+yavaşla+NV.
    _z0s=smooth([max(0.0,min(1.0,(_V_HI-_SP0[k])/(_V_HI-_V_LO))) for k in range(N)],max(3,int(N/34)))   # HIZ-bazlı zoom smooth (ani hız değişimi yumuşasın)
    # ZOOM = KENTSELLİK ODAKLI (Barış 2026-07-26): doğada/dağda UZAK kalsın. Eskiden max(hız,kentsel) -> yavaş dağ
    # yolu (curve) zoom açıyordu. Artık: kentsel taban (_LU0*0.96) + hız-bazlı zoom YALNIZ kentselken belirgin
    # (0.12+0.88*_LU0) -> doğa (_LU0≈0) en fazla ~0.12 (uzak), şehir (_LU0≈1) tam zoom.
    _z0=[max(0.0,min(1.0, max(_LU0[k]*0.96, _z0s[k]*(0.12+0.88*_LU0[k])) )) for k in range(N)]
    # (SÜREKLİ KENTSEL LİFT aşağıya, `_WOV_P`/`_NIGHT_P` tanımlandıktan SONRAYA taşındı —
    #  eşik artık km değil EKRAN SÜRESİ olduğu için pacing sabitlerine ihtiyaç duyuyor.)
    # NOT (2026-07-27): ekstra smooth(_z0,N/22) KALDIRILDI — uzun rotada kısa ŞEHİR tepelerini ezip NV'yi öldürüyordu
    # (_divp<0.45 -> night vision hiç açılmıyordu). _z0s zaten line'da smooth (N/34); kentsel tepe KESKİN kalmalı ki NV açılsın.
    # PACING (Barış 2026-07-27 "uçuyor/patlama"): yer-hızı kontrastı ÇOK yüksekti -> otoyol/doğa aşırı hızlanıp
    # zıplıyordu. (a) otoyol overview 9000->6800 (daha az uçma), (b) şehir dwell 0.80->0.62 (şehri biraz hızlandır
    # = Barış'ın izin verdiği fedakarlık), (c) PENCEREYİ ZAMAN-YUMUŞAT -> şehir<->doğa geçişinde yer-hızı ANİ
    # zıplamaz (yumuşak ivme). _z0/_zenv (NV mekanizması) DEĞİŞMEZ -> NV korunur.
    # SABİT TEMPO (Barış 2026-07-28 "hepsinde aynı hız veya çok hafif oynamalı"): pacing penceresi şehir/kırsal
    # oranı 8x'ti (850 vs 6800) -> yer-hızı şehirde çok yavaş, kırsalda hızlı ("başta yavaş sonra hızlanıp süreye
    # sığdırma"). Oran ~1.9x'e daraltıldı -> neredeyse SABİT yer-hızı. Görsel zoom (_film_base) DEĞİŞMEZ (ayrı).
    _WSTREET=2800.0; _WOVER=5200.0                  # pacing penceresi (dar oran = sabit tempo); görsel zoom ayrı
    # KISA (1dk) MODU HIGHLIGHT-ZOOM (Barış 2026-07-27 "1dk'da hiç zoom yok, 3dk'nın aynısı sıkıştırılmış olsun"):
    # 1dk video uzun rotayı çok sıkıştırıyor -> kamera uçuyor, yol-ortası şehirlere dwell/zoom kalmıyordu (sadece
    # başta zoom vardı). ÇÖZÜM: kısa modda şehir dwell GÜÇLÜ (0.62->0.88) -> şehirlere belirgin zoom-in dwell,
    # otoyolda hızlı (yumuşatma pürüzsüz tutar) = 3dk hissi 1dk'ya sığar. 3dk (uzun) 0.62'de kalır (zaten geniş).
    _shortm = DUR < 45.0
    _dwellf = 0.18 if _shortm else 0.15   # SABİT TEMPO (Barış 2026-07-28): şehir dwell 0.78->0.18 = çok hafif yavaşlama (hız neredeyse sabit); görsel zoom korunur
    _wraw=[0.0]
    for _k in range(1,N):
        _w=_WOVER*(1.0-_z0[_k])+_WSTREET*_z0[_k]
        _w*=(1.0-_dwellf*min(1.0,_LU0[_k]))         # kısa: şehir dwell ~8x (highlight zoom); uzun: 2.6x
        _wraw.append(_w)
    _wsm=smooth(_wraw,max(5,int(FPS*(0.8 if _shortm else 0.9))))  # kısa: 0.6->0.8 (dwell korunur AMA yer-hızı/zoom geçişi pürüzsüz, ani bozukluk yok)
    # KÜMÜLATİF YER MESAFESİ (Barış 2026-07-28 "deniz umursamadan düz ışınlanıyor"): pencere-bölme KALDIRILDI.
    # Eskiden ekran-mesafesi (yer/pencere) idi -> kırsal/körfez ucuna AZ kare düşüp aradaki route noktalarını
    # atlıyordu -> _atI iki uzak noktayı DÜZ ÇİZGİYLE bağlıyor (deniz üstünden ışınlanma). Yer-mesafesi = her
    # noktaya EŞİT kare -> yol/kıyı harfiyen takip edilir, düz atlama YOK, tempo tam sabit.
    # ŞEHİR DWELL GERİ (Barış 2026-07-28 "NV'yi aşırı hızlı geçiyor, eskiden yavaş güzel şehir turu vardı"):
    # ASİMETRİK -> şehirde (kentsel) yer-mesafesi KÜÇÜLTÜLÜR (yavaş ilerler = o bölgeye ÇOK kare = NV şehir turu
    # dwell); kırsal _gd TAM kalır (HIZLANDIRMA YOK -> az-kare/düz-çizgi/deniz-ışınlanma DÖNMEZ). Sabit-tempo
    # şikayeti aslında ışınlanmaydı (yer-mesafesi+marker offset çözdü); dwell'i tümden kesmek gereksizdi/NV'yi öldürdü.
    # ===== EKRAN-HIZI PACING + AYRI NV HIZI (Barış 2026-07-30: "yakınlaştığımda çok hızlı geçiyor; NV'de zoom-out'la
    # AYNI hızda ama daha yakın olduğu için çok hızlı. Night Vision'ı TAMAMEN AYRI bir hızda ayarla, şehrin içinde
    # belli olsun") — Barış'ın teşhisi birebir doğruydu. =====
    # KÖK NEDEN (simülasyonla ölçüldü): kareler _scum uzayında EŞİT dağılır -> bir bölgenin _scum KATKISI
    # KÜÇÜLTÜLÜRSE o bölge daha az _scum kaplar -> ona DAHA AZ kare düşer. Eski `_gd*(1-_DWELLC*urb)` bu yüzden
    # TERS çalışıyordu: şehir yer-hızı kırsala göre **6.67x HIZLANIYORDU** (ve _DWELLC'yi artırdıkça daha da
    # hızlanıyordu -> "dwell'i artırdım ama daha da hızlandı" bilmecesinin cevabı buydu). Üstüne NV görsel penceresi
    # (850m x0.35 = ~297m) overview'a (~8000m) göre ~27x DAR -> ekranda ~180x hızlı akış = "1 saniye bile sürmüyor".
    # (Not: tamamı-şehir olan KISA rotalarda oran tekdüze olduğu için hata görünmüyordu; sadece kırsal+şehir KARIŞIK
    # rotalarda -- Elazığ 745km gibi -- şehir kareleri açlıktan ölüyordu.)
    # ÇÖZÜM = EKRAN mesafesi ile pacing: ağırlık = yer-mesafesi / GÖRÜŞ PENCERESİ. Dar pencere (şehir/NV) = daha çok
    # kare = yavaş akış -> NV ekran hızı overview ile aynı tempoya oturur. NV'ye AYRICA `_NVSLOW` ek yavaşlaması
    # (Barış'ın "ayrı hız" isteği). KIRSAL KORUMA: fazlalık ölçeklenir ki kırsala az kare düşüp düz-çizgi/deniz
    # ışınlanması DÖNMESİN (_RUR_ALLOW = kırsal yer-hızının artabileceği azami kat).
    _grnd_p=DTOT[-1]*1000.0/max(1.0,DUR)                 # görsel _film_base ile AYNI pencere formülü
    _WOV_P=max(4500.0,min(9200.0,_grnd_p*7.0)); _WST_P=850.0
    _NIGHT_P=(_GRADE=="darknight")                       # NV yalnız gecede açılır -> ek NV yavaşlaması sadece gecede
    if _THEME=="auto":
        try:
            _f0=float(os.environ.get("TAC_FROM","0") or 0); _t0=float(os.environ.get("TAC_TO","0") or 0)
            _midp=(_f0+_t0)/2.0 if _t0>_f0 else _f0
            if _midp>0: _NIGHT_P=_sun_elev(_LA0[N//2],_LO0[N//2],_midp)<=-4.0
        except Exception: pass
    _NVSLOW=2.4                                          # NV'ye AYRI ek yavaşlama (Barış 2026-07-30 "NV'ler biraz daha yavaş olsun": 1.6->2.4)
    # KIRSAL BÜTÇESİ: iki koruma birlikte — (a) MUTLAK ekran-hızı tavanı (kırsal karesi overview penceresinin en fazla
    # %4'ünü geçmesin = ~25 kare/ekran; skip/ışınlanma bu eşiğin üstünde görünür olur), (b) oransal tavan (kısa
    # rotalarda aşırı kaymasın). Hangisi sıkıysa o uygulanır -> uzun otoyolda şehre bol kare aktarılır, kısa rotada
    # zaten gerek kalmaz. Fazlalık ölçeği `_sc` ile ORANTILI kısılır (kırsal fac=1 dokunulmaz).
    _RUR_MAXSCR=0.040                                    # kırsal: azami %4 pencere/kare (mutlak ışınlanma koruması)
    _RUR_ALLOW=1.9                                       # kırsal yer-hızı azami artış katı (oransal tavan)
    # NOT (2026-08-05): burada `_RUR_ALLOW`'u kentsel orana göre otonom yapmayı DENEDİM (1.9 -> 15.8).
    # ÖLÇÜLDÜ: videoda hiçbir şey değişmedi (NV açık kare %27 -> %28, yeşillik profili birebir aynı).
    # Yani kare bütçesi NV'nin darboğazı DEĞİLMİŞ -> değişiklik geri alındı, mühürlü davranış korunuyor.
    # Gerçek darboğaz `_z0`->`_divp` yolunda (aşağıdaki SÜREKLİ KENTSEL LİFT'e bak).
    # ===== SÜREKLİ KENTSEL LİFT — ölçüt: EKRAN SÜRESİ (Barış 2026-08-05) =====
    # "ufak/hızlı şehirlerde açılmasa da olur; ama yeterince yavaşlıyorsa NV açılsın, harbi küçükse aynı kalsın"
    # ÖLÇÜLDÜ: NV zaten hemen her gece şehrinde açılıyordu ama YARIM (yeşillik +6..+13; tam olan tek blokta +44..+52).
    # Zincir: _za=smoothstep((_divp-0.45)/0.35) -> TAM NV için _divp>=0.80; _divp ~= smooth(_zenv, FPS*1.3).
    # 1,3 sn'lik yumuşatma DAR tepeyi eziyor: kentsellik 0.94 olan blokta tepe ~0.65 -> _nva~0.57 = yarı yeşil.
    # Yani sorun tepenin YÜKSEKLİĞİ değil GENİŞLİĞİ.
    # ÖLÇÜT NEDEN KM DEĞİL: aynı 4 km, hızlı geçilirse 1 sn, yavaş geçilirse 6 sn ekranda kalır. Kare tahsisi
    # zaten Σ(gd×fac) ile orantılı -> her kentsel koşunun EKRAN SÜRESİNİ bununla tahmin edip eşiği ona koyuyoruz.
    # Yeterince yavaşlayan kısa şehir de NV alır; gerçekten küçük/hızlı geçilen kasaba DOKUNULMADAN kalır.
    _uw2=[0.0]*N
    try:
        # (a) lift ÖNCESİ geçici _fac — motorun aşağıdaki döngüsüyle aynı formül
        _pf=[1.0]*N; _pg=[0.0]*N
        for _k in range(1,N):
            _pg[_k]=math.hypot((_LA0[_k]-_LA0[_k-1])*111320.0,(_LO0[_k]-_LO0[_k-1])*111320.0*_coslat_a)
            _zk=max(0.0,min(1.0,_z0[_k])); _wk=_WOV_P*(1.0-_zk)+_WST_P*_zk; _sh=0.0
            if _zk>0.55 and _LU0[_k]>0.15:
                _sh=min(1.0,_LU0[_k])*min(1.0,(_zk-0.55)/0.45); _wk*=(1.0-0.65*_sh)
            _pf[_k]=max(1.0,(_WOV_P/max(1.0,_wk))*(1.0+(_NVSLOW-1.0)*(_sh if _NIGHT_P else 0.0)))
        _wtot=sum(_pg[_k]*_pf[_k] for _k in range(1,N)) or 1.0
        # (b) her kesintisiz kentsel koşunun tahmini EKRAN SÜRESİ -> eşik
        _SUS_S=3.2                                        # bu kadar saniye ekranda kalan şehir NV'yi hak eder
        _runs=[]; _r0=None
        for _k in range(N):
            if _LU0[_k]>=0.35:
                if _r0 is None: _r0=_k
            elif _r0 is not None:
                _runs.append((_r0,_k-1)); _r0=None
        if _r0 is not None: _runs.append((_r0,N-1))
        for _a,_b in _runs:
            _sec=DUR*sum(_pg[_q]*_pf[_q] for _q in range(_a+1,_b+1))/_wtot
            _g=max(0.0,min(1.0,(_sec-_SUS_S*0.5)/max(0.1,_SUS_S*0.5)))   # yarı eşikte başlar, eşikte tam
            if _g>0.0:
                for _q in range(_a,_b+1): _uw2[_q]=max(_uw2[_q],_g)
        if any(_uw2):
            _z0=[max(_z0[_k], 0.98*_uw2[_k]) for _k in range(N)]
    except Exception as _e:
        print("kentsel lift atlandı:", str(_e)[:120], flush=True)   # asla render'ı düşürme
    _gds=[0.0]*N; _fac=[1.0]*N; _nvf=[0.0]*N
    for _k in range(1,N):
        _gds[_k]=math.hypot((_LA0[_k]-_LA0[_k-1])*111320.0,(_LO0[_k]-_LO0[_k-1])*111320.0*_coslat_a)
        _zk=max(0.0,min(1.0,_z0[_k]))
        _wk=_WOV_P*(1.0-_zk)+_WST_P*_zk
        # ⚠️ GÜNDÜZ DERİN ZOOM TEMPOSU (Barış 2026-08-04: "10x hızında slayt gösterisine geçiyor").
        # ÖLÇÜLDÜ: derin zoom karelerinde ekran hızı 31,9 px/kare, başka her yerde 5-7 px/kare = 5-6 KAT.
        # KÖK NEDEN: `_film_base`'de derin zoom daralması "GECE=GÜNDÜZ" istendiği için `_isn` şartından
        # kurtarılmıştı, ama BURADAKİ tempo telafisi `_NIGHT_P`e bağlı kalmıştı. Sonuç: gündüz şehirde
        # pencere 850m -> ~200m daralıyor, tempo hâlâ 850m'lik kadraja göre yer adımı üretiyor
        # -> ekranda 4-5 kat hızlı akış = slayt gösterisi. Daralma artık gündüz de tempoya işleniyor.
        _shr=0.0
        if _zk>0.55 and _LU0[_k]>0.15:                   # _film_base'deki derin-zoom daralmasının AYNISI
            _shr=min(1.0,_LU0[_k])*min(1.0,(_zk-0.55)/0.45)
            _wk*=(1.0-0.65*_shr)
        # ⚠️ NV'YE DOKUNMA: `_nvf` (NV epizot tespiti) ve `_NVSLOW` ek yavaşlaması GECEYE ÖZEL kalır.
        _nvk=_shr if _NIGHT_P else 0.0
        _nvf[_k]=_nvk
        _f=_WOV_P/max(1.0,_wk)                           # EKRAN-mesafesi oranı: dar pencere -> çok kare -> yavaş
        _f*=(1.0+(_NVSLOW-1.0)*_nvk)                     # NV'ye AYRI ek yavaşlama (yalnız gece)
        _fac[_k]=max(1.0,_f)
    _gsum=sum(_gds); _xsum=sum(_gds[_k]*(_fac[_k]-1.0) for _k in range(1,N))
    if _xsum>1e-9 and _gsum>0:
        _cap=min(_RUR_MAXSCR*_WOV_P*(N-1), _RUR_ALLOW*_gsum)      # kırsalın kaldırabileceği toplam ağırlık
        _sc=max(0.0,min(1.0,(_cap-_gsum)/_xsum))                  # fazlalık ölçeği (1=tam ideal, 0=düz tempo)
        if _sc<1.0:
            for _k in range(1,N): _fac[_k]=1.0+(_fac[_k]-1.0)*_sc
    # ===== NV MİNİMUM SÜRE (Barış 2026-07-30: "NV anları minimum 5 saniye olsun; videonun bazı kısımlarında çok hızlı
    # açılıp kapanıyor, kullanıcının kafası karışıyor. Şehir fark etmeksizin o anki NV hızını ayarlayarak min 5sn yap;
    # fazlası rastgele olabilir") =====
    # Kare tahsisi = Σ(gd*fac)/vc olduğundan, kısa kalan NV epizodunun `fac`'ı oranla YÜKSELTİLİR (o anda yavaşlar).
    # vc toplam ağırlığa bağlı olduğu için 3 tur yinelenir (yakınsar). Epizot = _nvf>0 olan kesintisiz route aralığı.
    # GERÇEK render sinyali üzerinden: ekranda yeşil NV = `_za=smoothstep((_ZE-0.45)/0.35)`, `_nva=_za*_LOC_URB`
    # (>0.40 gözle görünür). `_ZE` = render zoom eğrisi (stepz+sürekli harman + zaman-yumuşatma) -> epizot süresi
    # yalnız kentsel uzunluğa DEĞİL zoom eğrisine de bağlı. Bu yüzden tahsisi bu sinyalin ÜZERİNDEN YİNELEMELİ
    # ayarlarız: fac -> kare eşlemesi -> NV maskesi -> kısa epizotları yavaşlat -> tekrar (yakınsar).
    # (İlk sürüm epizotu `_z0>0.55` route-noktası koşuluyla tanımlıyordu; render'ın koşulu farklı olduğu için
    # log "5.4sn" derken ekranda 0.3sn çıkıyordu — artık aynı koşul kullanılıyor.)
    _NVMIN_F=int(FPS*9.0)   # hedef 9.0sn (Barış: 'fazlası rastgele ama min 5sn'): eşik/rampa payı -> ekranda GÖRÜNÜR yeşil NV >=5sn
    _NVSTART_F=int(FPS*3.0)                                  # video başındaki NV yasağı (render ile aynı)
    def _predict_nv(_fc2):
        _sc2=[0.0]
        for _k2 in range(1,N): _sc2.append(_sc2[-1]+_gds[_k2]*max(1.0,_fc2[_k2]))
        _tt2=_sc2[-1] or 1.0
        _DEC2=min(N//3,int(FPS*1.4)); _fcp=max(1,N-1-_DEC2)
        _vc4=_tt2/max(1.0,(N-1)-_DEC2/2.0)
        _ri2=[]; _j2=0
        for _i2 in range(N):
            if _i2<=_fcp: _s4=_vc4*_i2
            else:
                _u4=(_i2-_fcp)/float(_DEC2); _s4=_vc4*_fcp+_vc4*_DEC2*(_u4-_u4*_u4/2.0)
            _s4=min(_tt2,_s4)
            while _j2<N-1 and _sc2[_j2+1]<_s4: _j2+=1
            _sg2=_sc2[_j2+1]-_sc2[_j2] if _j2<N-1 else 1.0
            _ri2.append(min(float(N-1), _j2+((_s4-_sc2[_j2])/_sg2 if _sg2>1e-9 else 0.0)))
        _ri2[-1]=float(N-1)
        def _ai(_ar,_ri):
            _j3=int(_ri); _g3=_ri-_j3; return _ar[_j3]*(1-_g3)+_ar[min(_j3+1,len(_ar)-1)]*_g3
        _zp=[max(0.0,min(1.0,_ai(_z0,_r))) for _r in _ri2]
        _up=[max(0.0,min(1.0,_ai(_LU0,_r))) for _r in _ri2]
        _rl=1.0/max(1.0,FPS*1.4)                             # üretimdeki release-limiter ile AYNI
        for _i2 in range(1,N):
            if _zp[_i2]<_zp[_i2-1]-_rl: _zp[_i2]=_zp[_i2-1]-_rl
            if _up[_i2]<_up[_i2-1]-_rl: _up[_i2]=_up[_i2-1]-_rl
        if DUR<45.0: _zb2=smooth(_zp,max(5,int(FPS*1.3)))    # _ZE üretimiyle AYNI eğri
        else:
            _zc2=smooth(_zp,max(5,int(FPS*1.0)))
            _zb2=[0.5*_stepz(_zp[_i2],4)+0.5*_zc2[_i2] for _i2 in range(N)]
        _ze2=smooth(_zb2,max(3,int(FPS*0.5)))
        _on2=[]
        for _i2 in range(N):
            _za2=max(0.0,min(1.0,(_ze2[_i2]-0.45)/0.35)); _za2=_za2*_za2*(3.0-2.0*_za2)
            # GECE KAPISI: NV yalnız gecede vardır -> gündüz sürüşte sahte "NV epizodu" sanıp şehri gereksiz
            # yavaşlatmasın (gündüz zaten klasik zoom kullanır, Barış 2026-07-30).
            _on2.append(1 if (_NIGHT_P and _i2>=_NVSTART_F and _za2*_up[_i2]>0.70) else 0)   # 0.70 = gözle NET yeşil
        return _ri2,_on2
    def _nv_runs(_on2):
        _rr=[]; _s5=None
        for _i2 in range(N):
            if _on2[_i2] and _s5 is None: _s5=_i2
            if (not _on2[_i2]) and _s5 is not None: _rr.append((_s5,_i2-1)); _s5=None
        if _s5 is not None: _rr.append((_s5,N-1))
        return _rr
    for _it in range(5):
        _ri5,_on5=_predict_nv(_fac)
        _shortr=[(_a5,_b5) for (_a5,_b5) in _nv_runs(_on5) if (_b5-_a5+1)<_NVMIN_F]
        if not _shortr: break
        for (_a5,_b5) in _shortr:
            _bo=min(4.0,_NVMIN_F/max(1.0,float(_b5-_a5+1)))  # o anki NV hızını yavaşlat (tur başı tavan x4)
            _ra=max(1,int(_ri5[_a5])); _rb=min(N-1,int(_ri5[_b5])+1)
            for _k2 in range(_ra,_rb+1): _fac[_k2]=min(400.0,_fac[_k2]*_bo)
    try:
        _ri6,_on6=_predict_nv(_fac)
        _dr=[round((_b6-_a6+1)/FPS,1) for (_a6,_b6) in _nv_runs(_on6)]
        _vc6=sum(_gds[_k2]*max(1.0,_fac[_k2]) for _k2 in range(1,N))/max(1,(N-1))
        print(f"NV EPİZOT: {len(_dr)} adet, süreler={_dr} sn (min 5.0 garanti) | kırsal {_vc6/max(1.0,_WOV_P)*100:.2f}% pencere/kare", flush=True)
    except Exception: pass
    _fac=smooth(_fac,max(3,int(FPS*0.6)))                # tempo geçişi pürüzsüz (yer-hızı ani zıplamaz)
    _scum=[0.0]
    for _k in range(1,N):
        _scum.append(_scum[-1]+_gds[_k]*max(1.0,_fac[_k]))
    try:
        _ci=[_k for _k in range(1,N) if _fac[_k]>1.35]
        if _ci: print(f"PACING: gece={_NIGHT_P} şehir/NV kare-yoğunluğu ×{sum(_fac[_k] for _k in _ci)/len(_ci):.1f} (kırsal ×1), kentsel-nokta={len(_ci)}/{N}", flush=True)
    except Exception: pass
    _stot=_scum[-1] or 1.0
    def _atI(arr,ri):
        j=int(ri); g=ri-j; return arr[j]*(1-g)+arr[min(j+1,len(arr)-1)]*g
    # SON KARELERDE YAVAŞLAMA (Barış): rota sonunda cruise'da koşup ışınlanma YERİNE yavaşlayarak dur ->
    # "sona doğru gidiş" hissi. Ekran-mesafesinde lineer decel (interpolasyon değil, düz takip yavaşlar).
    _DEC=min(N//3, int(FPS*1.4))
    _fc=max(1, N-1-_DEC)
    _vc=_stot/max(1.0, (N-1)-_DEC/2.0)              # cruise ekran-hızı: decel'e yer bırakır, hız-ARTIŞI yok
    _ridx=[]; _j=0
    for _i in range(N):
        if _i<=_fc:
            _s=_vc*_i                                # sabit tempo (eskisi gibi)
        else:
            _u=(_i-_fc)/float(_DEC); _s=_vc*_fc+_vc*_DEC*(_u-_u*_u/2.0)   # lineer yavaşlama -> son karede hız 0
        _s=min(_stot, _s)
        while _j<N-1 and _scum[_j+1]<_s: _j+=1
        _seg=_scum[_j+1]-_scum[_j] if _j<N-1 else 1.0
        _ridx.append(min(float(N-1), _j+((_s-_scum[_j])/_seg if _seg>1e-9 else 0.0)))
    _ridx[-1]=float(N-1)
    LATS=[_atI(_LA0,ri) for ri in _ridx]; LONS=[_atI(_LO0,ri) for ri in _ridx]
    DTOT=[_atI(_DT0,ri) for ri in _ridx]; SPD=[_atI(_SP0,ri) for ri in _ridx]; SIG=[_atI(_SG0,ri) for ri in _ridx]
    # KAMERA YUMUŞATMA (Barış 2026-07-27): kamera merkezi = rota konumunun HAFİF yumuşatılmışı -> ekran sallanmaz/baş
    # ağrıtmaz. Marker GERÇEK konumda -> merkezden HAFİF kayar ("hafif sapma", 3D Google hissi; askeri uydu kuralı bozulmaz).
    _zenv=[max(0.0,min(1.0,_atI(_z0,ri))) for ri in _ridx]   # konumun zoom'u (şehir yakın/otoyol uzak)
    _LOC_URB=[max(0.0,min(1.0,_atI(_LU0,ri))) for ri in _ridx]   # kentsellik de resample (frame-hizalı)
    # ===== EKRAN HIZI TAVANI: ASGARİ PENCERE (Barış 2026-08-04) =====
    # Ekran hızı ≈ yer_adımı/pencere. Kareler `_fac` ile orantılı dağıldığından yer_adımı ∝ 1/_fac.
    # Yani EKRAN HIZI ∝ 1/(_fac × pencere) -> sabit ekran hızı için `_fac × pencere = sabit` olmalı.
    # Kırsal taban (_fac=1, pencere=_WOV_P) sabiti verir -> asgari pencere = _WOV_P/_fac.
    # ⚠️ NEDEN GEREKLİ: derin zoom penceresi 202m'ye iniyordu (oran 21×) ama kare bütçesi şehre en
    # fazla ×4,9 yoğunluk verebiliyor (kırsalı ışınlatmamak için _RUR_MAXSCR tavanı var). Aradaki
    # 4× fark ekrana "10x slayt gösterisi" olarak yansıyordu. Artık bütçenin TAŞIYABİLECEĞİNDEN
    # daha derine zoom yapılmaz -> ekran hızı her yerde benzer kalır.
    # NV: gecede `_NVSLOW` sayesinde `_fac` zaten büyük -> tavan gevşek, NV derinliği korunur.
    _SCRTOL=float(os.environ.get("TAC_SCRSPD","") or 1.35)   # derin zoomda izin verilen hızlanma katı
    _FACF=[max(1.0,_atI(_fac,ri)) for ri in _ridx]
    _WINMIN=[_WOV_P/max(1.0,_FACF[_i]*_SCRTOL) for _i in range(N)]
    # YOLA SABİTLEME (Barış 2026-07-30 "yollara da sabitle"): marker ekran merkezinde sabit olduğu için görünen konum
    # = KAMERA merkezi (CAMLAT). Sabit yumuşatma penceresi DERİN ZOOM'da virajları KESİYOR (köşe kesme) -> marker
    # yoldan sapmış/binaların üstünde görünüyordu. Yumuşatma artık ZOOM'A DUYARLI: yakın (NV/şehir) = SIKI pencere
    # (kamera gerçek yol geometrisine kilitli), uzak (overview) = gevşek (sakin akış, titreme yok). Kare-başı blend.
    _cw_t=max(3,int(FPS*0.07)); _cw_l=max(3,int(FPS*0.30))
    _ctlat=smooth(LATS,_cw_t); _ctlon=smooth(LONS,_cw_t)     # SIKI: yola kilitli
    _cllat=smooth(LATS,_cw_l); _cllon=smooth(LONS,_cw_l)     # GEVŞEK: uzak/sakin
    _zb=smooth([max(0.0,min(1.0,_zenv[_i])) for _i in range(N)],max(3,int(FPS*0.5)))
    CAMLAT=[_ctlat[_i]*_zb[_i]+_cllat[_i]*(1.0-_zb[_i]) for _i in range(N)]
    CAMLON=[_ctlon[_i]*_zb[_i]+_cllon[_i]*(1.0-_zb[_i]) for _i in range(N)]
    # NV/ZOOM ÇIKIŞ YAVAŞLATMA (Barış 2026-07-27 "NV'den çok hızlı çıkıyor, bir anda zoom-out, fark edilmiyor"):
    # ASİMETRİK hız-sınırlayıcı — YÜKSELİŞ serbest (peak keskin kalır -> NV açılır, önceki regresyon tekrarlanmaz),
    # DÜŞÜŞ yavaş (release ~1.4sn) -> şehirden çıkışta zoom-out + NV kapanışı YUMUŞAK/fark edilir. Kentselliği de
    # aynı release ile ease -> NV fade (=_za*_URBAN_NOW) gerçekten yavaşlar. Kurulumda (chunk-öncesi) -> chunk-güvenli.
    _rel=1.0/max(1.0,FPS*1.4)
    for _i in range(1,N):
        if _zenv[_i] < _zenv[_i-1]-_rel: _zenv[_i]=_zenv[_i-1]-_rel
        if _LOC_URB[_i] < _LOC_URB[_i-1]-_rel: _LOC_URB[_i]=_LOC_URB[_i-1]-_rel
if _SPANM<=30000:
    # non-_FILM (kısa rota): X,Y hareketini sonda yavaşlat -> aynı "varış" hissi, ışınlanma yok
    _DEC2=min(N//3, int(FPS*1.4))
    if N>_DEC2+4:
        _d2=[0.0]+[math.hypot(X[i]-X[i-1],Y[i]-Y[i-1]) for i in range(1,N)]
        _c2=[0.0]
        for i in range(1,N): _c2.append(_c2[-1]+_d2[i])
        _L2=_c2[-1]
        if _L2>1e-6:
            _fc2=max(1,N-1-_DEC2); _vc2=_L2/max(1.0,(N-1)-_DEC2/2.0)
            _rx2=[]; _jj=0
            for _i in range(N):
                _s2=_vc2*_i if _i<=_fc2 else _vc2*_fc2+_vc2*_DEC2*(((_i-_fc2)/_DEC2)-((_i-_fc2)/_DEC2)**2/2.0)
                _s2=min(_L2,_s2)
                while _jj<N-1 and _c2[_jj+1]<_s2: _jj+=1
                _sg2=_c2[_jj+1]-_c2[_jj] if _jj<N-1 else 1.0
                _rx2.append(min(float(N-1),_jj+((_s2-_c2[_jj])/_sg2 if _sg2>1e-9 else 0.0)))
            _rx2[-1]=float(N-1)
            def _re2(a):
                o=[]
                for r in _rx2:
                    j=int(r); k=min(j+1,N-1); f=r-j; o.append(a[j]*(1-f)+a[k]*f)
                return o
            X=_re2(X); Y=_re2(Y); SPD=_re2(SPD); DTOT=_re2(DTOT); SIG=_re2(SIG); LATS=_re2(LATS); LONS=_re2(LONS); _LOC_URB=_re2(_LOC_URB)
def _crop_c2(img,cx,cy,z):
    iw,ih=img.size; z=max(1.02,min(6.0,z))
    tw=int(iw/z); th=int(tw*H/W)
    if th>ih: th=ih; tw=int(th*W/H)
    if tw>iw: tw=iw; th=int(tw*H/W)
    x=int(max(0,min(iw-tw,cx-tw/2))); y=int(max(0,min(ih-th,cy-th/2)))
    return img.crop((x,y,x+tw,y+th)).resize((W,H),Image.LANCZOS)
def _crop_c(img,z):
    iw,ih=img.size; z=max(1.02,min(6.0,z))
    tw=int(iw/z); th=int(tw*H/W)
    if th>ih: th=ih; tw=int(th*W/H)      # oran KORU: taşarsa iki boyut birlikte küçülür (ezme YOK)
    if tw>iw: tw=iw; th=int(tw*H/W)
    x=max(0,min(iw-tw,iw//2-tw//2)); y=max(0,min(ih-th,ih//2-th//2))
    return img.crop((x,y,x+tw,y+th)).resize((W,H),Image.LANCZOS)
# --- görünüm efektleri (intro ile aynı dil) ---
_VIG=Image.new("L",(W,H),0); ImageDraw.Draw(_VIG).ellipse([-W*.35,-H*.18,W*1.35,H*1.18],fill=255); _VIG=_VIG.filter(ImageFilter.GaussianBlur(200))
_SCANL=Image.new("RGBA",(W,H),(0,0,0,0)); sd=ImageDraw.Draw(_SCANL)
for _y in range(0,H,3): sd.line([(0,_y),(W,_y)],fill=(0,0,0,32))
_DARK=Image.new("RGB",(W,H),(3,8,14))
# DETERMİNİSTİK FİLM GRAIN (2026-07-26): Image.effect_noise PIL'in global C-RNG'sini kullanır -> grain deseni
# kare-SIRASINA bağlı -> paralel/parçalı render'da byte-identical OLMAZ. Bunun yerine kare-index'iyle SEED'lenen
# Gauss grain (aynı dağılım: mean 128, std=sigma, mode L) -> görünüm birebir AMA sıradan bağımsız -> parçalar birebir.
_FRAME_I=0   # o an render edilen kare index'i (loop'ta güncellenir; grain seed'i)
_NV_START_F=int(FPS*3.0)   # BAŞTA NV YOK (Barış 2026-07-27): ilk ~3sn night vision açılmasın -> video NV'yle başlamaz, komuttan/geçişten sonra girer
import numpy as _np
def _snoise(w,h,sigma,tag):
    a=_np.random.default_rng(_FRAME_I*10+int(tag)).normal(128.0,float(sigma),(h,w))
    return Image.fromarray(_np.clip(a,0,255).astype("uint8"),"L")
def _lut(im,mode,bright=1.28):
    """Renk LUT'u (vignette/scanline/noise HARİÇ) — auto blend için ayrıştırıldı."""
    if mode=="thermal":                                      # TERMAL: gri -> ısı LUT
        g=ImageEnhance.Contrast(ImageOps.grayscale(im)).enhance(1.35)
        im=ImageOps.colorize(g,black=(6,0,28),mid=(210,45,0),white=(255,240,175),midpoint=120)
        im=ImageEnhance.Brightness(im).enhance(bright*0.96)
    elif mode=="nv":                                         # GERÇEKÇİ GECE GÖRÜŞ (Gen-3 fosfor tüp): yoğunlaştırma+fosfor+bloom+grain
        g=ImageEnhance.Contrast(ImageOps.grayscale(im)).enhance(1.30)
        g=g.point(lambda v:int(255*((v/255.0)**0.80)))       # YOĞUNLAŞTIRMA (hafif kısıldı 0.74->0.80): göz yormasın
        im=ImageOps.colorize(g,black=(1,8,2),mid=(16,102,24),white=(158,232,158),midpoint=132)   # yeşil fosfor (bir tık koyu)
        im=ImageEnhance.Brightness(im).enhance(bright*0.90)   # genel parlaklık kısıldı (1.05->0.90)
        _hi=g.point(lambda v:v if v>182 else 0)              # BLOOM: sadece EN parlaklar taşar (eşik 168->182)
        _bl=_hi.filter(ImageFilter.GaussianBlur(7)).point(lambda v:int(v*0.36))   # bloom yoğunluğu 0.55->0.36
        im=ImageChops.add(im,Image.merge("RGB",(_bl.point(lambda v:v//3),_bl,_bl.point(lambda v:v//3))))
        _ng=_snoise(im.size[0],im.size[1],42,1).convert("L").point(lambda v:(v-118)//2 if v>118 else 0)   # YOĞUN grain (tüp paraziti) [deterministik]
        im=ImageChops.add(im,Image.merge("RGB",(_ng.point(lambda v:v//3),_ng,_ng.point(lambda v:v//3))))
    elif mode=="day":                                        # GÜNDÜZ: doğal, canlı, az koyu
        im=ImageEnhance.Brightness(im).enhance(bright*1.06)
        im=ImageEnhance.Color(im).enhance(1.22); im=ImageEnhance.Contrast(im).enhance(1.05)
    elif mode=="darknight":                                  # GECE: KARANLIK dünya uydusu (yeşil DEĞİL, göz yormaz), ay ışığı serin tonu
        im=ImageEnhance.Brightness(im).enhance(bright*0.44)   # koyu (gece çekilmiş uydu hissi)
        im=ImageEnhance.Color(im).enhance(0.62)               # doygunluğu düşür
        im=ImageEnhance.Contrast(im).enhance(1.14)
        _r,_g,_b=im.split()                                   # serin/mavi ay ışığı tonu
        im=Image.merge("RGB",(_r.point(lambda v:int(v*0.80)),_g.point(lambda v:int(v*0.92)),_b.point(lambda v:min(255,int(v*1.15)))))
    else:                                                    # RECON (default yeşil-teal)
        im=ImageEnhance.Brightness(im).enhance(bright)
        im=ImageEnhance.Color(im).enhance(1.18); im=ImageEnhance.Contrast(im).enhance(1.08)
    return im
_NV_CUR=0.0   # bu karede uygulanan gerçek NV miktarı (zoom×kentsellik) -> ses cue'su + HUD tetiği
_NV_TRANS=0.0   # NV GEÇİŞ yoğunluğu (0=kapalı/tam açık, 1=orta-geçiş) -> açılıp/kapanırken HAFİF glitch efekti (Barış 2026-07-27)
_URBAN_NOW=0.0   # bu karenin kentsellik skoru (crisp z16 karodan önceden hesaplı, konuma göre)
def _night_look(im,bright=1.28):
    """GECE: karanlık uydu tabanı; YAKINLAŞINCA + ŞEHİR/DETAYLI yerde yeşil GECE GÖRÜŞ (NV) dürbünü. Boş kırsalda NV YOK."""
    global _NV_CUR, _NV_TRANS
    if _FRAME_I < _NV_START_F:                               # BAŞTA NV YOK: ilk ~3sn karanlık gece kalır (video NV'yle başlamasın)
        _NV_CUR=0.0; _NV_TRANS=0.0; return _lut(im,"darknight",bright)
    _za=max(0.0,min(1.0,(_divp-0.45)/0.35))                  # zoom miktarı (belirgin yakınlaşmada)
    _za=_za*_za*(3.0-2.0*_za)                                 # SMOOTHSTEP (Barış 2026-07-27): NV giriş/çıkış YUMUŞAK (S-eğrisi), ani girip-çıkma yok; eşik(0)/tam(1) korunur
    dn=_lut(im,"darknight",bright)
    if _za<=0.02: _NV_CUR=0.0; _NV_TRANS=0.0; return dn
    _nva=_za*_URBAN_NOW                                      # NV = zoom × kentsellik (crisp z16 karodan önceden hesaplı)
    _NV_CUR=_nva
    _NV_TRANS=4.0*_za*(1.0-_za)                              # geçiş yoğunluğu: _za=0.5'te tepe (açılış/kapanış anı), tam-açık/kapalıda 0
    if _nva<=0.05: return dn                                 # boş kırsal -> karanlık kalır (NV açılmaz)
    nv=_lut(im,"nv",bright)
    return nv if _nva>=0.99 else Image.blend(dn,nv,_nva)
def grade(im,bright=1.28):
    global _NV_CUR, _NV_TRANS
    _NV_TRANS=0.0                                            # varsayılan: geçiş yok (gündüz/kapalı) -> _night_look transition'da set eder
    if _GRADE=="auto":                                       # OTONOM: gece-fraksiyonuna göre gündüz<->gece(karanlık+zoom-NV) blend
        nf=_AUTO_NF
        if nf>=0.985: im=_night_look(im,bright); _gm="nv"
        elif nf<=0.015: _NV_CUR=0.0; im=_lut(im,"day",bright); _gm="day"
        else: im=Image.blend(_lut(im.copy(),"day",bright),_night_look(im.copy(),bright),nf); _gm=("nv" if nf>=0.5 else "day")
    elif _GRADE=="darknight":                                # GECE (manuel): karanlık uydu + yakınlaşınca (şehirde) NV
        im=_night_look(im,bright); _gm="nv"
    else:
        _NV_CUR=0.0; im=_lut(im,_GRADE,bright); _gm=_GRADE
    dark=Image.composite(im,_DARK,_VIG); im=Image.blend(im,dark,0.08 if _gm=="day" else 0.18)
    im.paste(_SCANL,(0,0),_SCANL)
    n=_snoise(W,H,20,2).convert("L").point(lambda v:(v-118)//6 if v>118 else 0)
    return ImageChops.add(im,Image.merge("RGB",(n,n,n)))
def glow(d,xy,txt,font,col=TEAL,white=False):
    x,y=xy
    for ox,oy in ((-2,0),(2,0),(0,-2),(0,2)): d.text((x+ox,y+oy),txt,font=font,fill=(20,90,85))
    d.text((x,y),txt,font=font,fill=WHITE if white else col)
# mini avatar (izleyici yüzü unutmasın): AVATAR env foto -> 4:5 kırp; yoksa None
_avp=os.environ.get("AVATAR","")
AVMINI=None
if _avp and os.path.exists(_avp):
    _a=Image.open(_avp).convert("RGB")
    _tw=min(_a.width,int(_a.height*0.8)); _th=int(_tw/0.8)
    AVMINI=_a.crop(((_a.width-_tw)//2,(_a.height-_th)//2,(_a.width+_tw)//2,(_a.height+_th)//2)).resize((132,165),Image.LANCZOS)
    from PIL import ImageEnhance as _IE
    AVMINI=_IE.Color(AVMINI).enhance(0.62); AVMINI=_IE.Brightness(AVMINI).enhance(0.88)
VIEWW={"yakin":460,"orta":640,"uzak":850}.get(os.environ.get("TAC_CAMDIST","orta"),640)   # kamera mesafesi: yakın/orta/uzak
CRS=smooth(_pick([p.get("crs",0) for p in pts],_apar),13)   # arc-eşit (konumla senkron pusula)
# --- MGRS (37T, basitleştirilmiş UTM) ---
def mgrs(lat,lon):
    zone=int(lon/6)+31; lam0=math.radians((zone-31)*6+3)
    phi=math.radians(lat); lam=math.radians(lon)
    a_=6378137.0; f=1/298.257223563; e2=f*(2-f); ep2=e2/(1-e2)
    Np=a_/math.sqrt(1-e2*math.sin(phi)**2)
    T=math.tan(phi)**2; C=ep2*math.cos(phi)**2; A=(lam-lam0)*math.cos(phi)
    M=a_*((1-e2/4-3*e2*e2/64)*phi-(3*e2/8+3*e2*e2/32)*math.sin(2*phi)+(15*e2*e2/256)*math.sin(4*phi))
    k0=0.9996
    E=k0*Np*(A+(1-T+C)*A**3/6)+500000
    Nn=k0*(M+Np*math.tan(phi)*(A*A/2+(5-T+9*C)*A**4/24))
    colset="ABCDEFGH" if zone%3==1 else ("JKLMNPQR" if zone%3==2 else "STUVWXYZ")
    rowseq="ABCDEFGHJKLMNPQRSTUV"
    col=colset[int(E/100000)-1]; row=rowseq[(int(Nn/100000)+(0 if zone%2 else 5))%20]
    return f"{zone}T {col}{row} {int(E%100000):05d} {int(Nn%100000):05d}"
# --- olay günlüğü: veriden türet ---
EVENTS=[(1.0,"> UPLINK STABLE — TRACK GOOD")]
for i in range(30,N,15):
    dc=(CRS[i]-CRS[i-30]+540)%360-180; dv=SPD[i]-SPD[i-30]
    tt=i/FPS
    if abs(dc)>32: EVENTS.append((tt,f"> TARGET TURNING {'RIGHT' if dc>0 else 'LEFT'}"))
    elif dv>7: EVENTS.append((tt,f"> SPEED INCREASING {SPD[i]:.0f} KM/H"))
    elif dv<-7: EVENTS.append((tt,f"> SPEED DROPPING {SPD[i]:.0f} KM/H"))
_amb=["> SIGNAL STRONG","> SAT LINK 98%","> TRACK STABLE","> VISUAL MAINTAINED"]
_last=EVENTS[-1][0] if EVENTS else 0
for k,tt in enumerate(range(6,int(DUR),8)):
    EVENTS.append((float(tt),_amb[k%len(_amb)]))
EVENTS.sort()
# çok yakın olayları seyrelt (min 1.6sn ara)
_ev=[]
for tt,tx in EVENTS:
    if not _ev or tt-_ev[-1][0]>=1.6: _ev.append((tt,tx))
EVENTS=_ev
# ===== "CONFIRMED" ZİRVE-HIZ OLAYI (Faz2): en hızlı an -> taktik vurgu (TIMING DEĞİŞMEZ, sadece HUD) =====
_vpk_i=max(range(N),key=lambda _k:SPD[_k]) if N>0 else 0
_vpk_t=_vpk_i/FPS; _vpk_kmh=SPD[_vpk_i]; _PKW=int(FPS*0.8)   # ±0.8sn vurgu penceresi
if _vpk_kmh>=15:   # anlamlı hız varsa telsiz olayını ekle (dedup SONRASI -> korunur)
    EVENTS.append((_vpk_t, f"> CONFIRMED — MAX VELOCITY {_vpk_kmh:.0f} KM/H")); EVENTS.sort()
# ===== UZUN ROTA KAMERASI v4: hız-tabanlı sokak-takip mozaiği (z16 şehir sokak + z13 otoyol overview) =====
_FILM = _SPANM>2000
_ATILES=[]                # (img, clat, clon, tile_mpp)
_WIN_OVER=8000.0; _WIN_STREET=850.0
_latc=sum(la)/len(la); _coslat=math.cos(_latc*math.pi/180)
def _mppz(z): return 156543.03392*_coslat/(2**z)/2.0
if _FILM:
    _mov_km=DTOT[-1]; _grnd=_mov_km*1000.0/max(1.0,DUR)
    _WIN_OVER=max(4500.0,min(9200.0,_grnd*7.0))     # otoyol overview: yol görünür, 9:16 tek karoya sığar
    _WIN_STREET=850.0                                # şehir SOKAK seviyesi (z16 dolar) — premium flat takip
    # KATMANLI TABAN (Barış 2026-07-27 "uzak çekimde yerin altında/bulanık kalıyorum — auto-detect + netlik"):
    # tek-taban z15 BOŞLUK bırakıyordu (4685m kapsar; index-bazlı yerleşim uzun rotada OTOYOL stretch'ini atlıyordu
    # -> gap -> kaba BIG dolgu = TAM bulanık). ÇÖZÜM = KATMANLI + MESAFE-bazlı:
    #   z13 GENİŞ taban (7.3 m/px, 18740m kapsar = 9370m yarıçap -> geniş overview KÖŞELERİNİ de kaplar; Barış'ın
    #   "kıyıda mavi lekeler" = overview köşeleri (6500m) z14'ü aşıp kaba BIG denize düşüyordu -> düz mavi blob) +
    #   z16 ZOOM detay (0.9 m/px, yakınlaşınca NET) + z18 en-yakın (aşağıda). _geo_crop kare-başı EN İNCE olanı OTO seçer.
    # Kümülatif rota mesafesi (mesafe-bazlı örnekleme -> index-bazlının otoyol boşluğu yok)
    _cumd=[0.0]
    for _k in range(1,N):
        _cumd.append(_cumd[-1]+math.hypot((LATS[_k]-LATS[_k-1])*111320.0,(LONS[_k]-LONS[_k-1])*111320.0*_coslat))
    _rtot=_cumd[-1] or 1.0
    def _idx_at_dist(_dm):
        _lo2,_hi2=0,N-1
        while _lo2<_hi2:
            _mid=(_lo2+_hi2)//2
            if _cumd[_mid]<_dm: _lo2=_mid+1
            else: _hi2=_mid
        return _lo2
    # KARO PİRAMİDİ (Barış 2026-08-04: "görüntü aşırı bulanık, dümdüz uzaktaki resmi zoom in yapmış").
    # TEK HARİTA seçicisi kadrajı TAMAMEN kapsayan karo arar. 9:16 kadrajda yükseklik = genişlik×1,78:
    #   pencere 9200m -> 16356m · 6417m -> 11408m · 3633m -> 6459m · 850m -> 1511m
    # z13 karosu 24460m kapsar ama 7000m aralıkla konulunca geniş kadrajı çoğu yerde KAPSAYAMIYOR ->
    # seçici en kaba BIG'e düşüyordu (30 m/px) = "uzaktaki resme zoom" bulanıklığı. Ayrıca 3633m
    # penceresinde z13 (9,55 m/px) çıktının (5,05 m/px) 1,9 KATI kaba = yine bulanık.
    # ÇÖZÜM: z13 aralığı 7000->3500m + ARA SEVİYE z14 (12230m kapsar, 4,78 m/px) ~2800m aralıkla.
    # Her pencere boyu için artık hem KAPSAYAN hem NET bir karo var.
    # ⚠️ PİRAMİDİN İKİ UCU (Barış 2026-08-04 "yine ışınlanmaya başlıyor, 10x slayt gösterisi"):
    # ÖLÇÜLDÜ — 51 sıçramanın 45'i ÇOK-KARO YEDEĞİ karelerinde. Yani ışınlanmanın kaynağı
    # yedek yolun kendisi: kaynak tek-karo <-> çok-karo arasında 8 kez gidip geliyordu.
    # Yedeğe düşen 116 karenin dağılımı: 89'u DERİN ZOOM (0,28 m/px — z16 bile kaba kalıyor),
    # 24'ü EN GENİŞ kadraj (z13 18483m kapsıyor ama kadraj 16356m istiyor -> pay 1063m,
    # karo aralığı 3500m olduğu için bazı noktalarda kapsayamıyor).
    # ÇÖZÜM: en geniş uca z12 (36967m kapsar, 6 karo yeter), derin uca z17 (aşağıda).
    # ⚠️ SEVİYELER GERÇEK KAPSAMAYA GÖRE (2× hata düzeltildikten sonra yeniden hesaplandı).
    # 9:16 kadrajda gereken dikey kapsama = pencere×1,778:
    #   9202m -> 16360m dikey  => z11 (36966m kapsar, 14,4 m/px)
    #   6417m -> 11410m        => z12 (18483m, 7,2)
    #   3633m ->  6460m        => z13 ( 9242m, 3,6)
    #    850m ->  1511m        => z15 ( 2311m, 0,90)   [aşağıda ayrı katman]
    # Aralık kuralı: aralık <= (kapsama - dikey_kadraj), yoksa karo kadrajı tutamaz.
    for _zl,_ara,_cap in ((11,9000.0,60),(12,3500.0,110),(13,2000.0,130)):
        _mz=_tmpx(_zl); _nz=max(3,min(_cap,int(math.ceil(_rtot/_ara))+1))
        _bc=[_idx_at_dist(_rtot*_k/max(1,_nz-1)) for _k in range(_nz)]
        for _fi,_t in zip(_bc,_dtiles_par([(LATS[_fi],LONS[_fi],_zl) for _fi in _bc])):
            if _t is not None: _ATILES.append((_t,LATS[_fi],LONS[_fi],_mz))
    if len(_ATILES)<2: _FILM=False
    # z16 ZOOM detay (0.9 m/px, NET): yakınlaşılan her yer (_zenv>0.14 = doğa orta-zoom + şehir), MESAFE-bazlı ~750m.
    # BÜTÇE DAĞITIMI (Barış 2026-07-27 "sonlara doğru bulanık yerlere zoom yapmış"): eski kod ilk-gelen-alır +
    # 300'de kesiyordu -> uzun rotada ERKEN kısım bütçeyi yer, SON kısım z16'sız kalır -> sona zoom = kaba z13 = bulanık.
    # ÇÖZÜM: TÜM candidate'ları topla, bütçe aşarsa ROTA BOYUNCA EŞİT dağıt (son dahil kaplı) + bütçe 300->460.
    _mdet=_tmpx(15); _lastd=None; _cand=[]
    for _i in range(0,N,2):
        if _zenv[_i]>0.14:
            _la=LATS[_i]; _lo=LONS[_i]
            if _lastd is not None:
                _dd=math.hypot((_la-_lastd[0])*111320.0,(_lo-_lastd[1])*111320.0*_coslat)
                if _dd<600: continue                 # z15 karo 2311m kapsar -> 600m aralıkta boşluk yok
            _lastd=(_la,_lo); _cand.append((_la,_lo))
    _z16bud=max(1, 460-len(_ATILES))                  # toplam ~460 tile tavan (paralel fetch, ~9GB, 24Gi cloud OK)
    if len(_cand)>_z16bud:                            # aşarsa rota boyunca EŞİT ARALIKLI seç (son da kaplı)
        _st=len(_cand)/float(_z16bud)
        _cand=[_cand[min(len(_cand)-1,int(_k*_st))] for _k in range(_z16bud)]
    _sharp=[]                                         # NET (z16) tile merkezleri -> zoom-net-kapısı (_film_base)
    for (_la,_lo),_ct in zip(_cand,_dtiles_par([(c[0],c[1],15) for c in _cand])):
        if _ct is not None: _ATILES.append((_ct,_la,_lo,_mdet)); _sharp.append((_la,_lo))
    # z17 DERİN ZOOM (0,45 m/px, 1155m kapsar): şehirde pencere ~200m'ye iner (0,28 m/px çıktı) ve
    # z16 (0,90) bile kaba kalır -> eskiden çok-karo yedeğine düşüp ışınlanma üretiyordu.
    # Yalnız DERİN zoom yapılan yerlerde (_zenv>0.50), ~400m aralık (kapsama payı 398m).
    _mz17=_tmpx(16); _lastd=None; _c17=[]
    for _i in range(0,N,2):
        if _zenv[_i]>0.50:
            _la=LATS[_i]; _lo=LONS[_i]
            if _lastd is not None:
                if math.hypot((_la-_lastd[0])*111320.0,(_lo-_lastd[1])*111320.0*_coslat)<500: continue
            _lastd=(_la,_lo); _c17.append((_la,_lo))
    _b17=max(0, 620-len(_ATILES))
    if len(_c17)>_b17:
        _st=len(_c17)/float(max(1,_b17))
        _c17=[_c17[min(len(_c17)-1,int(_k*_st))] for _k in range(_b17)]
    if _c17:
        for (_la,_lo),_ct in zip(_c17,_dtiles_par([(c[0],c[1],16) for c in _c17])):
            if _ct is not None: _ATILES.append((_ct,_la,_lo,_mz17))
    _blon,_blat=inv(cx,cy); _ATILES.append((BIG,_blat,_blon,_SPANM/float(BW)))   # en alt: boşluk doldurucu
    _ATILES.sort(key=lambda a:-a[3])                 # kaba (BIG/z13) altta, ince (z16) üstte
else:
    # KISA ROTA YÜKSEK-ÇÖZ BIG (HBIG) — HIZLI: bbox'ı z14 karo ızgarasıyla px() (Web Mercator) yerleştirip
    # TEK SEFERDE birleştir; kare-başı sadece BIG.crop (kare-başı compositing YOK -> hızlı). ⚠️ KÖK FIX
    # (Barış 2026-07-25): _dtile (1280x1280@2x) GERÇEK mpp = _mppz(z)/2 (_mppz 2x FAZLAYDI!) -> önceki HBIG/
    # mozaik uzak karoda hedefi ~500m DENİZE kaydırıyordu (Perşembe/Ordu kıyı bug'ı). mpp /2 -> dikişsiz, marker YOLDA.
    _UPS=4; _htm=_mppz(14)/2.0                          # z14 GERÇEK mpp; HBIG ~2 m/px (net, bellek makul)
    HBIG=Image.new("RGB",(BW*_UPS,BH*_UPS),(8,16,12))
    _hsc=_htm*float(BW)*_UPS/_SPANM
    _step_m=2560*_htm*0.66                              # z14 karo yerleşim aralığı (~%34 örtüşme -> boşluk yok)
    _nx=max(1,int(math.ceil(_MPU0*(bx1-bx0)/_step_m)))
    _ny=max(1,int(math.ceil(_MPU0*(by1-by0)/_step_m)))
    for _gy in range(_ny+1):
        for _gx in range(_nx+1):
            _clo,_cla=inv(bx0+(bx1-bx0)*_gx/float(_nx), by0+(by1-by0)*_gy/float(_ny))
            try: _tl=_dtile(_cla,_clo,14)
            except Exception: _tl=None
            if _tl is None: continue
            _pw=int(_tl.size[0]*_hsc); _ph=int(_tl.size[1]*_hsc)
            if _pw<2 or _ph<2: continue
            _px,_py=px(_clo,_cla)                       # BIG-uzayı piksel (merc, DOĞRU)
            HBIG.paste(_tl.resize((_pw,_ph),Image.LANCZOS),(int(_px*_UPS-_pw/2),int(_py*_UPS-_ph/2)))
    _karo_denetle()   # KARO-FIKSI: HBIG ızgarasında da sessiz eksik karo -> eşik aşılırsa BAŞARISIZ
# FEATHER maskesi: üst karo kenarları alt katmana YUMUŞAK geçsin (keskin dikdörtgen dikiş YOK) — HER rota için
_FEATHER=Image.new("L",(2560,2560),255)
_ffd=ImageDraw.Draw(_FEATHER); _fmar=300
for _kk in range(_fmar):
    _ffd.rectangle([_kk,_kk,2559-_kk,2559-_kk],outline=int(255*_kk/_fmar))

# ===== KARO HİZALAMA — WEB MERCATOR (Barış 2026-08-04) =====
# "Yan yana iki kare senkronize değil, yoldan anladım."
# KÖK NEDEN: karolar DÜZ-DÜNYA metresiyle yerleştiriliyordu (_mlat=110540 sabit), oysa
# Mapbox görüntüleri WEB MERCATOR ve her karo KENDİ merkez enleminde render ediliyor.
# Komşu iki karo birkaç piksel kayıyor -> yol/bina sınırda KIRILIYOR.
# Mercator metresinde hesaplayınca aynı coğrafi nokta hangi karodan gelirse gelsin
# AYNI piksele düşer -> komşu karolar birebir bitişir, yol kesintisiz akar.
# ⚠️ Mercator m/px ENLEMDEN BAĞIMSIZDIR: _tm (yer metresi) / _coslat = sabit ölçek.
_MR=6378137.0
def _mx_(lon): return _MR*lon*math.pi/180.0
def _my_(lat):
    _l=max(-85.05,min(85.05,lat))*math.pi/180.0
    return _MR*math.log(math.tan(math.pi/4.0+_l/2.0))

_TILEDBG=(os.environ.get("TAC_TILEDBG","0")=="1")
_TEKHARITA=(os.environ.get("TAC_TEKHARITA","1")!="0")   # kare tek karodan kırpılsın (dikiş/yarım şehir yok)
_SINGLE_LAST=[-1]   # histerezis: son kullanılan karo (gereksiz karo değişimi = pozlama popu)
_TEKSAY=[0]; _COKSAY=[0]   # tanı sayaçları
_TILECHG=[0.0]   # bu karede karo (kaynak) değişti mi -> glitch ile maskele
_TILEADJ={}      # karo idx -> (kanal kazancı, ofset): pozlama eşitleme (aşağıda doldurulur)
_XF=[-1,0,0]     # karo geçişi: [eski idx, kalan kare, toplam kare] — kısa çözülme
_PREVC=[None,None]  # önceki karenin Mercator merkezi -> kamera hızı (geçiş eşiği için)
_XFN=max(2,int(FPS*float(os.environ.get("TAC_TILEXF","") or 0.25)))   # çözülme süresi
_TILELOG=[]   # TAC_TILEDBG=1: kare-başı (kare, seçilen karo idx, karo m/px) -> ışınlanma teşhisi

def _geo_crop(i,win_m):
    # hedef-merkezli çıktı karesine yakın karoları out_mpp'ye ölçekleyip COĞRAFİ hizalı yapıştır (dikişsiz)
    _tlat=CAMLAT[i]; _tlon=CAMLON[i]   # YUMUŞATILMIŞ kamera merkezi (sallanma azalır); marker gerçek konumda kalır (_film_base)
    _mlon=111320.0*math.cos(_tlat*math.pi/180); _mlat=110540.0   # (marker/ölçüm için korunur)
    _outM=_out0=None
    _out=win_m/float(W)                                # çıktı m/px (YER metresi)
    _outM=_out/max(1e-9,math.cos(_tlat*math.pi/180))   # çıktı MERCATOR m/px
    _fxM=_mx_(_tlon); _fyM=_my_(_tlat)                 # kare merkezi (Mercator metresi)                                # çıktı m/px
    _cv=Image.new("RGB",(W,H),(6,14,10)); _ccx=W/2.0; _ccy=H*0.42

    # ===== TEK HARİTA / TEK KARO (Barış 2026-08-04) =====
    # "Şehirler hâlâ yarım görünüyor, yarım şehir denizin üstünde duruyor. Zoom-out'ta TEK KARE,
    #  TEK HARİTA kullan; zoom-in'de karo sınırı DAİMA kadrajın dışında kalsın."
    # KÖK NEDEN: geniş kadrajda kare 2+ z13 karosundan birleştiriliyordu. Karolar coğrafi olarak
    # hizalı olsa bile ayrı Mapbox ÇEKİMLERİ (farklı tarih/pozlama/bulut) -> sınırda şehrin yarısı
    # bir çekimden, yarısı ötekinden geliyor = "yarım şehir".
    # ÇÖZÜM: kadrajı TAMAMEN kapsayan karolar arasından EN İNCE olanı seç ve kareyi YALNIZ ondan
    # kırp. Tek kaynak => birleştirme yok => dikiş/yarım şehir fiziksel olarak imkansız ve karo
    # sınırı tanım gereği kadrajın dışında kalır.
    if _TEKHARITA:
        _fx0=_fxM-_ccx*_outM; _fx1=_fxM+(W-_ccx)*_outM       # kadrajın Mercator sınırları
        _fy1=_fyM+_ccy*_outM; _fy0=_fyM-(H-_ccy)*_outM
        _mg=4.0*_outM                                        # 4 piksellik emniyet payı
        # ⚠️ ÇÖZÜNÜRLÜK ŞARTI: yalnız "kapsıyor mu" bakmak YETMEZ. En kaba karo (BIG, ~30 m/px)
        # her kadrajı kapsar; onu seçince görüntü 25 kata kadar büyütülüp mahalle detayı yok olur
        # ("dümdüz uzaktaki resme zoom yapmış" — Barış 2026-08-04). Karo, çıktı çözünürlüğünden
        # en fazla %35 kaba olabilir; olamıyorsa o karo aday DEĞİL.
        # TAVAN 1,35 -> 1,70 (Barış 2026-08-04): tavan dar olunca aday kalmıyor ve ÇOK-KARO
        # YEDEĞİNE düşülüyordu; ölçüm yedeğin ışınlanmanın ta kendisi olduğunu gösterdi.
        # Hafif yumuşak TEK karo, keskin ama ZIPLAYAN çok-karodan iyidir. z17 katmanı da bu
        # tavanla derin zoomda aday olabiliyor (0,45 ≤ 0,28×1,70).
        _mxm=_out*float(os.environ.get("TAC_TILESHARP","") or 1.70)
        def _kapsar(_t):
            _im2,_la2,_lo2,_tm2=_t
            if _tm2>_mxm: return False                       # çok kaba -> bulanık olur, kullanma
            _s2=(_tm2/max(1e-9,_coslat))                     # karonun Mercator m/px'i
            _hx=_im2.size[0]*_s2/2.0; _hy=_im2.size[1]*_s2/2.0
            _cxm=_mx_(_lo2); _cym=_my_(_la2)
            return (_cxm-_hx<=_fx0-_mg and _cxm+_hx>=_fx1+_mg and
                    _cym-_hy<=_fy0-_mg and _cym+_hy>=_fy1+_mg)
        # ⚠️ EN UZUN DAYANAN KAROYU SEÇ (Barış 2026-08-04: "sonlara doğru bir anda yine slayt
        # gösterisi"). ÖLÇÜLDÜ: 13. saniyede 4, 15'te 2 karo değişimi — en geniş kadrajda her
        # değişim TÜM kareyi başka Mapbox çekimiyle değiştiriyor = slayt gösterisi.
        # KÖK NEDEN: "kapsayan ilk karo" alınıyordu; bu çoğu zaman kapsamanın KIYISINDAKİ karo
        # oluyor ve kamera biraz ilerleyince değişmek zorunda kalıyordu. Artık aynı incelik
        # sınıfındaki karolar arasından PAYI EN BÜYÜK olan (merkeze en yakın) seçilir -> aynı karo
        # çok daha uzun dayanır, değişim sayısı düşer.
        def _pay(_t):                                        # kapsama payı (m): ne kadar büyükse o kadar dayanır
            _im2,_la2,_lo2,_tm2=_t
            _s2=(_tm2/max(1e-9,_coslat))
            _hx=_im2.size[0]*_s2/2.0; _hy=_im2.size[1]*_s2/2.0
            _cxm=_mx_(_lo2); _cym=_my_(_la2)
            return min(_fx0-(_cxm-_hx), (_cxm+_hx)-_fx1, _fy0-(_cym-_hy), (_cym+_hy)-_fy1)
        def _tam_kirp(_j):                                   # TAM kadrajı o karodan al (çözülme için)
            if not (0<=_j<len(_ATILES)) or not _kapsar(_ATILES[_j]): return None
            _im3,_la3,_lo3,_tm3=_ATILES[_j]
            _s3=(_tm3/max(1e-9,_coslat))
            _lx3=_mx_(_lo3)-_im3.size[0]*_s3/2.0; _ty3=_my_(_la3)+_im3.size[1]*_s3/2.0
            _a3=(max(0,int((_fx0-_lx3)/_s3)), max(0,int((_ty3-_fy1)/_s3)),
                 min(_im3.size[0],int(math.ceil((_fx1-_lx3)/_s3))),
                 min(_im3.size[1],int(math.ceil((_ty3-_fy0)/_s3))))
            if _a3[2]-_a3[0]<2 or _a3[3]-_a3[1]<2: return None
            return _uygula(_im3.crop(_a3).resize((W,H),Image.LANCZOS),_TILEADJ.get(_j))
        def _kirp(_j):                                       # kadrajın MERKEZ %60'ını o karodan al (küçük, hızlı)
            _im2,_la2,_lo2,_tm2=_ATILES[_j]
            _s2=(_tm2/max(1e-9,_coslat))
            _lx=_mx_(_lo2)-_im2.size[0]*_s2/2.0; _ty=_my_(_la2)+_im2.size[1]*_s2/2.0
            _bx=(_fx1-_fx0)*0.20; _by=(_fy1-_fy0)*0.20
            _a=(int((_fx0+_bx-_lx)/_s2), int((_ty-(_fy1-_by))/_s2),
                int((_fx1-_bx-_lx)/_s2), int((_ty-(_fy0+_by))/_s2))
            if _a[0]<0 or _a[1]<0 or _a[2]>_im2.size[0] or _a[3]>_im2.size[1]: return None
            if _a[2]-_a[0]<8 or _a[3]-_a[1]<8: return None
            return _im2.crop(_a).resize((64,64),Image.BILINEAR)
        def _esitle(_yeni,_eski):                            # yeni -> eski görünümü (kanal kazanç+ofset)
            _o=[]
            for _c in range(3):
                _ay=_np.asarray(_yeni.split()[_c],dtype=_np.float32)
                _ae=_np.asarray(_eski.split()[_c],dtype=_np.float32)
                _my_o=float(_ay.mean()); _me=float(_ae.mean())
                _sy=float(_ay.std())+1e-3; _se=float(_ae.std())
                _g=max(0.80,min(1.25,_se/_sy))               # aşırı düzeltme kilidi (renk patlamasın)
                _b=max(-28.0,min(28.0,_me-_g*_my_o))
                _o.append((_g,_b))
            return _o
        def _uygula(_im3,_adj):
            if not _adj: return _im3
            return Image.merge("RGB",[_ch.point(lambda _v,_g=_adj[_c][0],_b=_adj[_c][1]:
                                                max(0,min(255,int(_v*_g+_b))))
                                      for _c,_ch in enumerate(_im3.split())])
        _sec=None; _bt=None
        for _j in range(len(_ATILES)-1,-1,-1):               # ince -> kaba
            if not _kapsar(_ATILES[_j]): continue
            if _bt is None: _bt=_ATILES[_j][3]               # en ince sınıfın m/px'i
            elif _ATILES[_j][3]>_bt*1.01: break              # sınıf bitti -> daha kabaya geçme
            if _sec is None or _pay(_ATILES[_j])>_pay(_ATILES[_sec]): _sec=_j
        # ===== ERKEN GEÇİŞ + KISA ÇÖZÜLME (Barış 2026-08-04) =====
        # Karo değişimi seyrekleştirilemiyor (en geniş kadrajda karo hızla tükeniyor) ve pozlama
        # eşitlemesi tek başına yetmiyor (karolar farklı TARİHLİ çekimler; mevsim/gölge de değişik).
        # Bu yüzden değişim ANINDA yapılmaz: karo tükenmeden ÖNCE başlanır ve iki karo arasında
        # kısa bir çözülme yapılır. ⚠️ Bu, Barış'ın nefret ettiği eski crossfade DEĞİL: oradaki
        # karolar HİZASIZDI (hayalet/iç içe geçme) ve harman KALICIYDI. Burada geometri Mercator'da
        # birebir aynı, harman 0,25sn sürüyor -> hayalet imkansız, yalnız pozlama farkı yumuşuyor.
        _hiz=0.0
        if _PREVC[0] is not None: _hiz=math.hypot(_fxM-_PREVC[0],_fyM-_PREVC[1])
        _PREVC[0]=_fxM; _PREVC[1]=_fyM
        _esik=_hiz*_XFN*1.35+2.0*_outM                       # çözülme boyunca kat edilecek yol + pay
        _cur=_SINGLE_LAST[0]
        if (_sec is not None and 0<=_cur<len(_ATILES) and _cur!=_sec and _XF[1]<=0
                and _kapsar(_ATILES[_cur]) and _ATILES[_cur][3]<=_ATILES[_sec][3]*1.25
                and _pay(_ATILES[_cur])>_esik):
            _sec=_cur                                        # daha dayanır -> geçişi erteleme
        # HİSTEREZİS (sınırlı): önceki karo hâlâ kapsıyor VE en iyiden belirgin kaba değilse koru
        # -> gereksiz karo değişimi (pozlama popu) olmaz. ⚠️ Sınırsız histerezis kaba karoya
        # kilitleniyordu: kaba karo küçük kadrajı DAİMA kapsadığı için ince karoya bir daha
        # geçilmiyordu = kalıcı bulanıklık. Bu yüzden 1,25× tavanı ŞART.
        if (_sec is not None and 0<=_SINGLE_LAST[0]<len(_ATILES) and _SINGLE_LAST[0]!=_sec
                and _kapsar(_ATILES[_SINGLE_LAST[0]])
                and _ATILES[_SINGLE_LAST[0]][3] <= _ATILES[_sec][3]*1.25):
            _sec=_SINGLE_LAST[0]
        if _sec is not None:
            # ===== POZLAMA EŞİTLEME (Barış 2026-08-04: "sonlara doğru yine slayt gösterisi") =====
            # Karo değişimini SEYREKLEŞTİRMEK yetmiyor (en geniş kadrajda karo hızla tükeniyor).
            # Ama geometri zaten Mercator'da hizalı; değişimde göze çarpan tek şey İKİ ÇEKİMİN
            # POZLAMA/RENK FARKI. Değişim anında iki karo da AYNI yeri gösterdiği için yeni karonun
            # kanal ortalama/std'si eskisine (düzeltilmiş hâline) eşitlenir ve o karo boyunca
            # korunur -> zincir boyunca tutarlı, kesme hissi kalkar.
            if _SINGLE_LAST[0]>=0 and _sec!=_SINGLE_LAST[0]:
                _TILECHG[0]=1.0                                # kalanı glitch ile maskele
                _XF[0]=_SINGLE_LAST[0]; _XF[1]=_XFN; _XF[2]=_XFN   # çözülmeyi başlat
                try:
                    _eski=_kirp(_SINGLE_LAST[0])
                    if _eski is not None:
                        _eski=_uygula(_eski,_TILEADJ.get(_SINGLE_LAST[0]))
                        _yeni=_kirp(_sec)
                        if _yeni is not None: _TILEADJ[_sec]=_esitle(_yeni,_eski)
                except Exception: pass
            _SINGLE_LAST[0]=_sec; _TEKSAY[0]+=1
            if _TILEDBG: _TILELOG.append((i,_sec,round(_ATILES[_sec][3],2),round(_out,2),round(_tlat,6),round(_tlon,6)))
            _im2,_la2,_lo2,_tm2=_ATILES[_sec]
            _s2=(_tm2/max(1e-9,_coslat))
            _lx=_mx_(_lo2)-_im2.size[0]*_s2/2.0              # karonun sol-üst köşesi (Mercator)
            _ty=_my_(_la2)+_im2.size[1]*_s2/2.0
            _px0=(_fx0-_lx)/_s2; _px1=(_fx1-_lx)/_s2
            _py0=(_ty-_fy1)/_s2; _py1=(_ty-_fy0)/_s2
            _px0=max(0,int(_px0)); _py0=max(0,int(_py0))
            _px1=min(_im2.size[0],int(math.ceil(_px1))); _py1=min(_im2.size[1],int(math.ceil(_py1)))
            if _px1-_px0>=2 and _py1-_py0>=2:
                _res=_uygula(_im2.crop((_px0,_py0,_px1,_py1)).resize((W,H),Image.LANCZOS),
                             _TILEADJ.get(_sec))
                if _XF[1]>0:
                    _XF[1]-=1
                    _old=_tam_kirp(_XF[0])                   # eski karo hâlâ kapsıyorsa çözülerek çık
                    if _old is not None:
                        _al=1.0-(_XF[1]+1)/float(_XF[2]+1)   # 0 -> 1 (yeni karo yükselir)
                        _al=_al*_al*(3.0-2.0*_al)            # smoothstep
                        _res=Image.blend(_old,_res,_al)
                    else: _XF[1]=0
                return _res
        else:
            _COKSAY[0]+=1                                    # kapsayan karo yok -> çok-karo yedeği
            if _TILEDBG: _TILELOG.append((i,-1,-1.0,round(_out,2),round(_tlat,6),round(_tlon,6)))
    for _idx,(_img,_cla,_clo,_tm) in enumerate(_ATILES):  # setup'ta sıralı: kaba (BIG/z13) altta, ince (z16) üstte
        _sc=_tm/_out
        # KATMAN SÖNÜMÜ (Barış 2026-07-30 "bazı zoom-in/out'ta slide gösterisi gibi resim/kare değişiyor"):
        # eski SERT kesim (_sc<0.30 -> continue) ince karoyu TEK KAREDE düşürüyordu -> görüntü ANİDEN değişiyordu
        # (kaba katmanın rengi/tarihi farklı = "kare değişti" popu). Artık 0.22-0.34 arasında KADEMELİ alfa ile söner.
        _af=1.0
        if _idx>0:
            # İKİ RESİM ÜST ÜSTE — KÖK NEDEN (Barış 2026-08-04: "hâlâ binalar iç içe giriyor"):
            # 0.22-0.34 bandında katman YARI-SAYDAM çiziliyordu. Zoom DURURKEN _sc sabit olduğu
            # için o katman SÜREKLİ yarı-saydam kalıyor -> aynı yerin iki kopyası KALICI olarak
            # üst üste. Yani geçiş değil, DURAĞAN bir hata; hızlandırmak tek başına çözmez.
            # ÇÖZÜM: alfa İKİLİ olsun — katman ya TAM çizilir ya hiç çizilmez. Karışım yok =>
            # üst üste binme fiziksel olarak imkansız. Eskiden bandın amacı "pop"u yumuşatmaktı;
            # artık zoom geçişi TEK KAREDE olduğu için pop zaten görünmüyor (aşağıdaki HIZLI ZOOM).
            if _sc<0.28: continue                         # ikili eşik: altı = hiç çizme
        _iw,_ih=_img.size
        _sc=(_tm/max(1e-9,_coslat))/_outM                # ölçek de Mercator'da (enlemden bağımsız)
        _tlx=_ccx+(_mx_(_clo)-_fxM)/_outM-_iw*_sc/2.0    # karonun canvas'taki sol-üst köşesi
        _tly=_ccy+(_fyM-_my_(_cla))/_outM-_ih*_sc/2.0
        _vx0=max(0.0,_tlx); _vy0=max(0.0,_tly)
        _vx1=min(float(W),_tlx+_iw*_sc); _vy1=min(float(H),_tly+_ih*_sc)
        if _vx1-_vx0<1 or _vy1-_vy0<1: continue          # görünür değil -> atla (resize YOK)
        _cx0=max(0,int((_vx0-_tlx)/_sc)); _cy0=max(0,int((_vy0-_tly)/_sc))   # sadece GÖRÜNÜR bölgeyi kırp
        _cx1=min(_iw,int((_vx1-_tlx)/_sc)); _cy1=min(_ih,int((_vy1-_tly)/_sc))
        _dw=int(_vx1)-int(_vx0); _dh=int(_vy1)-int(_vy0)
        if _dw<1 or _dh<1: continue
        _rs=_img.crop((_cx0,_cy0,_cx1,_cy1)).resize((_dw,_dh),Image.LANCZOS)
        if _idx==0:                                       # en alt katman (BIG): opak -> asla siyah kalmaz
            _cv.paste(_rs,(int(_vx0),int(_vy0)))
        else:                                             # üst karolar: feather ile YUMUŞAK harman (dikiş yok)
            # FEATHER GERİ KONDU — ama artık ZARARSIZ (Barış 2026-08-04 deneyi):
            #  · feather YOK  -> komşu karolar farklı Mapbox çekimlerinden geldiği için
            #    aralarında SERT PARLAKLIK DİKİŞİ çıkıyor (ölçüldü, ekran görüntüsüyle görüldü)
            #  · feather VAR + karolar KAYIK (eski hal) -> aynı yerin iki kopyası karışıyor = HAYALET
            #  · feather VAR + karolar HİZALI (şimdi, Mercator) -> karışan iki görüntü AYNI yeri
            #    gösteriyor; harman yalnız POZLAMA farkını yumuşatıyor -> hayalet YOK, dikiş YOK.
            # Yani hayaleti yaratan feather değil, HİZASIZLIKTI. Hizalama düzelince feather işini
            # yapıyor. Katman sönümü (_af) yok — o ayrı ve kalıcı şeffaflık yapıyordu, kaldırıldı.
            _mk=_FEATHER.crop((_cx0,_cy0,_cx1,_cy1)).resize((_dw,_dh),Image.BILINEAR)
            _cv.paste(_rs,(int(_vx0),int(_vy0)),_mk)
    return _cv
_ZCOV=[]                                                # NET-KAPISI: kare-başı en yakın z16/z18 mesafesi (aşağıda doldurulur)
_ZE=[]                                                  # YUMUŞAK ZOOM dizisi
_ZOPEN_V=[]  # AÇILIŞ kadraj dizisi (aşağıda dolar) — yalnız kadrajı etkiler, NV'ye DOKUNMAZ (aşağıda _ZCOV sonrası doldurulur)
def _film_base(i):
    # YUMUŞAK ZOOM (Barış 2026-07-27): _ZE = precompute'lu, rampalı net-kapísı + zaman-yumuşatmalı -> zoom ani zıplamaz.
    _ze=_ZE[i] if (_ZE and i<len(_ZE)) else _stepz(_zenv[i],4)
    # AÇILIŞ GENİŞ KADRAJ (Barış 2026-08-04: "video zaten yakından başlıyor, karmakarışık her şeyin
    # içinden geçiyor; uzaktan başlayıp şehre girince zoom in yapmalı"). Rota ŞEHİR İÇİNDE başlarsa
    # _zenv[0] yüksek olduğu için video ilk kareden itibaren sokak seviyesindeydi -> hiç "zoom in" anı
    # yoktu. Artık video EN GENİŞ kadrajdan açılır ve rotanın gerçek seviyesine KADEMELİ iner
    # (her kademe tek karede, aradaki bekleme sabit) -> gerçek bir "zoom in" hareketi görünür.
    # ⚠️ NV'YE DOKUNULMAZ: fonksiyon yine ham `_ze` döndürür (`_divp` -> `_za` -> night vision aynen
    # kalır); burada değişen SADECE kadraj genişliği.
    _zev=_ZOPEN_V[i] if (_ZOPEN_V and i<len(_ZOPEN_V)) else _ze
    _win=_WIN_OVER*(1.0-_zev)+_WIN_STREET*_zev         # yavaş/şehir=sokak(küçük), hızlı/otoyol=overview(geniş)
    # DERİN CRISP NV (Barış: ŞEHİRDE İYİCE YAKINLAŞ): gece + KENTSEL + yakınken bina-seviyesine in (z18 karo crisp tutar).
    # Derin zoom pacing'i doğal yavaşlatır (sırıtmaz). Hızlı/kırsal/gündüzde dokunmaz -> 900km otoyol bozulmaz. ~%65 daha yakın.
    _isn=(_GRADE=="darknight") or (_GRADE=="auto" and _AUTO_NF>0.5)
    # GECE=GÜNDÜZ: şehirde derin yakınlaşma gündüzde de açık (_isn şartı kaldırıldı).
    if _zev>0.55 and _LOC_URB[i]>0.15:
        _win*=(1.0-0.65*min(1.0,_LOC_URB[i])*min(1.0,(_zev-0.55)/0.45))
    # EKRAN HIZI TAVANI: kare bütçesinin taşıyabileceğinden daha derine inme (yukarıdaki _WINMIN).
    # Zoom yine derinleşir, ama o bölgeye yeterince kare düşmüyorsa daralma orada durur.
    if _WINMIN and i<len(_WINMIN) and _win<_WINMIN[i]: _win=_WINMIN[i]
    # MARKER DRIFT (Barış 2026-07-27): kamera yumuşatılmış (CAMLAT/LON), marker GERÇEK konumda -> merkezden HAFİF kayar.
    # Sallanma yumuşak takibe döner. Clamp: merkezî banttan çıkmaz (askeri-uydu "merkezde" kuralı korunur).
    # MAKSİMUM DOĞRULUK (Barış 2026-07-28 "deniz'de rota olursa kullanıcı app'i siler, marker DAİMA gerçek yolda"):
    # Marker artık GERÇEK konumun tam projeksiyonu (offset 0.35->1.0). Kamera (CAMLAT smooth) git-gel/körfezde
    # denize kayıyordu; %35 offset + ±52px clamp marker'ı gerçek kıyı noktasına ulaştıramayıp denize koyuyordu.
    # Tam offset -> marker daima gerçek route noktasında (kara/yol); kamera nerede olursa olsun. Clamp GENİŞ
    # (ekranda kalsın ama gerçek konuma ulaşsın). Düz rotada kamera≈gerçek -> marker yine merkeze yakın kalır.
    # MARKER = EKRAN MERKEZİ SABİT (Barış 2026-07-28 "nokta sağa-sola zıplıyor/uçuyor"): offset %100 marker'ı gerçek
    # konuma koyuyordu AMA kamera(smooth)-marker(gerçek) farkı yüksek-frekans jitter -> marker TİTRİYORDU. Marker artık
    # DAİMA ekran ortasında (askeri-uydu: hedef sabit merkez); kamera (CAMLAT, gerçek rotaya SIKI kilitli) haritayı
    # taşır -> marker gerçek yolda + TİTREME YOK. _geo_crop merkezi CAMLAT olduğu için marker=merkez=gerçek konum.
    _mx=int(W/2.0); _my=int(H*0.42)
    # TEK HARİTA KALDIRILDI (Barış 2026-08-04): ölçümde büyük sıçramaların 43/43'ü
    # (yani %100'ü) karo değişim anındaydı — ızgara hücresi kadraj yüksekliğine bağlı
    # olduğu için 1,9 sn'de bir karo değişiyor ve görüntü ışınlanıyordu. Kaynak kalktı.
    return _geo_crop(i,_win), _mx, _my, _ze
# --- punch-in pencereleri + sinyal bozulması anları ---
PUNCH=[(DUR*0.28,DUR*0.40),(DUR*0.66,DUR*0.78)]
DEGR=[]   # karıncalanma efekti KALDIRILDI (yapmacık duruyordu)
# SİNYAL DALGALANMASI (Barış: rotadan sapınca gerçekçi sinyal kaybı): (1) AMBIENT birkaç yumuşak düşüş (canlı/dalgalı),
# (2) SU/DENİZ tespiti loop'ta (marker mavi/su uydu-renginde bir süre kalırsa -> sinyal kaybı).
_amb_rng=random.Random(int(abs(sum(la[:15]))*1e3)+7); _ambwin=[]
_nfl=max(2,int(DUR/16))
for _fi in range(_nfl):
    _c=(_fi+_amb_rng.uniform(0.3,0.7))/_nfl*DUR; _d=_amb_rng.uniform(0.8,1.5)
    _ambwin.append((_c-_d/2,_c+_d/2,_amb_rng.choice([0.42,0.48,0.55])))
_water_run=0
# SİNYAL DÜZELME anları (zayıf<0.5 -> kilit>=0.5): kısa "REACQUIRED" mesajı için ~1.3sn işaretle
_reacq=[False]*N
for _ri in range(1,N):
    if (SIG[_ri-1] if _ri-1<len(SIG) else 1.0)<0.5<=(SIG[_ri] if _ri<len(SIG) else 1.0):
        for _rj2 in range(_ri,min(N,_ri+40)): _reacq[_rj2]=True
# ===== OTONOM GÖRÜŞ (Barış 2026-07-26): sürüş gece/gündüz sınırını GEÇİYORSA video İÇİNDE yumuşak geçiş =====
# Kare-kare güneş yüksekliği -> gece-fraksiyonu (NIGHTF). Geçiş varsa (uzun/şafak-batım sürüşü) grade nv<->day
# blend'ler + HUD rengi kayar + geçiş anına sesli komut (render_job theme_transition.json'u okur). Geçiş yoksa sabit mod.
NIGHTF=[1.0]*N; _NDACC=((150,255,235),(120,220,255)); _NDAMB=((255,190,90),(150,210,255))   # (gündüz,gece) accent/amber — gece=cyan ay ışığı
if _THEME=="auto":
    _tf=float(os.environ.get("TAC_FROM","0") or 0); _tt=float(os.environ.get("TAC_TO","0") or 0)
    if _tt<=_tf: _tt=_tf+max(1.0,DUR*60)   # from/to yoksa kaba tahmin
    def _nf_el(el):
        if el<=-8.0: return 1.0
        if el>=0.0: return 0.0
        return -el/8.0
    NIGHTF=[_nf_el(_sun_elev(LATS[i],LONS[i], _tf+(_tt-_tf)*i/max(1,N-1))) for i in range(N)]
    NIGHTF=smooth(NIGHTF, max(3,int(FPS*0.7)))
    _GRADE="auto"
    if abs(NIGHTF[-1]-NIGHTF[0])>0.4:   # ANLAMLI geçiş -> sesli komut için an+yön yaz
        _ci=next((k for k in range(1,N) if (NIGHTF[k-1]-0.5)*(NIGHTF[k]-0.5)<=0), N//2)
        json.dump({"t":round(_ci/FPS,2),"dir":("night2day" if NIGHTF[0]>NIGHTF[-1] else "day2night")},
                  open(f"{SC}/theme_transition.json","w"))
    else:
        try: os.remove(f"{SC}/theme_transition.json")
        except OSError: pass
def _lerp3(a,b,f): return (int(a[0]+(b[0]-a[0])*f),int(a[1]+(b[1]-a[1])*f),int(a[2]+(b[2]-a[2])*f))
# DERİN CRISP NV (Barış: İYİCE YAKINLAŞ): en KENTSEL noktalara (road_density top) z18 karo -> _ATILES en üst; bina-seviyesi.
# z18 ~0.22 m/px -> ~280m pencereye kadar CRISP. _usam = (frac, yol-yoğunluğu, lat, lon) — gerçek şehirler.
if _SPANM>2000 and _usam:
    _dcos=math.cos(sum(la)/len(la)*math.pi/180)
    _deep=sorted([(s[1],s[2],s[3]) for s in _usam if s[1]>0.45], reverse=True)
    _dlast=None; _dc=[]
    for (_u,_dla,_dlo) in _deep:
        if _dlast is not None and math.hypot((_dla-_dlast[0])*111320.0,(_dlo-_dlast[1])*111320.0*_dcos)<900: continue
        _dlast=(_dla,_dlo); _dc.append((_dla,_dlo))
        if len(_dc)>=24: break
    _dn=0
    for (_dla,_dlo),_z18 in zip(_dc,_dtiles_par([(c[0],c[1],18) for c in _dc])):
        if _z18 is not None: _ATILES.append((_z18,_dla,_dlo,_tmpx(18))); _dn+=1; _sharp.append((_dla,_dlo))
    _ATILES.sort(key=lambda a:-a[3])   # yeniden sırala: kaba (z15/BIG) altta, z18 en üstte (finest)
    print(f"DERİN NV: {_dn} z18 karo (bina-seviyesi crisp zoom)", flush=True)
# NET-KAPISI: her kare -> en yakın NET (z16/z18) tile merkezine mesafe. _film_base uzaksa tight zoom yapmaz (bulanık önlenir).
try: _sharp
except NameError: _sharp=[]
if _FILM and _sharp:
    _sla_a=_np.array([s[0] for s in _sharp]); _slo_a=_np.array([s[1] for s in _sharp])
    for _i in range(N):
        _dx=(LATS[_i]-_sla_a)*111320.0; _dy=(LONS[_i]-_slo_a)*111320.0*_coslat
        _ZCOV.append(float(_np.sqrt((_dx*_dx+_dy*_dy).min())))
# YUMUŞAK ZOOM DİZİSİ (Barış 2026-07-27 "kısa videoda zoom-in/out bir anda geçiyor, bozukluk"): eski net-kapísı
# SERT eşikti (_ZCOV>1500 -> _ze=0.35 ANİ zıplama). ÇÖZÜM: _ZE'yi precompute et — net-kapísı RAMPALI (1100->2000m
# kademeli) + hafif ZAMAN-YUMUŞATMA -> zoom-in/out ani geçmez, pürüzsüz. chunk-güvenli (precompute). NV etkilenmez (_zenv ayrı).
_ZE=[]
if _FILM:
    # KISA (1dk) vs UZUN zoom eğrisi (Barış 2026-07-27 "1dk zoom slideshow gibi, içe geçme çirkin"):
    # _stepz = kademeli "zoom-DUR-zoom-DUR" (basamaklı) -> 1dk'da hızlı oscillation = SLIDE GÖSTERİSİ gibi çirkin.
    # KISA modda SÜREKLİ yumuşak zoom kullan (basamak yok, akıcı ease in/out); UZUN'da stepz sinematik his korunur.
    _shortz = DUR < 45.0
    if _shortz:
        _zbase=smooth([max(0.0,min(1.0,_zenv[_i])) for _i in range(N)], max(5,int(FPS*1.3)))   # SÜREKLİ, pürüzsüz (basamaksız)
    else:
        # UZUN mod: eskiden SAF `_stepz` (4 basamak, %58 DUR) -> Barış 2026-07-30 "bazı zoom-in/out'ta slide gösterisi
        # gibi" = zoom-DUR-zoom-DUR ritmi basamaklı/atlamalı okunuyordu. Artık basamaklı ile SÜREKLİ yumuşak zoom
        # YARI YARIYA harmanlanır: sinematik nefes korunur, basamak sertliği yarıya iner. Tepe değeri ~aynı kalır
        # (ikisi de tepede 1.0'a gider) -> NV eşiği (_ze>0.55) etkilenmez.
        # GECE/GÜNDÜZ AYRIMI (Barış 2026-07-30: "yumuşak zoom in/out'u gündüzde de kullanıyorsun, gündüzde çok belli
        # oluyor; gündüzde KLASİK zoom in/out olsun, night vision aynı kalsın"): yumuşak harman SADECE gecede
        # (NV'nin sinematik akışı için); gündüzde saf `_stepz` = klasik kademeli zoom-DUR (eski beğenilen davranış).
        # Kare-başı NIGHTF ile karışır -> şafak/batım geçişinde de yumuşak devreye girer, sıçrama olmaz.
        _zcont=smooth([max(0.0,min(1.0,_zenv[_i])) for _i in range(N)], max(5,int(FPS*1.0)))
        _zstep=[_stepz(_zenv[_i],4) for _i in range(N)]
        _zbase=[]
        for _i in range(N):
            _nfz=NIGHTF[_i] if _THEME=="auto" else (1.0 if _GRADE=="darknight" else 0.0)
            _sf=0.5*_zstep[_i]+0.5*_zcont[_i]                 # GECE: yumuşak harman (NV akışı)
            # GECE=GÜNDÜZ (Barış: "gece ile gündüzü aynı yap"): gündüzde saf basamaklı
            # (_zstep) zoom kademeli/atlamalı okunuyordu. Artık ikisi de gecenin yumuşak harmanı.
            _zbase.append(_sf)
    for _i in range(N):
        _z=_zbase[_i]
        if _ZCOV and _i<len(_ZCOV) and _ZCOV[_i]>1100.0:      # net tile uzaklaştıkça KADEMELİ kıs (sert eşik yok)
            _cf=max(0.0,min(1.0,(_ZCOV[_i]-1100.0)/900.0))    # 1100m->0, 2000m->1 (tam kıs)
            _z=_z*(1.0-_cf)+min(_z,0.35)*_cf
        _ZE.append(_z)
    _ZE=smooth(_ZE,max(3,int(FPS*0.5)))
    # ================= TEK KARE ZOOM (Barış 2026-08-04) =================
    # "Tek bir kare olsun, gözle algılanmayacak şekilde diğer kareye hızlı geçiş yap."
    # Kademeye yuvarla -> UZUN DUR -> TEK KAREDE atla -> UZUN DUR.
    # 33 ms'lik ölçek değişimi algı eşiğinin altında; üstelik alfa ikili olduğu için
    # o tek karede bile karışım YOK (katman ya var ya yok).
    _ZHOLD=float(os.environ.get("TAC_ZOOM_HOLD","0") or 0) or max(5.0, DUR/14.0)
    try:
        # ⚠️ ÖNCEKİ HATA (Barış 2026-08-04: "zoom in demesine rağmen zoom in yapmıyor,
        # video zaten yakından başlıyor"): kısa kademeler BİR ÖNCEKİNE yutuluyordu ->
        # uzun beklemede tüm video İLK kademenin seviyesine çöküyor, zoom eğrisi
        # düzleşiyor, hiç zoom in/out olmuyordu.
        # DOĞRUSU: önce eğriyi bekleme penceresi kadar YUMUŞAT (büyük ölçekli gidişat
        # kalır, kısa titremeler silinir), SONRA kademeye yuvarla. Böylece otoyolda
        # geniş, şehre girince yakın olur — yani rotanın gerçek şeklini izler.
        # yumuşatma penceresi videonun 1/6'sını AŞMASIN: kısa videoda tüm zarfı ezip
        # tek seviyeye düşürüyordu (geniş kademe hiç kullanılmıyordu).
        _wn=max(3,min(int(FPS*_ZHOLD), max(3,len(_ZE)//6)))
        # ===== 1 DAKİKALIK MOD (Barış 2026-08-05) — UZUN VİDEOYA DOKUNMAZ =====
        # ⚠️ Koşul `DUR<60`: kısa modda rota ~20sn, uzun (3dk) modda ~134sn -> ikisini KESİN ayırır,
        # mühürlü uzun hattın tek bir karesi bile değişmez.
        # ÖLÇÜLDÜ (TAC_ECHO=1 ile, 1dk testi): "ZOOM ZAMAN ÇİZELGESİ: 0-20sn:9200m · kullanılan
        # kademe 1 ([0.0]) · 0 geçiş" -> kısa videoda HİÇ ZOOM YOK, hepsi en geniş kademede.
        # SEBEP: 20sn'lik rotada yumuşatma penceresi 3,3sn (len//6) + 4 kademeye YUVARLAMA ->
        # ~1sn'lik şehir tepeleri komple siliniyor, `round` hepsini 0.0'a düşürüyor. Zoom olmayınca
        # NV de imkânsız (NV eşiği _divp>=0.45). Kısa modda pencereyi rota uzunluğuyla ölçekle.
        if DUR < 60.0:
            _wn=max(3, min(_wn, int(FPS*0.6), max(3, len(_ZE)//20)))
        _zs=smooth(list(_ZE), _wn)                    # bekleme penceresi kadar yumuşat
        _L=4
        _q=[round(max(0.0,min(1.0,_v))*(_L-1))/(_L-1) for _v in _zs]
        # yumuşatma sonrası kalan çok kısa kademeleri KOMŞULARIN ÇOĞUNLUĞUNA çevir
        # (öncekine yutma YOK -> eğri şekli korunur)
        _mh=max(2,int(FPS*1.5)); _i0=0
        while _i0 < len(_q):
            _i1=_i0
            while _i1+1 < len(_q) and _q[_i1+1]==_q[_i0]: _i1+=1
            if (_i1-_i0+1) < _mh:
                _sol=_q[_i0-1] if _i0>0 else None
                _sag=_q[_i1+1] if _i1+1<len(_q) else None
                _hedef=_sol if _sag is None else (_sag if _sol is None else
                        (_sol if abs(_q[_i0]-_sol)<=abs(_q[_i0]-_sag) else _sag))
                if _hedef is not None:
                    for _k in range(_i0,_i1+1): _q[_k]=_hedef
            _i0=_i1+1
        # ===== ŞEHİR EPİZODU: kademe SABİTLEME (Barış 2026-08-05) =====
        # ŞİKÂYET: "NV şehrin başından sonuna açık olmalı, ortasında rastgele açılıyor · aşırı
        # uzaktan çekiyor, sanki hiç zoom yapmamış gibi · sokağın dibine kadar yakınlaşsın".
        # KÖK NEDEN: `_ZHOLD = max(5, DUR/14)` -> 178sn videoda **12,7 SANİYELİK** yumuşatma penceresi.
        # 3,6sn'lik şehir bu pencerede tamamen siliniyor; 19,3sn'lik şehrin yalnız ORTASI hayatta
        # kalıyor (=ortada rastgele parlama). Üstelik `_q` YUVARLAMA yaptığı için son kademeye
        # (sokak, ~330m) çıkmak yumuşatılmış değerin >=0.833 olmasını gerektiriyor; ulaşamayınca
        # bir alt kademeye (~3000m) düşüyor = "hiç zoom yapmamış gibi".
        # ÇÖZÜM: yumuşatma/yuvarlamadan SONRA, ekranda yeterince kalan kentsel epizodu BAŞTAN SONA
        # en üst kademeye sabitle. Burada kareler doğrudan zaman demek (kare/FPS = saniye), yani
        # "ekran süresi" ölçütü tam isabetli. Kısa/hızlı geçilen kasaba DOKUNULMAZ (eşik altı).
        try:
            # ⚠️ 1dk modunda (DUR<60) eşik ölçeklenir: rota 20sn olduğu için şehirler zaten
            # ~1sn ekranda kalıyor; 3,2sn'lik mutlak eşik HİÇBİR şehri geçirmez. Uzun mod 3,2'de KALIR.
            _EPS_S=float(os.environ.get("TAC_CITY_SEC","") or (3.2 if DUR>=60.0 else 1.1))
            if _LOC_URB and len(_LOC_URB)>=len(_q):
                _minf=int(FPS*_EPS_S); _a=None; _pin=0
                for _i in range(len(_q)+1):
                    _u=(_i<len(_q) and _LOC_URB[_i]>=0.35)
                    if _u and _a is None: _a=_i
                    elif not _u and _a is not None:
                        if _i-_a>=_minf:
                            for _k in range(_a,_i): _q[_k]=1.0      # şehir boyunca SOKAK kademesi
                            _pin+=1
                        _a=None
                if _pin: print(f"ŞEHİR EPİZODU: {_pin} şehir baştan sona sokak kademesine sabitlendi "
                               f"(eşik {_EPS_S:.1f}sn)", flush=True)
        except Exception as _e:
            print("şehir epizodu atlandı:", str(_e)[:110], flush=True)
        _chg=sum(1 for _i in range(1,len(_q)) if _q[_i]!=_q[_i-1])
        # GEÇİŞ RAMPASI (Barış 2026-08-04: "zoomda çok hızlı, geçişler güzel ama biraz daha yavaş;
        # bir yanda slide gösterisi şeklinde geçiş var"). Geçiş TAM 1 kare (33ms) olunca sert KESME
        # gibi okunuyordu = slayt gösterisi. Artık kademe değişimi kısa bir smoothstep whip ile
        # yapılır (~0.15sn) -> hâlâ hızlı/sinematik ama kesme değil. Kademe BEKLEMELERİ aynı kalır.
        _ZSTEP=float(os.environ.get("TAC_ZSTEP_SEC","") or 0.15)
        _rn=max(1,int(round(FPS*_ZSTEP)))
        if _rn>1:
            _qr=list(_q)
            for _i in range(1,len(_q)):
                if _q[_i]==_q[_i-1]: continue
                _a=_q[_i-1]; _b=_q[_i]
                for _k in range(_rn):
                    _p=_i+_k
                    if _p>=len(_qr) or _q[min(len(_q)-1,_p)]!=_b: break   # sıradaki geçişe taşma
                    _g=(_k+1)/float(_rn); _qr[_p]=_a+(_b-_a)*(_g*_g*(3-2*_g))
            _q=_qr
        _ZE=_q                                        # RAMPA YOK -> geçiş tam 1 kare
        # AÇILIŞ: en geniş kadrajdan rotanın gerçek seviyesine KADEMELİ in (tek-kare geçişlerle).
        # Tek hamlede 9200m->850m atlamak (10x) sert okunuyordu; ara kademeler zoom-in hissini verir.
        _ZOPEN=float(os.environ.get("TAC_ZOPEN","") or 0) or min(5.0, max(2.5, DUR*0.05))
        _ZOPEN_V=[]
        if _q and _q[0]>0.05:
            _ust=[_l/(_L-1) for _l in range(_L) if _l/(_L-1) < _q[0]]   # hedefin ALTINDAKİ kademeler (geniş->dar)
            _pf=max(1,int(FPS*_ZOPEN/max(1,len(_ust))))                 # her kademede eşit bekleme
            for _lv in _ust: _ZOPEN_V.extend([_lv]*_pf)
        try:
            _wof=_WIN_OVER; _wsf=_WIN_STREET
            _tl=[]; _i0=0
            while _i0<len(_q):
                _i1=_i0
                while _i1+1<len(_q) and _q[_i1+1]==_q[_i0]: _i1+=1
                _tl.append(f"{_i0/FPS:.0f}-{(_i1+1)/FPS:.0f}sn:{_wof*(1-_q[_i0])+_wsf*_q[_i0]:.0f}m")
                _i0=_i1+1
            print("ZOOM ZAMAN ÇİZELGESİ: "+" | ".join(_tl[:14])+(" …" if len(_tl)>14 else ""), flush=True)
        except Exception: pass
        try:
            print(f"TEK HARİTA/GLITCH: geçiş rampası {_rn/FPS*1000:.0f}ms · glitch kuyruğu {_ZGL_TAIL*1000:.0f}ms", flush=True)
        except Exception: pass
        _sev=sorted(set(_q))
        print("AÇILIŞ: "+(" -> ".join(f"{_WIN_OVER*(1-_v)+_WIN_STREET*_v:.0f}m" for _v in dict.fromkeys(_ZOPEN_V))+
              f" -> rota ({len(_ZOPEN_V)/FPS:.1f}sn kademeli zoom-in)" if _ZOPEN_V else "zaten geniş başlıyor"), flush=True)
        print(f"TEK KARE ZOOM: {_chg} geçiş · 1 kare (33ms) · bekleme {_ZHOLD:.0f}sn · "
              f"kullanılan kademe {len(_sev)} ({[round(x,2) for x in _sev]}) · "
              f"başlangıç {_q[0]:.2f} bitiş {_q[-1]:.2f}", flush=True)
    except Exception as _e:
        print("tek kare zoom uygulanamadı:", str(_e)[:90], flush=True)
    # ====================================================================
                        # ek zaman-yumuşatma: geçişler tamamen pürüzsüz
def _finalize_cues(_therm_list):
    """Cue dosyalarını yaz (zoom + thermal + city) — dizilerden hesaplı (render'a gerek yok). Parent VEYA sequential çağırır."""
    try:
        _cues=[]; _lastt=-99.0
        if _FILM:
            for _i in range(1,N):
                _t=_i/FPS
                if _zenv[_i-1]<0.5<=_zenv[_i] and _t-_lastt>3.0:
                    _cues.append({"t":round(_t,2),"dir":"in"}); _lastt=_t
                elif _zenv[_i-1]>=0.5>_zenv[_i] and _t-_lastt>3.0:
                    _cues.append({"t":round(_t,2),"dir":"out"}); _lastt=_t
        else:
            for _d in DIVES:
                _cues.append({"t":round(_d[0],2),"dir":("in" if _d[4]=="in" else "out")})
        json.dump(_cues, open(f"{SC}/zoom_cues.json","w"))
        json.dump(_therm_list, open(f"{SC}/thermal_cues.json","w"))
    except Exception:
        pass
    try:
        _ccu=[]
        for (_pf,_pn) in PLACES:
            if _pn and 0.10<_pf<0.90: _ccu.append({"t":round(_pf*DUR,2),"city":_pn.title(),"f":_pf})
        _ccu.sort(key=lambda x:x["t"])
        _dd=[]
        for c in _ccu:
            if not _dd or _dd[-1]["city"]!=c["city"]: _dd.append(c)
        _ccu=_dd
        _cap=min(6,max(3,int(DUR/28)))
        if len(_ccu)<=_cap:
            _sel=_ccu
        else:
            _tg=[0.12+(0.88-0.12)*k/(_cap-1) for k in range(_cap)]
            _used=set(); _sel=[]
            for _t in _tg:
                _cands=[(abs(c["f"]-_t),_i) for _i,c in enumerate(_ccu) if _i not in _used]
                if _cands:
                    _bi=min(_cands)[1]; _used.add(_bi); _sel.append(_ccu[_bi])
            _sel.sort(key=lambda x:x["t"])
        _flt=[]; _lt=-99.0
        for c in _sel:
            if c["t"]-_lt>=8.0: _flt.append({"t":c["t"],"city":c["city"]}); _lt=c["t"]
        json.dump(_flt, open(f"{SC}/city_cues.json","w"))
    except Exception:
        json.dump([], open(f"{SC}/city_cues.json","w"))

# PARÇALI PARALEL RENDER (2026-07-26): kare-döngüsünü _NCHUNK chunk'a böl, her chunk ayrı OS process (fork -> setup MİRAS).
# Grain deterministik (kare-index seed) + _water_run 14-kare WARMUP ile chunk sınırında tam kurulur + _therm cue'ları
# yalnız chunk menzilinde toplanır (parent birleştirir) -> çıktı tek-thread ile BYTE-IDENTICAL. TAC_CHUNKS=1 -> eski davranış.
_NCHUNK=int(os.environ.get("TAC_CHUNKS","1"))
_CHUNK_START=0; _CHUNK_END=N; _WARM=14; _child=False; _bounds=[]
if _NCHUNK>1 and N>_NCHUNK*40 and "TAC_CHUNK_START" not in os.environ:
    _bounds=[(k*N//_NCHUNK,(k+1)*N//_NCHUNK) for k in range(_NCHUNK)]
    _pids=[]
    for (_a,_b) in _bounds:
        _pid=os.fork()
        if _pid==0:
            _CHUNK_START,_CHUNK_END=_a,_b; _child=True; break
        _pids.append(_pid)
    if not _child:   # PARENT: çocukları bekle -> thermal birleştir -> cue'ları yaz -> ÇIK (loop'a girmez)
        _rc=0
        for _p in _pids:
            if os.waitpid(_p,0)[1]!=0: _rc=1
        _tall=[]
        for (_a,_b) in _bounds:
            try: _tall+=json.load(open(f"{SC}/thermal_cues_{_a}.json"))
            except Exception: pass
        _finalize_cues(sorted(set(_tall)))
        print(f"TAKTİK ROTA {N} kare OK ({_NCHUNK} paralel chunk)")
        sys.exit(_rc)
_therm_cues=[]; _therm_prev=False   # GECE NV yükselen-kenarları (yakınlaşma anları) -> sesli anons için
_PREV_DIVP=None   # önceki karenin zoom konumu (zoom-geçiş glitch'i; warmup'ta da güncellenir)
_ZGL=[0.0]   # zoom glitch kuyruğu (sönen); warmup dahil her karede güncellenir -> chunk-güvenli
_ZGL_TAIL=float(os.environ.get("TAC_ZGLITCH_SEC","") or 0.45)
_ZGL_DECAY=0.02**(1.0/max(1.0,FPS*_ZGL_TAIL))   # kuyruk sonunda 0.02'ye iner
for i in range(max(0,_CHUNK_START-_WARM), _CHUNK_END):
    _FRAME_I=i
    t=i/FPS
    _URBAN_NOW=_LOC_URB[i]                              # bu karenin kentsellik skoru (crisp z16 karodan) -> NV kapısı
    if _THEME=="auto":                                 # OTONOM: bu karenin gece-fraksiyonuna göre grade + HUD rengi
        _AUTO_NF=NIGHTF[i]
        HUDA=_lerp3(_NDACC[0],_NDACC[1],NIGHTF[i]); TEAL=HUDA; AMB=_lerp3(_NDAMB[0],_NDAMB[1],NIGHTF[i])
    rj=random.Random(i)                                # her iki dalda da lazım (sinyal efekti + jitter)
    if _FILM:
        base,mcx,mcy,_divp=_film_base(i)
        fr=grade(base); d=ImageDraw.Draw(fr,"RGBA")
    else:
        tx,ty=X[i],Y[i]
        # kamera: hedefi %42 yüksekliğe koy, hafif jitter
        rj=random.Random(i)
        jx=rj.uniform(-1.2,1.2); jy=rj.uniform(-1.2,1.2)
        vw=VIEWW; _divp=0.0; _DACT=None; _dmix=0.0
        _nightnow=(_GRADE=="darknight") or (_GRADE=="auto" and NIGHTF[i]>0.5)   # gece? -> NV dive'ı DAHA DERİN zoom (Barış)
        _dzt=0.26 if _nightnow else 0.34; _dzr=1.0-_dzt                          # dive tam-zoom hedefi + ramp aralığı
        for _dt0,_dtl,_cla,_clo,_typ,_dzk in DIVES:
            if _dt0-_DIN<=t<_dt0+_DH+_DOUT:
                if _typ=="in":
                    _DACT=(_dtl,_cla,_clo,_dzk)
                    if t<_dt0:
                        _q=_stepz(sm((t-(_dt0-_DIN))/_DIN)); vw=int(VIEWW*(1.0-_dzr*_q)); _divp=_q
                        _dmix=sm(max(0,(_q-0.6)/0.4))
                    elif t<_dt0+_DH:
                        vw=int(VIEWW*_dzt); _divp=1.0; _dmix=1.0
                    else:
                        _q=_stepz(sm((t-(_dt0+_DH))/_DOUT)); vw=int(VIEWW*(_dzt+_dzr*_q)); _divp=1.0-_q
                        _dmix=(1.0 if _q<0.4 else sm((1.0-_q)/0.6))
                else:   # ZOOM OUT: geniş bağlam (pencere büyür) -> DUR -> geri
                    if t<_dt0:
                        _q=_stepz(sm((t-(_dt0-_DIN))/_DIN)); vw=int(VIEWW*(1.0+1.15*_q))     # KADEMELİ ZOOM OUT
                    elif t<_dt0+_DH:
                        vw=int(VIEWW*2.15)                                                   # en geniş: nerede olduğu belli
                    else:
                        _q=_stepz(sm((t-(_dt0+_DH))/_DOUT)); vw=int(VIEWW*(2.15-1.15*_q))     # KADEMELİ ZOOM IN geri
                break
        for p0,p1 in PUNCH:                      # PUNCH-IN: operatör merceği sıkar (640->430) ve bırakır
            if p0<=t<p1:
                ph=(t-p0)/(p1-p0)
                k=math.sin(min(1.0,ph*3.2 if ph<0.5 else (1-ph)*3.2)*math.pi/2) if ph<0.5 else math.sin(min(1.0,(1-ph)*3.2)*math.pi/2)
                k=min(1.0,max(0.0,(ph/0.18 if ph<0.18 else ((1-ph)/0.18 if ph>0.82 else 1.0))))
                vw=int(VIEWW-int(VIEWW*0.33)*k)
        # HBIG.crop (HIZLI + DOĞRU + NET): tek-seferde birleşmiş yüksek-çöz BIG'den kırp. tx,ty=hedef BIG-pikseli (px).
        vh=int(vw*H/W)
        x0=tx-vw/2; y0=ty-vh*0.42
        if vw>BW: vw=BW
        vh=int(vw*H/W)
        if vh>BH: vh=BH; vw=int(vh*W/H)                 # oran KORU
        x0=max(0,min(BW-vw,int(x0))); y0=max(0,min(BH-vh,int(y0)))
        base=HBIG.crop((int(x0*_UPS),int(y0*_UPS),int((x0+vw)*_UPS),int((y0+vh)*_UPS))).resize((W,H),Image.LANCZOS)
        base=base.filter(ImageFilter.UnsharpMask(radius=2,percent=120,threshold=2))   # hafif keskinlik
        if _DACT is not None and _dmix>0.01:            # DIVE anları: crisp z16 karo yakın-plan netliği
            # HİZALI NETLEŞTİRME (Barış 2026-07-27 "şehrin en yakınında fade-out/fade-in çirkin efekt"): eski kod
            # _dv'yi FARKLI ölçek/çerçevede (_crop_c2, marker 0.5) kırpıp base'e (marker 0.42) blend'liyordu ->
            # hizasız çapraz-erime = GHOSTING/dissolve = çirkin fade. FİKS: _dv'yi base ile BİREBİR aynı yer-genişliği
            # + aynı marker konumunda kırp -> blend sadece NETLEŞTİRİR (dikişsiz, dissolve/fade YOK).
            _dtl,_cla,_clo,_dzk=_DACT
            _tpx,_tpy=_dpx(LATS[i],LONS[i],_cla,_clo,_dzk,_dtl.size[0])
            _tmpp=156543.03392*math.cos(_cla*math.pi/180)/(2**_dzk)/2.0        # tile m/px (@2x, _dpx ile aynı)
            _dvw=int(vw*(_SPANM/float(BW))/max(1e-6,_tmpp)); _dvh=int(_dvw*H/W)  # base ile AYNI yer-genişliği
            _diw,_dih=_dtl.size
            if 8<=_dvw<=_diw and 8<=_dvh<=_dih:                                # tile pencereyi kapsıyorsa hizalı netleştir
                _fx=(tx-x0)/float(vw); _fy=(ty-y0)/float(max(1,vh))           # base'teki marker fraksiyonu (clamp dahil)
                _dx0=int(max(0,min(_diw-_dvw,_tpx-_fx*_dvw))); _dy0=int(max(0,min(_dih-_dvh,_tpy-_fy*_dvh)))
                _dv=_dtl.crop((_dx0,_dy0,_dx0+_dvw,_dy0+_dvh)).resize((W,H),Image.LANCZOS)
                base=Image.blend(base,_dv,_dmix)
        fr=grade(base); d=ImageDraw.Draw(fr,"RGBA")
        mcx=int((tx-x0)*W/vw); mcy=int((ty-y0)*W/vw)    # marker HBIG ile aynı projeksiyon -> yolda
    # GECE NV yükselen-kenarı: yakınlaşınca ŞEHİRDE gece görüş açıldığı an (gerçek NV miktarı) -> sesli anons cue'su
    _therm_now=_NV_CUR>0.4
    if _therm_now and not _therm_prev and i>=_CHUNK_START: _therm_cues.append(round(t,2))
    _therm_prev=_therm_now
    if i==N-1:
        fr.save(f"{SC}/route_end_base.jpg", quality=95)   # OUTRO FREEZE: route SON karesi (HUD öncesi) -> outro birebir bununla donar (resim geçişi YOK)
    # SİNYAL GÜVENİ: yol-dışı/belirsiz noktada marker SCANNING/sapma yapar (düzeltemediğimiz yerler = "sinyal zayıf")
    _sig=SIG[i] if i<len(SIG) else 1.0
    _wk=max(0.0,(0.55-_sig)/0.55)                        # 0=tam kilit, ->1 zayıf
    # SU/DENİZ SAPMASI: frame'in NE KADARI mavi/su (grid) -> açık deniz(çoğu su)=güçlü kayıp/LOST, kıyı(az su)=WEAK.
    # Tek-nokta yerine grid -> dalga parıltısı yanıltmaz, sağlam.
    try:
        _bw,_bh=base.size; _wc=0
        for _gx in range(6):
            for _gy in range(8):
                _q=base.getpixel((min(_bw-1,int((_gx+0.5)*_bw/6)),min(_bh-1,int((_gy+0.5)*_bh/8))))
                _navy=_q[2]>_q[1] and _q[2]>_q[0]+6 and _q[2]>=25 and (_q[0]+_q[1]+_q[2])<340   # koyu navy deniz
                _shallow=_q[2]>_q[0]+18 and _q[1]>_q[0]+18 and _q[2]>=_q[1]-14                   # turkuaz/SIĞ SU (kıyı/dere ağzı): mavi+yeşil kırmızıdan belirgin baskın (kara-bitki elenir, mavisi düşük) — Barış 2026-07-28 "signal weak"
                if _navy or _shallow: _wc+=1
        _wfrac=_wc/48.0
    except Exception:
        _wfrac=0.0
    _water_run=min(24,_water_run+2) if _wfrac>0.40 else max(0,_water_run-2)   # sürekli su -> birikir
    _water_wk=min(0.9,max(0.0,(_wfrac-0.35)/0.35)) if _water_run>5 else 0.0   # açık deniz(frac~0.6+)->LOST, kıyı(frac~0.45)->WEAK
    _amb_wk=0.0                                          # AMBIENT dalgalanma (rota boyu birkaç yumuşak düşüş)
    for _a0,_a1,_apk in _ambwin:
        if _a0<=t<_a1: _amb_wk=max(_amb_wk,_apk*math.sin(max(0.0,min(1.0,(t-_a0)/(_a1-_a0)))*math.pi))
    _wk=max(_wk,_water_wk,_amb_wk)                       # gerçek sig VEYA su-sapma VEYA ambient dalgalanma
    if _wk>0.02:
        _sj=random.Random(i*7+3)
        mcx+=int(_sj.uniform(-1,1)*8*_wk); mcy+=int(_sj.uniform(-1,1)*8*_wk)    # scanning sapması (hafif, reticle arıyor)
    # ZOOM GEÇİŞ YOĞUNLUĞU (Barış 2026-07-31 ekran görüntüsüyle: "zoom geçişleri dümdüz olduğu için katman
    # değişimi belli oluyor; NV'deki gibi hafif glitch'le maskele, ancak bu şekilde çözülür"): _divp = o karenin
    # zoom konumu (FILM=_ZE, kısa mod=dive rampası) -> kare-başı DEĞİŞİM HIZI geçiş anlarını verir (DUR'da 0).
    # Warmup dahil her karede güncellenir -> chunk sınırında sequential ile BYTE-IDENTICAL kalır.
    _zdp=0.0 if _PREV_DIVP is None else abs(_divp-_PREV_DIVP)
    _PREV_DIVP=_divp
    # GLITCH KUYRUĞU (Barış 2026-08-04: "glitch efekti koyabilirsin, NightVision'ın aynısı gibi").
    # ⚠️ Eski hâl: _ztr yalnız DEĞİŞİMİN OLDUĞU karede sıfırdan farklıydı -> glitch 33ms sürüyor,
    # göz yakalamıyordu (NV'de görünmesinin sebebi _NV_TRANS'ın rampalı/uzun olması). Artık zoom
    # glitch'i tetiklenince NV gibi SÖNEREK devam eder -> geçiş maskelenir, kesme okunmaz.
    _ztr0=min(1.0,_zdp*FPS*1.8)*0.7                               # anlık tetik (max 0.7)
    # KARO DEĞİŞİM MASKESİ: komşu karolar ayrı Mapbox çekimi olduğu için kaynak değişince kare
    # bir anda "başka görünüyor" -> kesme/slayt hissi. NV tipi glitch bunu maskeler (göz glitch'e
    # takılır). Değişim seyrekleşti ama sıfırlanamaz (karo sonlu) -> kalanı maskele.
    if _TILECHG[0]>0.0: _ztr0=max(_ztr0,0.62); _TILECHG[0]=0.0
    _ZGL[0]=max(_ztr0, _ZGL[0]*_ZGL_DECAY)                        # üstel sönüm (~0.45sn kuyruk)
    if _ZGL[0]<0.02: _ZGL[0]=0.0
    _ztr=_ZGL[0]
    # GİMBAL RETICLE (çizgi yok)
    if i<_CHUNK_START: continue   # WARMUP karesi: _water_run/_therm durumu güncellendi -> HUD çizimi+save ATLA
    # GEÇİŞ GLITCH (Barış 2026-07-27 NV + 2026-07-31 ZOOM): NV açılış/kapanışında VE zoom in/out hareketi
    # sırasında çok HAFİF dijital glitch (kromatik kayma + tear) -> göz glitch'e takılır, karo katman
    # değişimini/geçişi fark etmez (askeri HUD diliyle tutarlı). Geçiş dışında (DUR/seyir) YOK.
    _gl=max(_NV_TRANS,_ztr)
    if _gl>0.12:
        _gg=min(1.0,_gl); _gdx=int(round(3*_gg))            # kromatik kayma (RGB ayrışma) — birkaç px
        if _gdx>=1:
            _gr,_gc,_gb=fr.split()
            fr=Image.merge("RGB",(ImageChops.offset(_gr,_gdx,0),_gc,ImageChops.offset(_gb,-_gdx,0)))
        _gj=random.Random(i*13+5); _gd=ImageDraw.Draw(fr,"RGBA")   # 0-2 ince yatay "tear" çizgisi (hafif parlak)
        for _gk in range(int(round(2*_gg))):
            _gty=_gj.randint(0,H-1); _gd.rectangle([0,_gty,W,_gty+_gj.randint(1,3)],fill=(190,255,225,int(55*_gg)))
        d=ImageDraw.Draw(fr,"RGBA")                                # RGB merge sonrası d'yi tazele (aşağıdaki HUD çizimleri için)
    pr=10+2.0*math.sin(t*5.2)
    _ang=math.degrees(t*55)
    # KONTRAST HALO: koyu alt-kontur (kırmızı çatılarda da okunur)
    _hc=(8,12,14)
    d.polygon([(mcx,mcy-pr),(mcx+pr,mcy),(mcx,mcy+pr),(mcx-pr,mcy)],outline=_hc,width=7)
    for q0 in range(4):
        d.arc([mcx-27,mcy-27,mcx+27,mcy+27],_ang+q0*90-18,_ang+q0*90+18,fill=_hc,width=7)
    for ddx,ddy in ((1,0),(-1,0),(0,1),(0,-1)):
        d.line([(mcx+ddx*33,mcy+ddy*33),(mcx+ddx*47,mcy+ddy*47)],fill=_hc,width=6)
    d.polygon([(mcx,mcy-pr),(mcx+pr,mcy),(mcx,mcy+pr),(mcx-pr,mcy)],outline=RETC,width=3)
    d.ellipse([mcx-2,mcy-2,mcx+2,mcy+2],fill=RETC)
    for q0 in range(4):
        d.arc([mcx-26,mcy-26,mcx+26,mcy+26],_ang+q0*90-16,_ang+q0*90+16,fill=RETL,width=3)
    for ddx,ddy in ((1,0),(-1,0),(0,1),(0,-1)):
        d.line([(mcx+ddx*34,mcy+ddy*34),(mcx+ddx*46,mcy+ddy*46)],fill=RETL,width=2)
    for _o in ((-1,0),(1,0),(0,-1),(0,1)): d.text((mcx+34+_o[0],mcy-46+_o[1]),"TGT",font=FTT,fill=(8,12,14))
    d.text((mcx+34,mcy-46),"TGT",font=FTT,fill=RETL)
    # SİNYAL KAYBI (deniz/yol-dışı güçlü sapma): genişleyen ARAMA halkası -> "re-acquiring" hissi (dandik değil)
    if _wk>0.7:
        _sp=(t*2.0)%1.0; _sr=int(26+_sp*48)
        d.ellipse([mcx-_sr,mcy-_sr,mcx+_sr,mcy+_sr],outline=(RED[0],RED[1],RED[2],int(165*(1-_sp))),width=2)
    # SİNYAL BOZULMASI: sinyal zayıf noktada statik (şiddeti _wk ile orantılı), sonra düzelir
    _dg=_wk>0.4
    for g0,g1 in DEGR:
        if g0<=t<g1: _dg=True
    if _dg:
        # ÇOK HAFİF karıncalanma (sadece opaklık) — ekran KAYMAZ/SALLANMAZ. LOST'ta biraz daha statik (yine sallanmaz).
        _gs=44 if _wk<0.7 else 60
        nz=_snoise(W,H,_gs,3).convert("L")
        _go=min(0.10,0.05+0.11*_wk) if _wk<0.7 else min(0.16,0.09+0.11*_wk)
        fr=Image.blend(fr,Image.merge("RGB",(nz,nz,nz)),_go)
        d=ImageDraw.Draw(fr,"RGBA")
    # SİNYAL DURUMU (kademeli/inandırıcı): REACQUIRED(yeşil) > LOST/RESCANNING(kırmızı, deniz/sapma) > WEAK(amber)
    # ADAPTİF KONUM: reticle sağ yarıdaysa metni SOLA yaz (kenarda kırpılmaz)
    def _sigtxt(_tt,_cl):
        _tw=FTT.getlength(_tt)
        _tx=mcx+38 if (mcx+38+_tw)<(W-16) else mcx-38-_tw
        glow(d,(int(max(8,_tx)),mcy+16),_tt,FTT,col=_cl)
    if _reacq[i] and int(t*5)%2:
        _sigtxt("SIGNAL REACQUIRED · LOCK",(120,255,150))
    elif _wk>0.7:
        if int(t*6)%2: _sigtxt("SIGNAL LOST · RESCANNING",RED)
    elif _wk>0.35:
        _sigtxt("SIGNAL WEAK · SCANNING",AMB)
    # SÜREKLİ KONUM ETİKETİ: nerede olduğun HEP belli (şehir); şehir görünümü/yakınlaşınca ŞEHİR · MAHALLE;
    # yeni şehre girişte kısa VURGU (parlar). Barış: "Malatya üzerinden geçince Malatya yazsın, yakınlaşınca mahalle."
    _cc=_LOC_city[i] if i<len(_LOC_city) else ""
    if _cc:
        _hh=_LOC_hood[i] if i<len(_LOC_hood) else ""
        _zc=(_zenv[i] if i<len(_zenv) else 0.0)
        _lbl=_cc
        if ((not _FILM) or _zc>0.5) and _hh and _hh!=_cc: _lbl=_cc+" · "+_hh
        _prog=i/max(1,N-1); _pulse=0.0
        for _pf,_pn in PLACES:
            if abs(_prog-_pf)<0.028: _pulse=max(_pulse,1.0-abs(_prog-_pf)/0.028)
        _lw=int(FTT.getlength(_lbl))+46; _lx=W//2-_lw//2; _ly=max(int(H*0.112),118)   # compass'ın ALTINDA (çakışma yok)
        _bx=Image.new("RGBA",(W,H),(0,0,0,0)); _bd=ImageDraw.Draw(_bx)
        _bd.rectangle([_lx,_ly,_lx+_lw,_ly+30],fill=(int(5+22*_pulse),int(16+42*_pulse),int(20+30*_pulse),int(180+55*_pulse)))
        _bd.ellipse([_lx+11,_ly+11,_lx+19,_ly+19],outline=(HUDA[0],HUDA[1],HUDA[2],255),width=2)
        _bd.ellipse([_lx+13,_ly+13,_lx+17,_ly+17],fill=(HUDA[0],HUDA[1],HUDA[2],int(180+75*_pulse)))
        _bd.text((_lx+28,_ly+7),_lbl,font=FTT,fill=(int(200+55*_pulse),int(238+17*_pulse),235,255))
        fr=Image.alpha_composite(fr.convert("RGBA"),_bx).convert("RGB"); d=ImageDraw.Draw(fr,"RGBA")
    # KİLOMETRE TAŞI: her 50km geçişinde ~1sn flaş (yol kat edildikçe dönüm noktası hissi)
    _km=DTOT[i]; _pkm=DTOT[max(0,i-1)]
    _mk=int(_km/50)*50
    if _mk>0 and (_km-_mk)<max(0.05,(_km-_pkm))*30:      # geçişten sonra ~30 kare (~1sn) görünür
        _kms=f"{_mk} KM"
        _bw2=FB.getlength(_kms); _bx2=int(W//2-_bw2//2)
        d.rectangle([_bx2-22,int(H*0.205),_bx2+_bw2+22,int(H*0.205)+58],fill=(6,16,20,205))
        glow(d,(_bx2,int(H*0.21)),_kms,FB,col=(255,220,120))
    # HUD üst bar
    d.rectangle([0,0,W,64],fill=(4,10,14,205))
    glow(d,(40,20),"MLOG SATCOM",FTT)
    if _divp>0.6 and int(t*3)%2==0:
        _zt="NIGHT VISION" if _NV_CUR>0.4 else "ZOOM ENHANCE"; _zw=int(FS.getlength(_zt)/2)   # NV yazısı sadece gerçekten açılınca (şehir)
        glow(d,(W//2-_zw,int(H*0.30)),_zt,FS,col=AMB)
    if ORIG_DEST[0] and ORIG_DEST[1]:
        d.text((W//2-160,20),f"{ORIG_DEST[0][:11]} -> {ORIG_DEST[1][:11]}",font=FTT,fill=AMB)
    else: d.text((W//2-70,20),"TRACKING · LIVE",font=FTT,fill=AMB)
    if int(t*2)%2: d.ellipse([W-150,20,W-130,40],fill=RED); d.text((W-120,20),"REC",font=FTT,fill=RETC)
    # PUSULA BANDI: üst barın altında ince şerit (gerçek course)
    hd=CRS[i]%360
    d.rectangle([W//2-260,66,W//2+260,100],fill=(4,10,14,170))
    for dd in range(-60,61,15):
        az=(hd+dd)%360
        xx=W//2+dd*4.2
        if az%90<7.5 or az%90>82.5:
            lbl="NESW"[int(((az+45)%360)//90)]
            d.text((xx-6,70),lbl,font=FS,fill=WHITE)
        else:
            d.line([(xx,84),(xx,96)],fill=GRAY,width=2)
    d.polygon([(W//2,64),(W//2-6,74),(W//2+6,74)],fill=AMB)
    d.text((W//2-24,102),f"{hd:03.0f}°",font=FTT,fill=AMB)
    # CONFIRMED zirve-hız vurgusu: en hızlı an ±0.8sn -> merkez-üst banner + reticle doğrulama halkası
    _pkd=abs(i-_vpk_i)
    if _vpk_kmh>=15 and _pkd<_PKW:
        _pa=1.0-_pkd/float(_PKW)                    # merkeze doğru güçlenir (fade in/out)
        _pt="TARGET CONFIRMED"
        _ptw=FM.getlength(_pt); _pgap=30            # metin öncesi elmas için boşluk
        _pcx=int(W//2-(_ptw+_pgap)//2); _pbx=_pcx+_pgap; _pby=int(H*0.135)
        _al=int(215*_pa)
        d.rectangle([_pcx-26,_pby-10,_pbx+_ptw+26,_pby+48],fill=(10,20,16,int(200*_pa)))
        d.rectangle([_pcx-26,_pby-10,_pcx-20,_pby+48],fill=(HUDA[0],HUDA[1],HUDA[2],_al))   # sol accent bar
        _dcy=_pby+24; _dr=9                          # dolu elmas işaret (font-bağımsız, ◉ yerine)
        d.polygon([(_pcx,_dcy-_dr),(_pcx+_dr,_dcy),(_pcx,_dcy+_dr),(_pcx-_dr,_dcy)],fill=(HUDA[0],HUDA[1],HUDA[2],max(80,_al)))
        for _o in ((-2,0),(2,0),(0,-2),(0,2)): d.text((_pbx+_o[0],_pby+_o[1]),_pt,font=FM,fill=(6,12,10))
        d.text((_pbx,_pby),_pt,font=FM,fill=(HUDA[0],HUDA[1],HUDA[2],max(70,_al)))
        _lr=int(30+(1-_pa)*42)                      # genişleyen doğrulama halkası (lock)
        d.ellipse([mcx-_lr,mcy-_lr,mcx+_lr,mcy+_lr],outline=(HUDA[0],HUDA[1],HUDA[2],int(205*_pa)),width=3)
    # HUD alt: hız / mesafe / koordinat
    d.rectangle([0,H-150,W,H],fill=(4,10,14,205))
    # UZUN ROTA: yolculuk ilerleme çubuğu (nerede olduğun + ne kadar kaldığı SÜREKLİ belli)
    if PLACES and DTOT[-1]>0:
        _pgr=min(1.0,DTOT[i]/max(0.1,DTOT[-1]))
        d.rectangle([0,H-156,W,H-150],fill=(8,24,26,230))
        d.rectangle([0,H-156,int(W*_pgr),H-150],fill=HUDA)
        for _tk in range(1,10):
            _tx=int(W*_tk/10); d.line([(_tx,H-156),(_tx,H-150)],fill=(4,10,14),width=2)
    glow(d,(60,H-130),f"{SPD[i]:5.0f} KM/H",FM,white=True)
    glow(d,(W//2-90,H-130),f"{DTOT[i]:4.2f} KM",FM)
    d.text((W-400,H-130),mgrs(LATS[i],LONS[i]),font=FTT,fill=GRAY)
    d.text((60,H-84),"FEED 01 · SAT",font=FTT,fill=DIM)
    d.text((W-300,H-84),f"T+{int(t//60):02d}:{int(t%60):02d}",font=FTT,fill=GRAY)
    # OLAY GÜNLÜĞÜ: son 3 satır, en yenisi daktilo (sol, alt HUD'un üstünde)
    _vis=[e for e in EVENTS if e[0]<=t]
    if _vis:
        _v3=_vis[-3:]
        yy0=H-150-30*len(_v3)-14
        for k,(et,tx) in enumerate(_v3):
            if k==len(_v3)-1:
                nch=int((t-et)/0.024); tx=tx[:nch]
            d.text((60,yy0+k*30),tx,font=FTT,fill=(120,200,185) if k==len(_v3)-1 else (80,130,122))
    # ASKERİ KADRAJ KÖŞELERİ: sadece ÜST-2 taktik L-braketi (alt köşeleri olay-günlüğü+minimap+konsol barı zaten çerçeveler)
    _cbc=(HUDA[0],HUDA[1],HUDA[2],225); _cbt=(90,150,140,170); _CAM=52; _CAL=46
    for _cx,_cy in ((_CAM,124),(W-_CAM,124)):
        _sx=1 if _cx<W//2 else -1
        d.line([(_cx,_cy),(_cx+_sx*_CAL,_cy)],fill=_cbc,width=3)                       # yatay kol
        d.line([(_cx,_cy),(_cx,_cy+_CAL)],fill=_cbc,width=3)                           # dikey kol (aşağı)
        d.line([(_cx+_sx*15,_cy+15),(_cx+_sx*30,_cy+15)],fill=_cbt,width=1)            # iç tick (yatay)
        d.line([(_cx+_sx*15,_cy+15),(_cx+_sx*15,_cy+30)],fill=_cbt,width=1)            # iç tick (dikey)
    # üst/alt konsol accent çizgileri (taktik çerçeve kenarı)
    d.line([(0,64),(W,64)],fill=(HUDA[0],HUDA[1],HUDA[2],150),width=2)
    d.line([(0,H-150),(W,H-150)],fill=(HUDA[0],HUDA[1],HUDA[2],130),width=2)
    if AVMINI is not None:
        _mal=int(255*(0.62+0.10*math.sin(t*3.1)))
        _mo=Image.new("RGBA",(W,H),(0,0,0,0))
        _mo.paste(AVMINI.convert("RGBA"),(W-188,H-150-235))
        _md=ImageDraw.Draw(_mo)
        _md.rectangle([W-190,H-390,W-54,H-223],outline=(HUDA[0],HUDA[1],HUDA[2],235),width=3)
        _ma=_mo.getchannel("A").point(lambda v:int(v*_mal/255))
        _mo.putalpha(_ma)
        fr.paste(_mo,(0,0),_mo)
    fr.save(f"{OUT}/f{i:05d}.jpg",quality=93)
# OUTRO SÜREKLİLİĞİ: SON kareyi işleyen (son chunk VEYA sequential) yazar (mcy/fr = N-1 karesinden)
if _CHUNK_END==N:
    try:
        _coslatf=math.cos(sum(la)/len(la)*math.pi/180)
        if _FILM:
            _zf=_stepz(_zenv[N-1],4); _winf=_WIN_OVER*(1.0-_zf)+_WIN_STREET*_zf   # v4 son pencere (m)
        else:
            _winf=VIEWW*MPU/s                                                     # kısa rota son pencere (m)
        _oz0f=max(7.0,min(16.8,math.log2(max(1.0,156543.03392*_coslatf*720.0/max(50.0,_winf)))))
        # SON KARE hedef konumu: route hareket halinde bitiyor -> outro route'un BIRAKTIĞI yerde donsun
        if _FILM:
            _olatf=LATS[N-1]; _olonf=LONS[N-1]                                    # _FILM: imagery merkezi = hedef
        else:
            _mxf=cx+(X[N-1]-BW/2)/s; _myf=cy-(Y[N-1]-BH/2)/s; _olonf,_olatf=inv(_mxf,_myf)   # marker piksel -> lat/lon
        json.dump({"oz0":round(_oz0f,2),"win":round(_winf,1),"yf":round(max(0.15,min(0.85,mcy/float(H))),3),
                   "olat":round(_olatf,7),"olon":round(_olonf,7)}, open(f"{SC}/route_end.json","w"))
    except Exception:
        pass
if _child:
    # CHUNK çocuğu: kendi menzilinin thermal cue'larını yaz -> parent birleştirir. zoom/city cue'larını parent yazar.
    try: json.dump(_therm_cues, open(f"{SC}/thermal_cues_{_CHUNK_START}.json","w"))
    except Exception: pass
    sys.exit(0)
# SEQUENTIAL (TAC_CHUNKS=1): cue'ları doğrudan yaz (eski davranış)
_finalize_cues(_therm_cues)
try:
    if _TILEDBG: json.dump(_TILELOG, open(f"{SC}/tiledbg.json","w"))
except Exception: pass
try:
    _tt=_TEKSAY[0]+_COKSAY[0]
    if _tt: print(f"TEK HARİTA: kareler %{100.0*_TEKSAY[0]/_tt:.1f} tek karodan kırpıldı "
                  f"(çok-karo yedeği {_COKSAY[0]}/{_tt}) — dikiş/yarım şehir yok", flush=True)
except Exception: pass
print(f"TAKTİK ROTA {N} kare OK")
