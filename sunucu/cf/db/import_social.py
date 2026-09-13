#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
import_social.py — social.json → Cloudflare D1 (movelog-db) + R2 (tracks/) importu
==================================================================================

Faz 1 aracı. Kaynak: /opt/movelog/data/social.json (CANLI dosya — SADECE OKUNUR).
Hedef şema: /opt/matrix/cf/db/migrations/0001_init.sql (26 tablo).
Tüm eşleme kuralları: /opt/matrix/cf/db/SEMA-NOTLARI.md — bu script o kuralların
birebir uygulamasıdır:

  · pid = kayıt.pid ?? kayıt.sku                (iap_transactions — sku varyantı)
  · bool → int AÇIK cast                        (premium/ultra/admin/summary_enabled/
                                                 free_tactical_used/uploaded/is_group —
                                                 CHECK(x IN (0,1)) 'true' TEXT'ini reddeder)
  · dm çifti user_a <= user_b (ASLA katı <)     (self-DM 'baris|baris' canlı veride VAR)
  · summary_enabled/summary_hour: alan yoksa    (DEFAULT 0 basmak 45 kullanıcının özetini
    NULL yazılır, 0 YAZILMAZ                     kapatırdı; Worker COALESCE(...,1)/(...,21))
  · tv ?? 0, sokak_hak ?? 0, video_hak ?? 0     (JWT iptal + satın alınan haklar kaybolmasın)
  · uploaded_tracks D1'e GİRMEZ                 → R2 tracks/{ts}.json (idempotent: varsa ve
                                                 boyut aynıysa atla) + rides.track_key dolar
  · sahipsiz uid TOLERE edilir                  (u2f2e847e0430 gpucost+rides'ta var,
                                                 profiles'ta yok — varlık şartı ARANMAZ,
                                                 Worker join'leri LEFT JOIN)
  · rides.uid boş string AYNEN korunur          (boş = Barış fallback'i Worker'da sürer,
                                                 BARIS_UID'e SABİTLENMEZ — gölge-diff birebir)
  · state_json/prefs_json whitelist             (hr_live dahil — SEMA düzeltme turu)

FAZ 3'E BIRAKILANLAR (bu script BİLEREK ATLAR — KV işi):
  · free-push-sayac.json   → KV freepush:{uid}
  · ilkvideo-nudge.json    → KV nudge:ilkvideo:{uid}
  · render-bekci.json      → KV bekci:render
  · smsfix.json            → KV smsfix:{telefon}
  · video-kontrol.json     → KV bekci:video-kontrol
  · map-config.json        → KV mapconfig
  (announcement + free_tactical_enabled KV'ye DEĞİL D1 `config` tablosuna gider — o burada.)

İDEMPOTENTLİK:
  · Tüm satırlar INSERT OR REPLACE + doğal anahtarlar (mevcut kimlikler PK).
  · created_at/updated_at kaynaktaki doğal epoch'tan türetilir; olmayan yerde
    IMPORT_EPOCH = social.json mtime (deterministik → tekrar çalıştırma byte-aynı SQL üretir).
  · feedbacks id'si 'fb_<ts>_<md5(uid|ts|text)[:8]>' — rastgele DEĞİL, tekrar üretilebilir.
  · R2: aynı anahtar + aynı bayt boyutu → yükleme atlanır.

KULLANIM:
  python3 import_social.py --dry            # yalnız SQL üret + sayıları bas (D1/R2'ye dokunmaz)
  python3 import_social.py --local          # yerel D1'e uygula (wrangler --local) + R2 yükle
  python3 import_social.py --remote         # gerçek D1'e uygula (kimlik: movelog-cf.conf) + R2
  ek bayraklar: --no-r2 (R2 adımını atla), --source PATH (varsayılan canlı social.json)

SQL tek büyük dosyaya yazılır (satır satır execute ÇOK yavaş) ve wrangler
`d1 execute --file` ile uygulanır; dosya MAX_SQL_BYTES'ı aşarsa parçalara bölünür
(D1 dosya sınırı savunması). Multi-row VALUES (BATCH_ROWS satır/deyim) kullanılır.
D1 açık BEGIN/COMMIT kabul etmez — dosyada transaction deyimi YOKTUR.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys

# ── Sabitler ────────────────────────────────────────────────────────────────
SOURCE_DEFAULT = "/opt/movelog/data/social.json"
WRANGLER_DIR   = "/opt/matrix/cf/gps"          # wrangler.toml (movelog-db bağı) burada
SECRETS_CONF   = "/opt/matrix/secrets/movelog-cf.conf"
R2_CONF        = "/opt/movelog/backend/config.env"
OUT_DIR        = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
MAX_SQL_BYTES  = 900_000        # D1 --file savunma sınırı (dosya başına)
BATCH_ROWS     = 50             # multi-row INSERT satır sayısı

# ── EK GÖÇ modülleri sabitleri (diff-rapor-1 #4-#7, #9 veri boşlukları) ─────
BARIS_UID      = "u69be3f7e960e"
# ROUTES_DIR: main.py varsayılanı /opt/matrix/routes AMA canlı container
# Dockerfile'da ENV ROUTES_DIR=/opt/movelog/routes ile EZİLİR — üretimin
# gerçekte okuduğu dizin budur (82 ride'lık listedeki 7 yerel video buradan).
ROUTES_SRC     = "/opt/movelog/routes"
DATA_SRC       = "/opt/movelog/data"           # container DATA_DIR=/opt/movelog/data
YERELQ_SRC     = os.path.join(DATA_SRC, "yerelq")     # main.py _YERELQ (satır 2163)
KV_NAMESPACE   = "fd5db982178f49c589858c525755fba7"   # api/gps wrangler.toml [[kv_namespaces]]

# users kolonlarına giden profil alanları (kaynak_adı -> kolon)
USER_COL_MAP = {
    "name": "name", "handle": "handle", "alias": "alias", "phone": "phone",
    "lang": "lang", "premium_until": "premium_until", "trackerId": "tracker_id",
    "apple_sub": "apple_sub", "google_sub": "google_sub", "attest_key": "attest_key",
    "attested": "attested", "welcomed": "welcomed", "summary_hour": "summary_hour",
    "yerel_son": "yerel_son",
}
# bool → int AÇIK cast kolonları
USER_BOOL_COLS = {"premium": "premium", "ultra": "ultra", "admin": "admin",
                  "free_tactical_used": "free_tactical_used"}
# prefs_json whitelist'i (bütün-okunan tercihler)
PREFS_KEYS = {"summary_vid_mode", "summary_vid_speed", "summary_vid_aspect",
              "summary_vid_cam", "summary_vid_music", "video_line", "video_dot",
              "group_video", "safety_buddy", "safety_arrive", "safety_stop",
              "hr_share", "_not"}
# state_json whitelist'i (geçici canlı durum; hr_live SEMA düzeltme turuyla dahil)
STATE_KEYS = {"trackdbg", "last_beacon", "ptt_busy", "vc_invite", "vc_go",
              "hr_want_until", "hr_woke", "hr_live"}
# users üretiminde ayrıca ele alınanlar (kolon/pref/state dışında meşru olanlar)
USER_HANDLED = {"apns", "fcm", "avatar", "badges", "tv", "video_hak", "sokak_hak",
                "summary_enabled"}


# ── SQL yardımcıları ────────────────────────────────────────────────────────
def q(v):
    """Python değeri → SQL literali. bool BİLEREK reddedilir (açık cast zorunlu)."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        raise TypeError("bool doğrudan SQL'e basılamaz — int(v) ile açık cast şart")
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    raise TypeError(f"SQL'e çevrilemeyen tip: {type(v)}")


def jq(obj):
    """Nesne → JSON string literali (kolon *_json). None → NULL."""
    if obj is None:
        return "NULL"
    return q(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True))


def b(v, default=0):
    """bool/None → 0/1 AÇIK cast (SEMA kuralı)."""
    if v is None:
        return default
    return int(bool(v))


class SqlOut:
    """Tabloya göre multi-row INSERT OR REPLACE biriktirir; sayaç tutar."""

    def __init__(self):
        self.stmts = []                  # bitmiş SQL deyimleri
        self.counts = {}                 # tablo -> satır sayısı

    def rows(self, table, cols, rows):
        self.counts[table] = self.counts.get(table, 0) + len(rows)
        head = f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) VALUES\n"
        for i in range(0, len(rows), BATCH_ROWS):
            chunk = rows[i:i + BATCH_ROWS]
            vals = ",\n".join("(" + ", ".join(r) + ")" for r in chunk)
            self.stmts.append(head + vals + ";")

    def write_files(self, out_dir, base="import_social"):
        os.makedirs(out_dir, exist_ok=True)
        # eski parçaları temizle (parça sayısı azalırsa bayat dosya kalmasın)
        for f in os.listdir(out_dir):
            if f.startswith(base) and f.endswith(".sql"):
                os.remove(os.path.join(out_dir, f))
        files, cur, cur_len, idx = [], [], 0, 1
        for s in self.stmts:
            sb = len(s.encode("utf-8")) + 2
            if cur and cur_len + sb > MAX_SQL_BYTES:
                files.append(self._flush(out_dir, base, idx, cur)); idx += 1
                cur, cur_len = [], 0
            cur.append(s); cur_len += sb
        if cur:
            files.append(self._flush(out_dir, base, idx, cur))
        return files

    @staticmethod
    def _flush(out_dir, base, idx, stmts):
        path = os.path.join(out_dir, f"{base}_{idx:02d}.sql")
        with open(path, "w", encoding="utf-8") as f:
            f.write("-- Üretici: import_social.py (idempotent; INSERT OR REPLACE)\n")
            f.write("-- D1 kuralı: açık BEGIN/COMMIT YOK.\n\n")
            f.write("\n\n".join(stmts) + "\n")
        return path


# ── Eşleme (social.json → tablolar) ─────────────────────────────────────────
def build_sql(d, imp):
    """d = social.json içeriği, imp = IMPORT_EPOCH. Dönen: (SqlOut, uyarılar, beklenen_sayımlar)."""
    out, warn = SqlOut(), []
    profiles = d.get("profiles", {})
    seen = d.get("seen", {})

    # users ⇐ profiles + seen ------------------------------------------------
    ucols = ["uid", "name", "handle", "alias", "phone", "lang", "premium", "ultra",
             "admin", "premium_until", "tv", "video_hak", "sokak_hak", "tracker_id",
             "apple_sub", "google_sub", "attest_key", "attested", "welcomed",
             "free_tactical_used", "summary_enabled", "summary_hour", "last_seen_at",
             "yerel_son", "avatar_json", "badges_json", "prefs_json", "state_json",
             "created_at", "updated_at"]
    urows, trows = [], []
    for uid, p in profiles.items():
        col = {c: None for c in ucols}
        col["uid"] = uid
        for src, dst in USER_COL_MAP.items():
            if src in p:
                col[dst] = p[src]
        for src, dst in USER_BOOL_COLS.items():
            col[dst] = b(p.get(src))                     # yoksa 0 (DEFAULT ile aynı)
        # summary_enabled: yoksa NULL, 0 YAZMA (SEMA kuralı)
        col["summary_enabled"] = b(p["summary_enabled"]) if "summary_enabled" in p else None
        col["tv"] = int(p.get("tv", 0))                  # ?? 0 — JWT iptal sayacı
        col["video_hak"] = int(p.get("video_hak", 0))
        col["sokak_hak"] = int(p.get("sokak_hak", 0))
        col["last_seen_at"] = seen.get(uid)
        col["lang"] = p.get("lang", "en")
        prefs = {k: p[k] for k in PREFS_KEYS if k in p}
        state = {k: p[k] for k in STATE_KEYS if k in p}
        unknown = set(p) - set(USER_COL_MAP) - set(USER_BOOL_COLS) - PREFS_KEYS \
            - STATE_KEYS - USER_HANDLED
        if unknown:
            warn.append(f"profiles[{uid}] BİLİNMEYEN alan(lar) atlandı: {sorted(unknown)}")
        row = [q(col[c]) for c in ucols[:24]]
        row += [jq(p.get("avatar")), jq(p.get("badges")),
                jq(prefs or None), jq(state or None), q(imp), q(imp)]
        urows.append(row)
        # push_tokens ⇐ apns[] + fcm[]
        for plat in ("apns", "fcm"):
            for tok in p.get(plat, []):
                trows.append([q(tok), q(uid), q(plat), q(imp), q(imp)])
    # seen'de olup profiles'ta olmayan uid → yine users satırı (kayıp last_seen olmasın)
    for uid, ts in seen.items():
        if uid not in profiles:
            warn.append(f"seen[{uid}] profiles'ta yok — minimal users satırı yazıldı")
            row = [q(uid)] + ["NULL"] * 5 + [q(0)] * 3 + ["NULL", q(0), q(0), q(0)] \
                + ["NULL"] * 8 + [q(ts)] + ["NULL"] * 5 + [q(imp), q(imp)]
            urows.append(row)
    out.rows("users", ucols, urows)
    out.rows("push_tokens", ["token", "uid", "platform", "created_at", "updated_at"], trows)

    # friends ----------------------------------------------------------------
    rows = [[q(u), q(f), q(imp), q(imp)]
            for u, fl in d.get("friends", {}).items() for f in fl]
    out.rows("friends", ["uid", "friend_uid", "created_at", "updated_at"], rows)

    # friend_requests ⇐ freqs (hedef -> {isteyen: ts}) -----------------------
    rows = [[q(tgt), q(rq), q(ts), q(ts)]
            for tgt, m in d.get("freqs", {}).items() for rq, ts in m.items()]
    out.rows("friend_requests",
             ["target_uid", "requester_uid", "created_at", "updated_at"], rows)

    # invites ----------------------------------------------------------------
    rows = [[q(code), q(v["by"]), q(v.get("ts", imp)), q(v.get("ts", imp))]
            for code, v in d.get("invites", {}).items()]
    out.rows("invites", ["code", "by_uid", "created_at", "updated_at"], rows)

    # dm_messages ⇐ dm ("a|b" -> mesajlar); self-DM (a==b) MEŞRU ------------
    rows = []
    for pair, msgs in d.get("dm", {}).items():
        parts = pair.split("|")
        if len(parts) != 2:
            warn.append(f"dm çift anahtarı çözülemedi, ATLANDI: {pair!r}")
            continue
        a, b_ = sorted(parts)            # user_a <= user_b garantisi (== olabilir)
        for m in msgs:
            rows.append([q(m["id"]), q(a), q(b_), q(m["frm"]),
                         q(m.get("type", "text")), q(m.get("text", "")),
                         q(m.get("media")), q(m["ts"]), q(m["ts"]), q(m["ts"])])
    out.rows("dm_messages", ["id", "user_a", "user_b", "frm", "msg_type", "text",
                             "media", "ts", "created_at", "updated_at"], rows)

    # dm_reads ⇐ read --------------------------------------------------------
    rows = [[q(uid), q(peer), q(ts), q(ts), q(ts)]
            for uid, m in d.get("read", {}).items() for peer, ts in m.items()]
    out.rows("dm_reads", ["uid", "peer_uid", "read_at", "created_at", "updated_at"], rows)

    # rides ⇐ detected_rides -------------------------------------------------
    ut_keys = set(d.get("uploaded_tracks", {}).keys())
    rows = []
    for rid, r in d.get("detected_rides", {}).items():
        uploaded = b(r.get("uploaded"))
        track_key = None
        if uploaded and str(r.get("ts")) in ut_keys:
            track_key = f"tracks/{int(r['ts'])}.json"
        ts = r["ts"]
        # uid boş/eksikse AYNEN taşınır (Barış fallback'i Worker'da — SEMA kuralı)
        rows.append([q(rid), q(r.get("user")), q(r.get("date")), q(ts), q(r["to"]),
                     q(r.get("type")), q(r.get("km")), q(r.get("lat")), q(r.get("lon")),
                     q(uploaded), q(track_key), q(ts), q(ts)])
    out.rows("rides", ["rid", "uid", "date", "ts", "to_ts", "ride_type", "km", "lat",
                       "lon", "uploaded", "track_key", "created_at", "updated_at"], rows)

    # ride_type_overrides ⇐ ride_types (sarkık rid'ler MEŞRU — indirgeme yok)
    rows = [[q(rid), q(t), "NULL", q(imp), q(imp)]
            for rid, t in d.get("ride_types", {}).items()]
    out.rows("ride_type_overrides",
             ["rid", "ride_type", "uid", "created_at", "updated_at"], rows)

    # deleted_rides (global set) ---------------------------------------------
    rows = [[q(rid), q(imp), q(imp)] for rid in d.get("deleted_rides", [])]
    out.rows("deleted_rides", ["rid", "created_at", "updated_at"], rows)

    # videos ⇐ cloud_videos --------------------------------------------------
    rows = []
    for rid, v in d.get("cloud_videos", {}).items():
        rows.append([q(rid), q(v.get("user")), q(v["key"]), q(v.get("date")),
                     q(v["ts"]), q(v["to"]), q(v.get("type")), q(v.get("mode")),
                     q(v.get("speed")), q(v.get("aspect")), q(v.get("size", 0)),
                     q(v.get("km")), q(v.get("done")), q(b(v.get("group"))),
                     jq(v.get("users")), q(v.get("done", v["ts"])),
                     q(v.get("done", v["ts"]))])
    out.rows("videos", ["rid", "uid", "r2_key", "date", "ts", "to_ts", "ride_type",
                        "mode", "speed", "aspect", "size", "km", "done_at", "is_group",
                        "users_json", "created_at", "updated_at"], rows)

    # pending_videos ----------------------------------------------------------
    rows = [[q(vid), q(v["user"]), q(v.get("date")), q(v["ts"]), q(v["to"]),
             q(v.get("type")), q(v.get("mode")), q(v.get("queued", imp)),
             q(v.get("queued", imp)), q(v.get("queued", imp))]
            for vid, v in d.get("pending_videos", {}).items()]
    out.rows("pending_videos", ["vid", "uid", "date", "ts", "to_ts", "ride_type",
                                "mode", "queued_at", "created_at", "updated_at"], rows)

    # failed_videos (5 alan null olabilir — nullable kolonlar) ----------------
    rows = [[q(vid), q(v.get("user")), q(v.get("reason")), q(v["at"]), q(v.get("date")),
             q(v.get("ts")), q(v.get("to")), q(v.get("type")), q(v.get("mode")),
             q(v["at"]), q(v["at"])]
            for vid, v in d.get("failed_videos", {}).items()]
    out.rows("failed_videos", ["vid", "uid", "reason", "failed_at", "date", "ts",
                               "to_ts", "ride_type", "mode", "created_at", "updated_at"],
             rows)

    # clubs + club_members ----------------------------------------------------
    crows, mrows = [], []
    for cid, c in d.get("clubs", {}).items():
        created = c.get("created", imp)
        crows.append([q(cid), q(c["name"]), q(c["owner"]), q(c["code"]),
                      q(created), q(created)])
        for uid in c.get("members", []):
            mrows.append([q(cid), q(uid), q(created), q(created)])
    out.rows("clubs", ["cid", "name", "owner_uid", "join_code",
                       "created_at", "updated_at"], crows)
    out.rows("club_members", ["cid", "uid", "created_at", "updated_at"], mrows)

    # shared_routes + hedefleri (runtime anahtarı — bugün dosyada yok) --------
    srows, strows = [], []
    for sid, s in d.get("shared_routes", {}).items():
        rr = s.get("rideref") or {}
        ts = s.get("ts", imp)
        srows.append([q(sid), q(s["from"]), q(s.get("ride_id")), q(s.get("km", 0)),
                      q(s.get("date")), q(ts), q(rr.get("ts")), q(rr.get("to_t")),
                      q(ts), q(ts)])
        ridden = s.get("ridden") or {}
        for uid in s.get("to", []):
            strows.append([q(sid), q(uid), q(ridden.get(uid)), q(ts), q(ts)])
        for uid, rts in ridden.items():          # 'to' dışında ridden yazılmış uid savunması
            if uid not in s.get("to", []):
                strows.append([q(sid), q(uid), q(rts), q(ts), q(ts)])
    out.rows("shared_routes", ["sid", "from_uid", "ride_id", "km", "date", "ts",
                               "rideref_ts", "rideref_to", "created_at", "updated_at"],
             srows)
    out.rows("shared_route_targets",
             ["sid", "uid", "ridden_at", "created_at", "updated_at"], strows)

    # ptt_acl (iki şekil: {"users":[..]} | {"club":cid}) ----------------------
    rows = []
    for pid, a in d.get("ptt_acl", {}).items():
        digits = "".join(ch for ch in pid[1:11] if ch.isdigit())  # 'p<ts10><hex>'
        created = int(digits) if len(digits) == 10 else imp
        rows.append([q(pid), q(a.get("club")), jq(a.get("users")), q(created), q(created)])
    out.rows("ptt_acl", ["pid", "club_cid", "users_json", "created_at", "updated_at"], rows)

    # gift_codes --------------------------------------------------------------
    rows = [[q(code), q(g.get("used_by")), q(g.get("used_at")),
             q(g.get("created", imp)), q(g.get("used_at") or g.get("created", imp))]
            for code, g in d.get("giftcodes", {}).items()]
    out.rows("gift_codes", ["code", "used_by", "used_at", "created_at", "updated_at"], rows)

    # iap_transactions (pid ?? sku — SEMA kuralı) -----------------------------
    rows = []
    for tid, t in d.get("iap_used", {}).items():
        pid = t.get("pid") or t.get("sku")
        if pid is None:
            warn.append(f"iap_used[{tid}] pid DE sku DA yok — ATLANDI")
            continue
        rows.append([q(tid), q(t["user"]), q(pid), q(t["ts"]), q(t["ts"]), q(t["ts"])])
    out.rows("iap_transactions",
             ["tid", "uid", "pid", "ts", "created_at", "updated_at"], rows)

    # render_counts (heterojen sayaç anahtarları; değer REAL) -----------------
    rows = [[q(uid), q(key), q(float(val)), q(imp), q(imp)]
            for uid, m in d.get("render_counts", {}).items() for key, val in m.items()]
    out.rows("render_counts",
             ["uid", "counter_key", "value", "created_at", "updated_at"], rows)

    # gpu_costs ⇐ gpucost (uid -> {ay: {secs, videos, g3d_secs}}) -------------
    rows = [[q(uid), q(month), q(int(mv.get("secs", 0))), q(int(mv.get("videos", 0))),
             q(int(mv.get("g3d_secs", 0))), q(imp), q(imp)]
            for uid, months in d.get("gpucost", {}).items()
            for month, mv in months.items()]
    out.rows("gpu_costs", ["uid", "month", "secs", "videos", "g3d_secs",
                           "created_at", "updated_at"], rows)

    # free_tactical_devices (runtime listesi) ---------------------------------
    rows = [[q(k), q(imp), q(imp)] for k in d.get("free_tactical_devices", [])]
    out.rows("free_tactical_devices", ["attest_key", "created_at", "updated_at"], rows)

    # feedbacks (runtime listesi; id deterministik üretilir) ------------------
    rows = []
    for fb in d.get("feedbacks", []):
        ts = fb.get("ts", imp)
        h = hashlib.md5(f"{fb.get('user')}|{ts}|{fb.get('text', '')}"
                        .encode("utf-8")).hexdigest()[:8]
        rows.append([q(f"fb_{ts}_{h}"), q(fb["user"]), q(fb.get("name")),
                     q(fb.get("handle")), q(fb.get("lang")), q(fb.get("text", "")),
                     q(ts), q(ts), q(ts)])
    out.rows("feedbacks", ["id", "uid", "name", "handle", "lang", "text", "ts",
                           "created_at", "updated_at"], rows)

    # config ⇐ announcement + free_tactical_enabled ---------------------------
    rows = []
    if "announcement" in d:
        ann_ts = d["announcement"].get("ts", imp)
        rows.append([q("announcement"), jq(d["announcement"]), q(ann_ts), q(ann_ts)])
    if "free_tactical_enabled" in d:
        rows.append([q("free_tactical_enabled"),
                     q(json.dumps(bool(d["free_tactical_enabled"]))), q(imp), q(imp)])
    out.rows("config", ["key", "value_json", "created_at", "updated_at"], rows)

    # Beklenen sayımlar (kaynaktan bağımsız hesap — rapor karşılaştırması)
    expected = {
        "users": len(profiles) + len([u for u in seen if u not in profiles]),
        "push_tokens": sum(len(p.get("apns", [])) + len(p.get("fcm", []))
                           for p in profiles.values()),
        "friends": sum(len(v) for v in d.get("friends", {}).values()),
        "friend_requests": sum(len(v) for v in d.get("freqs", {}).values()),
        "invites": len(d.get("invites", {})),
        "dm_messages": sum(len(v) for v in d.get("dm", {}).values()),
        "dm_reads": sum(len(v) for v in d.get("read", {}).values()),
        "rides": len(d.get("detected_rides", {})),
        "ride_type_overrides": len(d.get("ride_types", {})),
        "deleted_rides": len(d.get("deleted_rides", [])),
        "videos": len(d.get("cloud_videos", {})),
        "pending_videos": len(d.get("pending_videos", {})),
        "failed_videos": len(d.get("failed_videos", {})),
        "clubs": len(d.get("clubs", {})),
        "club_members": sum(len(c.get("members", []))
                            for c in d.get("clubs", {}).values()),
        "shared_routes": len(d.get("shared_routes", {})),
        "shared_route_targets": len(strows),
        "ptt_acl": len(d.get("ptt_acl", {})),
        "gift_codes": len(d.get("giftcodes", {})),
        "iap_transactions": out.counts.get("iap_transactions", 0),
        "render_counts": sum(len(v) for v in d.get("render_counts", {}).values()),
        "gpu_costs": sum(len(v) for v in d.get("gpucost", {}).values()),
        "free_tactical_devices": len(d.get("free_tactical_devices", [])),
        "feedbacks": len(d.get("feedbacks", [])),
        "config": int("announcement" in d) + int("free_tactical_enabled" in d),
    }
    return out, warn, expected


# ── R2: uploaded_tracks → tracks/{ts}.json (idempotent) ─────────────────────
def load_env_file(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _r2_client():
    import boto3
    env = load_env_file(R2_CONF)
    s3 = boto3.client("s3", endpoint_url=env["R2_ENDPOINT"],
                      aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                      aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
                      region_name="auto")
    return s3, env["R2_BUCKET"]


_CTYPE = {".mp4": "video/mp4", ".m4a": "audio/mp4", ".json": "application/json"}


def r2_sync_files(pairs, dry):
    """pairs: [(r2_key, yerel_yol)]. Var + boyut aynı → atla (tracks ile aynı kural).
    Dönen: (rapor satırları, yüklenen_bayt, atlanan_sayı, yüklenen_sayı)."""
    report, up_b, n_skip, n_up = [], 0, 0, 0
    if dry:
        for key, path in pairs:
            sz = os.path.getsize(path)
            report.append(f"{key}  {sz} B  (dry — yüklenmedi)")
        return report, 0, 0, 0
    s3, bucket = _r2_client()
    for key, path in pairs:
        sz = os.path.getsize(path)
        try:
            head = s3.head_object(Bucket=bucket, Key=key)
            if head["ContentLength"] == sz:
                report.append(f"{key}  {sz} B  ATLANDI (aynı boyut mevcut)")
                n_skip += 1
                continue
            report.append(f"{key}  {sz} B  GÜNCELLENDİ (eski {head['ContentLength']} B)")
        except s3.exceptions.ClientError as e:
            if e.response["Error"]["Code"] not in ("404", "NoSuchKey"):
                raise
            report.append(f"{key}  {sz} B  YÜKLENDİ (yoktu)")
        ctype = _CTYPE.get(os.path.splitext(key)[1], "application/octet-stream")
        with open(path, "rb") as f:
            s3.put_object(Bucket=bucket, Key=key, Body=f, ContentType=ctype)
        up_b += sz; n_up += 1
    return report, up_b, n_skip, n_up


def r2_upload_tracks(tracks, dry):
    """tracks: {ts_str: [nokta...]}. Var + boyut aynı → atla. Dönen: rapor satırları."""
    report = []
    bodies = {ts: json.dumps(pts, separators=(",", ":")).encode("utf-8")
              for ts, pts in tracks.items()}
    if dry:
        for ts, body in bodies.items():
            report.append(f"tracks/{ts}.json  {len(body)} B  (dry — yüklenmedi)")
        return report
    s3, bucket = _r2_client()
    for ts, body in bodies.items():
        key = f"tracks/{ts}.json"
        try:
            head = s3.head_object(Bucket=bucket, Key=key)
            if head["ContentLength"] == len(body):
                report.append(f"{key}  {len(body)} B  ATLANDI (aynı boyut mevcut)")
                continue
            report.append(f"{key}  {len(body)} B  GÜNCELLENDİ "
                          f"(eski {head['ContentLength']} B)")
        except s3.exceptions.ClientError as e:
            if e.response["Error"]["Code"] not in ("404", "NoSuchKey"):
                raise
            report.append(f"{key}  {len(body)} B  YÜKLENDİ (yoktu)")
        s3.put_object(Bucket=bucket, Key=key, Body=body,
                      ContentType="application/json")
    return report


# ═══════════════════════════════════════════════════════════════════════════
# EK GÖÇ MODÜLLERİ (diff-rapor-1.md #4-#7, #9 — veri boşlukları; hepsi idempotent)
# Çalıştırma: --ek yerelvideo,muzik,ptt,yerelq,dmreads  (veya --ek hepsi)
# --ek verilince ANA social.json importu KOŞULMAZ; yalnız seçilen modüller koşar.
# ═══════════════════════════════════════════════════════════════════════════
import glob as _glob
import re as _re

# main.py:204 RX birebir — yerel render dosya adı deseni
_RX_ROTA = _re.compile(r"^rota_(\d{4}-\d{2}-\d{2})_(\d+)_([a-z0-9]+)_([a-z]+)_([0-9x]+)\.mp4$")
_TYPE_EMOJI = {"moto", "car", "bike", "run", "walk"}       # main.py:205 anahtar kümesi


def _tcx_tipi(day):
    """main.py _activity_type_for (208-216) birebir: aynı günün tcx'lerinden tip;
    glob sırasında SON eşleşen kazanır (Python davranışı aynen)."""
    best = ""
    for f in _glob.glob(os.path.join(ROUTES_SRC, f"*_{day}_*.tcx")):
        t = os.path.basename(f).split("_", 1)[0]
        if t in _TYPE_EMOJI:
            best = t
    return best


def _yan_meta(day, ts):
    """main.py _ride_meta (219-224) birebir: rota_{day}_{ts}.json yan dosyası."""
    try:
        return json.load(open(os.path.join(ROUTES_SRC, f"rota_{day}_{ts}.json")))
    except Exception:
        return {}


def ek_yerel_videolar(d, dry, remote, no_r2):
    """#4: Barış'ın yerel disk render'ları (ROUTES_SRC/rota_*.mp4) →
    R2 videos/yerel/{dosyaadi} + D1 videos satırı.
      · rid = {day}_{ts} (main.py:283), aynı rid'de EN YENİ mtime kazanır (287)
      · mode/speed/aspect dosya adından AYNEN (aspect '16x9'/'9x16' — ':' YOK)
      · done_at = int(mtime) (304), uid = BARIS_UID (277: yalnız Barış görür)
      · ride_type = tcx tahmini (289; override'lar Worker'da okuma anında biner)
      · to_ts = yan meta 'to' ?? ts+7200 (295)
      · deleted_rides'takiler atlanır; cloud_videos'ta AYNI rid varsa mtime
        kıyası main.py:312 birebir (yerel >= cloud.done → yerel kazanır)
    ⚠️ R2 lifecycle 'videos-expire-interim7d' prefix videos/ altını 7 GÜNDE
    siliyor — videos/yerel/ de kapsama girer; kalıcılık kararı Barış'a raporlanır."""
    deleted = set(d.get("deleted_rides", []))
    cloud = d.get("cloud_videos", {})
    by_id = {}                                   # rid -> (path, mtime, mode, speed, aspect, size)
    atlanan = []
    for f in sorted(_glob.glob(os.path.join(ROUTES_SRC, "rota_*.mp4"))):
        m = _RX_ROTA.match(os.path.basename(f))
        if not m:
            continue                             # 4-parçalı/serbest adlar main.py'de de elenir
        day, ts, mode, speed, aspect = m.groups()
        rid = f"{day}_{ts}"
        if rid in deleted:
            atlanan.append(f"{rid} (deleted_rides)")
            continue
        mt = os.path.getmtime(f)
        if rid in by_id and by_id[rid][1] >= mt:
            continue                             # en yenisi kazanır (main.py:287)
        by_id[rid] = (f, mt, mode, speed, aspect, os.path.getsize(f))
    # cloud_videos çakışması: main.py:312 — yerel _mt >= cloud done ise yerel kazanır
    for rid in list(by_id):
        cv = cloud.get(rid)
        if cv and by_id[rid][1] < int(cv.get("done", 0)):
            atlanan.append(f"{rid} (cloud daha yeni: done={cv.get('done')})")
            del by_id[rid]

    # R2 yüklemesi
    pairs = [(f"videos/yerel/{os.path.basename(v[0])}", v[0])
             for rid, v in sorted(by_id.items())]
    rapor, up_b, n_skip, n_up = ([], 0, 0, 0)
    if not no_r2:
        rapor, up_b, n_skip, n_up = r2_sync_files(pairs, dry)

    # D1 satırları
    out = SqlOut()
    rows = []
    for rid, (path, mt, mode, speed, aspect, size) in sorted(by_id.items()):
        day, ts = rid.rsplit("_", 1)
        meta = _yan_meta(day, ts)
        to_ts = int(meta.get("to") or (int(ts) + 2 * 3600))
        typ = _tcx_tipi(day)                     # override'sız tahmin (Worker okurken bindirir)
        done = int(mt)
        rows.append([q(rid), q(BARIS_UID), q(f"videos/yerel/{os.path.basename(path)}"),
                     q(day), q(int(ts)), q(to_ts), q(typ), q(mode), q(speed),
                     q(aspect), q(size), "NULL", q(done), q(0), "NULL",
                     q(done), q(done)])
    out.rows("videos", ["rid", "uid", "r2_key", "date", "ts", "to_ts", "ride_type",
                        "mode", "speed", "aspect", "size", "km", "done_at",
                        "is_group", "users_json", "created_at", "updated_at"], rows)
    files = out.write_files(OUT_DIR, base="ek_yerelvideo")
    if not dry:
        for f in files:
            wrangler_d1(["--file", f], remote)
    print(f"\n[yerelvideo] rid={len(by_id)}  D1 satır={len(rows)}  "
          f"R2 yüklendi={n_up} ({up_b/1e6:.1f} MB)  atlandı(aynı boyut)={n_skip}"
          f"{'  (dry)' if dry else ''}")
    for a in atlanan:
        print(f"[yerelvideo]   atlanan: {a}")
    for line in rapor:
        print(f"[yerelvideo]   {line}")
    return {"rid": len(by_id), "d1": len(rows), "r2_up": n_up, "r2_bayt": up_b,
            "r2_atla": n_skip, "atlanan": atlanan}


def ek_muzik(dry):
    """#6: müzik varlıkları → R2 (D1/KV kaydı GEREKMEZ — grup4 adları
    usermusic/{u}/names.json'dan, dosyaları head/get ile doğrudan R2'den okur):
      · DATA_SRC/usermusic/{u}/*            → usermusic/{u}/*   (kütüphane+active+names)
      · DATA_SRC/stockmusic/*.m4a           → stockmusic/*      (ref=stock: çözümü)
      · DATA_SRC/ridephotos/*/music.m4a     → ridephotos/*/music.m4a (ref=upload çözümü)"""
    pairs = []
    umdir = os.path.join(DATA_SRC, "usermusic")
    for u in sorted(os.listdir(umdir)) if os.path.isdir(umdir) else []:
        ud = os.path.join(umdir, u)
        if not os.path.isdir(ud):
            continue
        for fn in sorted(os.listdir(ud)):
            if fn.endswith((".m4a", ".json")):
                pairs.append((f"usermusic/{u}/{fn}", os.path.join(ud, fn)))
    smdir = os.path.join(DATA_SRC, "stockmusic")
    for fn in sorted(os.listdir(smdir)) if os.path.isdir(smdir) else []:
        if fn.endswith(".m4a"):
            pairs.append((f"stockmusic/{fn}", os.path.join(smdir, fn)))
    for p in sorted(_glob.glob(os.path.join(DATA_SRC, "ridephotos", "*", "music.m4a"))):
        ses = os.path.basename(os.path.dirname(p))
        pairs.append((f"ridephotos/{ses}/music.m4a", p))
    rapor, up_b, n_skip, n_up = r2_sync_files(pairs, dry)
    print(f"\n[muzik] dosya={len(pairs)}  yüklendi={n_up} ({up_b/1e6:.1f} MB)  "
          f"atlandı(aynı boyut)={n_skip}{'  (dry)' if dry else ''}")
    for line in rapor:
        print(f"[muzik]   {line}")
    return {"dosya": len(pairs), "r2_up": n_up, "r2_bayt": up_b, "r2_atla": n_skip}


def ek_ptt(dry):
    """#7: telsiz klipleri → R2 (ptt_acl D1'de ZATEN var — ana import yazdı):
      · DATA_SRC/ptt/*.m4a      → ptt/*       (24 saatlik telsiz — R2 lifecycle'a devir)
      · DATA_SRC/voicemsg/*.m4a → voicemsg/*  (30 günlük arkadaş sesli mesajı)"""
    pairs = []
    for sub in ("ptt", "voicemsg"):
        dd = os.path.join(DATA_SRC, sub)
        for fn in sorted(os.listdir(dd)) if os.path.isdir(dd) else []:
            if fn.endswith(".m4a"):
                pairs.append((f"{sub}/{fn}", os.path.join(dd, fn)))
    rapor, up_b, n_skip, n_up = r2_sync_files(pairs, dry)
    print(f"\n[ptt] dosya={len(pairs)}  yüklendi={n_up} ({up_b/1e6:.1f} MB)  "
          f"atlandı(aynı boyut)={n_skip}{'  (dry)' if dry else ''}")
    for line in rapor:
        print(f"[ptt]   {line}")
    return {"dosya": len(pairs), "r2_up": n_up, "r2_bayt": up_b, "r2_atla": n_skip}


def ek_yerelq(dry, remote):
    """#9: cihazda-üretim kuyruğu → KV. main.py _YERELQ/{uid}.json (2163-2184) →
    KV 'yerelq:{uid}' (grup6 local_renders okuyucusunun beklediği yapı: JSON dizi).
    KV put doğası gereği idempotent (aynı değer üstüne yazılır)."""
    n = 0
    for p in sorted(_glob.glob(os.path.join(YERELQ_SRC, "*.json"))):
        uid = os.path.basename(p)[:-5]
        lst = json.load(open(p))                 # bozuksa patlasın — sessiz bozuk veri yazma
        if not isinstance(lst, list):
            raise SystemExit(f"yerelq {p}: liste değil ({type(lst).__name__})")
        key = f"yerelq:{uid}"
        if dry:
            print(f"[yerelq] {key}  {len(lst)} iş  (dry — yazılmadı)")
            n += 1
            continue
        cmd = ["npx", "wrangler", "kv", "key", "put", key, "--path", p,
               "--namespace-id", KV_NAMESPACE,
               "--remote" if remote else "--local"]
        r = subprocess.run(cmd, cwd=WRANGLER_DIR, env=wrangler_env(remote),
                           capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"wrangler kv HATA ({key}):\n{r.stdout}\n{r.stderr}")
        print(f"[yerelq] {key}  {len(lst)} iş  YAZILDI")
        n += 1
    print(f"\n[yerelq] anahtar={n}{'  (dry)' if dry else ''}")
    return {"kv": n}


def ek_dmreads(d, dry, remote):
    """#10 (drift): dm_reads + users.last_seen_at'i kaynaktan YENİDEN bas.
    dm_reads: tam tazeleme (DELETE + INSERT — üretimde okunup düşen unread'ler
    ancak böyle yakalanır); users: SADECE last_seen_at/updated_at UPDATE
    (diğer kolonlara dokunulmaz — Worker'ın kendi yazdıkları ezilmesin)."""
    out = SqlOut()
    out.stmts.append("DELETE FROM dm_reads;")
    rows = [[q(uid), q(peer), q(ts), q(ts), q(ts)]
            for uid, m in d.get("read", {}).items() for peer, ts in m.items()]
    out.rows("dm_reads", ["uid", "peer_uid", "read_at", "created_at", "updated_at"], rows)
    seen = d.get("seen", {})
    for uid, ts in seen.items():
        out.stmts.append(f"UPDATE users SET last_seen_at = {q(ts)}, "
                         f"updated_at = {q(ts)} WHERE uid = {q(uid)};")
    files = out.write_files(OUT_DIR, base="ek_dmreads")
    if not dry:
        for f in files:
            wrangler_d1(["--file", f], remote)
    print(f"\n[dmreads] dm_reads={len(rows)} (tam tazeleme)  "
          f"last_seen UPDATE={len(seen)}{'  (dry)' if dry else ''}")
    return {"dm_reads": len(rows), "last_seen": len(seen)}


EK_MODULLER = ("yerelvideo", "muzik", "ptt", "yerelq", "dmreads")


# ── wrangler yürütme + sayım ────────────────────────────────────────────────
def wrangler_env(remote):
    env = dict(os.environ)
    if remote and not env.get("CLOUDFLARE_API_TOKEN"):
        conf = load_env_file(SECRETS_CONF)
        env["CLOUDFLARE_API_TOKEN"] = conf["MOVELOG_CF_TOKEN"]
        env["CLOUDFLARE_ACCOUNT_ID"] = conf["MOVELOG_CF_ACCOUNT_ID"]
    return env


def wrangler_d1(args_extra, remote):
    cmd = ["npx", "wrangler", "d1", "execute", "movelog-db",
           "--remote" if remote else "--local", "-y"] + args_extra
    r = subprocess.run(cmd, cwd=WRANGLER_DIR, env=wrangler_env(remote),
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"wrangler HATA ({' '.join(cmd)}):\n{r.stdout}\n{r.stderr}")
    return r.stdout


def d1_counts(tables, remote):
    # miniflare'in SQLite'ı compound SELECT terim sayısını düşük sınırlıyor → 5'erli parça
    # videos: --ek yerelvideo satırları (r2_key videos/yerel/%) social.json'da YOKTUR —
    # kaynak kıyası bunları dışlar (yoksa her tam-import 'UYUŞMUYOR' diye bağırır).
    filtre = {"videos": " WHERE r2_key NOT LIKE 'videos/yerel/%'"}
    got = {}
    for i in range(0, len(tables), 5):
        chunk = tables[i:i + 5]
        sel = " UNION ALL ".join(
            f"SELECT '{t}' AS tablo, count(*) AS n FROM {t}{filtre.get(t, '')}"
            for t in chunk)
        outp = wrangler_d1(["--command", sel, "--json"], remote)
        data = json.loads(outp[outp.index("["):])
        got.update({row["tablo"]: row["n"] for row in data[0]["results"]})
    return got


# ── ana akış ────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="social.json → D1/R2 importu (idempotent)")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--local", action="store_true", help="yerel D1'e uygula")
    mode.add_argument("--remote", action="store_true", help="gerçek D1'e uygula")
    mode.add_argument("--dry", action="store_true", help="yalnız SQL üret + say")
    ap.add_argument("--source", default=SOURCE_DEFAULT)
    ap.add_argument("--no-r2", action="store_true", help="R2 track yüklemesini atla")
    ap.add_argument("--ek", default=None, metavar="MODULLER",
                    help="SADECE ek göç modüllerini koş (ana import koşmaz): "
                         + ",".join(EK_MODULLER) + " veya 'hepsi'")
    a = ap.parse_args()

    with open(a.source, encoding="utf-8") as f:      # CANLI dosya — SADECE OKUMA
        d = json.load(f)
    imp = int(os.path.getmtime(a.source))            # deterministik import epoch'u

    # ── EK GÖÇ MODÜLLERİ (--ek): ana import'u ATLAYARAK yalnız seçilenler ──
    if a.ek:
        secim = EK_MODULLER if a.ek == "hepsi" else tuple(a.ek.split(","))
        bilinmeyen = [m for m in secim if m not in EK_MODULLER]
        if bilinmeyen:
            sys.exit(f"bilinmeyen --ek modülü: {bilinmeyen} (geçerli: {EK_MODULLER})")
        ozet = {}
        if "yerelvideo" in secim:
            ozet["yerelvideo"] = ek_yerel_videolar(d, a.dry, a.remote, a.no_r2)
        if "muzik" in secim:
            ozet["muzik"] = ek_muzik(a.dry)
        if "ptt" in secim:
            ozet["ptt"] = ek_ptt(a.dry)
        if "yerelq" in secim:
            ozet["yerelq"] = ek_yerelq(a.dry, a.remote)
        if "dmreads" in secim:
            ozet["dmreads"] = ek_dmreads(d, a.dry, a.remote)
        print("\nÖZET (JSON):")
        print(json.dumps(ozet, ensure_ascii=False, indent=1))
        return

    out, warn, expected = build_sql(d, imp)
    files = out.write_files(OUT_DIR)
    total_b = sum(os.path.getsize(f) for f in files)
    print(f"SQL üretildi: {len(files)} dosya, {len(out.stmts)} deyim, "
          f"{sum(out.counts.values())} satır, {total_b} B")
    for f in files:
        print(f"  {f} ({os.path.getsize(f)} B)")
    for w in warn:
        print(f"UYARI: {w}")

    # R2 (dry'da sadece listeler)
    if not a.no_r2:
        print("\nR2 tracks/:")
        for line in r2_upload_tracks(d.get("uploaded_tracks", {}), dry=a.dry):
            print(f"  {line}")

    if a.dry:
        print("\n--dry: D1'e uygulanmadı. Beklenen satır sayıları:")
        for t in sorted(expected):
            print(f"  {t:24s} {expected[t]}")
        return

    remote = a.remote
    print(f"\nD1'e uygulanıyor ({'REMOTE' if remote else 'local'})...")
    for f in files:
        wrangler_d1(["--file", f], remote)
        print(f"  uygulandı: {os.path.basename(f)}")

    # rapor: kaynak vs D1
    tables = sorted(expected)
    got = d1_counts(tables, remote)
    print(f"\n{'tablo':24s} {'kaynak':>7s} {'D1':>7s}  durum")
    ok = True
    for t in tables:
        durum = "OK" if expected[t] == got.get(t) else "UYUŞMUYOR"
        if durum != "OK":
            ok = False
        print(f"{t:24s} {expected[t]:7d} {got.get(t, -1):7d}  {durum}")
    print("\nSONUÇ: " + ("TÜM TABLOLAR UYUŞUYOR" if ok else "UYUŞMAYAN TABLOLAR VAR"))


if __name__ == "__main__":
    main()
