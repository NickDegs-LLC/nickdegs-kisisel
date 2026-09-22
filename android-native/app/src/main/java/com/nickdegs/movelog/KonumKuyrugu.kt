package com.nickdegs.movelog

import android.content.Context
import android.content.SharedPreferences
import android.location.Location
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

// ÖNCE-DİSKE-YAZ (write-ahead) KONUM KUYRUĞU — 20.09 vakasının düzeltmesi.
//
// VAKA: şebekesiz uzun otobüs yolculuğunda oto-takip AÇIKTI ama TEK BİR NOKTA bile sunucuya
// ulaşmadı, rota KALICI olarak kayboldu. Kök neden: konum "ateşle-unut" gönderiliyordu —
// TrackingService.send() içindeki `catch (e: Exception) {}` TAMAMEN BOŞTU; istek patlayınca
// nokta HİÇBİR YERE yazılmıyor, izsiz buharlaşıyordu.
//
// KURAL: nokta ÖNCE kalıcı dosyaya yazılır, SONRA gönderilir. Kuyruktan düşürme YALNIZ HTTP 2xx.
// Çevrimiçiyken davranış bugünküyle AYNI: nokta anında gönderilir, kuyruk boş kalır.
//
// Yeni bağımlılık YOK (projede Room/WorkManager yok): düz dosya (filesDir/konum_kuyrugu.csv,
// satır başına bir nokta) + SharedPreferences("movelog") yeterli.
//
// 🔴 BU DOSYAYI DÜZENLEYEN OKUSUN — DÖRT KURAL (hepsi gerçek kusurdan doğdu):
//  1. BOŞ TOKEN KUYRUĞU SİLMEZ, YALNIZ DURAKLATIR. Store.validate() HTTP 401 *veya 403* alınca
//     nd_token'a "" yazıyor; Cloudflare WAF/rate-limit 403'ü profil ucundan gelirse eski kod
//     8 saatlik rotayı TEK HAMLEDE siliyordu — düzeltmeye çalıştığımız kaybın ta kendisi.
//     Silme YALNIZ hesap değişiminde (K_SAHIP kapısı) olur.
//  2. Düşürme ARTIMLI: her ~50'lik partide baş göstergesi ilerler. Tur sonuna bırakılırsa süreç
//     ortada öldüğünde teslim edilmiş binlerce nokta TEKRAR gönderilir.
//  3. Dosyayı yeniden yazan her yol ATOMİK olmalı (geçici dosya + renameTo) ve gönderim
//     UÇUŞTAYKEN çalışmamalı — yoksa düşürme YANLIŞ dosyanın başından siler.
//  4. Dosya G/Ç ASLA ana iş parçacığında olmaz: konum geri çağrıları mainLooper'a bağlı,
//     4,5 MB'lık okuma orada ANR demektir. Tüm yazma tek bir arka plan executor'ında.
object KonumKuyrugu {
    private const val DOSYA = "konum_kuyrugu.csv"
    private const val GECICI = "konum_kuyrugu.yeni"      // atomik yeniden yazma ara dosyası
    private const val ETIKET = "MoveLogKuyruk"           // logcat etiketi (teşhis)
    // TAVAN (iOS GpsKuyruk.tavanKayit ile AYNI): 60.000 nokta ≈ 4,5 MB.
    // 20.000 yanlıştı: noktalar yalnız uzun aralıklardan gelmiyor — "hassas" modda 5 sn/5 m ile
    // otobüs hızında pratikte ~1 Hz akar, yani 20.000 ≈ 5,5 saatte, yolculuğun TAM ORTASINDA dolardı.
    private const val TAVAN = 60000
    // Seyreltme bu boşluğu AŞAMAZ. Sunucuda GAP_SEC = 15 dk (activity-detect.ts): daha uzun boşluk
    // tek yolculuğu İKİYE böler ve parçalar valid() eşiklerinin altında kalıp TAMAMEN düşer.
    private const val MAX_BOSLUK = 600L
    private const val PARTI = 50                         // artımlı düşürme grubu (en çok bu kadar nokta sonra baş ilerler)
    private const val TUR_TAVAN = 400                    // tek boşaltma turunda en çok bu kadar nokta (iOS turTavanKayit)
    private const val SIKISTIR_ESIGI = 256L * 1024       // tüketilmiş ön bu kadar büyüyünce dosya sıkıştırılır
    private const val PENCERE = 64 * 1024                // tek okuma penceresi
    private const val K_ID = "nd_ingest_id"          // Traccar cihaz kimliği (kalıcı)
    private const val K_URL = "nd_ingest_url"        // OsmAnd ingest adresi (kalıcı)
    private const val K_SAHIP = "nd_kuyruk_sahip"    // kuyruktaki noktalar KİMİN cihaz kimliğine ait
    private const val K_HATA = "nd_kuyruk_son_hata"  // teşhis: son başarısızlık (boş catch'in yerine)
    private const val K_BAS = "nd_kuyruk_bas"        // teslim edilmiş ön: dosyadaki BAŞ ofseti (bayt)
    private const val NL = '\n'.code.toByte()

