// activity-detect — /opt/matrix/scripts/activity-detect.py (746 satır) TS portu.
// Traccar yerine D1 positions; register-ride doğrudan D1 (ic.registerRide); oto-video RENDER_Q
// (ORTAM=golge → 'golge:' önekli, GERÇEK RunPod işi YOK); push'lar KV push:bekleyen (kuru).
// BİLİNÇLİ TAŞINMAYANLAR: TCX→Element ayağı (kişisel; Matrix satırı bildirim:bekleyen'e düşer),
// _country_of geocoding (kaynakta da ÇAĞRILMIYOR — ölü kod), gcloud Pub/Sub yedeği (ölü yol).
// Nabız: positions tablosunda hr kolonu YOK (SEMA-NOTLARI kararı) → hr her yerde null (kaynakta da
// telefon noktalarında null'du; watch hattı Faz sonrası).
import type { GorevCtx } from '../takvim'
import type { Env } from '../env'
import {
  hav, jsonParse, kvJson, kvJsonYaz, pushBekleyen, bildirimBekleyen, renderKuyruk,
  simdi, kvListe, ProfilRow, PROFIL_KOLON,
} from '../lib'
import { registerRide, renderDone } from '../ic'
import { izSuz } from '../../../ortak/src/izsuzgec'
// 🔴 TR günü ORTAK kaynaktan (22.09): geç gün hattının İKİ ucu (gps worker'ı + bu görev) artık
// aynı tanımı okuyor. cron/src/lib.ts'te birebir aynı kopyalar DURUYOR (öteki görevler kullanıyor,
// bu tur onların kapsamı dışıydı). Bu dosya tamamını ortak modülden alır: yalnız trGun'u ortaktan,
// trGunAralik'ı lib'den almak TR_OFSET bir gün değişirse dosyayı kendi içinde çelişkiye düşürürdü.
import { hhmm, trGun, trGunAralik, trSaat } from '../../../ortak/src/zaman'
import {
  GERIGUN_ONEK, GERIGUN_TTL_SN, gerigunIslendiAnahtar, gerigunCoz,
} from '../../../ortak/src/gecgun'
import type { GeriGunIsaret, GeriGunIslendi } from '../../../ortak/src/gecgun'

// moto-config.json (2026-08-30 ölçümü) — değerler koda sabitlendi; KV 'moto-config' varsa üzerine yazar
const CFG = {
  stop_minutes: 5, stop_radius_m: 60, gap_minutes: 15, summary_hour: 21,
  act_min_dur_s: 300, act_min_m: 500, moto_min_dur_s: 120, moto_min_m: 700,
  auto_video: true, video_speed: 'medium', video_mode: 'flyover', video_aspect: '9:16',
  video_dot_color: '#ff3b30', video_line_color: '#00e5ff',
}
// 🔴 OTOMATİK VİDEO MİNİMUM MESAFESİ (Barış 05.09: "On tane video bu kadar bakiyeyse sıkıntı.
// Minimum kilometre ayarlayalım, evet."). ÖLÇÜM: 04-05.09'da 10 bulut videosu üretildi (~$3,8-7,4);
// içlerinde 0,7 km ve 1,1 km'lik rotalar vardı — 700 metrelik gezinti için tam 3B render.
// RunPod bakiyesi o an $12,77, anlık harcama $2,26/saat. Bu eşik SADECE OTOMATİK üretimi bağlar;
// kullanıcı "üret"e kendi basarsa mesafe sınırı UYGULANMAZ (bilerek istemiştir).
// KV `oto-video-min-km` ile deploy'suz ayarlanır (ör. "1.5"); yoksa varsayılan 2 km.
const OTO_MIN_KM_VARSAYILAN = 2.0
const FREN_HER = 4        // free kullanıcı bildirim freni (Barış 2026-08-12)
const FREN_MIN_GUN = 3

// ---------- GEÇ GELEN GÜN (22.09 "otobüs vakası") ----------
// VAKA: 20.09'da şebekesiz uzun otobüs yolculuğunda oto-takip AÇIKTI, tek nokta ulaşmadı.
// İstemci tarafı artık noktayı diske yazıp ağ dönünce gönderiyor (GpsKuyruk). Sunucu tarafındaki
// EŞ HATA: bu görev YALNIZ bugünün TR gününü tarıyor (kos: trGun(c.now) → trGunAralik → positions).
// Tampon TR gece yarısından SONRA boşalırsa noktalar positions'a YAZILIR ama hiçbir cron turu o
// günü segmentlemez → gezi de otonom video da OLUŞMAZ. gps worker'ı geç gelen her (cihaz, gün)
// için KV'ye SU SEVİYESİ işareti bırakıyor (ortak/src/gecgun.ts), burası o günleri kuyruğa alır.
//
// 🔴 İŞARET ARTIK SİLİNMİYOR — `gerigun-islendi:` SEVİYESİ İLERLİYOR. Eski model (işareti iş
// bitince sil) otobüs vakasını ÇÖZMÜYORDU: cron dakikada bir koşuyor, ilk tur ~400 noktayı işleyip
// anahtarı siliyor, sonraki noktalar için gps bir daha işaret yazmıyordu → 1440 noktanın çoğu
// positions'a yazılıp gezi ÜRETİLMİYORDU. Şimdi cron yalnız `işaret.t > işlendi.sv` çiftlerini
// işler; her yeni nokta seviyeyi ileri taşıdığı için gün, boşalma bitene kadar yeniden işlenir.
const GERIGUN_MAX_YAS = 7 * 86400   // bundan eski geç gün işlenmez (iki anahtar da düşer)
const GERIGUN_MAX_DENEME = 5        // üst üste bu kadar tur patlarsa seviye işlenmiş sayılır + bildirim
//
// 🔴 YERLEŞME (settle) PENCERESİ — KIRPIK GEZİ ÖNLEYİCİ.
// Aşağıdaki `openTrip` kıyası `now - sonNoktaTs < STOP_SEC` olduğu için geç günde YAPISAL olarak
// false: gün çoktan bitmiştir. Yani tampon HÂLÂ boşalırken koşan tur, günü "bitmiş" sayıp
// segmentleri anında kapatıyor ve KIRPIK gezi üretiyordu (1440 noktalık yolculuktan 150 noktayla
// 5 km) — sonra gelen noktalar o geziyi TAMAMLAMIYORDU. Çözüm: geç günü ancak cihaz SUSTUKTAN
// sonra işle. İşaretin yazma anı (su seviyesi) bu pencere kadar eskimediyse tur ATLANIR.
// ÖLÇÜYE DAYALI DEĞER: istemcinin kendi geri çekilme tablosu [5, 15, 60, 300] sn (GpsKuyruk.bitir),
// yani iki boşaltma turu arası EN KÖTÜ 300 sn olabilir. 300 sn'lik pencere tam o sınıra oturur ve
// ağ takılan bir boşaltmanın ortasında günü işleyebilirdi; gap_minutes'in yarısı (450 sn) hem
// istemci tavanının üstünde hem GAP_SEC'in (15 dk, segment ayıran boşluk) altında kalır.
const GERIGUN_YERLESME_SN = (CFG.gap_minutes * 60) / 2
//
// 🔴 YERLEŞME PENCERESİNİN ÜST SINIRI — "SONSUZA KADAR BEKLEME" DELİĞİ (22.09, 2. inceleme).
// Yukarıdaki kapı `c.now - seviye <= GERIGUN_YERLESME_SN` ve HER geç nokta seviyeyi ileri ittiği
// için KESİNTİSİZ akan bir cihazda pencere HİÇ açılmaz: gün her turda "bekliyor" diye atlanır,
// sonunda GERIGUN_MAX_YAS (7 gün) devreye girer ve günü İŞLEMEDEN düşürür — dışarıdan tam da
// düzeltmeye çalıştığımız veri kaybı gibi görünür. Bu tavan o kuyruğu keser: bekleme bu kadar
// uzadıysa yerleşme BEKLENMEZ, gün işlenir.
// DEĞER GEREKÇESİ: istemcinin en kötü geri çekilmesi 300 sn (GpsKuyruk.bitir), yerleşme penceresi
// 450 sn — gerçekten susan cihazda pencere dakikalar içinde açılır. 1800 sn bunun 4 katı; 30
// dakikadır kesintisiz nokta basan cihaz "tamponunu boşaltıyor" değil CANLI akıyordur.
// ⚠️ BEDELİ (bilerek kabul edildi): zorlanan tur KIRPIK gezi yazabilir (bkz. cihazIsle openTrip
// notu). Zararsızlığı registerRide'ın upsert'ine dayanır: rid = `${TRgun}_${başlangıç}` olduğu
// için sonraki (yerleşmiş) tur AYNI satırı tam hâliyle üstüne yazar. Kalan tek risk, boşalmanın
// ortasında 15 dk'lık (GAP_SEC) bir boşluk oluşursa doğan ikinci rid'in öksüz kalmasıdır —
// kuyruk FIFO boşaldığı için beklenmiyor. VİDEO zorlanan turda bilerek ÜRETİLMEZ (cihazIsle
// `zorla` parametresi): kırpık rotayı render etmek hem para yakar hem yanlış rotayı gösterirdi.
const GERIGUN_BEKLEME_TAVAN_SN = 30 * 60
// kvListe cursor'lu: tavan yalnız tur başına iş miktarını sınırlar. 40 ÇOK DÜŞÜKTÜ — anahtarlar
// artık silinmediği (30 gün TTL ile durduğu) ve sözlüksel sıralandığı için tek bir cihazın eski
// günleri listeyi doldurup YENİ geç günü turun dışında bırakabilirdi.
// 1000 = KV list'in tek sayfası: en kötü hâlde TEK list çağrısı, sayfalama gidiş-dönüşü yok.
// ⚠️ DAHA DA YÜKSELTMEDEN ÖNCE: listelenen HER anahtar tur başına 2 KV OKUMASI demek (işaret +
// işlendi) ve bu görev DAKİKADA BİR koşar. Tavan gerçek anahtar sayısının üstünde kaldığı sürece
// bedeli yoktur (maliyet listeye GİREN anahtar kadardır, tavan kadar değil); tavanı ölçüye değil
// "ne olur ne olmaz"a göre büyütmek doğrudan faturadır. Tavan dolarsa kos() UYARI loglar.
const GERIGUN_LISTE_TAVAN = 1000
// İşlenmiş bir çift bu kadar süredir yeni nokta almadıysa iki anahtar da düşer (liste şişmesin).
// Silmek güvenli: gerçekten yeni bir nokta gelirse gps işareti TAZE seviyeyle yeniden yazar.
const GERIGUN_TEMIZLIK_SN = 86400
// Geç günde saat kapısına takılan ÖZET PUSH'u (veri değil, yalnız bildirim — aşağıya bak).
const GECOZET_PUSH_ONEK = 'gecozet-push:'
const GECOZET_PUSH_TTL = 2 * 86400
// Otonom video: geç gün için en fazla kaç gezi (kullanıcı + geç gün başına) buluta gider.
// KV `gerigun-video-tavan` ile deploy'suz ayarlanır; 0/geçersiz = geç günde video YOK.
const GEC_VIDEO_TAVAN_VARSAYILAN = 1
const GEC_VIDEO_MAX_GUN = 2         // 2 günden eski gün: gezi yazılır, otomatik video YOK

