#!/usr/bin/env python3
# CoD OUTRO v3 (9.2sn) — Barış senaryosu (2026-07-19):
# 1) Hedef durur (reticle AÇIK) + "TARGET HAS STOPPED / TRACK COMPLETE — MISSION OVER"
# 2) 2.2sn'de reticle BİR ANDA kaybolur (görev bitti)
# 3) Kademeli zoom-out: çek-DUR ×4, maksimuma kadar
# 4) 6.6'dan sonra YAVAŞ logout ekranı (LOGGING OUT... bekleyerek) -> fade
import os, math, random, urllib.request, io
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops, ImageEnhance
random.seed(9)
SC=os.environ.get("TAC_WORKDIR", os.path.dirname(os.path.abspath(__file__))+"/work")
OUT=f"{SC}/outroframes"; os.makedirs(OUT, exist_ok=True)
for o in os.listdir(OUT): os.remove(f"{OUT}/{o}")
MB=[l.split('=',1)[1].strip() for l in open('/opt/matrix/secrets/mapbox.conf') if l.startswith('MAPBOX_PUBLIC_TOKEN=')][0]
# TAŞIMA (RunPod, 2026-08-30): harita taban ucu env'den; varsayılan = bugünkü yerel proxy (davranış birebir).
_HT=os.environ.get("HARITA_TABAN","http://127.0.0.1:8890").rstrip("/")
_H_STATIK=os.environ.get("HARITA_STATIK",_HT).rstrip("/")
LAT=float(os.environ.get("TAC_OLAT","40.98446")); LON=float(os.environ.get("TAC_OLON","37.87898"))
W=int(os.environ.get("TAC_W","1080")); H=int(os.environ.get("TAC_H","1920")); FPS=30
OYF=float(os.environ.get("TAC_OYF","0.42"))   # hedef ekran-Y oranı = route SON karesiyle birebir (sınır zıplaması yok)
TEAL=(150,255,235); GRAY=(170,180,185); GRN=(120,255,150); RED=(255,90,80); AMB=(255,190,90); WHITE=(240,255,250)
def _retcol():
    _h=os.environ.get("TAC_RETCOL","")
    if _h.startswith("#") and len(_h)==7:
        try:
            r,g,b=int(_h[1:3],16),int(_h[3:5],16),int(_h[5:7],16)
            return (r,g,b),(min(255,r+35),min(255,g+35),min(255,b+35))
        except ValueError: pass
    return (255,90,80),(255,120,110)
RETC,RETL=_retcol()
_FDIR=os.path.dirname(os.path.abspath(__file__))+"/fonts"   # ASKERİ/TAKTİK HUD fontu (Chakra Petch)
def F(s): return ImageFont.truetype(_FDIR+"/ChakraPetch-SemiBold.ttf", s)
def FBD(s): return ImageFont.truetype(_FDIR+"/ChakraPetch-Bold.ttf", s)
FB,FM,FS,FTT=FBD(42),F(31),F(23),F(16)
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
def sat(z):
    u=f"{_H_STATIK}/styles/v1/mapbox/satellite-v9/static/{LON},{LAT},{z},0/1280x1280@2x?access_token={MB}"
    return Image.open(io.BytesIO(_statik_getir(u))).convert("RGB")