    private val kilit = Any()
    private val gonderiliyor = AtomicBoolean(false)
    // TÜM disk yazımı bu TEK iş parçacığında: sıra korunur (nokta sırası = zaman sırası) ve
    // konum geri çağrısının bağlı olduğu ana iş parçacığı hiç dosyaya dokunmaz.
    private val yazici = Executors.newSingleThreadExecutor { r ->
        Thread(r, "nd-kuyruk-yazici").apply { isDaemon = true }
    }
    // Ana iş parçacığı (bildirim) KİLİTSİZ okur -> @Volatile. Yazımı hep kilit altında.
    @Volatile private var satirSayisi = -1                // -1 = henüz sayılmadı
    @Volatile private var basOfset = -1L                  // -1 = prefs'ten henüz okunmadı
    // Dosya yeniden yazıldığında artar: uçuştaki turun elindeki BAYT ofsetleri geçersizleşir.
    @Volatile private var nesil = 0L

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences("movelog", Context.MODE_PRIVATE)

    private fun dosya(ctx: Context) = File(ctx.applicationContext.filesDir, DOSYA)

    private fun hataYaz(ctx: Context, mesaj: String) {
        // Boş catch yok: hem cihazda kalsın (iOS'taki lastError karşılığı) HEM de logcat'te görünsün.
        // Eskiden K_HATA yazılıyor ama HİÇBİR YERDE okunmuyordu -> teşhis fiilen yoktu.
        Log.w(ETIKET, mesaj)
        try { prefs(ctx).edit().putString(K_HATA, "${System.currentTimeMillis() / 1000}:$mesaj").apply() }
        catch (e: Exception) { }
    }

    // ---- Kimlik (START_STICKY yeniden başlatmasında intent extras GELMEZ, kalıcı yerden okunur) ----
    fun kimlikSakla(ctx: Context, deviceId: String, url: String) {
        if (deviceId.isEmpty() || url.isEmpty()) return
        prefs(ctx).edit().putString(K_ID, deviceId).putString(K_URL, url).apply()
    }
    fun kimlikId(ctx: Context): String = prefs(ctx).getString(K_ID, "") ?: ""
    fun kimlikUrl(ctx: Context): String = prefs(ctx).getString(K_URL, "") ?: ""

    /// Bekleyen nokta sayısı. ANA İŞ PARÇACIĞINDAN çağrılır (bildirim metni) -> DOSYAYA DOKUNMAZ,
    /// yalnız bellekteki sayacı okur. Sayım arka planda (ilk ekle/boşaltma) yapılır.
    fun bekleyen(ctx: Context): Int {
        val n = satirSayisi
        return if (n < 0) 0 else n
    }

    // ---- 1) ÖNCE DİSKE ----
    fun ekle(ctx: Context, loc: Location) {
        val app = ctx.applicationContext
        // Ölçüm anının ZAMAN DAMGASI korunur: sunucu `timestamp` parametresini aynen yazıyor,
        // yani saatler sonra boşalan kuyruk bile rotayı doğru ana oturtur.
        // Satır ÇAĞIRAN iş parçacığında kurulur (ucuz, G/Ç yok): böylece değişebilen Location
        // nesnesi arka plana taşınmaz, yalnız hazır metin taşınır.
        val satir = "${loc.latitude},${loc.longitude},${loc.time / 1000}," +
            "${loc.speed * 1.94384},${loc.altitude},${loc.accuracy},${loc.bearing}"   // m/s -> knot
        // 🔴 DOSYA G/Ç ANA İŞ PARÇACIĞINDA YAPILMAZ: konum güncellemeleri mainLooper'a bağlı,
        // ilk ekle() 4,5 MB'a kadar dosya okuyabiliyordu (ANR riski). Tek executor -> SIRA KORUNUR.
        try { yazici.execute { diskeEkle(app, satir) } }
        catch (e: Exception) { hataYaz(app, "kuyruga alinamadi: ${e.message}") }
    }