const TYPES: Record<string, [string, string]> = {
  walk: ['Yürüyüş', '🚶'], run: ['Koşu', '🏃'], bike: ['Bisiklet', '🚴'], moto: ['Motor', '🏍️'], car: ['Araba', '🚗'],
}

type Nokta = { t: number; lat: number; lon: number; ele: number; dop: number; spd: number }
type Akt = { s: Nokta[]; type: string; dist: number; dur: number; med: number; p85: number; mx: number; acc: number; dp90: number }

// ---------- istatistik + sınıflandırma (satır 201-238 birebir) ----------
function segStats(s: Nokta[]) {
  let dist = 0
  for (let k = 1; k < s.length; k++) dist += hav(s[k - 1], s[k])
  const dur = s[s.length - 1].t - s[0].t
  const spds = s.map((p) => p.spd).filter((v) => v > 1 && v < 160).sort((a, b) => a - b)
  const med = spds.length ? spds[Math.floor(spds.length / 2)] : 0
  const p85 = spds.length ? spds[Math.floor(spds.length * 0.85)] : 0
  const mx = spds.length ? spds[spds.length - 1] : 0
  const dops = s.map((p) => p.dop).filter((v) => v > 1 && v < 150).sort((a, b) => a - b)
  const dp90 = dops.length ? dops[Math.floor(dops.length * 0.9)] : 0
  let acc = 0
  for (let k = 1; k < s.length; k++) {
    const dt = s[k].t - s[k - 1].t
    if (dt > 0 && dt <= 8) {
      const a = ((s[k].spd - s[k - 1].spd) / 3.6) / dt
      if (a > acc) acc = a
    }
  }
  return { dist, dur, med, p85, mx, acc, dp90 }
}

function classify(med: number, p85: number, mx: number, acc: number, dp90: number, vehicle: string): string {
  const motorized = p85 >= 30 || mx >= 48 || dp90 >= 45 || acc >= 3.5
  if (motorized) {
    const v = vehicle === 'moto' || vehicle === 'car' ? vehicle : 'moto'
    if (acc >= 3.2 && mx < 90) return 'moto'
    if (mx >= 95 && acc < 2.2) return 'car'
    return v
  }
  if (med >= 14) return 'bike'
  if (med >= 8) return 'run'
  return 'walk'
}

function valid(s: Nokta[]): boolean {
  const st = segStats(s)
  if (s.length < 3 || st.p85 < 4) return false
  if (st.p85 >= 30 || st.mx >= 48 || st.dp90 >= 45 || st.acc >= 3.5) {
    return st.dur >= CFG.moto_min_dur_s && st.dist >= CFG.moto_min_m
  }
  return st.dur >= CFG.act_min_dur_s && st.dist >= CFG.act_min_m
}

/** Otomatik video için minimum rota mesafesi (km). KV `oto-video-min-km` ezebilir. */
async function otoMinKm(env: Env): Promise<number> {
  try {
    const v = await env.KV.get('oto-video-min-km')
    const n = v === null ? NaN : parseFloat(v)
    return Number.isFinite(n) && n >= 0 ? n : OTO_MIN_KM_VARSAYILAN
  } catch { return OTO_MIN_KM_VARSAYILAN }
}

/**
 * GEÇ GÜN OTONOM VİDEO KAPISI — KARAR + GEREKÇE (22.09).
 *
 * SORU: geç gelen gün işlenirken otonom video ÜRETİLMELİ mi?
 * ÖLÇÜLEN DURUM: otonom (`oto: true`) iş DAILY_AUTO_CAP'e (api grup1.ts:69, 3/gün) TAKILMAZ —
 * o tavan yalnız kullanıcının kendi bastığı /api/rides/generate yolunda çalışır. Geç günün
 * videosu dispatch'teki iki kapıdan geçer: `gpu-gunluk-limit-usd` (günlük $ tavanı) ve
 * kullanıcının AYLIK bütçesi (dispatch/src/index.ts:116 `j?.oto && uid` → aylikButce).
 * Yani geç gün otomatik olarak aylık bütçeden yiyor.
 *
 * KARAR (güvenli taraf): GEZİ HER ZAMAN OLUŞUR (registerRide bedava — vakanın asıl derdi bu),
 * VİDEO ise kısıtlı:
 *   · 2 günden eski gün → video YOK (kullanıcı o rotayı çoktan unuttu, sürpriz masraf olur),
 *   · kullanıcı + geç gün başına en fazla GEC_VIDEO_TAVAN_VARSAYILAN (1) gezi,
 *   · mevcut kapıların HEPSİ yerinde kalır (premium · minKm · videos/pending_videos · bütçe).
 * NEDEN TAVAN ŞART: tek bir tampon boşalması SAATLERCE nokta + birden çok geç gün getirebilir;
 * tavansız hâlde bir yolculuk, kullanıcının aylık payını tek gecede bitirir ve gerçekten
 * istediği videoyu üretemez hâle gelir. Aynı gezinin retry'ı yeni hak TÜKETMEZ (aşağıda).
 * Kullanıcı isterse videoyu uygulamadan kendisi üretebilir — o yol bu kapıya girmez.
 */
async function gecVideoHakki(
  c: GorevCtx, uid: string, gun: string, vst: number, gunYasi: number,
): Promise<boolean> {
  const { env, log } = c
  if (gunYasi > GEC_VIDEO_MAX_GUN) {
    log(`  geç gün ${gun} (${gunYasi} gün önce): otomatik video YOK, gezi yazıldı`)
    return false
  }
  const ham = await env.KV.get('gerigun-video-tavan')
  const tavan = ham === null ? GEC_VIDEO_TAVAN_VARSAYILAN : parseInt(ham, 10)
  if (!Number.isFinite(tavan) || tavan <= 0) {
    log(`  geç gün ${gun}: otomatik video KAPALI (KV gerigun-video-tavan=${ham})`)
    return false
  }
  const anahtar = `gerigunvid:${uid}:${gun}`
  const st = await kvJson<{ ids: number[] }>(env, anahtar, { ids: [] })
  const ids = Array.isArray(st.ids) ? st.ids : []
  if (ids.includes(vst)) return true          // aynı gezinin retry'ı: yeni hak tüketmez
  if (ids.length >= tavan) {
    log(`  geç gün ${gun}: otomatik video tavanı doldu (${ids.length}/${tavan})`)
    return false
  }
  ids.push(vst)
  // 🔴 kvJsonYaz DEĞİL (22.09 bulgusu): o yardımcı `catch { }` ile TÜM hataları yutar. Burada
  // yazılan şey geç gün video TAVANININ ta kendisi — yazım sessizce düşerse tavan hiç ilerlemez
  // ve aynı geç gün her turda yeni bir GPU işi kuyruklayabilir (önlemeye çalıştığımız sürpriz
  // masrafın kendisi). Yazım patlarsa GÖRÜNÜR olur ve video bu tur ÜRETİLMEZ: tavanı sayamıyorsak
  // para harcamayan taraf güvenli taraftır. Kayıp değil, erteleme — `autovid:` sayacı (8 deneme,
  // 20 dk arayla) aynı geziyi yeniden dener, o turda yazım tutarsa video normal yoluna girer.
  if (!(await kvYazLogla(c, anahtar, { ids }, 7 * 86400))) {
    log(`  geç gün ${gun}: video hakkı KV'ye YAZILAMADI → video bu tur atlandı (tavan sayılamıyor)`)
    return false
  }
  return true
}

