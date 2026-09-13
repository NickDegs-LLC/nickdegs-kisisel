-- Üretici: import_social.py (idempotent; INSERT OR REPLACE)
-- D1 kuralı: açık BEGIN/COMMIT YOK.

DELETE FROM dm_reads;

INSERT OR REPLACE INTO dm_reads (uid, peer_uid, read_at, created_at, updated_at) VALUES
('u54c58ec41b54', 'demo_elif', 1782352613, 1782352613, 1782352613),
('u54c58ec41b54', 'demo_mert', 1782352613, 1782352613, 1782352613),
('u54c58ec41b54', 'demo_zeynep', 1782352613, 1782352613, 1782352613),
('appreview', 'demo_elif', 1783240851, 1783240851, 1783240851),
('appreview', 'demo_mert', 1782417312, 1782417312, 1782417312),
('appreview', 'demo_zeynep', 1782404794, 1782404794, 1782404794),
('appreview', 'u5f41b66429bc', 1788114958, 1788114958, 1788114958),
('u5f41b66429bc', 'u69be3f7e960e', 1785509888, 1785509888, 1785509888),
('u69be3f7e960e', 'u5f41b66429bc', 1788114957, 1788114957, 1788114957),
('apple_golge_diff', 'u5f41b66429bc', 1788114957, 1788114957, 1788114957);

UPDATE users SET last_seen_at = 1781699712, updated_at = 1781699712 WHERE uid = 'baris';

UPDATE users SET last_seen_at = 1788114962, updated_at = 1788114962 WHERE uid = 'appreview';

UPDATE users SET last_seen_at = 1782023684, updated_at = 1782023684 WHERE uid = 'apple_157e22337f5c';

UPDATE users SET last_seen_at = 1788116244, updated_at = 1788116244 WHERE uid = 'u69be3f7e960e';

UPDATE users SET last_seen_at = 1785601898, updated_at = 1785601898 WHERE uid = 'u54c58ec41b54';

UPDATE users SET last_seen_at = 1782381383, updated_at = 1782381383 WHERE uid = 'demo_elif';

UPDATE users SET last_seen_at = 1782381363, updated_at = 1782381363 WHERE uid = 'demo_mert';

UPDATE users SET last_seen_at = 1782363413, updated_at = 1782363413 WHERE uid = 'demo_zeynep';

UPDATE users SET last_seen_at = 1784065564, updated_at = 1784065564 WHERE uid = 'u1a57e54c51a7';

UPDATE users SET last_seen_at = 1785554682, updated_at = 1785554682 WHERE uid = 'u5f41b66429bc';

UPDATE users SET last_seen_at = 1784163705, updated_at = 1784163705 WHERE uid = 'uf1d394c1aa63';

UPDATE users SET last_seen_at = 1784198451, updated_at = 1784198451 WHERE uid = 'u7d2674d6c08b';

UPDATE users SET last_seen_at = 1784322843, updated_at = 1784322843 WHERE uid = 'u9de39b59b4d0';

UPDATE users SET last_seen_at = 1784648760, updated_at = 1784648760 WHERE uid = 'u028b2909b417';

UPDATE users SET last_seen_at = 1784758987, updated_at = 1784758987 WHERE uid = 'u0f9e77f08e62';

UPDATE users SET last_seen_at = 1786685424, updated_at = 1786685424 WHERE uid = 'google_293ea942b72e';

UPDATE users SET last_seen_at = 1787835585, updated_at = 1787835585 WHERE uid = 'google_6ae8ef5f5a51';

UPDATE users SET last_seen_at = 1788114957, updated_at = 1788114957 WHERE uid = 'apple_golge_diff';