    private fun diskeEkle(ctx: Context, satir: String) {
        synchronized(kilit) {
            try {
                if (satirSayisi < 0) sayDosyadan(ctx)
                FileOutputStream(dosya(ctx), true).use { it.write((satir + "\n").toByteArray()) }
                satirSayisi++
            } catch (e: Exception) { hataYaz(ctx, "yazma: ${e.message}"); return }
            if (satirSayisi > TAVAN) seyrelt(ctx)
        }
    }

    // Taşma politikası — kilit altında çağrılır.
    private fun seyrelt(ctx: Context) {
        // 🔴 GÖNDERİM UÇUŞTAYKEN DOSYAYI YENİDEN YAZMA (iOS'taki `guard !mesgul` karşılığı):
        // tur ortasında dosyayı değiştirirsek turun elindeki bayt ofsetleri YANLIŞ dosyaya işaret
        // eder ve düşürme teslim EDİLMEMİŞ noktaları sessizce silerdi. Tavan aşımı burada
        // ertelenir; tur bitince bir sonraki ekle() aynı kapıya yeniden gelir.
        if (gonderiliyor.get()) return
        val hepsi = tumBekleyen(ctx)
        if (hepsi.size <= TAVAN) { satirSayisi = hepsi.size; return }
        // 🔴 BİTİŞİK BLOK SİLİNMEZ: sunucudaki 15 dk (GAP_SEC) boşluk eşiği yüzünden baştan/ortadan
        // blok atmak TEK yolculuğu ikiye böler ve parçalar tamamen düşebilir. Bunun yerine
        // BİR ATLAYARAK seyreltiriz: zaman kapsamı TAM kalır, yalnız çözünürlük yarıya iner.
        // İlk ve son nokta HER ZAMAN korunur (yolculuğun başı ve sonu kaymasın).
        // Ek emniyet (iOS ile aynı): bir noktayı atmak komşular arası boşluğu MAX_BOSLUK'un
        // üstüne çıkaracaksa O NOKTA ATILMAZ — seyreltme GAP_SEC bölünmesi üretmesin.
        var tutulan = ArrayList<String>(hepsi.size / 2 + 2)
        var sonTs = 0L                                  // i=0 her zaman tutulur, karşılaştırmadan önce dolar
        for (i in hepsi.indices) {
            val ilk = i == 0; val son = i == hepsi.lastIndex
            if (!ilk && !son && i % 2 == 1 && zaman(hepsi[i + 1]) - sonTs <= MAX_BOSLUK) continue
            tutulan.add(hepsi[i]); sonTs = zaman(hepsi[i])
        }
        // Seyreltme kâr etmediyse (MAX_BOSLUK kapısı her atlamayı engelledi) kuyruk sınırsız büyür
        // ve BUNDAN SONRAKİ HER ekle() tüm dosyayı okurdu. Sert emniyet: en eski %10'u at.
        if (tutulan.size >= hepsi.size) {
            val at = maxOf(1, hepsi.size / 10)
            tutulan = ArrayList(hepsi.drop(at))
        }
        if (tutulan.size >= hepsi.size) { satirSayisi = hepsi.size; return }
        basSifirlaSenkron(ctx)                           // 🔴 rename'den ÖNCE (bkz. basSifirlaSenkron)
        if (!atomikYaz(ctx, tutulan.joinToString("\n", postfix = "\n").toByteArray())) {
            hataYaz(ctx, "seyreltme yazilamadi, kuyruk DOKUNULMADAN duruyor")
            return                                       // eski dosya sağlam: kayıp yok
        }
        satirSayisi = tutulan.size
        nesil++
        hataYaz(ctx, "tavan asildi, seyreltildi ${hepsi.size}->${tutulan.size}")
    }

