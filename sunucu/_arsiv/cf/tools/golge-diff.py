#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
golge-diff.py — GET-diff turu (Faz 2a)
======================================
Sözleşmedeki (contracts/api.json) method=GET + auth=auth_user uçlarını hem ÜRETİM
(https://kisisel-api.nickdegs.com) hem GÖLGE (workers.dev) tabanına aynı JWT ile atar,
JSON cevapları alan-kümesi + değer bazında karşılaştırır.

KURALLAR:
- YALNIZ GET — üretime yazma isteği YOK (POST/DELETE diff'i Faz 2b).
- JWT: tools/jwt.py (HS256, backend config.env ile aynı sır).
- Test kullanıcıları: apple_golge_diff (yeni kullanıcı → örnek içerik),
  u69be3f7e960e (Barış, zengin veri), appreview (örnek içerik sahibi).
- Path parametreli uçlarda GERÇEK id'ler (uzak D1'den seçildi, aşağıda ORNEK_ID).
- Zaman/oynak alanlar (ts, updated_at, nonce, token, url...) NORM listesiyle
  değer karşılaştırmasından muaf; alan-kümesi karşılaştırması yine yapılır.
- Float toleransı 1e-6 (göreli).

Çıktı: stdout skor tablosu + /opt/matrix/cf/tools/diff-rapor-1.md
"""
import json, hashlib, subprocess, sys, time, urllib.request, urllib.error

PROD  = "https://kisisel-api.nickdegs.com"
GOLGE = "https://movelog-api.daclen10.workers.dev"
CONTRACT = "/opt/matrix/cf/contracts/api.json"
JWT_TOOL = "/opt/matrix/cf/tools/jwt.py"
RAPOR = sys.argv[1] if len(sys.argv) > 1 else "/opt/matrix/cf/tools/diff-rapor-1.md"
USERS = ["apple_golge_diff", "u69be3f7e960e", "appreview"]
TIMEOUT = 45
BINARY_CAP = 2 * 1024 * 1024        # ikili gövdeden en çok bu kadarını oku
JSON_CAP = 30 * 1024 * 1024
MAX_DIFF_PER_PAIR = 30              # rapora uç×kullanıcı başına en çok bu kadar fark yaz

# ---- Gerçek örnek id'ler (uzak D1 movelog-db'den seçildi, 2026-08-30) ----
# rides:    u69be3f7e960e → 2026-08-28_1787905726 (ts 1787905726, to_ts 1787906384)
#           appreview     → 2026-08-28_1787900000 (ts 1787900000, to_ts 1787900849; videos'ta kaydı VAR)
# friends:  u69be3f7e960e ↔ u5f41b66429bc (handle: semraunal)
# clubs:    c1784072828c4b2e8 (sahip u54c58ec41b54; test kullanıcıları üye DEĞİL → yetki-yolu paritesi)
# ptt_acl:  p1787903670c7933b24 (DM klibi ["u5f41b66429bc","u69be3f7e960e"])
RIDE = {
    "u69be3f7e960e":    "2026-08-28_1787905726",
    "appreview":        "2026-08-28_1787900000",
    "apple_golge_diff": "2026-08-28_1787900000",   # örnek-içerik istisnası testi (_ornek_mi)
}
TRACK = {
    "u69be3f7e960e":    (1787905726, 1787906384),
    "appreview":        (1787900000, 1787900849),
    "apple_golge_diff": (1787900000, 1787900849),
}
FRIEND_HANDLE = "semraunal"
FRIEND_UID = "u5f41b66429bc"
CID = "c1784072828c4b2e8"
PID = "p1787903670c7933b24"

# Uç başına istek özelleştirmesi: path değişkenleri / query / header (kullanıcıya göre)
def spec(path, u):
    q, hdr, pth = {}, {}, {}
    if path == "/api/track":
        frm, to = TRACK[u]; q = {"frm": frm, "to": to, "detay": 1}
    elif path == "/api/rides/{ride_id}/video":
        pth = {"ride_id": RIDE[u]}; hdr = {"Range": "bytes=0-1023"}
    elif path == "/api/rides/{ride_id}/videourl":
        pth = {"ride_id": RIDE[u]}
    elif path == "/api/live/{username}":
        pth = {"username": FRIEND_HANDLE}
    elif path == "/api/live/club/{cid}" or path == "/api/clubs/{cid}" or path == "/api/intercom/{cid}/token":
        pth = {"cid": CID}
    elif path == "/api/voicecall/token":
        q = {"peer": FRIEND_HANDLE}
    elif path == "/api/ptt/busy/{username}":
        pth = {"username": FRIEND_HANDLE}
    elif path == "/api/ptt/{pid}":
        pth = {"pid": PID}
    elif path == "/api/chat/with/{other}":
        pth = {"other": FRIEND_UID}
    elif path == "/api/chat/poll":
        q = {"since": 0}
    elif path == "/api/users/find":
        q = {"q": "semra"}
    elif path == "/api/music/file":
        q = {"ref": "active"}
    return pth, q, hdr

# Bilinen-fark kabul listesi: FARKLI çıkarsa ayrı "BİLİNEN-FARK" sınıfına düşer, FARKLI SAYILMAZ.
# GÖLGE-HATA/PROD-HATA yine maskelenmez (bir 500 bu listeyle gizlenemez).
# Görev C kararı (2026-08-30): iki uçta üretim verisi Traccar'dan geliyor, gölge D1 akışı Faz 3/4'te.
BILINEN_FARK = {
    "/api/activities": "BEKLENEN BOŞLUK (Faz 3/4: Traccar→D1 akışı)",
    "/api/gps/live":   "BEKLENEN BOŞLUK (Faz 3/4: Traccar→D1 akışı)",
    "/api/track":      "BEKLENEN BOŞLUK (Faz 3/4: pozisyon geçmişi backfill)",
}

# Değer karşılaştırmasından muaf (oynak/zaman/sunucu-üretimi) alan adları.
# Alan-KÜMESİ karşılaştırması bunlar için de yapılır; yalnız DEĞER farkı bastırılır.
NORM = {
    "ts", "to", "exp", "expires", "expires_at", "expires_in", "now", "server_time",
    "server_now", "updated_at", "created_at", "uploaded_at", "done", "done_at",
    "last_seen", "last_ts", "nonce", "challenge", "token", "url", "video_url",
    "generated_at", "session",
}
FLOAT_TOL = 1e-6

def jwt(sub):
    return subprocess.run([sys.executable, JWT_TOOL, sub, "7200"],
                          capture_output=True, text=True, check=True).stdout.strip()

def fetch(base, path, pth, q, hdr, tok):
    p = path
    for k, v in pth.items():
        p = p.replace("{%s}" % k, str(v))
    url = base + p
    if q:
        url += "?" + "&".join(f"{k}={v}" for k, v in q.items())
    # UA ŞART: Cloudflare, varsayılan "Python-urllib" UA'sını 403'lüyor (workers.dev bot koruması)
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + tok,
        "User-Agent": "golge-diff/1.0 (+movelog faz2a)",
        **hdr})
    try:
        r = urllib.request.urlopen(req, timeout=TIMEOUT)
        status, ct = r.status, (r.headers.get("content-type") or "")
        cl = r.headers.get("content-length")
        cap = JSON_CAP if "json" in ct else BINARY_CAP
        body = r.read(cap)
        r.close()
    except urllib.error.HTTPError as e:
        status, ct = e.code, (e.headers.get("content-type") or "")
        cl = e.headers.get("content-length")
        body = e.read(BINARY_CAP)
    except Exception as e:
        return {"err": f"{type(e).__name__}: {e}"}
    out = {"status": status, "ct": ct.split(";")[0].strip(), "cl": cl, "nbytes": len(body)}
    if "json" in out["ct"] or (body[:1] in (b"{", b"[") and "text/html" not in out["ct"]):
        try:
            out["json"] = json.loads(body.decode("utf-8"))
        except Exception:
            out["sha"] = hashlib.sha256(body).hexdigest()[:16]
    else:
        out["sha"] = hashlib.sha256(body).hexdigest()[:16]
    return out

def feq(a, b):
    try:
        fa, fb = float(a), float(b)
    except (TypeError, ValueError):
        return False
    return abs(fa - fb) <= max(FLOAT_TOL, FLOAT_TOL * max(abs(fa), abs(fb)))

def jdiff(a, b, yol, farklar, anahtar=None):
    """a=üretim, b=gölge. Farkları farklar listesine ekler."""
    if len(farklar) > MAX_DIFF_PER_PAIR:
        return
    if isinstance(a, dict) and isinstance(b, dict):
        ka, kb = set(a), set(b)
        for k in sorted(ka - kb):
            farklar.append(("ALAN-EKSIK(gölge)", f"{yol}.{k}"))
        for k in sorted(kb - ka):
            farklar.append(("ALAN-FAZLA(gölge)", f"{yol}.{k}"))
        for k in sorted(ka & kb):
            jdiff(a[k], b[k], f"{yol}.{k}", farklar, anahtar=k)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            farklar.append(("LISTE-BOY", f"{yol} üretim={len(a)} gölge={len(b)}"))
        for i, (x, y) in enumerate(zip(a, b)):
            jdiff(x, y, f"{yol}[{i}]", farklar, anahtar=anahtar)
    else:
        if a == b:
            return
        if anahtar in NORM:
            return  # oynak alan: değer farkı bastır
        if isinstance(a, bool) != isinstance(b, bool):
            # bool vs 0/1 tip farkı önemli (JSON alan sözleşmesi)
            farklar.append(("TIP", f"{yol} üretim={a!r} gölge={b!r}"))
            return
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and feq(a, b):
            return
        sa, sb = json.dumps(a, ensure_ascii=False)[:80], json.dumps(b, ensure_ascii=False)[:80]
        farklar.append(("DEGER", f"{yol} üretim={sa} gölge={sb}"))

def karsilastir(pr, sh):
    """Sonuç: (verdikt, özet, farklar)"""
    if "err" in sh and "err" in pr:
        return "IKISI-HATA", f"üretim: {pr['err']} | gölge: {sh['err']}", []
    if "err" in sh:
        return "GÖLGE-HATA", f"ağ/istisna: {sh['err']}", []
    if "err" in pr:
        return "PROD-HATA", f"ağ/istisna: {pr['err']}", []
    if sh["status"] >= 500 and pr["status"] < 500:
        return "GÖLGE-HATA", f"gölge {sh['status']} (üretim {pr['status']}) gövde={json.dumps(sh.get('json'), ensure_ascii=False)[:200] if 'json' in sh else sh.get('sha','')}", []
    if pr["status"] != sh["status"]:
        oz = f"durum: üretim {pr['status']} ≠ gölge {sh['status']}"
        d = []
        if "json" in pr: d.append(("PROD-GOVDE", json.dumps(pr["json"], ensure_ascii=False)[:200]))
        if "json" in sh: d.append(("GOLGE-GOVDE", json.dumps(sh["json"], ensure_ascii=False)[:200]))
        return "FARKLI", oz, d
    if "json" in pr and "json" in sh:
        farklar = []
        jdiff(pr["json"], sh["json"], "$", farklar)
        if not farklar:
            return "EŞİT", f"{pr['status']} json", []
        return "FARKLI", f"{len(farklar)} fark ({pr['status']})", farklar
    if "json" in pr or "json" in sh:
        return "FARKLI", f"gövde tipi: üretim={pr['ct']} gölge={sh['ct']}", []
    # ikili gövde: durum + content-type + boyut/hash
    d = []
    if pr["ct"] != sh["ct"]:
        d.append(("CTYPE", f"üretim={pr['ct']} gölge={sh['ct']}"))
    if pr["nbytes"] != sh["nbytes"]:
        d.append(("BOYUT", f"üretim={pr['nbytes']}B gölge={sh['nbytes']}B"))
    elif pr.get("sha") != sh.get("sha"):
        d.append(("HASH", f"üretim={pr.get('sha')} gölge={sh.get('sha')} (boyut aynı)"))
    if d:
        return "FARKLI", f"ikili gövde ({pr['status']})", d
    return "EŞİT", f"{pr['status']} ikili {pr['nbytes']}B", []

def main():
    kayitlar = json.load(open(CONTRACT))
    ucler = [r for r in kayitlar if r.get("method") == "GET"
             and str(r.get("auth", "")).startswith("auth_user")]
    print(f"{len(ucler)} GET+auth_user ucu, {len(USERS)} kullanıcı → {len(ucler)*len(USERS)} istek çifti", file=sys.stderr)
    toklar = {u: jwt(u) for u in USERS}
    sonuc = {}   # path -> {user: (verdikt, özet, farklar, prodmeta, golgemeta)}
    for r in ucler:
        path = r["path"]
        sonuc[path] = {}
        for u in USERS:
            pth, q, hdr = spec(path, u)
            pr = fetch(PROD, path, pth, q, hdr, toklar[u])
            sh = fetch(GOLGE, path, pth, q, hdr, toklar[u])
            v, oz, farklar = karsilastir(pr, sh)
            sonuc[path][u] = (v, oz, farklar, pr, sh)
            print(f"  {v:10s} {path} [{u}] {oz}", file=sys.stderr)
            time.sleep(0.1)

    # ---- skor + rapor ----
    def uc_verdikt(per_user):
        vs = [x[0] for x in per_user.values()]
        for kritik in ("GÖLGE-HATA", "PROD-HATA", "IKISI-HATA", "FARKLI"):
            if kritik in vs:
                return kritik
        return "EŞİT"

    ozet = {}
    for p, pu in sonuc.items():
        ozet[p] = uc_verdikt(pu)
        # bilinen-fark kabulü: yalnız FARKLI'yı yeniden sınıflar; HATA sınıfları maskelenmez
        if ozet[p] == "FARKLI" and p in BILINEN_FARK:
            ozet[p] = "BİLİNEN-FARK"
    say = {}
    for v in ozet.values():
        say[v] = say.get(v, 0) + 1

    L = []
    import re as _re
    _n = _re.search(r"(\d+)", RAPOR.rsplit("/", 1)[-1])
    L.append(f"# Gölge GET-diff Raporu #{_n.group(1) if _n else '?'} (Faz 2a)\n")
    L.append(f"- Tarih: {time.strftime('%Y-%m-%d %H:%M:%S %z')}")
    L.append(f"- Üretim: {PROD}")
    L.append(f"- Gölge: {GOLGE}")
    L.append(f"- Kapsam: method=GET + auth=auth_user → **{len(ozet)} uç** × {len(USERS)} kullanıcı ({', '.join(USERS)})")
    L.append(f"- Normalize (değer muaf) alanlar: {', '.join(sorted(NORM))}")
    L.append(f"- Float toleransı: {FLOAT_TOL}")
    L.append("- Bilinen-fark kabul listesi (FARKLI sayılmaz, hata sınıfları maskelenmez): "
             + "; ".join(f"`{p}` → {n}" for p, n in sorted(BILINEN_FARK.items())) + "\n")
    L.append("## Skor\n")
    L.append("| Verdikt | Uç sayısı |")
    L.append("|---|---|")
    for v in ("EŞİT", "FARKLI", "BİLİNEN-FARK", "GÖLGE-HATA", "PROD-HATA", "IKISI-HATA"):
        if say.get(v):
            L.append(f"| {v} | {say[v]} |")
    L.append("")
    L.append("## Uç tablosu\n")
    L.append("| Uç | Verdikt | " + " | ".join(USERS) + " |")
    L.append("|---|---|" + "---|" * len(USERS))
    for p in sorted(ozet, key=lambda x: ((ozet[x] == "EŞİT") * 2 + (ozet[x] == "BİLİNEN-FARK"), x)):
        satir = [p, f"**{ozet[p]}**"]
        for u in USERS:
            v, oz, _, pr, sh = sonuc[p][u]
            st = f"{pr.get('status','ERR')}/{sh.get('status','ERR')}"
            satir.append(f"{v} ({st}) {oz if v!='EŞİT' else ''}".strip())
        L.append("| " + " | ".join(satir) + " |")
    L.append("")
    L.append("## Fark ayrıntıları\n")
    for p in sorted(ozet):
        if ozet[p] == "EŞİT":
            continue
        L.append(f"### {p}\n")
        if ozet[p] == "BİLİNEN-FARK":
            L.append(f"> Kabul listesi: {BILINEN_FARK[p]} — fark ayrıntısı bilgi amaçlı.\n")
        for u in USERS:
            v, oz, farklar, pr, sh = sonuc[p][u]
            if v == "EŞİT":
                continue
            L.append(f"- **{u}** → {v}: {oz}")
            for tip, det in farklar[:MAX_DIFF_PER_PAIR]:
                L.append(f"  - `{tip}` {det}")
            if len(farklar) > MAX_DIFF_PER_PAIR:
                L.append(f"  - … (+{len(farklar)-MAX_DIFF_PER_PAIR} fark daha)")
        L.append("")
    open(RAPOR, "w").write("\n".join(L) + "\n")

    # stdout: makinece okunur özet
    print(json.dumps({
        "skor": say,
        "toplam_uc": len(ozet),
        "ucler": {p: ozet[p] for p in sorted(ozet)},
        "rapor": RAPOR,
    }, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
