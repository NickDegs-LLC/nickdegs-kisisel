-- 0015 — ÜCRETSİZ MOD (03.11.2026, Barış: "abonelikleri kaldıralım, ücretsiz kalsın").
-- Herkes premium: tüm kapılar (video/GPX/müzik/kamera) açılır; premium_until NULL → premium-suresi
-- asla dokunmaz (kural: NULL'a dokunulmaz). video_hak sıfırlanır (paket satışı yok).
UPDATE users SET premium = 1, premium_until = NULL, video_hak = 0, updated_at = strftime('%s','now');