    // Satırın ölçüm anı (saniye); bozuk satırda 0 -> seyreltme kapısı muhafazakâr davranır.
    private fun zaman(satir: String): Long = satir.split(",").getOrNull(2)?.toLongOrNull() ?: 0L

    // ---- 2) SONRA GÖNDER (sıralı, en eskiden en yeniye) ----
    fun bosalt(ctx: Context) {
        val app = ctx.applicationContext
        if (!gonderiliyor.compareAndSet(false, true)) return   // tek gönderici: sıra bozulmasın
        Thread({
            try { dongu(app) }
            catch (e: Exception) { hataYaz(app, "dongu: ${e.message}") }
            finally { gonderiliyor.set(false) }
        }, "nd-kuyruk-gonderici").start()
    }

    private fun dongu(ctx: Context) {
        val p = prefs(ctx)
        // Sayaç arka planda burada primlenir (bildirim ana iş parçacığında yalnız okur).
        synchronized(kilit) { if (satirSayisi < 0) sayDosyadan(ctx) }

        // 🔴 BOŞ TOKEN = DURAKLAT, SİLME. Eskiden burada temizle() çağrılıyordu; ama
        // Store.validate() 401 VEYA 403'te nd_token'a "" yazıyor ve 403 Cloudflare
        // WAF/rate-limit'ten de gelebiliyor -> tüm rota tek hamlede silinirdi. Noktalar diskte
        // bekler, giriş yenilenince akar. Hesap DEĞİŞİMİ aşağıdaki K_SAHIP kapısında yakalanır.
        if ((p.getString("nd_token", "") ?: "").isEmpty()) { tikali = true; return }
        val id = kimlikId(ctx)
        val url = kimlikUrl(ctx)
        if (id.isEmpty() || url.isEmpty()) { tikali = true; return }   // kimlik yok: noktalar SİLİNMEZ, diskte bekler
        tikali = false

        // Kuyruk başka bir cihaz kimliğine (başka hesaba) aitse gönderme, at.
        val sahip = p.getString(K_SAHIP, "") ?: ""
        if (sahip.isEmpty()) p.edit().putString(K_SAHIP, id).apply()
        else if (sahip != id) { temizle(ctx); p.edit().putString(K_SAHIP, id).apply(); return }

        var turda = 0
        while (turda < TUR_TAVAN) {
            // Nesil HER PARTİDE yeniden alınır: parti okunduktan sonra dosya yeniden yazılırsa
            // (temizle/seyrelt) baş göstergesi İLERLETİLMEZ, tur sessizce biter.
            val n0 = nesil
            val parti = oku(ctx, minOf(PARTI, TUR_TAVAN - turda))
            if (parti.isEmpty()) return                 // kuyruk boşaldı (ya da yalnız yarım satır kaldı)
            var bayt = 0L
            var adet = 0
            var durdu = false
            for (k in parti) {
                val a = k.satir.split(",")
                // İçeriği bozuk kayıt TÜKETİLİR (kuyruğu tıkamasın) ama AĞA ÇIKILMAZ: süreç yazma
                // ortasında ölmüşse yarım satır bir sonrakine yapışmış olabilir, o çöpü sunucuya
                // göndermek rotaya sahte sıçrama yazardı.
                if (a.size >= 7 && gecerli(a)) {
                    val kod = gonder(url, id, a)
                    if (kod !in 200..299) {
                        // 🔴 4xx DAHİL HER başarısızlıkta DUR, sırayı bozma, noktayı DÜŞÜRME (iOS
                        // GpsKuyruk ile aynı karar). "Kalıcı 4xx'i at" dalı BİLEREK YOK: Cloudflare
                        // WAF/rate-limit 403'ü İSTEĞE aittir, kayda değil — tüm kuyruğu tek tek
                        // sessizce silerdi. Sunucu tarafı da buna göre yazıldı (gps worker):
                        // çöp koordinat 200 döner (sonsuz retry olmasın), D1 yazımı patlarsa 500.
                        hataYaz(ctx, "kod=$kod bekleyen=${maxOf(0, bekleyen(ctx) - adet)}")
                        durdu = true
                        break
                    }
                }
                bayt += k.bayt      // YALNIZ 2xx (ya da içeriği bozuk kayıt) buraya ulaşır
                adet++
                turda++
            }
            // 🔴 ARTIMLI DÜŞÜRME: partide teslim edilen ne varsa HEMEN düşer — başarısızlıkta da.
            // Eskiden düşürme tur SONUNDAYDI: süreç ortada ölünce teslim edilmiş binlerce nokta
            // yeniden gönderiliyordu.
            if (adet > 0 && !basIlerlet(ctx, bayt, adet, n0)) return
            if (durdu) return
        }
        // Tur tavanı doldu: kalanı BİR SONRAKİ TETİĞE bırak (TrackingService periyodik denemesi,
        // ağ geri çağrısı, uygulama öne gelmesi). Kuyruk boş değilken TrackingService tekrar
        // aralığını 60 sn'den 5 sn'ye düşürür -> yığılmış kuyruk hızla akar.
    }