ZLVL=list(range(17,4,-1))   # z17..z5 (z17: yakın şehir bitişi de route ile eşleşsin; alt: uzağa zoom-out)
TILES={z:sat(z) for z in ZLVL}
_VIG=Image.new("L",(W,H),0); ImageDraw.Draw(_VIG).ellipse([-W*.35,-H*.18,W*1.35,H*1.18],fill=255); _VIG=_VIG.filter(ImageFilter.GaussianBlur(200))
_SCANL=Image.new("RGBA",(W,H),(0,0,0,0)); sd=ImageDraw.Draw(_SCANL)
for _y in range(0,H,3): sd.line([(0,_y),(W,_y)],fill=(0,0,0,32))
_DARK=Image.new("RGB",(W,H),(3,8,14))
def grade(im,bright=1.22):
    im=ImageEnhance.Brightness(im).enhance(bright)
    im=ImageEnhance.Color(im).enhance(1.18); im=ImageEnhance.Contrast(im).enhance(1.08)
    dark=Image.composite(im,_DARK,_VIG); im=Image.blend(im,dark,0.18)
    im.paste(_SCANL,(0,0),_SCANL)
    n=Image.effect_noise((W,H),20).convert("L").point(lambda v:(v-118)//6 if v>118 else 0)
    return ImageChops.add(im,Image.merge("RGB",(n,n,n)))
def glow(d,xy,txt,font,col=TEAL,white=False):
    x,y=xy
    for ox,oy in ((-2,0),(2,0),(0,-2),(0,2)): d.text((x+ox,y+oy),txt,font=font,fill=(20,90,85))
    d.text((x,y),txt,font=font,fill=WHITE if white else col)
def sm(a): return max(0.0,min(1.0,a))**2*(3-2*max(0.0,min(1.0,a)))

TOTAL=13.2; N=int(FPS*TOTAL)
_ZMIN=min(TILES); _ZMAX=max(TILES)
_MPP0=156543.03392*math.cos(LAT*math.pi/180)/2.0   # z0 @2x metre/px (tile 1280@2x=2560px)
_TW,_TH=TILES[_ZMAX].size
_TF=Image.new("L",(_TW,_TH),0)                     # ince tile feather maskesi (dikişsiz harman)
_tm=int(max(80,min((_TW-max(W,H)*1.05)/2.0, _TW*0.15)))   # opak bölge kareyi TAM kaplasın -> tile-geçişinde kenar pop'u YOK
ImageDraw.Draw(_TF).rectangle([_tm,_tm,_TW-_tm,_TH-_tm],fill=255)
_TF=_TF.filter(ImageFilter.GaussianBlur(_tm*0.7))
def _place(zt,out_mpp):
    img=TILES[zt]; iw,ih=img.size
    sc=(_MPP0/2**zt)/out_mpp                        # tile px -> çıktı px (=2**(Z-zt))
    tlx=W/2.0-iw*sc/2.0; tly=H*OYF-ih*sc/2.0       # tile merkezi=hedef, %42 yükseklik (route ile birebir)
    vx0=max(0.0,tlx); vy0=max(0.0,tly); vx1=min(float(W),tlx+iw*sc); vy1=min(float(H),tly+ih*sc)
    if vx1-vx0<1 or vy1-vy0<1: return None
    cx0=max(0,int((vx0-tlx)/sc)); cy0=max(0,int((vy0-tly)/sc))
    cx1=min(iw,int((vx1-tlx)/sc)); cy1=min(ih,int((vy1-tly)/sc))
    dw=int(vx1)-int(vx0); dh=int(vy1)-int(vy0)
    if dw<1 or dh<1 or cx1-cx0<1 or cy1-cy0<1: return None
    return img.crop((cx0,cy0,cx1,cy1)).resize((dw,dh),Image.LANCZOS),int(vx0),int(vy0),(cx0,cy0,cx1,cy1)
def view(Z):
    # DİKİŞSİZ zoom: kaba tile taban (kadrajı doldurur) + ince tile feather'la merkeze (COĞRAFİ HİZALI).
    # Tile-sınırında POP yok (ince tile Z arttıkça büyüyüp tabana dönüşür); BLEND ghosting yok (coğrafi hiza).
    Z=max(_ZMIN,min(_ZMAX,Z)); out_mpp=_MPP0/2**Z
    zt0=max(_ZMIN,min(_ZMAX,int(math.floor(Z)))); frac=Z-zt0
    cv=Image.new("RGB",(W,H),(6,14,10))
    b=_place(zt0,out_mpp)
    if b: rs,vx,vy,_=b; cv.paste(rs,(vx,vy))
    if zt0<_ZMAX:
        f=_place(zt0+1,out_mpp)
        if f:
            rs,vx,vy,(cx0,cy0,cx1,cy1)=f
            a=int(255*(max(0.0,min(1.0,(frac-0.12)/0.76))**0.9))   # ince tile Z arttıkça belirir -> kenar dikişi görünmez
            if a>4:
                mk=_TF.crop((cx0,cy0,cx1,cy1)).resize(rs.size,Image.LANCZOS)
                if a<255: mk=mk.point(lambda v:v*a//255)
                cv.paste(rs,(vx,vy),mk)
    return cv
# ===== BİTİŞ ZOOM SEKANSI: rota bitti->DUR(freeze) -> [uzaksa kademeli zoom-in] -> kademeli zoom-out =====
# IŞINLANMA/DALIŞ YOK: her adım smoothstep (ekleme yerlerinde hız=0 -> zıplama yok), kesintisiz view -> resim geçişi yok.
OZ0=float(os.environ.get("TAC_OZ0","16.6")); ZEND=float(os.environ.get("TAC_ZEND","9.0"))
# KESİN ÖLÇEK EŞLEŞME: route SON pencere metresi (win) verildiyse OZ0'ı OUTRO'nun KENDİ ölçeğiyle hesapla
# -> outro ilk karesi = route son karesi (birebir, sabit 720 uyuşmazlığı YOK). W*_MPP0/2^Z = win.
_owin=os.environ.get("TAC_OWIN","")
if _owin:
    try: OZ0=max(_ZMIN+0.15,min(_ZMAX+0.55,math.log2(W*_MPP0/max(1.0,float(_owin)))))
    except Exception: pass
HOLD1=1.15                                          # rota bitti: 1+sn DUR (teyit), uzaklık DEĞİŞMEZ
_FAR=OZ0<14.0
def _steps(t0,targets,move,hold):
    ks=[]; t=t0
    for tz in targets:
        t=round(t+move,3); ks.append((t,tz))
        t=round(t+hold,3); ks.append((t,tz))
    return ks,t
ZKEY=[(0.0,OZ0),(HOLD1,OZ0)]
if _FAR:
    ZMID=min(15.2,OZ0+3.0)                          # uzaktaysa hedefe kademeli YAKLAŞ (dalış değil)
    _ki,_t=_steps(HOLD1,[OZ0+(ZMID-OZ0)*0.55,ZMID],move=0.62,hold=0.34)
    ZKEY+=_ki; _RET_END=_t                          # reticle: freeze+zoom-in boyunca (hedef teyit)
    _ko,_t=_steps(_t,[ZMID-(ZMID-ZEND)*0.45,ZMID-(ZMID-ZEND)*0.76,ZEND],move=0.48,hold=0.22)
    ZKEY+=_ko
else:
    _RET_END=HOLD1+0.45                             # şehir: yakın zaten -> kısa teyit -> zoom-out
    _ko,_t=_steps(HOLD1,[OZ0-(OZ0-ZEND)*0.34,OZ0-(OZ0-ZEND)*0.61,OZ0-(OZ0-ZEND)*0.83,ZEND],move=0.55,hold=0.26)
    ZKEY+=_ko
ZKEY.append((TOTAL,ZEND))
def zof(t):
    for j in range(len(ZKEY)-1):
        t0,z0=ZKEY[j]; t1,z1=ZKEY[j+1]
        if t<=t1:
            q=0 if t1==t0 else (t-t0)/(t1-t0)
            return z0+(z1-z0)*sm(max(0,min(1,q)))
    return ZKEY[-1][1]
CMDS=[(0.40,"> TARGET HAS STOPPED"),(1.30,"> TRACK COMPLETE — MISSION OVER"),(2.40,"> RETURN TO ORBIT")]
# ROUTE SON KARESİ (freeze birebir): route_gen kaydetti -> outro'nun DUR fazı route ile piksel-birebir (resim geçişi YOK)
_RB=None
try:
    _rbp=f"{SC}/route_end_base.jpg"
    if os.path.exists(_rbp): _RB=Image.open(_rbp).convert("RGB").resize((W,H),Image.LANCZOS)
except Exception: _RB=None
for i in range(N):
    t=i/FPS
    _Z=zof(t)
    if _RB is not None and t<HOLD1:
        fr=_RB.copy()                                                       # FREEZE: route SON karesiyle BİREBİR (resim geçişi/ışınlanma yok)
    elif _RB is not None and t<HOLD1+0.5:
        fr=Image.blend(_RB, grade(view(_Z)), sm((t-HOLD1)/0.5))             # zoom başlarken route-base -> tile YUMUŞAK geçiş (aynı kadraj -> ghost yok, hareket maskeler)
    else:
        fr=grade(view(_Z))
    d=ImageDraw.Draw(fr,"RGBA")
    # RETICLE: rota bitti->freeze + (uzaksa) hedefe zoom-in boyunca AÇIK — zoom-out başlayınca yok
    if t<_RET_END:
        mcx,mcy=W//2,int(H*OYF)
        pr=10+2.0*math.sin(t*5.2)
        _ang=math.degrees(t*55)
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
        if int(t*3)%2==0:
            glow(d,(mcx+40,mcy-14),"TARGET STATIONARY",FS,col=AMB)
    # üst bar
    d.rectangle([0,0,W,64],fill=(4,10,14,200))
    glow(d,(40,20),"MLOG SATCOM",FTT); d.text((W-330,20),"TRACK TERMINATED",font=FTT,fill=GRAY)
    # konsol (daktilo)
    cy=int(H*0.70)
    d.rectangle([50,cy-24,W-50,cy+120],fill=(5,14,18,165),outline=(90,110,114),width=2)
    yy=cy-6
    for st_,txt in CMDS:
        if t>st_:
            nch=int((t-st_)/0.028)
            d.text((78,yy),txt[:nch]+("_" if nch<len(txt) and int(t*4)%2 else ""),font=FS,fill=TEAL)
        yy+=36
    # ===== ZENGİN LOGOUT / SİSTEM KAPANIŞ SEKANSI =====
    LG=min(float(os.environ.get("TAC_LOGOUT","7.4")),TOTAL-7.55)   # terminal DAİMA tam sığar (>=7.55sn pencere)
    if t>=LG:
        fr=Image.new("RGB",(W,H),(3,8,14)); d=ImageDraw.Draw(fr,"RGBA")
        _lt=t-LG
        d.text((W//2,int(H*0.16)),"MLOG SATCOM",font=FB,fill=TEAL,anchor="mm")
        d.text((W//2,int(H*0.16)+52),"OPERATOR TERMINAL",font=FTT,fill=(120,150,150),anchor="mm")
        # daktilo komut zinciri (her satır sırayla yazılır, klavye sesiyle senkron)
        _CALLSIGN=(os.environ.get("TAC_CALLSIGN","").strip() or "ACTUAL").upper()[:16]
        SEQ=[(0.25,"> OPERATOR: "+_CALLSIGN),
             (1.05,"> ARCHIVING MISSION LOG ..."),
             (1.95,"> SATELLITE UPLINK ... CLOSED"),
             (2.80,"> ENCRYPTION KEYS ... PURGED"),
             (3.70,"> LOGGING OUT OPERATOR ..."),
             (4.70,"> SESSION ENDED — GOOD HUNTING")]
        yy=int(H*0.30)
        for _st,_tx in SEQ:
            if _lt>_st:
                nch=int((_lt-_st)/0.026)
                _done=nch>=len(_tx)
                _col=(120,255,150) if _done else TEAL
                d.text((90,yy),_tx[:nch]+("_" if not _done and int(t*4)%2 else ""),font=FS,fill=_col)
                if _done: d.text((W-150,yy),"[OK]",font=FTT,fill=(120,255,150))
            yy+=42
        # GÜÇ KAPANIŞ barı (5.3 -> 6.4 arası dolar)
        if _lt>5.3:
            _pp=min(1.0,(_lt-5.3)/1.1)
            by=int(H*0.66)
            d.rectangle([120,by,W-120,by+26],outline=(90,110,114),width=2)
            d.rectangle([124,by+4,124+int((W-248)*_pp),by+22],fill=(120,200,185))
            d.text((120,by+34),"POWERING DOWN SATCOM ...",font=FTT,fill=(150,200,195))
        # TERMINAL OFFLINE + CRT çizgiye iniş
        if _lt>6.5:
            d.text((W//2,int(H*0.80)),"[ TERMINAL OFFLINE ]",font=FS,fill=(160,120,110),anchor="mm")
        if _lt>6.7:
            _e=sm(min(1.0,(_lt-6.7)/0.55))           # CRT: görüntü ince çizgiye iner, sonra sönеr
            hh=max(3,int(H*(1.0-_e)))
            band=fr.resize((W,max(2,hh)))
            fr=Image.new("RGB",(W,H),(0,0,0)); fr.paste(band,(0,(H-hh)//2))
            if _lt>7.2:
                fr=Image.blend(fr,Image.new("RGB",(W,H),(0,0,0)),sm((_lt-7.2)/0.35))
    fr.save(f"{OUT}/f{i:05d}.jpg",quality=93)
print(f"OUTRO v3 {N} kare OK")
