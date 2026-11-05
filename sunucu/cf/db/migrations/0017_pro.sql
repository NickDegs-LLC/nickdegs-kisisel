-- 0017 — Move Log Pro (05.11.2026, Barış): TEK SEFERLİK satın alma (iOS com.nickdegs.kisisel.pro,
-- Android "pro"), 9,99 $. Açtığı tek şey: ORTAK SÜRÜŞ videoları (arkadaş + kulüp). Bireysel her şey ücretsiz.
-- `premium` sütunu ücretsiz modda herkese 1 (0015) — Pro ayrı bayrak.
ALTER TABLE users ADD COLUMN pro INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pro_at INTEGER;
