#!/usr/bin/env python3
# v7: GERÇEK KÜRE DÜNYA (ortografik projeksiyon, döner) + oran-koruyucu kırpma (elastik bug fix)
# + yavaş arayış dönüşü + hızlı snap zoom'lar + CoD HUD (v6 dili). Fade yok; tek istisna final oturuş.
import os, math, random, urllib.request, io, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
random.seed(23)
SC=os.environ.get("TAC_WORKDIR", os.path.dirname(os.path.abspath(__file__))+"/work")
OUT=f"{SC}/sm8frames"; os.makedirs(OUT, exist_ok=True)
for o in os.listdir(OUT): os.remove(f"{OUT}/{o}")
MB=[l.split('=',1)[1].strip() for l in open('/opt/matrix/secrets/mapbox.conf') if l.startswith('MAPBOX_PUBLIC_TOKEN=')][0]
# TAŞIMA (RunPod, 2026-08-30): harita taban ucu env'den; varsayılan = bugünkü yerel proxy (davranış birebir).
_HT=os.environ.get("HARITA_TABAN","http://127.0.0.1:8890").rstrip("/")
_H_STATIK=os.environ.get("HARITA_STATIK",_HT).rstrip("/")
LAT=float(os.environ.get("TAC_LAT","40.99038")); LON=float(os.environ.get("TAC_LON","37.87437"))
W=int(os.environ.get("TAC_W","1080")); H=int(os.environ.get("TAC_H","1920")); FPS=30
TEAL=(120,235,235); DIM=(70,150,155); WHITE=(240,255,250); GRN=(120,255,150); RED=(255,120,120); AMB=(255,190,90)
CODE=os.environ.get("VIDCODE","NINE ONE THREE TWO")
_FDIR=os.path.dirname(os.path.abspath(__file__))+"/fonts"   # ASKERİ/TAKTİK HUD fontu (Chakra Petch)
def F(s): return ImageFont.truetype(_FDIR+"/ChakraPetch-SemiBold.ttf", s)
def FBD(s): return ImageFont.truetype(_FDIR+"/ChakraPetch-Bold.ttf", s)
def FST(s): return ImageFont.truetype(_FDIR+"/BlackOpsOne-Regular.ttf", s)   # stencil — sadece dev hero başlık
FB,FM,FS,FT,FTT=FBD(42),F(31),F(23),F(19),F(16)
# >>>KARO-FIKSI-STATIK (2026-08-31, Barış onaylı): tek statik istek 50 sn'de dönmezse ya da 5xx
# gelirse ESKİDEN istisna fırlıyor/eksik mozaik dönüyordu -> intro/outro karelerinde dikdörtgen
# yamalar (kanıt: kaynak görüntü tertemiz, videoda yama VAR; ilk çekim 90 sn'de tamamlanamadı).
# Davranış değişmiyor: aynı URL, aynı sonuç — yalnız geçici hatada 3 kez yeniden denenir.
def _statik_getir(u, _bekle=(0.5, 1.5, 3.0), _timeout=90):
    import time as _t, urllib.error as _ue
    _son = None
    for _i in range(len(_bekle) + 1):
        try:
            return urllib.request.urlopen(u, timeout=_timeout).read()
        except _ue.HTTPError as e:
            if e.code in (400, 403, 404):      # kalıcı: ısrar etme
                raise
            _son = e
        except Exception as e:
            _son = e
        if _i < len(_bekle):
            _t.sleep(_bekle[_i])
    raise RuntimeError(f"statik karo alinamadi ({_son}): {u[:80]}")
# <<<KARO-FIKSI-STATIK
def sat(lon,lat,z):
    u=f"{_H_STATIK}/styles/v1/mapbox/satellite-v9/static/{lon},{lat},{z},0/1280x1280@2x?access_token={MB}"
    return Image.open(io.BytesIO(_statik_getir(u))).convert("RGB")
