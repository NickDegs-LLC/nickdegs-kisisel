# RunPod → Modal geçişi: HAZIR, TEK KOMUT

**Durum (07.09):** Modal tarafı tamamen kurulu ve sınandı. Üretim trafiği HÂLÂ RunPod'da.
Barış'ın talimatı: *"bakiye bitince geçeriz"*. Bakiye $10,90 → uyarı $6'da düşer (~13 video).

## Geçiş anı geldiğinde
Mac'ten (repo kökü, örn. `~/claude/matrix/nickdegs-kisisel`). Sırlar:
`~/.nickdegs/anahtarlar/movelog-sunucu/{movelog-cf.conf,modal.conf,modal-dispatch.conf}`.
```bash
bash sunucu/modal/gecis-yap.sh                 # uygular + dağıtır + doğrular
bash sunucu/modal/gecis-yap.sh --geri          # RunPod'a geri döner (aynı hızda)
bash sunucu/modal/gecis-yap.sh --yalniz-taktik # yalnız taktik (önce bu)
bash sunucu/modal/gecis-yap.sh --yalniz-render # sonra 3B
bash sunucu/modal/gecis-yap.sh --deploy-atla   # kaynakta Modal dalı + MODAL_SECRET canlıysa dağıtımı atla
bash sunucu/modal/gecis-yap.sh --durum
```

Bayrak KV'de (`dispatch:motor`), kod değil → geri dönüş **yeniden dağıtım istemez**.

---

## Sınanmış olanlar (hepsi ölçüldü, iddia değil)

| Ne | Kanıt |
|---|---|
| Özel ghcr imajı çekimi | Modal imajı kurdu, `im-...` |
| GPU gerçek (llvmpipe değil) | `ANGLE (NVIDIA, Tesla T4/PCIe/SSE2)` |
| Fontlar yükleniyor | PIL ile ayrıştırıldı + glif ölçüldü, 9/9 |
| R2 yaz-oku-sil | gerçek nesne yazıldı, okundu, silindi |
| Harita yan-servisi | 132 KB gerçek PNG mozaik (port yoklandı, `sleep` değil) |
| Uzak karo (Cloudflare katmanı) | HTTP 200, 16,7 KB |
| **Geri çağrı yolu** | `400 {"detail":"eksik"}` → uygulama katmanına ulaştı, sır doğru, Cloudflare engeli YOK, **D1'e yazmadan** |
| HTTP ucu koruması | yanlış sır → 403 · kısa iz → 400 |
| HTTP → spawn → GPU → sonuç | `{"id":"fc-...","status":"IN_QUEUE"}` → `COMPLETED`, T4 rc=0 |
| Gerçek video kalitesi | 1080×1920 60fps 35,6sn, faststart, siyah/beyaz kare YOK, beyaz şerit YOK, gözle onaylandı |
| Süre / maliyet | T4 **15,4 dk / $0,2323** · L4 17,4 dk / $0,3236 (RunPod filo ort. 19,9 dk / $0,38) |

## Uçlar
- `https://daclen10--movelog-render-run.modal.run` → RunPod `/v2/{id}/run` eşleniği
- `https://daclen10--movelog-render-status.modal.run` → `/status` eşleniği
- Sır: `~/.nickdegs/anahtarlar/movelog-sunucu/modal-dispatch.conf` (600) + Modal `movelog-dispatch`

Yanıt şekilleri RunPod ile **birebir aynı** (`{"id":...,"status":"IN_QUEUE"}` / `{"status":"COMPLETED","output":{...}}`).
Dispatch her dalı KV motor bayrağına göre seçer: 3B `dispatch:motor` (`runpodGonder` / `modalGonder`);
taktik `dispatch:motor-tac` doluysa onu, yoksa ana bayrağı (`taktikGonder` / `taktikModalGonder`).
Geçiş sırası: önce yalnız taktik (`motor-tac=modal`), sonra 3B (`motor=modal`).

---

## ⚠️ Geçmeden önce bilinmesi gerekenler

1. ~~**Taktik dalı (`movelog-tactical`) TAŞINMADI.**~~
   **✅ GÜNCEL (2026-09-14): taktik de taşındı** — `movelog_tactical.py` + `TAKTIK-GECIS.md`.
   Artık iki hat da KV bayrağını izliyor, dolayısıyla "bakiye sıfırlanırsa taktik durur" riski
   kalmadı. **Geçiş Mac'ten `sunucu/modal/gecis-yap.sh` ile:** betik `sunucu/cf/dispatch/src/index.ts`
   içinde `taktikModalGonder` yoksa çıkar. Ayrıntı ve `movelog-tactical` sırrının içeriği: `TAKTIK-GECIS.md`.
2. **`_redispatch` Modal'da çalışmaz** (bilerek: `RUNPOD_API_KEY` sırra konmadı, yoksa Modal'dan
   RunPod'a iş sıçrardı). Karşılığı: GL bozuksa `Isci.render` exception atar → Modal taze
   konteynerde 2 kez dener (`modal.Retries(max_retries=2)`).
3. **Eşzamanlılık tavanı `max_containers=10`.** RunPod'da 13 slot vardı. Yoğun günde kuyruk uzar;
   gerekirse yükselt.
4. **Maliyet ölçümü tek örnek.** T4'ün L4'ten hızlı çıkması işin GPU-bağımlı olmadığını gösteriyor
   (darboğaz karo çekme/CPU) — ama hata payı ölçülmedi.
5. **$30 kredi varsayımı doğrulanmadı.** ~26 video/ay × $0,23 ≈ $6/ay; kredi geçerliyse cepten $0.
   Kredi yoksa da RunPod'dan ucuz.