/**
 * DOĞRUDAN KV yazımı — hata LOGLANIR.
 * 🔴 NEDEN kvJsonYaz DEĞİL: o yardımcı `catch { }` ile TÜM hataları yutar ("kuyruk yazımı asla
 * görevi düşürmez"). Geç gün emniyetleri (deneme sayacı + işlenen seviye) oraya yazıldığında
 * "sonsuz tur yok" güvencesi SESSİZCE devre dışı kalıyordu: sayaç hiç artmaz, aynı çift her
 * dakika yeniden denenirdi. Buradaki yazım da görevi düşürmez ama hatayı GÖRÜNÜR yapar.
 */
async function kvYazLogla(c: GorevCtx, anahtar: string, deger: unknown, ttlSn: number): Promise<boolean> {
  try {
    await c.env.KV.put(anahtar, JSON.stringify(deger), { expirationTtl: Math.max(60, ttlSn) })
    return true
  } catch (e) {
    c.log(`KV yazılamadı (${anahtar}): ${String(e).slice(0, 140)}`)
    return false
  }
}

/** Verilen anahtarları düşürür (silinemeyen anahtar sonraki turda yeniden denenir). */
async function kvSil(c: GorevCtx, ...anahtarlar: string[]): Promise<void> {
  for (const a of anahtarlar) {
    try { await c.env.KV.delete(a) } catch { /* sonraki tur yeniden dener */ }
  }
}

/**
 * `gerigun-islendi:` kaydının BU DOSYAYA ÖZEL genişletilmiş hâli.
 *  · `bi` — BEKLEME İLK: bu seviye için yerleşme penceresinde İLK kez beklemeye geçilen an
 *    (epoch sn). GERIGUN_BEKLEME_TAVAN_SN bunun üzerinden ölçülür; 0/yok = henüz beklemedi.
 * 🔴 NEDEN ORTAK TİPE (ortak/src/gecgun.ts) EKLENMEDİ: o modül gps worker'ı ile PAYLAŞILAN
 * sözleşmedir; `gerigun-islendi:` anahtarını ise YALNIZ bu dosya yazar ve okur (gps sadece
 * `gerigun:` işaretini yazar, işlendi kaydına hiç bakmaz). Tek taraflı bir alan için paylaşılan
 * sözleşmeyi şişirmiyoruz.
 * 🔴 GERİYE DÖNÜK: alan OPSİYONEL — canlıda duran eski `{sv,hata,t}` kayıtları `bi` olmadan
 * okunur, 0 sayılır ve ilk bekleme turunda o anki zaman yazılır. Göç adımı GEREKMEZ.
 */
type IslendiKayit = GeriGunIslendi & { bi?: number }

/**
 * Geç gün turunun sonucunu `gerigun-islendi:` seviyesine yazar.
 *  · BAŞARI → seviye işlenmiş sayılır, hata sayacı sıfırlanır. İŞARET SİLİNMEZ: boşalma sürerken
 *    gelen her yeni nokta seviyeyi ileri taşır ve gün yeniden işlenir (vakanın çözümü budur).
 *  · HATA   → sayaç artar, seviye GÜNCELLENMEZ → sonraki tur aynı işi yeniden dener.
 *  · GERIGUN_MAX_DENEME → seviye "işlendi" yazılır + Barış'a bildirim: sonsuz tur yok. Gün büsbütün
 *    kaybolmaz; daha yüksek bir seviye (yeni nokta) gelirse yeniden kuyruğa girer.
 */
async function gerigunSonuc(
  c: GorevCtx, dev: string, gun: string, seviye: number, onceki: IslendiKayit, ok: boolean,
): Promise<void> {
  const anahtar = gerigunIslendiAnahtar(dev, gun)
  if (ok) {
    // `bi` BİLEREK yazılmıyor = bekleme tavanı sayacı SIFIRLANIR: bu seviye işlendi. Boşalma
    // sürüyorsa sıradaki nokta yeni bir seviye yazar ve tavan penceresi baştan başlar — yani
    // zorlanan turlar 30 dakikada birden sık tekrarlamaz.
    const yeni: IslendiKayit = { sv: seviye, hata: 0, t: c.now }
    await kvYazLogla(c, anahtar, yeni, GERIGUN_TTL_SN)
    return
  }
  const n = (Number(onceki.hata) || 0) + 1
  if (n >= GERIGUN_MAX_DENEME) {
    const pes: IslendiKayit = { sv: seviye, hata: 0, t: c.now }
    await kvYazLogla(c, anahtar, pes, GERIGUN_TTL_SN)
    await bildirimBekleyen(c.env,
      `⚠️ Geç gelen gün ${GERIGUN_MAX_DENEME} turdur işlenemedi, seviye işlenmiş sayıldı: ${dev} ${gun}`,
      'activity-detect')
    c.log(`gerigun düştü (${GERIGUN_MAX_DENEME} deneme): ${dev} ${gun}`)
    return
  }
  // 🔴 HATA YOLUNDA `bi` KORUNUR: bekleme tavanı sayacı başarısız her turda sıfırlansaydı, sürekli
  // hata veren bir çift tavanı hiçbir zaman dolduramaz ve yerleşme penceresinde sonsuza dek beklerdi
  // (kapatmaya çalıştığımız deliğin hata yolundan geri gelmesi).
  const sayac: IslendiKayit = {
    sv: Number(onceki.sv) || 0, hata: n, t: c.now, bi: Number(onceki.bi) || 0,
  }
  await kvYazLogla(c, anahtar, sayac, GERIGUN_TTL_SN)
  c.log(`gerigun hata ${n}/${GERIGUN_MAX_DENEME}: ${dev} ${gun} (sonraki tur yeniden denenecek)`)
}

/** Geç günde saat kapısında bekleyen özet push kaydı (VERİ değil, yalnız bildirim). */
type GecOzetPush = { uid: string; gun: string; saat: number; baslik: string; govde: string; t: number }

/**
 * Saat kapısına takılmış geç gün özet push'larını uygun saatte gönderir.
 * 🔴 kos()'un EN BAŞINDA çağrılır: "bugün aktif cihaz yok" erken dönüşünün ARKASINDA kalsaydı
 * hareketsiz bir günde push hiç gitmezdi.
 */
async function gecOzetPushGonder(c: GorevCtx): Promise<void> {
  for (const k of await kvListe(c.env, GECOZET_PUSH_ONEK, 200)) {
    // 🔴 BAŞARISIZ OKUMAYI BOZUK KAYITTAN AYIR. kvJson hatayı YUTUYOR (lib.ts:52
    // `catch { return dflt }`), yani geçici bir KV arızası ile gerçekten bozuk gövde aynı
    // görünüyordu ve ikisinde de anahtar SİLİNİYORDU -> tek bir okuma hatası bekleyen özet
    // bildirimini kalıcı olarak düşürürdü. Artık ham değeri okuyup ayırıyoruz: anahtar
    // GERÇEKTEN yoksa (ya da gövde bozuksa) sil; okuma patlamışsa DOKUNMA, sonraki tur dener.
    let ham: string | null
    try {
      ham = await c.env.KV.get(k)
    } catch (e) {
      c.log(`geç gün özet push'u okunamadı, sonraki tura bırakıldı (${k}): ${String(e).slice(0, 120)}`)
      continue
    }
    const r = ham === null ? null : jsonParse<GecOzetPush | null>(ham, null)
    if (!r || typeof r.uid !== 'string' || !r.uid) {
      await kvSil(c, k)
      continue
    }
    if (c.now - (Number(r.t) || 0) > GECOZET_PUSH_TTL) {   // bayat: özet ekranda zaten duruyor
      await kvSil(c, k)
      c.log(`geç gün özet push'u bayat, düştü: ${k}`)
      continue
    }
    if (trSaat(c.now) < (Number(r.saat) || CFG.summary_hour)) continue   // saati gelmedi, beklesin
    await pushBekleyen(c.env, { user: r.uid, title: r.baslik, body: r.govde })
    await kvSil(c, k)   // silinemezse: en kötü ihtimalle bir kez daha push (para harcamaz)
    c.log(`geç gün özet push'u gönderildi (${r.gun} → ${r.uid.slice(0, 14)})`)
  }
}

// ---------- free bildirim freni (satır 58-76) — KV freepush:{uid} ----------
async function freeBildirimHakki(env: Env, user: string, log: (s: string) => void): Promise<boolean> {
  if (!user) return false
  const st = await kvJson<{ n: number; son: number }>(env, `freepush:${user}`, { n: 0, son: 0 })
  st.n += 1
  const izin = st.n % FREN_HER === 0 && simdi() - (st.son || 0) > FREN_MIN_GUN * 86400
  if (izin) st.son = simdi()
  await kvJsonYaz(env, `freepush:${user}`, st)
  log(`  · free fren: ${user.slice(0, 14)} sürüş#${st.n} -> ${izin ? 'GÖNDER' : 'sus'}`)
  return izin
}

