-- Üretici: import_social.py (idempotent; INSERT OR REPLACE)
-- D1 kuralı: açık BEGIN/COMMIT YOK.

INSERT OR REPLACE INTO videos (rid, uid, r2_key, date, ts, to_ts, ride_type, mode, speed, aspect, size, km, done_at, is_group, users_json, created_at, updated_at) VALUES
('2026-06-01_1780303623', 'u69be3f7e960e', 'videos/yerel/rota_2026-06-01_1780303623_flyover_medium_16x9.mp4', '2026-06-01', 1780303623, 1780310823, '', 'flyover', 'medium', '16x9', 3607262, NULL, 1780578891, 0, NULL, 1780578891, 1780578891),
('2026-06-04_1780567112', 'u69be3f7e960e', 'videos/yerel/rota_2026-06-04_1780567112_3d_medium_16x9.mp4', '2026-06-04', 1780567112, 1780574312, '', '3d', 'medium', '16x9', 41420478, NULL, 1780598951, 0, NULL, 1780598951, 1780598951),
('2026-06-07_1780812280', 'u69be3f7e960e', 'videos/yerel/rota_2026-06-07_1780812280_flyover_medium_16x9.mp4', '2026-06-07', 1780812280, 1780819480, 'moto', 'flyover', 'medium', '16x9', 2001174, NULL, 1780816272, 0, NULL, 1780816272, 1780816272),
('2026-06-11_1781165738', 'u69be3f7e960e', 'videos/yerel/rota_2026-06-11_1781165738_flyover_medium_16x9.mp4', '2026-06-11', 1781165738, 1781172938, 'moto', 'flyover', 'medium', '16x9', 2986885, NULL, 1781181263, 0, NULL, 1781181263, 1781181263),
('2026-06-11_1781166844', 'u69be3f7e960e', 'videos/yerel/rota_2026-06-11_1781166844_flyover_medium_16x9.mp4', '2026-06-11', 1781166844, 1781174044, 'moto', 'flyover', 'medium', '16x9', 1877579, NULL, 1781181264, 0, NULL, 1781181264, 1781181264),
('2026-06-27_1782545926', 'u69be3f7e960e', 'videos/yerel/rota_2026-06-27_1782545926_flyover_medium_16x9.mp4', '2026-06-27', 1782545926, 1782551191, 'moto', 'flyover', 'medium', '16x9', 3428460, NULL, 1782589644, 0, NULL, 1782589644, 1782589644),
('2026-06-27_1782550590', 'u69be3f7e960e', 'videos/yerel/rota_2026-06-27_1782550590_3d_slow_9x16.mp4', '2026-06-27', 1782550590, 1782551191, 'moto', '3d', 'slow', '9x16', 13599835, NULL, 1782589209, 0, NULL, 1782589209, 1782589209);