    // Kuyruğun BAŞINI `bayt` kadar ilerletir (teslim edilen kayıtlar). Gönderim sırasında sona
    // yeni nokta eklenmiş olabilir; ilerletme hep BAŞTAN olduğu için onları etkilemez.
    // false dönerse dosya altımızdan değişmiştir: çağıran turu bitirir.
    private fun basIlerlet(ctx: Context, bayt: Long, adet: Int, nesil0: Long): Boolean {
        synchronized(kilit) {
            if (nesil0 != nesil) return false
            val b = basOku(ctx) + bayt
            basYaz(ctx, b)
            satirSayisi = maxOf(0, satirSayisi - adet)
            try {
                val uz = dosya(ctx).length()
                if (b >= uz) {                      // hepsi teslim edildi: dosyayı sil, en ucuz sıkıştırma
                    dosya(ctx).delete(); basYaz(ctx, 0L); satirSayisi = 0; nesil++
                } else if (b > SIKISTIR_ESIGI) {    // tüketilmiş ön şişti: dosyanın önünü at
                    sikistir(ctx)
                }
            } catch (e: Exception) { hataYaz(ctx, "bas ilerletme: ${e.message}") }
            return true
        }
    }

    // Tüketilmiş önü atar (atomik). Başarısız olursa eski dosya OLDUĞU GİBİ kalır, veri kaybı yok.
    private fun sikistir(ctx: Context) {          // kilit altında
        try {
            val f = dosya(ctx)
            val b = basOku(ctx)
            val uz = f.length()
            if (b <= 0L || b >= uz) return
            val kalan = ByteArray((uz - b).toInt())
            RandomAccessFile(f, "r").use { raf -> raf.seek(b); raf.readFully(kalan) }
            basSifirlaSenkron(ctx)                       // 🔴 rename'den ÖNCE (bkz. basSifirlaSenkron)
            if (!atomikYaz(ctx, kalan)) { hataYaz(ctx, "sikistirma yazilamadi"); return }
            nesil++
        } catch (e: Exception) { hataYaz(ctx, "sikistirma: ${e.message}") }
    }

    // 🔴 ATOMİK YENİDEN YAZMA: geçici dosyaya yaz + renameTo (aynı dosya sisteminde, filesDir).
    // Eski kod writeText kullanıyordu: dosyayı ÖNCE 0'a kırpıyor, sonra yazıyordu — arada süreç
    // ölürse (arka planda öldürülme gerçekçi) kuyruğun TAMAMI yok olurdu.
    private fun atomikYaz(ctx: Context, govde: ByteArray): Boolean {
        val f = dosya(ctx)
        val g = File(ctx.applicationContext.filesDir, GECICI)
        return try {
            FileOutputStream(g).use { it.write(govde); it.fd.sync() }   // rename ÖNCESİ diske insin
            if (!g.renameTo(f)) { g.delete(); false } else true
        } catch (e: Exception) {
            try { g.delete() } catch (e2: Exception) { }
            hataYaz(ctx, "atomik yazma: ${e.message}")
            false
        }
    }

    // Takip KAPATILIRSA kuyruk SİLİNMEZ (yalnız gönderilmeye çalışılır); burası SADECE hesap
    // değişimi içindir (K_SAHIP kapısı). Boş token'da ARTIK ÇAĞRILMAZ — yukarıdaki 1. kural.
    fun temizle(ctx: Context) {
        synchronized(kilit) {
            try { dosya(ctx).delete() } catch (e: Exception) { }
            try { File(ctx.applicationContext.filesDir, GECICI).delete() } catch (e: Exception) { }
            satirSayisi = 0
            basYaz(ctx, 0L)
            nesil++                                  // uçuştaki tur artık baş ilerletemez
        }
        try { prefs(ctx).edit().remove(K_SAHIP).apply() } catch (e: Exception) { }
    }

