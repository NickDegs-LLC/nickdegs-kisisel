#!/usr/bin/env python3
# Garmin sağlık verisinden sabah özeti + akıllı uyarılar -> Element "Sağlık" odası.
import sys, json, urllib.request, urllib.parse, time
from datetime import date, timedelta
sys.path.insert(0, "/opt/matrix/garmin-lib")
from garminconnect import Garmin

HS="http://127.0.0.1:8008"; BOT="SIR_KALDIRILDI_bkz_secrets_MATRIX_BOT_TOKEN"
ROOM="!nLZOCypHLCKdSfPmuJ:nickdegs.duckdns.org"; GTOK="/opt/matrix/garmin-tokens"

night = date.fromisoformat(sys.argv[1]) if len(sys.argv)>1 else date.today()   # uyku/HRV/hazırlık (dün gece)
dayd  = night - timedelta(days=1)                                              # dünkü gündüz aktivitesi

g=Garmin(); g.login(tokenstore=GTOK)
def safe(fn, d=None):
    try: return fn()
    except Exception: return d

us = safe(lambda: g.get_user_summary(dayd.isoformat()), {}) or {}
sl = safe(lambda: g.get_sleep_data(night.isoformat()), {}) or {}
hv = safe(lambda: g.get_hrv_data(night.isoformat()), {}) or {}
tr = safe(lambda: g.get_training_readiness(night.isoformat()), []) or []
sp = safe(lambda: g.get_spo2_data(night.isoformat()), {}) or {}

# 7 gün dinlenme nabzı taban
rhrs=[]
for k in range(2,9):
    s=safe(lambda: g.get_user_summary((dayd-timedelta(days=k)).isoformat()), {}) or {}
    v=s.get("restingHeartRate")
    if v: rhrs.append(v)
rhr_base=round(sum(rhrs)/len(rhrs)) if rhrs else None

# --- değerler ---
sleep_s=(sl.get("dailySleepDTO") or {}).get("sleepTimeSeconds") or 0
sleep_h=sleep_s/3600
sleep_score=((sl.get("dailySleepDTO") or {}).get("sleepScores") or {}).get("overall",{}).get("value")
rhr=us.get("restingHeartRate")
steps=us.get("totalSteps")
stress=us.get("averageStressLevel")
bb_hi=us.get("bodyBatteryHighestValue"); bb_lo=us.get("bodyBatteryLowestValue")
hrv_last=(hv.get("hrvSummary") or {}).get("lastNightAvg"); hrv_wk=(hv.get("hrvSummary") or {}).get("weeklyAvg"); hrv_st=(hv.get("hrvSummary") or {}).get("status")
treadiness=(tr[0].get("level") if tr else None); tscore=(tr[0].get("score") if tr else None)
spo2_avg=sp.get("averageSpO2"); spo2_lo=sp.get("lowestSpO2")

def fmth(h): return f"{int(h)}s {int((h*60)%60)}dk"
L=[f"🩺 Sağlık özeti — {night.strftime('%d.%m.%Y')} sabahı", ""]
L.append(f"😴 Uyku: {fmth(sleep_h)}" + (f" (skor {sleep_score})" if sleep_score else ""))
if rhr is not None: L.append(f"❤️ Dinlenme nabzı: {rhr} bpm" + (f" (7g ort {rhr_base})" if rhr_base else ""))
if hrv_last is not None: L.append(f"📊 HRV (toparlanma): {hrv_last} ms (haftalık {hrv_wk}, durum {hrv_st})")
if treadiness: L.append(f"🔋 Antrenman hazırlığı: {treadiness}" + (f" ({tscore})" if tscore else ""))
if bb_hi is not None: L.append(f"⚡ Vücut bataryası: {bb_lo}–{bb_hi}")
if stress is not None: L.append(f"😬 Ort. stres (dün): {stress}")
if steps is not None: L.append(f"👟 Adım (dün): {steps}")
if spo2_avg: L.append(f"🫁 SpO2 ort: {spo2_avg}% (en düşük {spo2_lo}%)")

# --- uyarılar ---
A=[]
if sleep_h and sleep_h<6: A.append(f"Az uyumuşsun ({fmth(sleep_h)}). Bugün kendini zorlama.")
if rhr and rhr_base and rhr>=rhr_base+6: A.append(f"Dinlenme nabzın normalden yüksek ({rhr} vs {rhr_base}). Yorgunluk/hastalık/stres işareti olabilir, dinlen.")
if hrv_st and str(hrv_st).upper()=="POOR": A.append("HRV düşük (POOR) — toparlanman zayıf, ağır aktiviteden kaçın.")
elif hrv_last and hrv_wk and hrv_last < hrv_wk*0.8: A.append("HRV haftalık ortalamanın altında — toparlanma düşük.")
if treadiness and str(treadiness).upper() in ("POOR","LOW"): A.append("Antrenman hazırlığın düşük — bugün hafif geçir / dinlen.")
if bb_hi is not None and bb_hi<40: A.append(f"Vücut bataryan düşük kaldı (zirve {bb_hi}). Enerjin az olabilir.")
if stress is not None and stress>50: A.append(f"Ortalama stresin yüksek ({stress}). Mola/nefes iyi gelebilir.")
if spo2_avg and spo2_avg<92: A.append(f"Ortalama SpO2 düşük ({spo2_avg}%).")

if A:
    L.append(""); L.append("⚠️ Uyarılar:")
    for a in A: L.append(f"• {a}")
else:
    L.append(""); L.append("✅ Belirgin bir uyarı yok, iyi görünüyor.")

body="\n".join(L)
def send(t):
    r=urllib.request.Request(f"{HS}/_matrix/client/v3/rooms/{urllib.parse.quote(ROOM)}/send/m.room.message/{int(time.time()*1000)}",
        data=json.dumps({"msgtype":"m.text","body":t}).encode(),method="PUT",
        headers={"Authorization":"Bearer "+BOT,"Content-Type":"application/json"})
    urllib.request.urlopen(r,timeout=30)
send(body)
print(body)
print("\n[gönderildi -> Sağlık]")