// ---------- 13 dilli metinler (satır 270-289, 631-643, 666-681 birebir) ----------
const UT: Record<string, string> = { en: 'Ride saved 🎉', tr: 'Sürüşün kaydedildi 🎉', ar: 'تم حفظ رحلتك 🎉', es: 'Ruta guardada 🎉', fr: 'Ride enregistrée 🎉', ru: 'Поездка сохранена 🎉', de: 'Fahrt gespeichert 🎉', it: 'Giro salvato 🎉', pt: 'Rolê salvo 🎉', ja: 'ライドを保存しました🎉', zh: '骑行已保存 🎉', ko: '라이딩 저장 완료 🎉', hi: 'राइड सेव हो गई 🎉' }
const UB: Record<string, string> = {
  en: 'Remember your gift video? With Premium every ride becomes a cinematic video automatically.',
  tr: 'Hediye videonu hatırlıyor musun? Premium ile her sürüşün otomatik sinematik videoya döner.',
  ar: 'أتذكر فيديو الهدية؟ مع بريميوم يتحول كل ركوب إلى فيديو سينمائي تلقائياً.',
  es: '¿Recuerdas tu vídeo de regalo? Con Premium cada ruta se convierte en vídeo automáticamente.',
  fr: 'Tu te souviens de ta vidéo offerte ? Avec Premium chaque ride devient une vidéo automatiquement.',
  ru: 'Помнишь подарочное видео? С Premium каждая поездка автоматически становится видео.',
  de: 'Erinnerst du dich an dein Geschenkvideo? Mit Premium wird jede Fahrt automatisch zum Video.',
  it: 'Ricordi il video in regalo? Con Premium ogni giro diventa un video automaticamente.',
  pt: 'Lembra do vídeo de presente? Com o Premium cada rolê vira vídeo automaticamente.',
  ja: 'プレゼント動画を覚えていますか？プレミアムなら毎回のライドが自動で動画になります。',
  zh: '还记得你的礼物视频吗？高级版让每次骑行自动变成视频。',
  ko: '선물 영상 기억하시나요? 프리미엄은 모든 라이딩을 자동으로 영상으로 만들어요.',
  hi: 'अपना गिफ्ट वीडियो याद है? प्रीमियम हर राइड को अपने आप वीडियो बनाता है।',
}

type Prefs = Record<string, unknown>

// ---------- oto-video kuyruğu (satır 363-485 portu) ----------
async function queueCloudVideo(
  c: GorevCtx, dev: string, uid: string, prof: ProfilRow, prefs: Prefs, P: Nokta[],
  st: number, en: number, acttype: string, name: string, isSummary: boolean, forceMode?: string,
): Promise<void> {
  const { env, log } = c
  const track = P.filter((p) => st <= p.t && p.t <= en)
    .map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, spd: Math.round(p.spd * 10) / 10, alt: p.ele }))
  if (track.length < 3) { log('  → bulut: iz<3 nokta, video atlandı'); return }
  const rday = trGun(st)
  const rideId = isSummary ? `${rday}_ozet_${st}` : `${rday}_${st}`
  // 🔴 18.09 Barış: TEK KATMAN — otonom video ürünün FARKI, herkes 3B alır (Ultra kalktı).
  // Kullanıcı prefs.video_mode ile hâlâ daha ucuz bir moda inebilir; varsayılan 3B.
  const vmode = forceMode || (isSummary
    ? (prefs.summary_vid_mode as string) || CFG.video_mode
    : (prefs.video_mode as string) || '3d')
  const vspeed = isSummary ? (prefs.summary_vid_speed as string) || CFG.video_speed : CFG.video_speed
  const vaspect = isSummary ? (prefs.summary_vid_aspect as string) || CFG.video_aspect : CFG.video_aspect
  const job: Record<string, unknown> = {
    device: dev, user: uid, name, from: st, to: en, day: rday, ride_id: rideId, type: acttype,
    // 🔴 05.09: `oto: true` = bu iş KULLANICI TETİKLEMEDİ. API'nin bütçe kapısı (grup1.bumpDailyCap)
    // yalnız /api/rides/generate yolunda çalışıyor; otomatik üretim HİÇBİR kullanıcı bütçesine
    // girmiyordu. dispatch bu bayrağı görüp aylık kullanıcı bütçesini burada işler (tek kapı,
    // çift sayım yok).
    oto: true,
    mode: vmode, speed: vspeed, aspect: vaspect, premium: true, ts: simdi(), track,
    line: (prefs.video_line as string) || CFG.video_line_color,
    dot: (prefs.video_dot as string) || CFG.video_dot_color,
    // ⚠️ MOTOR SÖZLEŞMESİ — DEĞİŞTİRMEDEN ÖNCE OKU: bu bayrak "Ultra katmanı" DEĞİL, karo
    // tavanı demek. render3d.js:72 `IN.ultra ? 'ultra' : 'premium'` → `?k=` → karo.js:33
    // `tavan = k==='premium' ? 17 : 18`. true yapmak z18 = kare başına 4 KAT karo ve o yük
    // Hooder'ın ORTAK haritasına biner. Barış 18.09: "Herkes z17 (mevcut Premium)".
    // Bayrağın başka etkisi YOK: Google 3B dalları GOOGLE_3D_OLU=1 ile ölü, satStyle zaten
    // ondan bağımsız true, çıkıntılı bina `kabartma`ya bağlı (mühürlü false).
    ultra: false,
  }
  if (isSummary) {
    job.camdist = (prefs.summary_vid_cam as string) || 'orta'
    if (prefs.summary_vid_music) job.music = prefs.summary_vid_music
  }
  // CİHAZDA ÜRETİM (1.61 yerelq — satır 402-448): app /api/local-renders bu KV listesini okur
  const yerelOk = simdi() - Number(prof.yerel_son || 0) < 7 * 86400
  const yerelqYaz = async (neden: string): Promise<boolean> => {
    try {
      const lst = await kvJson<Record<string, unknown>[]>(env, `yerelq:${uid}`, [])
      if (!lst.some((x) => Math.trunc(Number(x.from ?? 0)) === st)) {
        const kayit: Record<string, unknown> = {}
        for (const k of ['from', 'to', 'type', 'mode', 'speed', 'aspect', 'line', 'dot', 'ride_id', 'ts', 'camdist']) {
          if (k in job) kayit[k] = job[k]
        }
        if (job.music) kayit.music = job.music
        lst.push(kayit)
        await kvJsonYaz(env, `yerelq:${uid}`, lst.slice(-10))
      }
      log(`  → CİHAZDA üretilecek (${neden}): ${rideId} mode=${job.mode}`)
      return true
    } catch { return false }
  }
  const prem = !!prof.premium
  // 🔴 VARSAYILAN ARTIK BULUT (Barış 05.09: "Varsayılan olarak telefondan üretilmeyecek").
  // NEDEN: telefon render'ı görünmez WKWebView'da kare kare snapshot alıyor; uygulama ARKA PLANA
  // düşerse snapshot BOŞ/BEYAZ döner (WebRouteVideo.swift:24'ün kendi yorumu: "ekran hiyerarşisinde
  // olmalı — yoksa snapshot boş döner") ve döngü o beyaz kareleri videoya YAZAR. Koruma yok →
  // kullanıcı beyaz video alıyor. Ayrıca uygulama kapalıyken iş hiç üretilmiyordu.
  // KV `telefon-render` = "1" yapılırsa eski davranış (bedava, telefonda) geri gelir — uygulama
  // güncellemesi beklemeden tek anahtarla dönülebilir. Anahtar YOKSA bulut kullanılır.
  const telefonAcik = (await env.KV.get('telefon-render')) === '1'
  if (telefonAcik && (job.mode === 'flat' || job.mode === 'flyover') && !forceMode && yerelOk) {
    if (await yerelqYaz('yerelq, bulut maliyeti SIFIR (KV telefon-render=1)')) return
  }
  const bulutKapali = (await env.KV.get('bulut-kapali')) !== null   // .bulut-kapali bayrağı → KV
  if (!forceMode && yerelOk && prem && bulutKapali) {
    if (await yerelqYaz('YEDEK YOL — bulut kapalı, telefonda üretilecek')) return
  }
  // BİRİNCİL: RENDER_Q → movelog-dispatch → RunPod (golge: öneki gerçek işi keser)
  const kid = await renderKuyruk(env, job, isSummary ? 'activity-detect:ozet' : 'activity-detect:oto')
  log(`  → KUYRUK: ${kid} • ${track.length} nokta • ${vmode}/${vspeed}`)
}

