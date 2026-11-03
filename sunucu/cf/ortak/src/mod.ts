// ortak/src/mod.ts — UYGULAMA MODU (03.11.2026, Barış: "bulutu kalıcı kapatalım, isteyen kendi
// telefonundan üretsin, bana masraf olmayacak; abonelikleri kaldıralım, ücretsiz kalsın").
//
// UCRETSIZ_MOD = true iken:
//   · Bulut GPU'ya (RunPod/Modal) HİÇBİR iş gitmez: activity-detect/generate/regenerate/özet
//     videosu YALNIZ telefon kuyruğuna (KV yerelq:{uid}) yazar; yerelq-bekcisi buluta DEVRETMEZ;
//     dispatch tüketicisi kuyruğa düşen bir şey olursa motora gitmeden ack'ler.
//   · Herkes premium sayılır (D1 migration 0015 users.premium=1; yeni kayıt premium=1). Abonelik
//     bildirimleri/premium-suresi premium'u DÜŞÜRMEZ.
//   · RunPod/Modal bekçileri ve sondaları atlanır (gorev_takvimi 0016 ile de kapatıldı).
// Geri dönüş: bu sabiti false yap + 0015/0016'nın tersini uygula + KV bulut-kapali'yi sil.
export const UCRETSIZ_MOD = true
