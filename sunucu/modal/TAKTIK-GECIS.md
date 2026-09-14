# Taktik hat → Modal geçişi

**Durum:** Modal işçisi (`movelog_tactical.py`) kodda hazır. Üretim trafiği KV
bayrağına bağlı (`dispatch:motor` / isteğe bağlı `dispatch:motor-tac`).
3B hattı ayrı: `GECIS-HAZIR.md`. Bu belge yalnız **taktik CPU** hattı içindir.

Bayrak KV'de, kod değil → geri dönüş **yeniden dağıtım istemez**.

---

## Sırra konacak env (`movelog-tactical`)

RunPod template `egptl6t4pr` ile aynı küme. Değerleri koda/belgeye yazma —
template'ten veya `/opt/matrix/secrets` içinden oku.

| Değişken | Şart | Not |
|---|---|---|
| `HARITA_GEOCODING` | evet | Cloudflare katmanı |
| `HARITA_MATCHING` | evet | Cloudflare katmanı |
| `HARITA_MVT` | **ŞART** | yoksa `streets-v12` bembeyaz döner, `_road_density` her yeri kırsal sayar (31.08-02.09 arası bu hatayla çalışmış) |
| `HARITA_UZAK` | **ŞART** | `HARITA_MVT` ile aynı uç; karo yedeği |
| `MAPBOX_PUBLIC` | evet | public token (client-safe); handler `mapbox.conf`'a yazar |
| `TAC_CHUNKS` | isteğe bağlı | template'te var |
| `TAC_ECHO` | isteğe bağlı | template'te var |
| `TAC_TIMEOUT` | isteğe bağlı | varsayılan 3300; Modal `timeout=3900` bunun üzerine pay |

**Koyma:**

- `TAC_BACKEND` / `RENDER_DONE_SECRET` — sarmalayıcı `http://127.0.0.1:8780` + yer tutucu `yerel` yazar. Gerçek sır konteynere GİRMEZ.
- `RUNPOD_API_KEY` / `RUNPOD_ENDPOINT_ID` — 3B'deki `_redispatch` tuzağının taktik karşılığı yok; yine de konmasın.
- `HARITA_TABAN` / `HARITA_STATIK` — template'te yoktu; varsayılan `http://127.0.0.1:8890` yan-servise düşer. `http://127.0.0.1*` verilirse sarmalayıcı `HARITA_UZAK`'ı ondan **türetmez** (döngü; `basla.sh:14-19`).
- R2 kimliği — video `put_url` (presigned PUT) ile yüklenir.

HTTP uçları (`/run`, `/status`) ayrı sır: `movelog-dispatch` (`DISPATCH_SECRET`).
İmaj çekimi: `ghcr` sırrı (3B ile paylaşılır).

```bash
modal secret create movelog-tactical \
  HARITA_GEOCODING=... HARITA_MATCHING=... \
  HARITA_MVT=... HARITA_UZAK=... \
  MAPBOX_PUBLIC=... TAC_CHUNKS=... TAC_ECHO=... TAC_TIMEOUT=...
```

---

## Uçlar

- `https://daclen10--movelog-tactical-run.modal.run` → RunPod `/v2/{id}/run` eşleniği
- `https://daclen10--movelog-tactical-status.modal.run` → `/status` eşleniği

Yanıt şekilleri RunPod ile **birebir aynı**
(`{"id":...,"status":"IN_QUEUE"}` / `{"status":"COMPLETED","output":{...}}`).
Yanlış `secret` → 403; eksik gövde / iz yok → 400.