// ---------- tek cihaz analizi ----------
// `gec`  : bu gün GERİ DÖNÜK işleniyor (gps'in `gerigun:` işareti).
// `zorla`: geç gün YERLEŞME BEKLENMEDEN işleniyor (bekleme tavanı doldu, bkz.
//          GERIGUN_BEKLEME_TAVAN_SN). Tampon HÂLÂ boşalıyor olabilir → eldeki rota KIRPIK
//          olabilir. Gezi yine yazılır (upsert sonraki turda tamamlar), OTO-VİDEO ertelenir.
// İkisi de varsayılan false → bugünkü çağrıların (bugün + özet isteği yolu) davranışı BİREBİR
// AYNI kalır; `zorla` yalnız `gec` ile birlikte anlamlıdır.
async function cihazIsle(c: GorevCtx, dev: string, gun: string, gec = false, zorla = false): Promise<void> {
  const { env, now, log } = c
  const [g0, g1] = trGunAralik(gun)
  const gunYasi = Math.round((trGunAralik(trGun(now))[0] - g0) / 86400)   // bugün=0, dün=1
  const prof = await env.DB.prepare(`SELECT ${PROFIL_KOLON} FROM users WHERE tracker_id = ?1`)
    .bind(dev).first<ProfilRow>()
  const uid = prof?.uid || ''
  const prefs = jsonParse<Prefs>(prof?.prefs_json ?? null, {})
  const devName = (prof?.name || prof?.handle || '').trim() || dev
  const rows = await env.DB.prepare(
    'SELECT ts, lat, lon, alt, spd FROM positions WHERE device = ?1 AND ts >= ?2 AND ts < ?3 ORDER BY ts')
    .bind(dev, g0, g1).all<{ ts: number; lat: number; lon: number; alt: number | null; spd: number | null }>()
  // 🔴 FİKS 05.09: burası `rides.km`'yi ÜRETEN yer ve HAM okuyordu. `positions`'taki tek bir çöp
  // koordinat (41.000000, 29.000000) 91 saniyede 744,96 km'lik sıçrama doğurup "748,7 km yürüyüş /
  // 13 dk" diye üç HAYALET rota yaratmıştı. Süzgeç artık ortak modülden ve okuma anında uygulanıyor.
  const hamP = rows.results.map((p) => ({
    t: p.ts, lat: p.lat, lon: p.lon, ele: p.alt ?? 0,
    dop: (p.spd ?? 0) * 1.852,   // knot → km/h (main.py:159 ile aynı çarpan)
    spd: 0,
  }))
  const P: Nokta[] = izSuz(hamP)
  if (P.length !== hamP.length) log(`  iz süzgeci: ${hamP.length - P.length} çöp/ışınlanma noktası atıldı`)
  for (let i = 1; i < P.length; i++) {
    const dt = P[i].t - P[i - 1].t
    P[i].spd = dt > 0 ? (hav(P[i - 1], P[i]) / dt) * 3.6 : 0
  }

  // --- durma-temelli segmentasyon (satır 166-185 birebir) ---
  const STOP_SEC = CFG.stop_minutes * 60, STOP_R = CFG.stop_radius_m, GAP_SEC = CFG.gap_minutes * 60
  const segs: Nokta[][] = []
  let cur: Nokta[] = []
  let anchor: Nokta | null = null
  for (const p of P) {
    if (!cur.length) { cur = [p]; anchor = p; continue }
    const prev = cur[cur.length - 1]
    if (p.t - prev.t >= GAP_SEC) { segs.push(cur); cur = [p]; anchor = p; continue }
    if (hav(anchor!, p) > STOP_R) { anchor = p; cur.push(p) }
    else if (p.t - anchor!.t >= STOP_SEC) {
      const seg = cur.filter((q) => q.t <= anchor!.t)
      if (seg.length) segs.push(seg)
      cur = [p]; anchor = p
    } else cur.push(p)
  }
  if (cur.length) segs.push(cur)
  // 🔴 AÇIK GEZİ (openTrip) ve GEÇ GÜN — 22.09 KIRPIK GEZİ BULGUSU.
  // Bu kıyas `now - sonNoktaTs < STOP_SEC` olduğu için geç günde YAPISAL olarak false'tur: gün
  // çoktan bitmiştir, son nokta saatler öncesine aittir. Tampon HÂLÂ boşalırken koşan bir tur bu
  // yüzden günü "bitmiş" sayıp segmentleri anında kapatıyor, elindeki ilk ~150 noktayla 5 km'lik
  // KIRPIK bir gezi üretiyor ve sonradan gelen noktalar o geziyi tamamlamıyordu.
  // ARTIK GÜVENLİ: kos() geç günü ancak cihaz GERIGUN_YERLESME_SN kadar SUSTUKTAN sonra işliyor
  // (su seviyesi + yerleşme penceresi), yani buraya gelindiğinde o günün noktaları tamamlanmıştır.
  // ⚠️ Yerleşme penceresini kaldırmak/kısaltmak kırpık geziyi GERİ GETİRİR.
  let openTrip = false
  if (segs.length && now - segs[segs.length - 1][segs[segs.length - 1].length - 1].t < STOP_SEC) {
    openTrip = true; segs.pop()
  }

  // --- uyandırma bekçisi (satır 292-308) ---
  // 18.09: güvenlik uzun-duraklama bloğu KALDIRILDI (güvenli sürüş özelliği çıktı);
  // aşağıdaki wakepush bekçisi GÜVENLİK DEĞİL, sessiz uyandırma — kalıyor.
  if (uid && P.length >= 2) {
    const a = P[P.length - 2], b = P[P.length - 1]
    const age = now - b.t, gap = b.t - a.t, d = hav(a, b)
    if (age <= 900 && gap >= 120 && d >= 700) {
      const mk = await env.KV.get(`wakepush:${uid}`)
      if (mk === null) {
        await kvJsonYaz(env, `wakepush:${uid}`, b.t, 600)
        await pushBekleyen(env, { user: uid, silent: 1 })
        log(`BEKÇİ: beklemede ${(d / 1000).toFixed(1)}km yer değiştirme -> sessiz uyandırma (${uid})`)
      }
    }
  }
  // --- aktiviteler ---
  const vehicle = (prefs.vehicle as string) || 'moto'
  const acts: Akt[] = []
  for (const s of segs) {
    if (!valid(s)) continue
    const st = segStats(s)
    acts.push({ s, type: classify(st.med, st.p85, st.mx, st.acc, st.dp90, vehicle), ...st })
  }
  log(`${gun} dev=${dev} (${devName}): ${P.length} nokta, ${segs.length} segment, ${acts.length} aktivite (açık=${openTrip})`)

  // --- Rotalar'a kaydet (idempotent upsert; satır 532-534) ---
  if (uid) {
    for (const a of acts) {
      const st0 = a.s[0].t, en0 = a.s[a.s.length - 1].t
      await registerRide(env, {
        user: uid, ride_id: `${trGun(st0)}_${Math.trunc(st0)}`, date: trGun(st0),
        ts: Math.trunc(st0), to: Math.trunc(en0), type: a.type,
        km: Math.round(a.dist / 100) / 10, lat: a.s[0].lat, lon: a.s[0].lon,
      })
    }
  }

  // --- gönderim durumu (sent_act → KV) ---
  const scope = uid || dev
  const sentKey = `sent:act:${gun}_${scope}`
  const done = new Set(await kvJson<string[]>(env, sentKey, []))
  const yeni = acts.filter((a) => !done.has(String(Math.trunc(a.s[0].t))))
  const ozetKey = `sent:ozet:${gun}_${scope}`
  const ozetVar = (await env.KV.get(ozetKey)) !== null
  const reqler = uid ? await kvListe(env, `summaryreq:${uid}_`, 20) : []
  const onDemand = reqler.length > 0
  const sumEnabled = (prof?.summary_enabled ?? 1) !== 0            // COALESCE(summary_enabled,1)
  const userHour = prof?.summary_hour ?? CFG.summary_hour          // COALESCE(summary_hour,21)
  // 22.09: GEÇ GÜNDE SAAT KAPISI VERİ İÇİN ANLAMSIZ — o gün çoktan bitti. Saat kapısı "gün daha
  // bitmedi, özeti erken gönderme" içindi; geç günde beklenecek bir şey yok (aksi hâlde gece
  // yarısından sonra boşalan tampon için özet HİÇ üretilmezdi). `sent:ozet:` mükerrerini keser.
  // ⚠️ Bu kapı YALNIZ VERİYİ açar. Kullanıcıyı 03:00'te uyandırmamak için PUSH ayrı kapıda
  // bekletilir — aşağıdaki "VERİ ile BİLDİRİM AYRI" bloğuna bak.
  const summaryDue = onDemand || (sumEnabled && (gec || trSaat(now) >= userHour))
  // 🔴 ZORLANAN TURDA ÖZET ÜRETME. `zorla` = yerleşme beklenmeden koşulan tur, yani tampon HÂLÂ
  // boşalıyor olabilir. Özet o anki KIRPIK veriyle hesaplanıp `sent:ozet:` mandalını kurardı ve
  // yerleşmiş tur (tam veriyle) onu bir daha DÜZELTEMEZDİ — kullanıcı 8 saatlik yolculuk için
  // yanlış km'li kalıcı bir özet görürdü. Video için aynı karar zaten verilmişti (`gec && zorla`);
  // özet de aynı kapıya alınıyor. Tek özet, yerleşmiş turda, tam veriyle.
  const needSummary = acts.length > 0 && summaryDue && (onDemand || !ozetVar) && !(gec && zorla)

  // --- OTO-VİDEO RETRY (satır 554-611): R2'de hazırsa render-done, yoksa backoff'lu yeniden kuyruk ---
  if (CFG.auto_video && uid && prof?.premium) {
    const minKm = await otoMinKm(env)
    for (const a of acts) {
      if (a.type !== 'moto' && a.type !== 'car') continue
      if (a.dist / 1000 < minKm) {          // kısa gezinti -> otomatik video YOK (bakiye koruması)
        log(`  oto-video atlandı: ${(a.dist / 1000).toFixed(1)} km < ${minKm} km eşiği`)
        continue
      }
      const vst = Math.trunc(a.s[0].t), ven = Math.trunc(a.s[a.s.length - 1].t)
      const vrid = `${trGun(vst)}_${vst}`
      const vidVar = await env.DB.prepare('SELECT 1 x FROM videos WHERE rid = ?1').bind(vrid).first()
      if (vidVar) continue
      // 🔴 FİKS 05.09: `videos` henüz yazılmamışken iş HÂLÂ render oluyor olabilir. `pending_videos`
      // bakılmadığı için 20 dk sonra ikinci kez kuyruğa giriyordu = ikinci GPU faturası + 2. bildirim.
      const bekleyen = await env.DB.prepare('SELECT 1 x FROM pending_videos WHERE vid = ?1').bind(vrid).first()
      if (bekleyen) { log(`  oto-video atlandı: ${vrid} hâlâ render oluyor (pending_videos)`); continue }
      if (now - ven < 300) continue
      const vkey = `videos/${vrid}.mp4`
      const obj = await env.R2.head(vkey)
      if (obj) {
        await renderDone(env, {
          ride_id: vrid, key: vkey, user: uid, date: trGun(vst), ts: vst, to: ven, type: a.type,
          mode: (prefs.video_mode as string) || '3d',
          speed: CFG.video_speed, aspect: (prefs.video_aspect as string) || CFG.video_aspect,
          size: obj.size, ultra: false,   // bkz. queueCloudVideo'daki karo tavanı notu
        })
        log(`  ✅ OTO-VİDEO LAND: ${vrid} — R2'de hazırdı, render-done D1'e işlendi`)
        continue
      }
      const mk = await kvJson<{ n: number; son: number }>(env, `autovid:${uid}:${vst}`, { n: 0, son: 0 })
      if (mk.n >= 8) continue
      if (now - mk.son < 1200) continue
      // 🔴 ZORLANMIŞ GEÇ TUR: yerleşme beklenmeden işlendi, elimizdeki rota KIRPIK olabilir.
      // Gezi upsert'le düzelir ama VİDEO düzelmez (videos/R2'de duran kırpık video ikinci kez
      // üretilmez) — hem para yakar hem kullanıcıya yanlış rotayı gösterir. Yerleşmiş tura bırak.
      if (gec && zorla) {
        log(`  geç gün ${gun}: tur ZORLANDI (yerleşme beklenmedi) → oto-video ertelendi`)
        continue
      }
      // Geç gün kapısı EN SONDA: diğer tüm koşullar geçmeden hak tüketilmesin (bkz. gecVideoHakki).
      if (gec && !(await gecVideoHakki(c, uid, gun, vst, gunYasi))) continue
      await queueCloudVideo(c, dev, uid, prof, prefs, P, vst, ven, a.type, devName, false)
      await kvJsonYaz(env, `autovid:${uid}:${vst}`, { n: mk.n + 1, son: now }, 2 * 86400)
      log(`  🔁 OTO-VİDEO RETRY: ${vrid} (deneme ${mk.n + 1}/8)`)
    }
  }

  // 🔴 ZORLANAN TURDA BİLDİRİM DE YOK (özetle aynı gerekçe). Bu tur yerleşme beklenmeden koştu,
  // yani tampon HÂLÂ boşalıyor olabilir ve `yeni` içindeki geziler KIRPIK. Bildirim gönderilseydi
  // kullanıcı "~42,0 km" push'u alır, ardından `done.add` + `sent:act:` mandalı kurulduğu için
  // yerleşmiş tur gerçek "86 km"yi BİR DAHA bildiremezdi. Gezi satırı yine yazılıyor (upsert
  // sonraki turda tamamlıyor); yalnız KULLANICIYA HABER VERMEK erteleniyor.
  // ⚠️ needSummary de bu turda false olduğu için burada dönmek `sent:ozet:`/`sent:act:` mandallarının
  // HİÇBİRİNİ kurmadan çıkar — yerleşmiş tur temiz sayfayla gelir.
  if (gec && zorla) {
    if (yeni.length) log(`  ⏳ zorlanan tur: ${yeni.length} gezi yazıldı, bildirim/özet yerleşmiş tura bırakıldı`)
    return
  }

  if (!yeni.length && !needSummary) return

  // --- biten aktiviteler (satır 615-704) — TCX ayağı TAŞINMADI, Matrix satırı bildirim:bekleyen ---
  for (const a of yeni) {
    const [lbl, em] = TYPES[a.type]
    const st0 = a.s[0].t, en0 = a.s[a.s.length - 1].t
    await bildirimBekleyen(env,
      `${em} ${lbl} ${hhmm(st0)}–${hhmm(en0)}: ~${(a.dist / 1000).toFixed(1)} km, ${Math.floor(a.dur / 60)} dk. (${devName})`,
      'aktivite')
    done.add(String(Math.trunc(st0)))
    const isAuto = a.type === 'moto' || a.type === 'car'
    const lng = prof?.lang || 'en'
    const minKm2 = await otoMinKm(env)
    if (CFG.auto_video && isAuto && prof?.premium && a.dist / 1000 >= minKm2) {
      // 🔴 FİKS 05.09 — ÇİFT ÜRETİM: burada ikinci kez kuyruklamak HER otomatik videoyu 2 kez
      // GPU'ya gönderiyordu (kanıt: aynı rid için D1 size ≠ R2 size, D1 satırı R2 yüklemesinden
      // ÖNCE yazılmış). Yukarıdaki OTO-VİDEO RETRY dalı (satır ~340) aynı `acts` dizisini aynı turda
      // zaten geziyor ve videos/pending_videos/R2/autovid/eşik korumalarının HEPSİNE sahip.
      // Bu dal artık yalnız else-zincirini kısa devre ettirmek için duruyor.
      log(`  → ${a.type} (premium): oto-video RETRY dalına bırakıldı (çift kuyruklama yok)`)
      // 30.10 (Barış onayı): premium motorlu gezide de "kaydedildi" bildirimi — eskiden tek bildirim
      // "video hazır"dı; render düşünce (Modal bakiyesi) kullanıcı sürüşün algılandığını HİÇ duymuyordu.
      // Metin motorsuz dalla BİREBİR aynı. Tek sefer: `yeni` zaten sent:act ile süzülü (done.add yukarıda).
      if (uid) {
        await pushBekleyen(env, {
          user: uid, title: `${em} ${lbl} kaydedildi`,
          body: `${(a.dist / 1000).toFixed(1)} km · ${Math.floor(a.dur / 60)} dk otomatik algılandı. İstersen videoya dönüştür.`,
        })
        log(`  → ${a.type} (premium): kaydedildi + bildirim`)
      }
    } else if (CFG.auto_video && isAuto && uid) {
      // ücretsiz motorlu: oto-üretim YOK (Barış 2026-08-28) — frenli upsell
      if (await freeBildirimHakki(env, uid, log)) {
        await pushBekleyen(env, { user: uid, title: UT[lng] || UT.en, body: UB[lng] || UB.en })
        log('  → motorlu araç (free): upsell push')
      } else log('  → motorlu araç (free): upsell SUSTURULDU (fren)')
    } else if (uid) {
      // motorsuz: "kaydedildi" bildirimi (premium muaf frenli)
      if (prof?.premium || (await freeBildirimHakki(env, uid, log))) {
        await pushBekleyen(env, {
          user: uid, title: `${em} ${lbl} kaydedildi`,
          body: `${(a.dist / 1000).toFixed(1)} km · ${Math.floor(a.dur / 60)} dk otomatik algılandı. İstersen videoya dönüştür.`,
        })
        log(`  → ${a.type}: kaydedildi + bildirim`)
      } else log(`  → ${a.type}: kaydedildi, bildirim SUSTURULDU`)
    }
  }
  await kvJsonYaz(env, sentKey, [...done], 3 * 86400)

  // 🔴 FİKS 04.09: özetlenecek aktivite yoksa da on-demand isteği TÜKETİLMELİ; yoksa istek
  // TTL dolana dek her turda yeniden denenir ve kullanıcı hiçbir geri bildirim almaz.
  if (onDemand && !needSummary) {
    for (const k of reqler) { try { await env.KV.delete(k) } catch { /* sonraki tur */ } }
    log(`özet isteği tüketildi ama üretilecek aktivite yok (${gun}, ${acts.length} aktivite)`)
  }

  // --- günün özeti (satır 707-741) ---
  if (needSummary) {
    const tot = new Map<string, [number, number, number]>()
    for (const a of acts) {
      const t = tot.get(a.type) ?? [0, 0, 0]
      t[0] += 1; t[1] += a.dist / 1000; t[2] += Math.floor(a.dur / 60)
      tot.set(a.type, t)
    }
    const totalKm = acts.reduce((s, a) => s + a.dist, 0) / 1000
    const totalMin = Math.floor(acts.reduce((s, a) => s + a.dur, 0) / 60)
    const sp = (a: Akt) => (a.dur > 0 ? (a.dist / 1000) / (a.dur / 3600) : 0)
    const fastest = acts.reduce((m, a) => (sp(a) > sp(m) ? a : m), acts[0])
    const longest = acts.reduce((m, a) => (a.dist > m.dist ? a : m), acts[0])
    const first = acts.reduce((m, a) => (a.s[0].t < m.s[0].t ? a : m), acts[0])
    const last = acts.reduce((m, a) => (a.s[a.s.length - 1].t > m.s[m.s.length - 1].t ? a : m), acts[0])
    const lines = [
      onDemand ? '📊 Şu ana kadarki özet' : `🗓️ ${gun} günün özeti`,
      `Toplam: ${totalKm.toFixed(1)} km · ${totalMin} dk · ${acts.length} aktivite`,
    ]
    for (const [typ, [n, km, dk]] of tot) lines.push(`${TYPES[typ][1]} ${TYPES[typ][0]}: ${n}× · ${km.toFixed(1)} km · ${dk} dk`)
    lines.push(`⚡ En hızlı an: ${TYPES[fastest.type][1]} ~${sp(fastest).toFixed(0)} km/s`)
    lines.push(`📏 En uzun: ${TYPES[longest.type][1]} ${(longest.dist / 1000).toFixed(1)} km`)
    lines.push(`🕒 ${hhmm(first.s[0].t)}–${hhmm(last.s[last.s.length - 1].t)}`)
    lines.push('📍 ' + acts.map((a) => `${TYPES[a.type][1]}${hhmm(a.s[0].t)}`).join(' → '))
    const text = lines.join('\n')
    await bildirimBekleyen(env, text, 'gün özeti')
    await kvJsonYaz(env, ozetKey, text, 3 * 86400)   // durum bayrağı: "bu gün için özet gönderildi mi"
    // 🔴 FİKS 04.09: özet YALNIZ KV'ye yazılıyordu; uygulamanın "Günlük özet" ekranı ise D1
    // `activities` tablosundan okuyor (api grup7.ts:478) → ekran BOMBOŞ görünüyordu (tablo da yoktu,
    // migration 0005 ile açıldı). Artık kanonik kopya D1'e gider; KV bayrağı yukarıda kalır.
    // uid yoksa (cihaz-only akış) yazılmaz: uid NOT NULL + sahipsiz özet gizlilik ihlali olurdu.
    if (uid) {
      const simdiTs = Math.floor(Date.now() / 1000)
      try {
        await env.DB.prepare(
          `INSERT INTO activities (id, uid, day, summary, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT(uid, day) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`)
          .bind(`${uid}_${gun}`, uid, gun, text, simdiTs).run()
      } catch (e) {
        log(`özet D1'e yazılamadı: ${String(e).slice(0, 120)}`)   // SESSİZ YUTMA YOK — göreve düşsün
      }
    }
    // 🔴 FİKS 04.09 (2. tur): istek burada tüketilir — özet KALICI olarak yazıldıktan hemen sonra.
    // Önce aşağıdaki push/oto-video adımlarından SONRA siliniyordu; queueCloudVideo patlayınca
    // cihazIsle fırlıyor, silme hiç çalışmıyor ve istek TTL dolana dek her turda özet ürettiriyordu.
    // ÖLÇÜLDÜ: 00:12'de özet D1'e yazıldı, `summaryreq:` anahtarı yerinde kaldı.
    for (const k of reqler) { try { await env.KV.delete(k) } catch { /* sonraki tur yeniden dener */ } }
    if (onDemand) log(`on-demand istek tüketildi (${reqler.length})`)

    if (uid) {
      const ozetBaslik = 'Günlük özetin hazır 📊'
      const ozetGovde = `${totalKm.toFixed(1)} km · ${acts.length} aktivite · en hızlı ~${sp(fastest).toFixed(0)} km/s`
      // 🔴 VERİ ile BİLDİRİM AYRI (22.09 bulgusu: geç günde saat kapısı tamamen kaldırılmıştı →
      // tampon gece 03:00'te boşalınca kullanıcı 03:00'te "Günlük özetin hazır" push'uyla
      // uyanıyordu). Özet YUKARIDA D1'e ve `sent:ozet:` bayrağına ZATEN yazıldı — ekran dolu,
      // kullanıcı sabah uygulamayı açtığında her şey yerinde. Geriye yalnız BİLDİRİM kaldı ve o
      // kullanıcının kendi özet saatine (userHour) bırakılır.
      // onDemand HARİÇ: kullanıcı "üret"e kendisi bastıysa cevabı o an ister, saat kapısı işlemez.
      if (gec && !onDemand && trSaat(now) < userHour) {
        const kayit: GecOzetPush = {
          uid, gun, saat: userHour, baslik: ozetBaslik, govde: ozetGovde, t: now,
        }
        await kvYazLogla(c, `${GECOZET_PUSH_ONEK}${uid}_${gun}`, kayit, GECOZET_PUSH_TTL)
        log(`  geç gün: özet YAZILDI, push ${userHour}:00'a bırakıldı (şu an ${trSaat(now)}:00)`)
      } else {
        await pushBekleyen(env, { user: uid, title: ozetBaslik, body: ozetGovde })
      }
      const motorlu = acts.filter((x) => x.type === 'moto' || x.type === 'car')
      // 🔴 FİKS 05.09: 2 km eşiği yalnız tekil oto-videolarda vardı, ÖZET dalında YOKTU —
      // 0,4 km'lik bir gün de ~25 dk 3B GPU render'ı tetikleyebiliyordu (bakiye koruması).
      const ozetMinKm = await otoMinKm(env)
      // oto-video hatası özet akışını düşürmesin (yukarıdaki istek tüketimi zaten yapıldı)
      if (prof?.premium && motorlu.length && totalKm >= ozetMinKm) {
        const ozetVst = Math.trunc(first.s[0].t)
        // Geç günde ÖZET videosu da aynı tavana girer: gün özeti en uzun/en pahalı render'dır,
        // kullanıcı istemeden buluta gitmesi tam da kaçındığımız sürpriz masraf.
        if (gec && zorla) {
          // Zorlanmış tur: gün özeti videosu en uzun/en pahalı render'dır, kırpık veriyle
          // üretmenin anlamı yok. Özet METNİ yukarıda zaten yazıldı ve gönderildi.
          log('  geç gün: tur ZORLANDI → gün özeti videosu ertelendi (özet metni yine gönderildi)')
        } else if (gec && !(await gecVideoHakki(c, uid, gun, ozetVst, gunYasi))) {
          log('  geç gün: gün özeti videosu atlandı (özet metni yine gönderildi)')
        } else {
          try {
            await queueCloudVideo(c, dev, uid, prof, prefs, P,
              ozetVst, Math.trunc(last.s[last.s.length - 1].t),
              motorlu[motorlu.length - 1].type, `${devName} • Gün özeti`, true)
          } catch (e) { log(`oto-video kuyruklanamadı: ${String(e).slice(0, 140)}`) }
        }
      }
    }
    // 🔴 FİKS 04.09: `summaryreq:` istekleri OKUNUYOR ama HİÇ SİLİNMİYORDU (satır 306) → bir kez
    // "üret"e basan kullanıcı için onDemand SONSUZA DEK true kalır, her turda yeni özet+push gider.
    // İstek tüketildi, şimdi temizleniyor.
    log('özet gönderildi' + (onDemand ? ' (on-demand)' : ''))
  } else if (onDemand && uid) {
    await pushBekleyen(env, { user: uid, title: 'Günlük özet', body: 'Bugün henüz kayıtlı aktivite yok.' })
  }
  if (onDemand) for (const rk of reqler) { try { await env.KV.delete(rk) } catch { /* yut */ } }
}