    // ---- dosya katmanı: BAŞ ofseti modeli (iOS GpsKuyruk ile aynı fikir) ----
    // Teslim edilen kayıtlar dosyadan SİLİNMEZ, yalnız baş göstergesi ilerler. Böylece her
    // düşürmede 4,5 MB yeniden yazılmaz; dosya ancak ön SIKISTIR_ESIGI'ni aşınca toparlanır.
    private fun basOku(ctx: Context): Long {
        if (basOfset < 0) basOfset = try { prefs(ctx).getLong(K_BAS, 0L) } catch (e: Exception) { 0L }
        return basOfset
    }

    private fun basYaz(ctx: Context, v: Long) {
        basOfset = v
        try { prefs(ctx).edit().putLong(K_BAS, v).apply() } catch (e: Exception) { }
    }

    /// 🔴 YENİDEN YAZMADAN ÖNCE çağrılır, apply() DEĞİL commit() ile (senkron).
    /// Neden: atomikYaz() renameTo ile dosyayı anında değiştirir, ama basYaz'ın apply()'ı
    /// ASENKRONDUR. Rename ile prefs yazımı arasında süreç ölürse dosya YENİ (baştan başlar)
    /// ama kayıtlı baş ofseti ESKİ ve BÜYÜK kalır -> basOku dosyanın ortasını gösterir ve
    /// baştaki noktalar SESSİZCE ATLANIR: tam da önlemeye çalıştığımız kayıp.
    /// Ters sırada (önce baş=0 commit, sonra rename) en kötü ihtimal mükerrer gönderimdir —
    /// sunucu aynı noktayı zararsız karşılar, veri KAYBOLMAZ.
    private fun basSifirlaSenkron(ctx: Context) {
        basOfset = 0L
        try { prefs(ctx).edit().putLong(K_BAS, 0L).commit() } catch (e: Exception) { }
    }

    /// Kuyruk TIKALI: token yok ya da kimlik yok -> gönderim ilerleyemez. Hızlı kadansı buna
    /// bağlarız: aksi hâlde "bekleyen > 0" sonsuza dek doğru kalır ve TrackingService 5 saniyede
    /// bir BOŞUNA thread açar (ilerleme ihtimali SIFIR). Giriş yenilenince ilk tur bunu temizler.
    @Volatile private var tikali = false
    fun tikaliMi(): Boolean = tikali

    private class Kayit(val satir: String, val bayt: Int)   // bayt = satır + '\n' (baş ofseti için)

    // Baştan itibaren en çok `enFazla` TAM satır okur. Yarım kalmış son satır (süreç yazma
    // ortasında ölmüşse) OKUNMAZ: sonraki ekleme onu tamamlar/yapıştırır, gecerli() süzer.
    private fun oku(ctx: Context, enFazla: Int): List<Kayit> {
        synchronized(kilit) {
            val f = dosya(ctx)
            if (!f.exists()) return emptyList()
            try {
                RandomAccessFile(f, "r").use { raf ->
                    val uz = raf.length()
                    var b = basOku(ctx)
                    // Tutarsız baş (dosya dışarıdan kısaldı): BAŞA dön. Mükerrer gönderim zararsız
                    // (sunucu mesafeyi haversine ile topluyor, aynı koordinatın katkısı 0);
                    // baştaki noktaları atmak ise KALICI kayıp olurdu.
                    if (b > uz) { b = 0L; basYaz(ctx, 0L) }
                    if (b >= uz) return emptyList()
                    raf.seek(b)
                    val boy = minOf(PENCERE.toLong(), uz - b).toInt()
                    val tampon = ByteArray(boy)
                    raf.readFully(tampon)
                    val out = ArrayList<Kayit>(enFazla)
                    var bas = 0
                    for (i in 0 until boy) {
                        if (tampon[i] != NL) continue
                        out.add(Kayit(String(tampon, bas, i - bas, Charsets.US_ASCII), i - bas + 1))
                        bas = i + 1
                        if (out.size >= enFazla) break
                    }
                    // Tam pencere doldu ama tek '\n' yok: satır 64 KB'tan uzun, yani dosya bozuk.
                    // Kuyruk sonsuza kadar tıkanmasın diye o pencereyi tüketilmiş say (sınırlı kayıp).
                    if (out.isEmpty() && boy >= PENCERE) {
                        hataYaz(ctx, "bozuk pencere atlandi ($boy bayt)")
                        basYaz(ctx, b + boy)
                    }
                    return out
                }
            } catch (e: Exception) { hataYaz(ctx, "okuma: ${e.message}"); return emptyList() }
        }
    }

