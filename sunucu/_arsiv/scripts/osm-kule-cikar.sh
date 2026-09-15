#!/bin/bash
# OSM KULE ÇIKARIMI (Barış 2026-08-11: "bizzat kendi OSM depomuzdan çek — aylık yenileniyor")
# Kendi planet arşivimizden (uzak mount, ~2 MB/s -> ~12 saat) height/building:levels etiketli
# yapıları süzer -> yerel SQLite. Proxy /yukseklik kule katmanını BUNDAN okur (Overpass yalnız
# bu DB yokken yedek). NOT (diğer hesabın ölçümü): kaynakta etiket SEYREK (%0-6) — bu katman
# yalnız ikonik kuleler için; mahalle profili GHS'ten gelir.
set -uo pipefail
exec 9>/var/lock/osm-kule-cikar.lock; flock -n 9 || { echo "zaten çalışıyor"; exit 0; }
D=/opt/matrix/harita-yukseklik; L=$D/cikarim.log
log(){ echo "$(date '+%F %T') $1" >> $L; }
PLANET=/mnt/harita-uzak/planet-latest.osm.pbf
# ⚠️ DAYANIKLILIK (11.08 dersi): 12 saatlik kesintisiz sshfs okuması ağ hıçkırığında
# "Input/output error" ile düşüyor. 3 deneme + her denemede mount sağlık kontrolü
# (bozuksa mount birimini tazele; harita-proxy pmtiles o an Esri yedeğine düşer, zararsız).
mount_saglik(){ dd if="$PLANET" of=/dev/null bs=1M count=2 >/dev/null 2>&1; }
TAMAM=0
for deneme in 1 2 3; do
  if ! mount_saglik; then
    log "mount bozuk (deneme $deneme) -> birim tazeleniyor"
    systemctl restart 'mnt-harita\x2duzak.mount' 2>>$L; sleep 30
    mount_saglik || { log "mount hâlâ bozuk, 10 dk bekle"; sleep 600; continue; }
  fi
  log "BAŞLADI deneme $deneme (planet: $(stat -c%s $PLANET) bayt, ~12 saat)"
  if nice -n 19 ionice -c 3 osmium tags-filter --no-progress "$PLANET" \
      w/height w/building:levels \
      -o $D/kule-ham.osm.pbf --overwrite >> $L 2>&1; then
    TAMAM=1; break
  fi
  log "tags-filter düştü (deneme $deneme), 10 dk sonra tekrar"
  sleep 600
done
[ "$TAMAM" = "1" ] || { log "HATA: 3 denemede bitmedi"; exit 1; }
log "süzme bitti: $(du -h $D/kule-ham.osm.pbf | cut -f1)"
nice -n 19 osmium export $D/kule-ham.osm.pbf -f geojsonseq \
  --index-type=sparse_mem_array --geometry-types=polygon \
  -o $D/kule-ham.geojsonseq --overwrite >> $L 2>&1 || { log "HATA: export"; exit 1; }
log "export bitti: $(du -h $D/kule-ham.geojsonseq | cut -f1)"
python3 - <<'PY' >> $L 2>&1
import json,sqlite3,os
D="/opt/matrix/harita-yukseklik"
db=sqlite3.connect(D+"/kule.db.yeni")
db.execute("CREATE TABLE kule(glat INT, glon INT, lon REAL, lat REAL, h REAL)")
n=0
for ln in open(D+"/kule-ham.geojsonseq",encoding="utf-8",errors="replace"):
    ln=ln.strip().lstrip("\x1e")
    if not ln: continue
    try:
        f=json.loads(ln); pr=f.get("properties",{})
        if "building" not in pr and "building:part" not in pr: continue
        h=None
        raw=str(pr.get("height","")).replace("m","").replace(",",".").strip()
        try: h=float(raw)
        except Exception:
            try: h=float(str(pr.get("building:levels","")).replace(",",".").strip())*3.1+2
            except Exception: h=None
        if not h or not (3<=h<=830): continue
        cs=f["geometry"]["coordinates"]
        while isinstance(cs[0][0],list): cs=cs[0]
        lon=sum(c[0] for c in cs)/len(cs); lat=sum(c[1] for c in cs)/len(cs)
        db.execute("INSERT INTO kule VALUES(?,?,?,?,?)",(int(lat*20),int(lon*20),round(lon,6),round(lat,6),round(h,1)))
        n+=1
        if n%200000==0: db.commit(); print(f"  {n} kayıt")
    except Exception: pass
db.execute("CREATE INDEX ix ON kule(glat,glon)")
db.commit(); db.close()
os.replace(D+"/kule.db.yeni",D+"/kule.db")
print(f"TAMAM: {n} etiketli yapı -> kule.db")
PY
rm -f $D/kule-ham.geojsonseq
log "BİTTİ: kule.db $(du -h $D/kule.db 2>/dev/null | cut -f1)"
