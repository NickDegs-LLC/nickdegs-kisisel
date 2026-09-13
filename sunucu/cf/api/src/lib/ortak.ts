// Ortak yardımcılar — bütünleştirme turunda (08-30) grup dönüş notlarından toplandı.
// Buradaki üç karar GRUPLAR ARASI TUTARLILIK içindir; tek tek uç davranışını değiştirmez:
//
//  1) sv-kapali bayrağı → TEK KV anahtarı: 'sv_off'
//     Orijinalde TEK dosya (/opt/movelog/data/sv-kapali) vardı; gruplar 4 farklı anahtar
//     okuyordu (sv_off / sv_kapali / flags:sv_off / config:sv-kapali) — admin bayrağı bir kez
//     yazınca hepsinin AYNI kararı vermesi için svKapali() tek anahtarı okur.
//     (Sözleşmelerde çoğunluk 'sv_off': grup3/4/6/7 cf_mapping.)
//  2) adminq dosya kuyruğu → TEK KV önek: 'adminq:bekleyen:' (değer {msg})
//     grup7 'adminq:<ms>' yazıyordu; Faz 3 tüketicisi (Telegram iletici) tek önek tarar.
//     Anahtara hex eki eklendi (aynı ms'de iki yazım birbirini ezmesin — dosya kuyruğunda
//     dosya adları benzersizdi).
//  3) pushq dosya kuyruğu → TEK KV önek: 'push:bekleyen:' (değer {user,title,body,route?})
//     Tüm gruplar zaten bu öneki kullanıyordu; TTL 7 gün'e eşitlendi (gölge modda tüketici
//     yok, birikmesin; orijinal dosya kuyruğu tüketilene dek dururdu — Faz 3 tüketicisi
//     7 günden çok daha sık tarayacak). Özel-anahtarlı yazımlar (pushreq/<dosya>, bc_<ts>,
//     welcome_*, sessiz live_*/hr_*) kimlik taşıdığından grup dosyalarında AYNEN kaldı.
//
// Hata davranışı: adminq/pushq main.py'deki gibi HER hatayı yutar (kuyruk yazımı isteği
// asla bozmaz); svKapali okunamazsa KAPALI-DEĞİL sayar (os.path.exists asla fırlatmaz).

import type { Env } from './env'

/** Python secrets.token_hex(bayt) eşleniği (2×bayt hex karakter). */
export function hexRasgele(bayt: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bayt))
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** sv-kapali bayrağının KANONİK KV anahtarı (admin araçları da bunu yazar/siler). */
export const SV_OFF_KEY = 'sv_off'

/** /opt/movelog/data/sv-kapali dosya bayrağı eşleniği: anahtar VARSA kapalı. Okunamazsa false. */
export async function svKapali(env: Env): Promise<boolean> {
  try { return (await env.KV.get(SV_OFF_KEY)) !== null } catch { return false }
}

/** main.py _adminq (2957-2964) eşleniği — Barış'a olay bildirimi; ASLA istek akışını bozmaz. */
export async function adminq(env: Env, msg: string): Promise<void> {
  try {
    await env.KV.put(`adminq:bekleyen:${Date.now()}_${hexRasgele(4)}`,
      JSON.stringify({ msg }), { expirationTtl: 7 * 86400 })
  } catch { /* Python: her hata yutulur */ }
}

/** main.py _pushq (2986-2997) eşleniği — hedefli görünür push kaydı; gitmezse istek yine işler. */
export async function pushq(
  env: Env, user: string, title: string, body: string, route?: string,
): Promise<void> {
  try {
    const d: Record<string, unknown> = { user, title, body }
    if (route) d.route = route
    await env.KV.put(`push:bekleyen:${Date.now()}_${hexRasgele(4)}`,
      JSON.stringify(d), { expirationTtl: 7 * 86400 })
  } catch { /* yutulur */ }
}