    // Baştan sona TÜM bekleyen satırlar (yalnız seyreltme kullanır; kilit altında, arka planda).
    private fun tumBekleyen(ctx: Context): List<String> {     // kilit altında
        val f = dosya(ctx)
        if (!f.exists()) return emptyList()
        try {
            RandomAccessFile(f, "r").use { raf ->
                val uz = raf.length()
                var b = basOku(ctx)
                if (b > uz) { b = 0L; basYaz(ctx, 0L) }
                if (b >= uz) return emptyList()
                raf.seek(b)
                val tampon = ByteArray((uz - b).toInt())
                raf.readFully(tampon)
                val out = ArrayList<String>()
                var bas = 0
                for (i in tampon.indices) {
                    if (tampon[i] != NL) continue
                    out.add(String(tampon, bas, i - bas, Charsets.US_ASCII))
                    bas = i + 1
                }
                return out
            }
        } catch (e: Exception) { hataYaz(ctx, "tam okuma: ${e.message}"); return emptyList() }
    }

    // Bekleyen satır sayısını dosyadan sayar (yalnız arka plan; kilit altında).
    private fun sayDosyadan(ctx: Context) {
        val f = dosya(ctx)
        if (!f.exists()) { satirSayisi = 0; return }
        var n = 0
        try {
            RandomAccessFile(f, "r").use { raf ->
                val uz = raf.length()
                var b = basOku(ctx)
                if (b > uz) { b = 0L; basYaz(ctx, 0L) }
                raf.seek(b)
                val tampon = ByteArray(PENCERE)
                while (true) {
                    val okunan = raf.read(tampon)
                    if (okunan <= 0) break
                    for (i in 0 until okunan) if (tampon[i] == NL) n++
                }
            }
        } catch (e: Exception) { hataYaz(ctx, "sayim: ${e.message}") }
        satirSayisi = n
    }

    // Worker'ın sessizce YUTACAĞI/çöp olan kaydı istemcide ele (iOS gecerli() karşılığı):
    // boşuna istek gitmesin, yarım satırdan yapışmış çöp rotaya sahte sıçrama yazmasın.
    private fun gecerli(a: List<String>): Boolean {
        val lat = a[0].toDoubleOrNull() ?: return false
        val lon = a[1].toDoubleOrNull() ?: return false
        val ts = a[2].toLongOrNull() ?: return false
        if (!lat.isFinite() || !lon.isFinite()) return false
        if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) return false
        if (lat == 0.0 && lon == 0.0) return false        // Null Island
        if (ts < 946684800L) return false                 // 2000 öncesi = bozuk saat
        return true
    }

    // Tek nokta gönderimi (eski TrackingService.send() ile birebir aynı istek) -> HTTP kodu, -1 = ağ hatası.
    private fun gonder(ingestUrl: String, deviceId: String, a: List<String>): Int {
        return try {
            val sep = if (ingestUrl.contains("?")) "&" else "?"
            fun e(v: String) = URLEncoder.encode(v, "UTF-8")
            val q = "${sep}id=${e(deviceId)}&lat=${a[0]}&lon=${a[1]}" +
                "&timestamp=${a[2]}&speed=${a[3]}" +
                "&altitude=${a[4]}&accuracy=${a[5]}&bearing=${a[6]}"
            val c = (URL(ingestUrl + q).openConnection() as HttpURLConnection)
            c.requestMethod = "POST"; c.connectTimeout = 10000; c.readTimeout = 10000
            c.doOutput = true; OutputStreamWriter(c.outputStream).use { it.write("") }
            val kod = c.responseCode
            c.disconnect()
            kod
        } catch (e: Exception) { -1 }
    }
}
