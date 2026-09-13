// D1 sık kalıpları — şema: cf/db/migrations/0001_init.sql, sözleşmeler: cf/db/SEMA-NOTLARI.md
//   - state_json/prefs_json alan güncellemesi TEK DEYİM (json_set/json_remove) — blob'u okuyup
//     JS'te değiştirip geri yazmak YASAK (kayıp-güncelleme; SEMA-NOTLARI users bölümü).
//   - Boş/NULL uid = Barış (BARIS_UID) — main.py:255-258 _own() kuralı.
//   - ÖRNEK İÇERİK: kendi kaydı olmayan kullanıcı appreview verisini görür (main.py:227-248).

import { Hata } from './hata'

export const ORNEK_UID = 'appreview'                 // main.py:232
export const BARIS_UID = 'u69be3f7e960e'             // main.py:24 (OWNER_UID varsayılanı)

/** epoch saniye — int(time.time()) eşleniği */
export const simdi = () => Math.floor(Date.now() / 1000)

// users tablosu satırı (0001_init.sql ile birebir; JSON kolonlar ham TEXT döner)
export type UserRow = {
  uid: string
  name: string | null
  handle: string | null
  alias: string | null
  phone: string | null
  lang: string | null
  premium: number | null
  ultra: number | null
  admin: number | null
  premium_until: number | null
  tv: number
  video_hak: number | null
  sokak_hak: number | null
  tracker_id: string | null
  apple_sub: string | null
  google_sub: string | null
  attest_key: string | null
  attested: number | null
  welcomed: number | null
  free_tactical_used: number | null
  summary_enabled: number | null   // NULL = seçilmedi; okuma: COALESCE(summary_enabled,1)
  summary_hour: number | null      // NULL = seçilmedi; okuma: COALESCE(summary_hour,21)
  last_seen_at: number | null
  yerel_son: number | null
  avatar_json: string | null
  badges_json: string | null
  prefs_json: string | null
  state_json: string | null
  created_at: number
  updated_at: number
}

/** Tek kullanıcı satırı (profiles[uid] eşleniği); yoksa null. */
export async function getUser(db: D1Database, uid: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE uid = ?1').bind(uid).first<UserRow>()
}

/** users.<kolon> JSON kolonundan alan oku (satır/kolon/alan yoksa null). Tek küçük SELECT. */
export async function jsonGet<T = unknown>(
  db: D1Database, uid: string, kolon: 'state_json' | 'prefs_json', alan: string,
): Promise<T | null> {
  alanKontrol(alan)
  const row = await db
    .prepare(`SELECT json_extract(${kolon}, '$.${alan}') AS v FROM users WHERE uid = ?1`)
    .bind(uid).first<{ v: string | null }>()
  if (!row || row.v === null) return null
  // json_extract skaler değeri ham (TEXT/INTEGER/REAL), objeyi/diziyi JSON metni döndürür
  if (typeof row.v === 'string' && (row.v.startsWith('{') || row.v.startsWith('['))) {
    try { return JSON.parse(row.v) as T } catch { /* ham dön */ }
  }
  return row.v as unknown as T
}

/**
 * state_json/prefs_json alanını TEK DEYİMLE yaz (SEMA-NOTLARI sözleşmesi).
 * UPDATE users SET k=json_set(COALESCE(k,'{}'),'$.alan',json(?)), updated_at=? WHERE uid=?
 * deger JS değeri olarak verilir (JSON.stringify burada yapılır).
 * Dönen: değişen satır sayısı (0 = kullanıcı yok — çağıran gerekirse 404 üretir).
 */
export async function jsonSet(
  db: D1Database, uid: string, kolon: 'state_json' | 'prefs_json', alan: string, deger: unknown,
): Promise<number> {
  alanKontrol(alan)
  const r = await db.prepare(
    `UPDATE users SET ${kolon} = json_set(COALESCE(${kolon}, '{}'), '$.${alan}', json(?1)), updated_at = ?2 WHERE uid = ?3`)
    .bind(JSON.stringify(deger), simdi(), uid).run()
  return r.meta.changes ?? 0
}

/** state_json/prefs_json alanını TEK DEYİMLE sil (json_remove). Dönen: değişen satır sayısı. */
export async function jsonRemove(
  db: D1Database, uid: string, kolon: 'state_json' | 'prefs_json', alan: string,
): Promise<number> {
  alanKontrol(alan)
  const r = await db.prepare(
    `UPDATE users SET ${kolon} = json_remove(COALESCE(${kolon}, '{}'), '$.${alan}'), updated_at = ?1 WHERE uid = ?2`)
    .bind(simdi(), uid).run()
  return r.meta.changes ?? 0
}

// alan adı SQL'e interpolate edildiği için sıkı beyaz-liste (path injection koruması);
// alan adları kod sabitidir (trackdbg, last_beacon, ptt_busy, hr_live, _not, ...) — dinamik girdi verilmez.
function alanKontrol(alan: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alan)) throw new Hata(500, `gecersiz json alani: ${alan}`)
}

/**
 * main.py _ornek_mi eşleniği: rota örnek içerik mi?
 * Sıra AYNI: önce cloud_videos (videos), sonra detected_rides (rides); kayıt bulunan İLK
 * koleksiyonda karar verilir: (user or '') == 'appreview'. Hiçbirinde yoksa false.
 */
export async function ornekMi(db: D1Database, rideId: string): Promise<boolean> {
  const [v, r] = await db.batch<{ uid: string | null }>([
    db.prepare('SELECT uid FROM videos WHERE rid = ?1').bind(rideId),
    db.prepare('SELECT uid FROM rides  WHERE rid = ?1').bind(rideId),
  ])
  const vRow = v.results[0]
  if (vRow !== undefined) return (vRow.uid ?? '') === ORNEK_UID
  const rRow = r.results[0]
  if (rRow !== undefined) return (rRow.uid ?? '') === ORNEK_UID
  return false
}

/**
 * main.py _kendi_kaydi_var eşleniği: kullanıcının videos/rides'ta EN AZ BİR kaydı var mı?
 * Boş/NULL uid → BARIS_UID sayılır (_own kuralı).
 */
export async function kendiKaydiVar(db: D1Database, user: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS x FROM videos WHERE COALESCE(NULLIF(uid, ''), ?2) = ?1
     UNION ALL
     SELECT 1 AS x FROM rides  WHERE COALESCE(NULLIF(uid, ''), ?2) = ?1
     LIMIT 1`)
    .bind(user, BARIS_UID).first()
  return row !== null
}

/**
 * ÖRNEK İÇERİK sahip seçimi (main.py:267-270 list_rides/stats deseni):
 * Barış değilse VE hiç kendi kaydı yoksa → içerik sahibi 'appreview', yoksa kendisi.
 * Liste uçları koleksiyon filtresinde bu uid'i kullanır.
 */
export async function etkinSahip(db: D1Database, user: string): Promise<string> {
  if (user !== BARIS_UID && !(await kendiKaydiVar(db, user))) return ORNEK_UID
  return user
}