Donanım: GPU yok · `cpu=8` · `memory=32768` · `timeout=3900` · `max_containers=10` · `retries=2`.
Eşzamanlı girdi kapalı (mini müzik ucu job'a özel `music_url` tutar).

---

## Geçiş ve geri dönüş

Önce bu PR'daki dosyaların `/opt/matrix` altında olduğundan emin ol
(`sunucu/modal/` → `/opt/matrix/modal/`, `sunucu/cf/dispatch/` → `/opt/matrix/cf/dispatch/`).
`dispatch-modal.patch` bu işle birlikte **silindi**: içeriği artık repodaki `index.ts`'in
kendisinde ve yamanın son satırı taktiği `'runpod'`a sabitliyordu — `/opt/matrix`'te elde kalmış
bir kopyası varsa onu da sil, uygulanırsa bu geçişi sessizce geri alır.

```bash
bash /opt/matrix/modal/gecis-yap.sh                 # iki hat Modal
bash /opt/matrix/modal/gecis-yap.sh --yalniz-taktik # yalnız taktik (dispatch:motor-tac=modal)
bash /opt/matrix/modal/gecis-yap.sh --yalniz-render # yalnız 3B
bash /opt/matrix/modal/gecis-yap.sh --geri          # iki hat RunPod (yeniden dağıtım yok)
bash /opt/matrix/modal/gecis-yap.sh --geri --yalniz-taktik
bash /opt/matrix/modal/gecis-yap.sh --durum
```

Betik `movelog-tactical` sırrı yoksa ne yapılacağını yazıp **çıkar** (sessizce devam etmez).
Dağıtım sonrası `/run` uçlarına yanlış sır (403) ve eksik gövde (400) gönderir.

KV okunamazsa dispatch **RunPod** seçer (arıza ≠ sessiz motor değişimi).

---

## Doğrulama

Bu ortamda Modal hesabına dağıtım **koşturulmadı** — aşağıdaki adımlar operatörün
geçiş anında koşturacağı listedir; "sınandı" diye işaretlenmez.

1. **Sır:** `modal secret list` içinde `movelog-tactical` görünsün. `HARITA_MVT` + `HARITA_UZAK` dolu olsun.
2. **Dağıtım:** `cd /opt/matrix/modal && modal deploy movelog_tactical.py`
   GPU istemediğini logda doğrula (`cpu=8`, `memory=32768`, `timeout=3900`).
3. **`saglik()`:** `modal run movelog_tactical.py`
   Beklenen anahtarlar: `yan_servis` (kimlik `"katman": "harita-yan"`), `uzak_karo`, `font`,
   `mini_muzik`, `render_job`, `handler.ayiklanan_runpod_cagrisi` (boş değil), `cikis_ip`.
   `hepsi_ok: true`. GPU/GL anahtarı yok.
4. **HTTP uç:** yanlış sır → 403; `input: {}` → 400.
   Geçerli iş → `{"id":"fc-...","status":"IN_QUEUE"}`; `/status` → `COMPLETED` + `output`.
5. **Dispatch bayrağı:** `dispatch:motor=modal` iken taktik iş Modal'a, `=runpod` iken RunPod'a.
   `dispatch:motor-tac=runpod` iken taktik RunPod'da kalır, 3B ana bayrağı izler.
6. **Özel müzik:** `music: "lib:<id>"` Modal'a **gönderilir**, `input.music_url` dolu gelir
   (R2'de `usermusic/{user}/{mid}.m4a` varsa). Yoksa iş yine gider, `music_url` konmaz,
   mühürlü kod stok müziğe düşer. RunPod yolunda `ozelMuzik` ertelemesi **aynı** kalır.
7. **Uçtan uca tek video:** bilinen bir taktik `ride_id` kuyruğa; çıkan mp4 süre + LUFS +
   taban haritanın beyaz olup olmadığı (MVT yoksa bembeyaz — o zaman sır eksik).
8. **Mühür:** `git diff --stat -- sunucu/cf/tactical-runpod/route_gen.py render_job.py intro_gen.py outro_gen.py rp_handler_tac.py` boş.

---

## Bilinen sınırlar ve taşınmayanlar

- **Mühürlü dört dosya ve `rp_handler_tac.py` değişmedi.** Handler imajın içinde pişmiş;
  ihtiyaç duyulan her şey sarmalayıcıdan çözülür (AST yükleme, mini müzik ucu, yan-servis).
- **Cron bekçileri** RunPod taktik endpoint'ini izlemeye devam eder — geri dönüş için ayakta
  kalması doğru. Bu iş `sunucu/cf/cron/` altına dokunmaz.
- **`_redispatch` / RunPod sıçraması yok** (sır konmaz). Bozuk konteyner: `retries=2`.
- **Eşzamanlılık tavanı `max_containers=10`.** Mini müzik ucu yüzünden konteyner başına tek iş.
- **Özel müzik yalnız Modal'da.** RunPod'da sır hâlâ yok → `ozel-muzik` ertelemesi duruyor.
- **3B `GECIS-HAZIR.md`'deki "taktik taşınmadı" notu** bu işten sonra eskir; taktik bu belgeyle taşınır.
- **Maliyet** bu işte ölçülmedi. CPU 8/32, `timeout=3900`.
