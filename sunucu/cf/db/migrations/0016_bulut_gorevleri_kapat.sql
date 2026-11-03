-- 0016 — Bulut GPU'ya bağlı görevler KAPALI (03.11.2026, ücretsiz mod; bkz ortak/src/mod.ts).
-- render-bekci / runpod-saglik: RunPod wmax+bakiye+bulut-kapali yönetimi (bulut yok)
-- imaj-surum-bekcisi: RunPod/Modal imaj kontrolü (saat başı v151/v152 bildirimi de biter)
-- kuyruk-bekcisi + yerelq-bekcisi: bulut kuyruğu / buluta devir (devir kod tarafında da kapalı)
-- grupsurus: ortak 3B video buluta giderdi · ilkvideo-nudge: upsell · premium-suresi: düşürme yok
UPDATE gorev_takvimi SET enabled = 0, updated_at = strftime('%s','now')
 WHERE name IN ('render-bekci','runpod-saglik','imaj-surum-bekcisi','kuyruk-bekcisi','yerelq-bekcisi',
                'grupsurus','ilkvideo-nudge','premium-suresi');