// ---------- görev girişi: bugün aktif tüm cihazlara fan-out (satır 99-114) ----------
export async function kos(c: GorevCtx): Promise<void> {
  // 🔴 EN BAŞTA: geç günde saat kapısına takılmış özet push'ları. Aşağıdaki "bugün aktif cihaz
  // yok" erken dönüşünün ARKASINDA kalsaydı, hareketsiz bir günde bekleyen push hiç gitmezdi.
  await gecOzetPushGonder(c)
  const gun = trGun(c.now)
  const [g0, g1] = trGunAralik(gun)
  const devs = await c.env.DB.prepare('SELECT DISTINCT device FROM positions WHERE ts >= ?1 AND ts < ?2')
    .bind(g0, g1).all<{ device: string }>()
  // cihaz -> işlenecek TR GÜNLERİ (22.09'a kadar TEK gündü).
  // 🔴 NEDEN ÇOĞUL: geç gün tam da telefonun ŞEBEKEYE KAVUŞTUĞU an gelir — yani cihaz aynı turda
  // hem bugün aktiftir hem de dünü işlenmelidir. Tek günlük Map'te ikisinden biri diğerinin
  // üstüne yazılır ve o gün sessizce düşerdi.
  const isle = new Map<string, Set<string>>()
  const ekle = (dev: string, g: string): void => {
    const s = isle.get(dev) ?? new Set<string>()
    s.add(g)
    isle.set(dev, s)
  }
  for (const d of devs.results) ekle(d.device, gun)

  // 🔴 GEÇ GELEN GÜN (22.09 "otobüs vakası") — gps worker'ının bıraktığı işaretler.
  // KONUM ÖNEMLİ: bu blok aşağıdaki özet-isteği döngüsünün ve onun `isle` kapısının ÖNÜNDE.
  const gecKume = new Set<string>()   // `${dev}|${g}` — bu turda geri dönük işlenecek çiftler
  // `${dev}|${g}` -> bu turda GÖRÜLEN seviye + o anki işlenmiş kayıt (tur sonunda yazılır).
  // Seviye turun BAŞINDA okunan değerdir: iş sürerken gelen yeni noktalar daha yüksek bir seviye
  // yazar, biz eskisini "işlendi" diye kaydederiz ve gün sonraki turda yeniden işlenir. Doğru olan
  // da budur — yeni nokta hiçbir zaman işlenmiş sayılmaz.
  const gecDurum = new Map<string, { seviye: number; islendi: IslendiKayit; zorla: boolean }>()
  const gecAnahtarlar = await kvListe(c.env, GERIGUN_ONEK, GERIGUN_LISTE_TAVAN)
  if (gecAnahtarlar.length >= GERIGUN_LISTE_TAVAN) {
    // 🔴 TAVAN DOLDU = SESSİZ AÇLIK RİSKİ. KV list SÖZLÜKSEL sıralı, dolayısıyla taşan anahtarlar
    // hep aynı uçtan (lexical olarak sonda kalan cihazlar) düşer ve bu turda HİÇ görülmez.
    // Kalıcı açlık DEĞİL — işlenen çiftler GERIGUN_TEMIZLIK_SN (1 gün) sonra silindiği için liste
    // kendini boşaltır ve sıradakiler yüzeye çıkar; ama gecikme günlere çıkabilir. Bu satır
    // loglarda görünüyorsa tavan gerçek yükün ALTINDA demektir, ölçüye bakıp yükselt.
    c.log(`⚠️ gerigun listesi TAVANDA (${gecAnahtarlar.length}/${GERIGUN_LISTE_TAVAN}) — taşan anahtarlar bu turda işlenmedi`)
  }
  for (const k of gecAnahtarlar) {
    const coz = gerigunCoz(k)
    if (!coz) {
      await kvSil(c, k)
      c.log(`gerigun anahtarı bozuk, silindi: ${k}`)
      continue
    }
    const { dev, gun: g } = coz
    const islendiAnahtar = gerigunIslendiAnahtar(dev, g)
    if (g >= gun) { await kvSil(c, k, islendiAnahtar); continue }
    if (c.now - trGunAralik(g)[1] > GERIGUN_MAX_YAS) {       // çok eski: gezi de artık anlamsız
      await kvSil(c, k, islendiAnahtar)
      c.log(`gerigun düştü (${g} çok eski): ${dev}`)
      continue
    }
    // SU SEVİYESİ: işaret = son geç noktanın yazma anı, işlendi = cron'un işlediği seviye.
    // Eski biçimdeki ({t, ts} ve hata sayacı eklenmiş) kayıtlar da aynen okunur — `t` alanı
    // ikisinde de var, dolayısıyla canlıda duran anahtarlar için göç adımı GEREKMEZ.
    const isaret = await kvJson<GeriGunIsaret>(c.env, k, { t: 0, ts: 0 })
    const seviye = Number(isaret.t) || 0
    const ham = await kvJson<IslendiKayit>(c.env, islendiAnahtar, { sv: 0, hata: 0, t: 0 })
    const islendi: IslendiKayit = {
      sv: Number(ham.sv) || 0, hata: Number(ham.hata) || 0, t: Number(ham.t) || 0,
      bi: Number(ham.bi) || 0,
    }
    if (seviye <= islendi.sv) {
      // Bu seviye işlendi. Bir gündür yeni nokta da gelmediyse iki anahtar da düşsün (liste
      // şişmesin). Silme güvenli: gerçekten yeni bir nokta gelirse gps işareti TAZE seviyeyle
      // yeniden yazar. (Teorik yarış: tam bu ara nokta gelirse o tek nokta işlenmeden kalır —
      // boşalma yüzlerce nokta gönderdiği için sıradaki nokta günü yeniden kuyruğa sokar.)
      if (c.now - seviye > GERIGUN_TEMIZLIK_SN) await kvSil(c, k, islendiAnahtar)
      continue
    }
    // 🔴 YERLEŞME (settle): tampon HÂLÂ boşalıyorsa günü İŞLEME — yoksa kırpık gezi üretilir
    // (bkz. cihazIsle'deki openTrip notu). Her yeni nokta seviyeyi ileri ittiği için bu koşul
    // ancak cihaz gerçekten sustuğunda açılır.
    // 🔴 ÜST SINIR (GERIGUN_BEKLEME_TAVAN_SN): "ancak cihaz sustuğunda" KESİNTİSİZ akan bir
    // cihazda hiç gerçekleşmeyebilir — her nokta seviyeyi ileri iter, pencere hiç açılmaz ve gün
    // 7 gün sonra İŞLENMEDEN düşerdi. Bekleme tavanı dolduğunda yerleşme BEKLENMEZ: gün işlenir,
    // oto-video ise ertelenir (aşağıdaki `zorla`).
    let zorla = false
    if (c.now - seviye <= GERIGUN_YERLESME_SN) {
      let bi = Number(islendi.bi) || 0
      if (!bi) {
        // Bu seviye için İLK bekleme turu: tavan saatini başlat ve KALICI yaz — tur içi değişken
        // yetmez, sonraki tur bambaşka bir izolatta koşar. Yazım patlarsa (kvYazLogla loglar)
        // tavan bir tur gecikir, kilitlenme olmaz: sonraki tur yeniden dener.
        bi = c.now
        islendi.bi = bi
        await kvYazLogla(c, islendiAnahtar, islendi, GERIGUN_TTL_SN)
      }
      const bekleme = c.now - bi
      if (bekleme <= GERIGUN_BEKLEME_TAVAN_SN) {
        c.log(`gerigun bekliyor: ${dev} ${g} — tampon hâlâ boşalıyor (${c.now - seviye}sn < ${GERIGUN_YERLESME_SN}sn, toplam bekleme ${bekleme}sn)`)
        continue
      }
      zorla = true
      c.log(`gerigun ZORLANDI: ${dev} ${g} — ${bekleme}sn'dir yerleşmedi (tavan ${GERIGUN_BEKLEME_TAVAN_SN}sn), gün yerleşme beklenmeden işleniyor (oto-video ertelendi)`)
    }
    ekle(dev, g)
    gecKume.add(`${dev}|${g}`)
    gecDurum.set(`${dev}|${g}`, { seviye, islendi, zorla })
    c.log(`gerigun: ${dev} → ${g} günü geri dönük işlenecek (seviye ${seviye}, işlenen ${islendi.sv})`)
  }

  // 🔴 FİKS 04.09 — ON-DEMAND ÖZET, BUGÜN HAREKET OLMASA DA İŞLENMELİ.
  // Eskiden burada "bugün aktif cihaz yok" deyip ÇIKILIYORDU: kullanıcı "üret"e bastığında
  // (ör. TR gece yarısından sonra ya da sürüş yapılmayan bir günde) istek KV'de öylece kalıyor,
  // özet HİÇ üretilmiyordu. Ölçüldü 05.09 00:09 TR: bekleyen istek var, konum yok → görev bitiyordu.
  // Artık bekleyen istek sahiplerinin son HAREKETLİ günü işlenir.
  const istekler = await kvListe(c.env, 'summaryreq:', 50)
  for (const k of istekler) {
    const uid = k.slice('summaryreq:'.length).split('_')[0]
    if (!uid) { await c.env.KV.delete(k); continue }
    const row = await c.env.DB.prepare('SELECT tracker_id FROM users WHERE uid = ?1')
      .bind(uid).first<{ tracker_id: string | null }>()
    const dev = row?.tracker_id || ''
    if (!dev) { await c.env.KV.delete(k); c.log(`özet isteği düştü (takipçi yok): ${uid}`); continue }
    if (isle.get(dev)?.has(gun)) continue            // zaten BUGÜN işlenecek (geç gün sayılmaz)
    const son = await c.env.DB.prepare('SELECT MAX(ts) AS t FROM positions WHERE device = ?1 AND ts >= ?2')
      .bind(dev, c.now - 3 * 86400).first<{ t: number | null }>()
    if (!son?.t) { await c.env.KV.delete(k); c.log(`özet isteği düştü (3 günde veri yok): ${uid}`); continue }
    ekle(dev, trGun(son.t))                          // son hareketli günü özetle
    c.log(`özet isteği: ${uid} → ${trGun(son.t)} günü işlenecek (bugün hareket yok)`)
  }

  if (!isle.size) { c.log('bugün aktif cihaz yok, bekleyen özet isteği de yok'); return }
  // AYNI GÜN İKİ KEZ İŞLENİRSE NE OLUR (sorulan soru — ölçülen cevap): güvenli.
  //   · rides  : ic.registerRide INSERT ... ON CONFLICT(rid) DO UPDATE, rid = `${TRgun}_${başlangıç}`
  //              → çift kayıt YOK, üstüne yazar.
  //   · özet   : activities ON CONFLICT(uid, day) DO UPDATE → çift kayıt YOK.
  //   · bildirim: `sent:act:` kümesi + `sent:ozet:` bayrağı keser (TTL 3 gün; ondan sonra en fazla
  //              bir kez tekrar push gider — para harcamaz).
  //   · video  : videos/pending_videos/R2 + `autovid:` sayacı + geç gün tavanı → ikinci GPU işi YOK.
  // Bu yüzden seviye ancak iş BAŞARIYLA bittikten sonra ilerletiliyor: bir tur fazladan koşmak,
  // bir günü hiç işlememekten kıyas kabul etmez biçimde ucuz.
  for (const [dev, gunler] of isle) {
    for (const g of gunler) {
      const cift = `${dev}|${g}`
      const durum = gecDurum.get(cift)
      try {
        await cihazIsle(c, dev, g, gecKume.has(cift), durum?.zorla ?? false)
        if (durum) await gerigunSonuc(c, dev, g, durum.seviye, durum.islendi, true)
      } catch (e) {
        c.log(`cihaz ${dev} (${g}) hata: ${String(e).slice(0, 150)}`)
        // Seviye İLERLEMEZ → sonraki tur aynı günü yeniden dener (MAX_DENEME'de pes eder).
        if (durum) await gerigunSonuc(c, dev, g, durum.seviye, durum.islendi, false)
      }
    }
  }
}