print("varlıklar...")
import json as _json
CITIES=_json.loads(os.environ["TAC_CITIES"]) if os.environ.get("TAC_CITIES") else [("NEW YORK",-74.0,40.71),("LONDON",-0.12,51.5),("TOKYO",139.69,35.68)]
CITIES=[tuple(c) for c in CITIES]
CTILE={n:sat(lo,la,9) for n,lo,la in CITIES}
CTILE2={n:sat(lo,la,13) for n,lo,la in CITIES}   # SOKAK seviyesi z13: iyice yakın (bina blokları)
OWN15=sat(LON,LAT,15)                             # FINAL: tam sokak görünümü karosu
OWN16=sat(LON,LAT,16); OWN17=sat(LON,LAT,17)  # EN DİP: bina/araç seviyesi (rota ile birleşme)
ROUTE1=Image.open(f"{SC}/route_first.jpg").convert("RGB").resize((W,H))  # rota videosu ilk karesi (geçiş)
_avp=os.environ.get("AVATAR","")
if _avp and os.path.exists(_avp):
    _a=Image.open(_avp).convert("RGB")
    _tw=min(_a.width,int(_a.height*0.8)); _th=int(_tw/0.8)   # 4:5 merkez-kırp
    AVIMG=_a.crop(((_a.width-_tw)//2,(_a.height-_th)//2,(_a.width+_tw)//2,(_a.height+_th)//2)).resize((300,375),Image.LANCZOS)
    from PIL import ImageEnhance
    AVIMG=ImageEnhance.Color(AVIMG).enhance(0.50)         # operasyonel: soluk renk
    AVIMG=ImageEnhance.Brightness(AVIMG).enhance(0.80)    # hafif karanlık
    AVIMG=ImageEnhance.Contrast(AVIMG).enhance(1.18)
    AVIMG=Image.blend(AVIMG,Image.new("RGB",AVIMG.size,(66,104,104)),0.18)   # teal ton
    _sc2=Image.new("RGBA",AVIMG.size,(0,0,0,0)); _sd2=ImageDraw.Draw(_sc2)
    for _yy in range(0,375,3): _sd2.line([(0,_yy),(300,_yy)],fill=(0,0,0,42))
    AVIMG.paste(_sc2,(0,0),_sc2)
else:
    AVIMG=Image.new("RGB",(300,375),(26,34,40))
    _d=ImageDraw.Draw(AVIMG)
    _d.ellipse([95,95,205,205],fill=(118,130,138))          # kafa
    _d.ellipse([55,225,245,375],fill=(118,130,138))         # omuzlar

WZ=1.5; WCLON,WCLAT=32.0,28.0
# BOŞLUKSUZ BULUT HARİTASI (NASA Blue Marble, statik — kara delik/veri-yok İMKANSIZ)
def _grade_clouds():
    from PIL import ImageEnhance as _IE, ImageChops as _IC
    _cp=os.path.dirname(os.path.abspath(__file__))+"/assets/clouds_global.jpg"
    cl=Image.open(_cp).convert("L")                       # beyaz bulutlar, gapsız
    bw,bh=cl.size
    base=Image.new("RGB",(bw,bh),(10,20,34))             # koyu-mavi dünya tabanı (uzay hissi)
    base=_IE.Brightness(base).enhance(1.0)
    _c=cl.point(lambda v:int(min(255,v*1.15)))
    clr=Image.merge("RGB",(_c,_c,Image.eval(_c,lambda v:min(255,int(v*1.08)))))
    g=_IC.screen(base,Image.eval(clr,lambda v:int(v*0.9)))   # parlak bulutlar
    steel=Image.new("RGB",(bw,bh),(150,168,205))
    g=Image.blend(g,_IC.multiply(g,steel),0.28)
    return g
_WMODE="plate"
try:
    WORLD=_grade_clouds()
except Exception:
    WORLD=_satcom(sat(WCLON,WCLAT,WZ)); _WMODE="merc"   # yedek: Mapbox + prosedürel
SWM=1024*(2**WZ)
def _mercy(lat): return math.log(math.tan(math.pi/4+math.radians(lat)/2))/(2*math.pi)
def wpix(lon,lat):
    iw,ih=WORLD.size
    if _WMODE=="plate":                       # VIIRS küresel: linear lon/lat
        return (lon+180.0)/360.0*iw, (90.0-lat)/180.0*ih
    return iw/2+(lon-WCLON)*SWM/360.0, ih/2+(_mercy(WCLAT)-_mercy(lat))*SWM
ZL=[4,6,8,10,12,13]; LV=[sat(LON,LAT,z) for z in ZL]
# YANLIŞ BÖLGELER (otonom+rastgele): hedeften uzak iki bölge — her render farklı yönde
_ws=random.Random()
_wa1=_ws.uniform(0,2*math.pi); _wa2=_wa1+_ws.uniform(1.7,2.7)
TRFAR=sat(LON+4.2*math.cos(_wa1), max(-70,min(70,LAT+3.2*math.sin(_wa1))), 5)
TRMID=sat(LON+1.7*math.cos(_wa2), max(-72,min(72,LAT+1.3*math.sin(_wa2))), 6)
# CoD ek varlıklar: şehir landmark fotoğrafları (Commons) + araç tel-kafes kartı
LM={}
LMNAME=_json.loads(os.environ.get("TAC_LMNAME","{}"))
for _n in CITIES:
    _k=_n[0].split()[0].lower()
    try: LM[_n[0]]=Image.open(f"{SC}/lm_{_k}.jpg").convert("RGB")
    except Exception: pass
ACTTYPE=os.environ.get("ACTTYPE","moto")
TACNAME=os.environ.get("TAC_NAME","BARIS").upper()[:14]
TACCITY=os.environ.get("TAC_CITY","ALTINORDU, ORDU").upper()[:24]
print("çekildi.")
# --- oran-koruyucu kırpma (ELASTİK BUG FİX: pencere görüntüye sığmazsa ORANI koruyarak küçült) ---
def cropat(img,cx,cy,zwin):
    iw,ih=img.size
    tw=int(iw/max(1.02,zwin)); th=int(tw*H/W)
    if th>ih:                                   # taşma -> oranı KORU (ezme yok)
        th=ih; tw=int(th*W/H)
    cx=max(tw//2,min(iw-tw//2,int(cx))); cy=max(th//2,min(ih-th//2,int(cy)))
    return img.crop((cx-tw//2,cy-th//2,cx+tw//2,cy+th//2)).resize((W,H),Image.LANCZOS)
def crop(img,z): iw,ih=img.size; return cropat(img,iw//2,ih//2,z)
_VIG=Image.new("L",(W,H),0); ImageDraw.Draw(_VIG).ellipse([-W*.35,-H*.18,W*1.35,H*1.18],fill=255); _VIG=_VIG.filter(ImageFilter.GaussianBlur(200))
_SCANL=Image.new("RGBA",(W,H),(0,0,0,0)); sd=ImageDraw.Draw(_SCANL)
for _y in range(0,H,3): sd.line([(0,_y),(W,_y)],fill=(0,0,0,32))
_DARK=Image.new("RGB",(W,H),(3,8,14))
from PIL import ImageEnhance
_NIGHT=max(0.0,min(1.0,float(os.environ.get("TAC_NIGHT","0"))))   # sürüş başlangıcı gece faktörü (route ile tutarlı)
def grade(im,ca=3,bright=1.3):
    # CoD tarzı: PARLAK + CANLI + kontrast; grilik yok. Üstüne hafif gren + zarif köşe vinyeti.
    im=ImageEnhance.Brightness(im).enhance(min(1.30,bright))
    im=ImageEnhance.Color(im).enhance(1.18)
    im=ImageEnhance.Contrast(im).enhance(1.08)
    off=ImageChops.offset(im,ca,0)
    im=Image.blend(im,off,.18)
    dark=Image.composite(im,_DARK,_VIG)
    im=Image.blend(im,dark,0.18)                 # çok hafif kenar vinyeti
    if _NIGHT>0.08:                              # GECE SÜRÜŞÜ: intro'yu KARART + soğuk ay-ışığı tonu -> route darknight'ıyla eşleş (ani zıplama YOK)
        _ni=ImageEnhance.Brightness(im).enhance(1.0-0.66*_NIGHT)    # KARART (güçlendirildi 0.55->0.66)
        _ni=ImageEnhance.Color(_ni).enhance(1.0-0.42*_NIGHT)        # doygunluk düşür
        _r,_g,_b=_ni.split()                                        # soğuk mavi-yeşil gece tonu (ay ışığı)
        _r=_r.point(lambda v:int(v*(1.0-0.32*_NIGHT)))
        _b=_b.point(lambda v:int(min(255,v*(1.0+0.12*_NIGHT))))
        _ni=Image.merge("RGB",(_r,_g,_b))
        im=Image.blend(im,_ni,min(1.0,_NIGHT*1.1))                  # yüksek gecede neredeyse tam karanlık versiyona geç
    im.paste(_SCANL,(0,0),_SCANL)
    n=Image.effect_noise((W,H),20).convert("L").point(lambda v:(v-118)//6 if v>118 else 0)
    return ImageChops.add(im,Image.merge("RGB",(n,n,n)))   # ince gren (görüntüyü KARARTMAZ)
def jitrot(im,t):
    fr=int(t*30); rnd=random.Random(fr)
    ang=math.sin(t*0.35)*1.2
    im=im.rotate(ang,resample=Image.BILINEAR,expand=False)
    if rnd.random()<0.28: im=ImageChops.offset(im,rnd.randint(-3,3),rnd.randint(-2,2))
    return im
def corners(d,cx,cy,s,col=TEAL):
    # CoD reticle: KÜÇÜK, İNCE, SOLUK — kalın cafcaflı değil
    s=int(s*0.52)
    cmap={RED:(255,150,140,165),GRN:(150,255,170,165),AMB:(255,200,130,165),TEAL:(210,222,225,150)}
    c=cmap.get(col,(210,222,225,150))
    for dx,dy in [(-1,-1),(1,-1),(-1,1),(1,1)]:
        x,y=cx+dx*s,cy+dy*s
        d.line([(x,y),(x-dx*15,y)],fill=c,width=2); d.line([(x,y),(x,y-dy*15)],fill=c,width=2)
    d.ellipse([cx-2,cy-2,cx+2,cy+2],outline=(c[0],c[1],c[2],130),width=1)
def glow(d,xy,txt,font,col=(150,255,235),white=False):
    x,y=xy
    for ox,oy in ((-2,0),(2,0),(0,-2),(0,2)): d.text((x+ox,y+oy),txt,font=font,fill=(20,90,85))
    d.text((x,y),txt,font=font,fill=(240,255,250) if white else col)
def topbar(d,label,prog,alt):
    prog=max(0.0,min(1.0,prog)); y=64
    d.ellipse([56,y+2,80,y+26],outline=(180,190,195),width=2); d.ellipse([64,y+10,72,y+18],fill=(150,255,235))
    bx=96
    for lab,wd in (("CHANNEL",112),("SELECT",100),("ENCODING KEY",158),("FILTERS",108),("SPEED",92)):
        d.rectangle([bx,y,bx+wd,y+26],outline=(120,130,135),width=1)
        d.text((bx+8,y+6),lab,font=FTT,fill=(200,210,212)); bx+=wd+10
    d.text((bx+4,y-2),"[",font=FM,fill=(180,190,195)); d.text((bx+34,y+6),f"{int(prog*100):02d}%",font=FTT,fill=(150,255,235)); d.text((bx+86,y-2),"]",font=FM,fill=(180,190,195))
    glow(d,(96,y+36),"CORE SYSTEM",FTT)
    d.text((300,y+36),f"{label}",font=FTT,fill=(170,180,185))
    d.text((W-230,y+36),f"ALT {alt:05d} KM",font=FTT,fill=(170,180,185))
_ENV=json.load(open(f"{SC}/voice_env.json"))
def botbar(d,txt,t):
    fr=int(t*30); rnd=random.Random(fr//2)
    d.text((60,H-176),"MLOG SYSTEM 3/8",font=FTT,fill=(170,180,185))
    d.text((W-330,H-176),txt[:26],font=FTT,fill=(150,255,235))
    Nn=54; bw=(W-140)/Nn; base=H-128; maxh=34
    for k in range(Nn):
        i=fr-(Nn-1-k); a=_ENV[i] if 0<=i<len(_ENV) else 0.0
        h=max(2,int(a*maxh)); x=70+k*bw
        d.rectangle([x,base-h,x+bw*0.6,base+h],fill=(150,255,235) if a>0.06 else (60,105,108))

def briefpanel(d,fr,t):
    by=int(H*0.705); pnl=Image.new("RGBA",(W,H),(0,0,0,0)); ImageDraw.Draw(pnl).rectangle([50,by-28,W-50,by+300],fill=(6,20,26,140),outline=TEAL,width=2); fr.paste(pnl,(0,0),pnl)
    d.text((80,by),"// PRIORITY TRANSMISSION //",font=FS,fill=TEAL)
    # KONUŞMA SENKRONU: her satır telsizde TAM söylendiği anda belirir
    if t>TLA:  d.text((80,by+42),f"AUTH CODE : {CODE}",font=FM,fill=WHITE)     # "Nine one three two"
    if t>TLC+0.05: d.text((80,by+88),f"TARGET    : {TACNAME}",font=FM,fill=TEAL)       # "Callsign Baris"
    if t>TLC+1.25: d.text((80,by+126),f"TYPE      : {'MOTORCYCLE' if ACTTYPE!='car' else 'CAR'}",font=FM,fill=TEAL) # "operating a motorcycle"
    if t>TLC+2.05: d.text((80,by+164),"LAST KNOWN: 40.98N 37.87E",font=FTT,fill=DIM)
    if t>TLO: d.text((80,by+202),"ORDER     : TRACK & MAINTAIN VISUAL",font=FS,fill=AMB)  # "Track the vehicle..."
def sm(a): return max(0.0,min(1.0,a))**2*(3-2*max(0.0,min(1.0,a)))
def wander(seed,q,K=5):
    """Gerçek arama deseni: rastgele noktalara git -> DUR/incele -> sonrakine atla. (-1..1,-1..1) döner."""
    rnd=random.Random(seed)
    wp=[(rnd.uniform(-1,1),rnd.uniform(-1,1)) for _ in range(K)]
    seg=max(0.0,min(0.999,q))*(K-1); i=int(seg); f=seg-i
    f2=min(1.0,f/0.55)                          # hareket legin ilk %55'inde, gerisi DUR-incele
    e=f2*f2*(3-2*f2)
    return wp[i][0]+(wp[i+1][0]-wp[i][0])*e, wp[i][1]+(wp[i+1][1]-wp[i][1])*e
def fastout(a): a=max(0.0,min(1.0,a)); return 1-(1-a)**3

# ZAMAN: BOOT 0-2 | TUR 2-16.5 (küre dönüşü YAVAŞ + şehre SNAP dip) | TR 16.5-17.5 | LOC 17.5-18.9 | LOCK 18.9-20.1 | İNİŞ 20.1-24 (REC 22.4)
# DİNAMİK ZAMAN: konuşma ASLA sıkıştırılmaz — brifing uzarsa TOUR uzar, dengeyi rota süresi öder
BOOT=float(os.environ.get("TAC_BOOT","5.5"))   # 1dk optimizasyonu: boot animasyonu kısalır (ses erken başlar)
_T1=float(os.environ.get("TAC_TOUREND","20.0"))
# KİLİT SEKANSI UZUNLUĞU (Barış 2026-08-05, 1dk için): eskiden 11.0 SABİTTİ; render_job'da
# küçültmek işe yaramıyordu çünkü intro_gen yine 11.0 basıyordu. Artık env'den geliyor ve
# alt fazlar aynı oranda ölçekleniyor -> sekans kısalır ama İÇ DÜZENİ bozulmaz.
# ⚠️ Ses çapaları (mc_scan/located/locked/moving) render_job'da AYNI oranla ölçeklenir; ikisi
# birlikte değişmezse ses görüntüden kayar. Uzun mod env göndermez -> 11.0'de kalır.
_LSQ=float(os.environ.get("TAC_LOCKSEQ","") or 11.0)
_k=_LSQ/11.0
TOUR=(BOOT,_T1); TRPAN=(_T1,_T1+0.8*_k); OWNS=(_T1+0.8*_k,_T1+4.2*_k); LOC=(_T1+4.2*_k,_T1+5.4*_k)
PINP=(_T1+5.4*_k,_T1+6.9*_k); LOCK=(_T1+6.9*_k,_T1+7.5*_k); MOVE=(_T1+7.5*_k,_T1+_LSQ)
TOTAL=_T1+_LSQ; REC=TOTAL-1.6
TLC=float(os.environ.get("TL_CALLSIGN","14.7")); TLA=float(os.environ.get("TL_AUTH","5.6")); TLO=float(os.environ.get("TL_ORDER","17.25"))
BRIEF_END=float(os.environ.get("TL_BRIEFEND","19.6")); N=int(FPS*TOTAL)
_CALLSIGN=(os.environ.get("TAC_CALLSIGN","").strip() or "ACTUAL").upper()[:16]   # kişisel operatör çağrı işareti
NC=len(CITIES); SEG=(_T1-BOOT)/NC   # tur penceresine (BOOT..TOUR1) göre ADAPTİF (3dk'da eskiyle birebir; 1dk'da kısa tur doğru dağılır)
CUTS=[]
for c in range(NC): CUTS+=[TOUR[0]+c*SEG, TOUR[0]+c*SEG+0.85, TOUR[0]+c*SEG+2.72, TOUR[0]+c*SEG+3.20]
CUTS+=[TRPAN[0]+0.62, OWNS[0]+ (OWNS[1]-OWNS[0])*0.5, LOC[0], PINP[0], LOCK[0]]
_DZ=int(os.environ.get("TAC_DIVEZ","17"))
_DSTEPS={13:[5],15:[5,6],16:[5,6,7],17:[5,6,7,8]}.get(_DZ,[5,6,7,8])
_DGAP=3.35*_k/len(_DSTEPS)   # dalış adımları MOVE fazıyla birlikte ölçeklenir (taşmasın)
DESC=[(MOVE[0]+_i*_DGAP,_k) for _i,_k in enumerate(_DSTEPS)]
FINK=_DSTEPS[-1]
CUTS+=[a for a,_ in DESC]
def nearcut(t): return any(abs(t-c)<(0.5/FPS) for c in CUTS)

def tour(t):
    """ŞEHİR SEVİYESİ arayış: şehir üstünde YAVAŞ süzülme (Tokyo gerçekten Tokyo görünür, 1.5sn)
    CUT daha yakına SNAP-inceleme (1.1sn, NO MATCH) CUT sonraki şehir (0.3 nefes)."""
    tt=t-TOUR[0]; ci=min(NC-1,int(tt/SEG)); lp=tt-ci*SEG
    name,clo,cla=CITIES[ci]
    C=CTILE[name]; C2=CTILE2[name]; iw,ih=C2.size
    if lp<0.85:      # YAKLAŞ: z9'da okunur hızlı zoom
        e=fastout(lp/0.85)
        return crop(C,1.10+e*1.30), name, True, False
    if lp<2.72:      # CUT -> ŞEHRİN İÇİ: DAHA YAKIN + rastgele arama kayması (gerçekten arıyor)
        p=(lp-0.85)/1.87
        wx,wy=wander(100+ci,p,K=max(4,int(SEG*1.05)))         # durak sayısı süreye oranlı: uzun kalış=çok nokta
        dx=wx*iw*0.115; dy=wy*ih*0.085
        return cropat(C2, iw/2+dx, ih/2+dy, 1.55+p*0.35), name, True, False
    if lp<3.20:      # CUT -> GERİ ÇEKİL
        p=(lp-2.72)/0.48
        return crop(C,2.30-fastout(p)*1.15), name, True, False
    # DÜNYADA KAYARAK sonraki şehre (ışınlanma YOK)
    p=(lp-3.20)/max(0.01,SEG-3.20)
    nname,nlo,nla=CITIES[min(NC-1,ci+1)]
    x1,y1=wpix(clo,cla); x2,y2=wpix(nlo,nla)
    e=sm(p)
    return cropat(WORLD, x1+(x2-x1)*e, y1+(y2-y1)*e, 4.6+0.5*math.sin(e*math.pi)), "", False, False
TRX_LON=LON
for i in range(N):
    t=i/FPS
    if t<BOOT:
        fr=Image.new("RGB",(W,H),(3,8,14)); d=ImageDraw.Draw(fr,"RGBA"); p=t/BOOT
        d.text((W//2,H*0.30),"MLOG SATCOM",font=FB,fill=TEAL,anchor="mm")
        # LOGIN konsolu: satır satır daktilo (uyduya bağlanma hissi)
        LOGIN=[(0.22,"> ESTABLISHING SATELLITE UPLINK ..."),(0.85,"> UPLINK OK — ORBITAL NODE 7"),
               (1.42,"> AUTHENTICATING OPERATOR ..."),(2.02,"> ENCRYPTION KEY ACCEPTED"),
               (2.55,"> ACCESS GRANTED — WELCOME, "+_CALLSIGN)]
        yy=int(H*0.38)
        for st,txt in LOGIN:
            if t>st:
                nch=int((t-st)/0.024)
                d.text((110,yy),txt[:nch]+("_" if nch<len(txt) and int(t*4)%2 else ""),font=FS,fill=TEAL if st<3.3 else WHITE)
            yy+=44
        d.rectangle([W//2-240,H*0.62,W//2+240,H*0.62+24],outline=DIM,width=2)
        d.rectangle([W//2-236,H*0.62+3,W//2-236+int(468*min(1,p*1.15)),H*0.62+21],fill=TEAL)
        if t>3.0 and int(t*3)%2==0:
            d.text((W//2,H*0.70),"[ SIGNAL LIVE ]",font=FS,fill=GRN,anchor="mm")
        fr.save(f"{OUT}/f{i:05d}.jpg",quality=93); continue
    alt=int(36000*(1-sm(t/TOTAL)))
    if t<TOUR[1]:
        base,hudname,live,isglobe=tour(t)
        fr=grade(jitrot(base,t),3,1.5 if live else 1.3)      # şehir içi daha parlak (net görünür)
        d=ImageDraw.Draw(fr,"RGBA")
        ccx,ccy=W//2,int(H*0.42)
        corners(d,ccx,ccy,150,RED)
        topbar(d,"SCANNING GLOBAL GRID",(t-TOUR[0])/(TOUR[1]-TOUR[0]),alt)
        if live:
            d.text((ccx+120,ccy-34),"[ ]",font=FS,fill=(160,170,175)); glow(d,(ccx+170,ccy-34),hudname,FM,white=True)
            glow(d,(ccx+170,ccy+2),f"{random.randint(0,89)}.{random.randint(100,999)}  {random.randint(0,179)}.{random.randint(100,999)}",FTT)
            d.text((ccx+120,ccy+28),"[ ]",font=FS,fill=(160,170,175)); glow(d,(ccx+170,ccy+28),"NO MATCH",FM,col=(255,140,130))
            # LANDMARK PIP (CoD): incele fazında şehrin ünlü yapısı kısa süre görünür
            _lp2=(t-TOUR[0])-min(NC-1,int((t-TOUR[0])/SEG))*SEG
            _ci2=min(NC-1,int((t-TOUR[0])/SEG))
            _lmw=(SEG*0.17,SEG*0.995) if _ci2==NC-1 else (SEG*0.17,SEG*0.87)   # son şehir: avatar kapandıktan sonra da görünsün
            if _lmw[0]<_lp2<_lmw[1] and hudname in LM and not (TLC-0.1<=t<TLC+2.65):
                # CITY RECON kartı: SOLDA, profil-kartı boyutunda, CoD fade in/out
                _lq=(_lp2-_lmw[0])/(_lmw[1]-_lmw[0])
                _dur=_lmw[1]-_lmw[0]
                if _lp2<_lmw[0]+0.25: _lfa=sm((_lp2-_lmw[0])/0.25)
                elif _lp2>_lmw[1]-0.25: _lfa=sm((_lmw[1]-_lp2)/0.25)
                else: _lfa=1.0
                lm=LM[hudname].copy(); lm.thumbnail((430,530))
                dp0=ImageDraw.Draw(lm,"RGBA")
                _sy=int((_lq*2.4%1.0)*lm.height)                  # gezen tarama çizgisi
                dp0.rectangle([0,_sy-2,lm.width,_sy+2],fill=(150,255,235,120))
                _lx,_ly=66,int(H*0.16)
                _lo=Image.new("RGBA",(W,H),(0,0,0,0))
                _lo.paste(lm.convert("RGBA"),(_lx,_ly))
                dp=ImageDraw.Draw(_lo)
                dp.rectangle([_lx-4,_ly-30,_lx+lm.width+4,_ly-4],fill=(5,16,20,235))
                dp.text((_lx+8,_ly-26),f"CITY RECON · {hudname}",font=FTT,fill=(150,255,235,255))
                dp.rectangle([_lx-4,_ly-4,_lx+lm.width+4,_ly+lm.height+4],outline=(200,210,214,255),width=3)
                dp.rectangle([_lx-4,_ly+lm.height+4,_lx+lm.width+4,_ly+lm.height+52],fill=(5,16,20,235))
                dp.text((_lx+8,_ly+lm.height+12),f"GEO-ANCHOR : {LMNAME.get(hudname,hudname)}",font=FTT,fill=(150,255,235,255))
                if _lq<0.62:
                    dp.text((_lx+8,_ly+lm.height+32),"VERIFYING CITY SIGNATURE ...",font=FTT,fill=(160,175,180,255))
                else:
                    dp.text((_lx+8,_ly+lm.height+32),"CITY CONFIRMED",font=FTT,fill=(120,255,150,255))
                    dp.rectangle([_lx+4,_ly+10,_lx+lm.width-4,_ly+52],outline=(255,110,100,255),width=3)
                    dp.text((_lx+16,_ly+20),"NO TARGET MATCH",font=FS,fill=(255,120,110,255))
                if _lfa<1.0:
                    _la=_lo.getchannel("A").point(lambda v:int(v*_lfa))
                    _lo.putalpha(_la)
                fr.paste(_lo,(0,0),_lo)
        if t<BRIEF_END: briefpanel(d,fr,t)
        botbar(d,"THIS IS "+_CALLSIGN if t<BRIEF_END else "SWEEPING SECTORS...",t)
    elif t<TRPAN[1]:
        p=(t-TRPAN[0])/(TRPAN[1]-TRPAN[0])
        if p<0.60:   # dünyada Türkiye'ye kayış (Tokyo'dan)
            x1,y1=wpix(CITIES[-1][1],CITIES[-1][2]); x2,y2=wpix(LON,LAT)
            e=sm(p/0.60)
            base=cropat(WORLD, x1+(x2-x1)*e, y1+(y2-y1)*e, 4.6+0.5*math.sin(e*math.pi))
        else:        # CUT -> Türkiye bölgesine snap
            base=crop(LV[0],1.02+fastout((p-0.60)/0.40)*1.3)
        fr=grade(jitrot(base,t)); d=ImageDraw.Draw(fr,"RGBA")
        corners(d,W//2,int(H*0.41),135,AMB); topbar(d,"SIGNAL TRACE",1.0,alt)
        glow(d,(W//2+150,int(H*0.41)),"SIGNAL DETECTED",FM,col=AMB)
        botbar(d,"TRACING SIGNAL...",t)
    elif t<OWNS[1]:
        # KENDİ ŞEHRİNDE ARAYIŞ: hemen bulmaz — Ordu bölgesinde ~1.3sn tarama süzülmesi
        p=(t-OWNS[0])/(OWNS[1]-OWNS[0])
        if p<0.45:  # YANLIŞ BÖLGE 1 (rastgele yön, ~400km uzak): hedef ekranda YOK
            q=p/0.45; iw0,ih0=TRFAR.size
            wx,wy=wander(500,q,K=6)
            base=cropat(TRFAR, iw0/2+wx*iw0*0.26, ih0/2+wy*ih0*0.16, 1.30+0.14*abs(wx))
        elif p<0.85: # CUT -> YANLIŞ BÖLGE 2 (farklı yön, ~180km): yaklaştı ama hâlâ değil
            q=(p-0.45)/0.40; iw1,ih1=TRMID.size
            wx,wy=wander(501,q,K=6)
            base=cropat(TRMID, iw1/2+wx*iw1*0.22, ih1/2+wy*ih1*0.13, 1.28+0.13*abs(wy))
        else:        # CUT -> HIZLI süzülüş: hedef bölge kadraja girer -> Located
            q=(p-0.85)/0.15; iw1,ih1=LV[1].size
            wx=-0.55+0.55*sm(q)                                  # batıdan merkeze doğru kayar
            base=cropat(LV[1], iw1/2+wx*iw1*0.20, ih1/2-0.06*ih1*(1-sm(q)), 1.22)
        fr=grade(jitrot(base,t)); d=ImageDraw.Draw(fr,"RGBA")
        corners(d,W//2,int(H*0.42),150,RED); topbar(d,"SCANNING SECTOR",1.0,alt)
        glow(d,(W//2+150,int(H*0.42)),"ACQUIRING TARGET...",FM,col=AMB)
        botbar(d,"SWEEPING LOCAL GRID...",t)
    else:
        ccx,ccy=W//2,int(H*0.42)
        if t<PINP[0]:
            base=crop(LV[1],1.15+(t-LOC[0])*0.03)
        elif t<MOVE[0]:
            base=crop(LV[4],1.10+(t-LOCK[0])*0.06)   # KİLİT: zeroing görüntüsünde kal (geri uzaklaşma YOK)
        else:
            k=0
            for a,idx in DESC:
                if t>=a: k=idx; a0=a
            lp=t-a0
            _TIL={5:LV[5],6:OWN15,7:OWN16,8:OWN17}[k]
            if k!=FINK:
                base=crop(_TIL,1.02+fastout(min(1,lp/0.35))*0.9+lp*0.05)       # yakınlaş-DUR
            else:
                # SON BASAMAK (otonom derinlik): yakınlaş-DUR, sonra ROTAYA DALIŞ + odak
                e=fastout(min(1,lp/0.35))
                _zz=1.02+e*0.6+lp*0.05
                if t>TOTAL-0.85: _zz+=sm((t-(TOTAL-0.85))/0.55)*0.9
                base=crop(_TIL,_zz)
                blur=(1.0-sm(min(1,lp/0.75)))*4.5
                if t>TOTAL-0.60: blur=max(blur,(t-(TOTAL-0.60))/0.30*2.2)
                if blur>0.3: base=base.filter(ImageFilter.GaussianBlur(blur))
        fr=grade(jitrot(base,t),3,1.5 if t>=MOVE[0]+1.1 else 1.35); d=ImageDraw.Draw(fr,"RGBA")
        if t>=MOVE[0]+0.9:
            pip=crop(LV[4],2.4).resize((300,200))
            fr.paste(pip,(W-340,H-430)); dp=ImageDraw.Draw(fr,"RGBA")
            dp.rectangle([W-340,H-430,W-40,H-230],outline=(200,210,212),width=3)
            dp.text((W-330,H-424),"FEED 02 · LIVE",font=FTT,fill=(150,255,235))
        # ARAÇ SİLÜET KARTI KALDIRILDI (Barış 2026-07-21): silüet çirkin duruyordu
        if LOC[1]<=t<PINP[1] if 'PINP' in dir() else False:
            pass
        if PINP[0]<=t<PINP[1]:
            # NET LOKASYON ARAMASI: kendi şehrinde sokak seviyesinde kısa gezinme (diğer şehirler gibi)
            _pt=t-PINP[0]
            if _pt<0.75:                       # köprü: z8 -> z10 iki hızlı basamak (kopukluk yok)
                _st=0 if _pt<0.375 else 1
                _lpb=_pt-_st*0.375
                base=crop(LV[2+_st],1.02+fastout(min(1,_lpb/0.30))*0.85)
            else:
                p=(_pt-0.75)/(PINP[1]-PINP[0]-0.75)
                iw5,ih5=LV[4].size
                wx,wy=wander(502,p,K=4)
                dx=wx*iw5*0.10; dy=wy*ih5*0.07
                base=cropat(LV[4], iw5/2+dx, ih5/2+dy, 1.35+0.18*abs(math.sin(p*3.1)))
            fr=grade(jitrot(base,t),3,1.45); d=ImageDraw.Draw(fr,"RGBA")
            corners(d,ccx,ccy,140,GRN); topbar(d,"ZEROING IN",1.0,alt)
            glow(d,(ccx+150,ccy),"ZEROING IN ON TARGET",FTT,col=GRN)
            botbar(d,"REFINING POSITION",t)
        elif t<LOC[1]:
            corners(d,ccx,ccy,120,GRN); topbar(d,"MATCH FOUND",1.0,alt)
            glow(d,(ccx+140,ccy-44),"Located...",FM,white=True); glow(d,(ccx+140,ccy-6),f"'{TACNAME}'",FM); glow(d,(ccx+140,ccy+30),TACCITY,FM)
            tc=int(t*24); glow(d,(ccx+140,ccy+66),f"00 : 00 : {int(t):02d} : {tc%24:02d}",FM,white=True)
            botbar(d,"TARGET ACQUIRED",t)
        elif t<LOCK[1]:
            p=(t-LOCK[0])/(LOCK[1]-LOCK[0]); corners(d,ccx,ccy,int(120-70*p),GRN); d.ellipse([ccx-8,ccy-8,ccx+8,ccy+8],outline=GRN,width=3)
            topbar(d,"TARGET LOCKED",1.0,alt); glow(d,(ccx+120,ccy-16),"LOCK CONFIRMED",FM); botbar(d,"LOCK CONFIRMED",t)
        else:
            corners(d,ccx,ccy,int(90-40*sm((t-MOVE[0])/4)),GRN); topbar(d,"MOVING IN",1.0,alt)
            if t>=REC and int(t*2)%2: d.ellipse([ccx-160,ccy-70,ccx-140,ccy-50],fill=RED); d.text((ccx-128,ccy-72),"REC",font=FM,fill=RED)
            botbar(d,"VISUAL ACQUIRED — RECORDING" if t>=REC else "MOVING IN",t)
    # zoom-anı blok bozulması (CoD): hızlı zoom pencerelerinde rastgele yatay bantlar pikselleşir
    _zoomwin=False
    _tt=t-TOUR[0]
    if TOUR[0]<=t<TOUR[1] and (_tt-int(_tt/SEG)*SEG)<0.55: _zoomwin=True
    for _a,_ in DESC:
        if _a<=t<_a+0.5: _zoomwin=True
    if TRPAN[0]+0.62<=t<TRPAN[0]+0.95: _zoomwin=True
    if _zoomwin:
        rb=random.Random(i)
        for _ in range(rb.randint(1,3)):
            y0=rb.randint(0,H-90); hh=rb.randint(28,80)
            band=fr.crop((0,y0,W,y0+hh)).resize((W//22,max(1,hh//22)),Image.NEAREST).resize((W,hh),Image.NEAREST)
            fr.paste(band,(rb.randint(-14,14),y0))
    if nearcut(t):
        fr=fr.resize((W//26,H//26),Image.NEAREST).resize((W,H),Image.NEAREST)
    dd=ImageDraw.Draw(fr,"RGBA"); rnd=random.Random(i)
    sy=int((t*0.8%1)*H); dd.line([(0,sy),(W,sy)],fill=(150,255,235,55),width=2)
    for _ in range(rnd.randint(1,3)):
        yyq=rnd.randint(0,H); dd.line([(0,yyq),(W,yyq)],fill=(255,255,255,rnd.randint(10,26)),width=1)
    if TLC<=t<TLC+2.55:
        _aw=300
        if t<TLC+0.25: _fa=sm((t-TLC)/0.25)
        elif t>TLC+2.3: _fa=sm((TLC+2.55-t)/0.25)
        else: _fa=1.0
        if _fa>0.03:
            _ah=375
            _ax,_ay=W-366,int(H*0.16)
            _ov=Image.new("RGBA",(W,H),(0,0,0,0))
            _ov.paste(AVIMG.convert("RGBA"),(_ax,_ay))
            dp=ImageDraw.Draw(_ov)
            dp.rectangle([_ax-4,_ay-4,_ax+_aw+4,_ay+_ah+4],outline=(200,210,214,255),width=3)
            dp.rectangle([_ax-4,_ay+_ah+4,_ax+_aw+4,_ay+_ah+52],fill=(5,16,20,235))
            dp.text((_ax+8,_ay+_ah+12),f"TARGET ID · '{TACNAME}'",font=FS,fill=(150,255,235,255))
            dp.text((_ax+8,_ay+_ah+34),"FILE PHOTO · VERIFIED",font=FTT,fill=(160,175,180,255))
            if _fa<1.0:
                _al=_ov.getchannel("A").point(lambda v:int(v*_fa))
                _ov.putalpha(_al)
            fr.paste(_ov,(0,0),_ov)
    # MİNİ AVATAR: TARGET ID kartı kapandıktan sonra sol-altta soluk hatırlatıcı (yüz unutulmasın)
    if t>TLC+2.7:
        _mw,_mh=96,120
        _mth=AVIMG.resize((_mw,_mh))
        _mal=int(255*(0.34+0.12*math.sin(t*3.1)))          # hafif yanıp sönme (belirgin DEĞİL)
        _mo=Image.new("RGBA",(W,H),(0,0,0,0))
        _mo.paste(_mth.convert("RGBA"),(56,H-118-_mh-190))
        _md=ImageDraw.Draw(_mo)
        _md.rectangle([54,H-120-_mh-190,56+_mw+2,H-116-190],outline=(150,255,235,200),width=2)
        _ma=_mo.getchannel("A").point(lambda v:int(v*_mal/255))
        _mo.putalpha(_ma)
        fr.paste(_mo,(0,0),_mo)
    if t>TOTAL-0.75:
        # DEVİR TESLİM (0.75sn): kamera dalıştan TAKİP İRTİFASINA motorlu geri çekilir — akıcı, bilinçli
        _q=fastout((t-(TOTAL-0.75))/0.75)
        _rz=1.55-0.53*_q
        _rw,_rh=int(W*_rz),int(H*_rz)
        _r1=ROUTE1.resize((_rw,_rh),Image.LANCZOS).crop(((_rw-W)//2,(_rh-H)//2,(_rw-W)//2+W,(_rh-H)//2+H))
        _bb=(1.0-_q)*1.6
        fr=_r1.filter(ImageFilter.GaussianBlur(_bb)) if _bb>0.3 else _r1
    fr.save(f"{OUT}/f{i:05d}.jpg",quality=93)
    if i%90==0: print(f"  {i}/{N}")
print(f"BİTTİ {N}")
