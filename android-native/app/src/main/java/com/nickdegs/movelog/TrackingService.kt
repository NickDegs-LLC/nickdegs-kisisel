package com.nickdegs.movelog

import android.app.*
import android.content.Context
import android.content.Intent
import android.location.Location
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.nickdegs.movelog.ui.L
import java.util.Locale

// Canlı rota kaydı: foreground service + FusedLocation -> Traccar OsmAnd ingest (iOS Tracker.swift karşılığı).
// Konumlar sunucuya gider, backend aktiviteyi otomatik algılar.
class TrackingService : Service() {
    companion object {
        var active = false; private set
        private const val CH = "movelog_tracking"
        private const val NID = 42
        private const val TEKRAR_MS = 60_000L        // kuyruk BOŞKEN periyodik boşaltma denemesi
        // Kuyrukta bekleyen varsa SIK dene: kuyruğun tur tavanı var (tek turda en çok 400 nokta),
        // yani her tetik yığının bir bölümünü akıtır. 60 sn'de bir denemek 8 saatlik bir birikimi
        // saatlerce sürüncemede bırakırdı; 5 sn'de bir ~80 nokta/sn'ye çıkar.
        private const val TEKRAR_HIZLI_MS = 5_000L
        private const val ILK_TEKRAR_MS = 1_000L     // ilk tur: bildirimdeki bekleyen sayısı hızla dolsun
        private const val ETIKET = "MoveLogTakip"
        fun start(ctx: Context, deviceId: String, url: String) {
            // Kimlik KALICI yere de yazılır. AÇIK (20.09): deviceId/ingestUrl YALNIZCA intent
            // extras'ta tutuluyordu; START_STICKY ile servis kendi başına yeniden başladığında
            // intent null gelir -> ikisi de boş kalır, bildirim "Rotan kaydediliyor…" derken
            // TEK NOKTA bile gitmezdi. Artık SharedPreferences'tan okunuyor.
            KonumKuyrugu.kimlikSakla(ctx, deviceId, url)
            val i = Intent(ctx, TrackingService::class.java).putExtra("id", deviceId).putExtra("url", url)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, TrackingService::class.java)) }
    }

    private lateinit var fused: FusedLocationProviderClient
    private var lastSent: Location? = null
    private var agCb: ConnectivityManager.NetworkCallback? = null
    private val el = Handler(Looper.getMainLooper())
    // Ağ geri gelmese bile periyodik dene (bazı cihazlarda ağ geri çağrısı gecikir/gelmez).
    // 🔴 BU TİK CİHAZI UYANDIRMAZ: Handler/postDelayed uyku sırasında İLERLEMEZ, Doze'da tikler
    // kayar. Bilerek böyle — uyandırma işi KonumKuyrugu'nun JobScheduler tetiğinde (setPersisted +
    // NETWORK_TYPE_ANY): ağ yokken sistem bizi hiç uyandırmaz, ağ gelince kendisi uyandırır.
    // Burası yalnız CİHAZ ZATEN UYANIKKEN hızlı kadans + bildirim tazeleme içindir; ikisi
    // birbirinin yedeği, ikisi de kuyruk boşken/tıkalıyken boşuna çalışmaz.
    private var sonGosterilenBekleyen = -1
    private val tekrar = object : Runnable {
        override fun run() {
            KonumKuyrugu.bosalt(this@TrackingService)
            bildirimTazele()
            // Bekleyen varken hızlı, kuyruk boşken seyrek: boşuna uyanma yok, yığılma da beklemez.
            // 🔴 TIKALIYKEN hızlı kadans YOK: token/kimlik yoksa döngü anında dönüyor, ilerleme
            // ihtimali SIFIR — 5 sn'de bir boşuna thread açmak pil yakar. Giriş yenilenince
            // ilk seyrek tur tıkanıklığı temizler ve kadans yeniden hızlanır.
            val bekleyen = KonumKuyrugu.bekleyen(this@TrackingService)
            val hizli = bekleyen > 0 && !KonumKuyrugu.tikaliMi()
            el.postDelayed(this, if (hizli) TEKRAR_HIZLI_MS else TEKRAR_MS)
        }
    }

    private val cb = object : LocationCallback() {
        override fun onLocationResult(res: LocationResult) {
            val loc = res.lastLocation ?: return
            // ışınlanma filtresi (>252 km/h imkansız)
            lastSent?.let { p ->
                val dt = (loc.time - p.time) / 1000.0
                if (dt > 0 && loc.distanceTo(p) / dt > 70) return
            }
            lastSent = loc
            kaydet(loc)
        }
    }

    override fun onCreate() {
        super.onCreate()
        fused = LocationServices.getFusedLocationProviderClient(this)
        // AĞ DÖNÜNCE OTOMATİK BOŞALT: şebekesiz yolculukta biriken noktalar kapsama girer girmez akar.
        agCb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { KonumKuyrugu.bosalt(this@TrackingService) }
        }
        try {
            (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
                .registerDefaultNetworkCallback(agCb!!)
        } catch (e: Exception) {
            // SESSİZ YUTMA YOK: ACCESS_NETWORK_STATE izni düşerse/servis yoksa tek belirti bu satır.
            // Periyodik deneme devrede kalır (kuyruk yine akar) ama "ağ döndü" anı kaçar.
            Log.w(ETIKET, "ag geri cagrisi kurulamadi: ${e.message}")
            agCb = null
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Kimlik: intent'ten geldiyse KALICIYA yaz. Gönderim kimliği artık servisin alanlarından
        // değil kuyruktan (SharedPreferences) okunur — START_STICKY yeniden başlatmasında intent
        // null gelir ve eski kodda deviceId/ingestUrl boş kalıp hiçbir nokta gönderilmiyordu.
        val gelenId = intent?.getStringExtra("id") ?: ""
        val gelenUrl = intent?.getStringExtra("url") ?: ""
        if (gelenId.isNotEmpty() && gelenUrl.isNotEmpty()) KonumKuyrugu.kimlikSakla(this, gelenId, gelenUrl)
        startForeground(NID, notification())
        active = true
        // Servis başında bekleyen varsa hemen dene + periyodik denemeyi kur.
        KonumKuyrugu.bosalt(this)
        el.removeCallbacks(tekrar); el.postDelayed(tekrar, ILK_TEKRAR_MS)
        // ALGILAMA HASSASİYETİ (Barış 2026-08-01: "hassas takipte 5 saniyede bir konum daha keskin sonuç verir,
        // orta/normal telefon konumunda kalabilir"). BUG: burası SABİT 5sn/5m idi -> ayar hiçbir şey yapmıyordu ve
        // HERKES (ücretsiz dahil) sürekli en yüksek hassasiyette kalıp pil yiyordu. Artık iOS Tracker.sensParams
        // ile BİREBİR aynı tablo; ücretsiz kullanıcı iOS'taki gibi zorunlu "basit".
        val prefs = getSharedPreferences("movelog", MODE_PRIVATE)
        val prem = prefs.getBoolean("nd_premium", false)
        val sens = if (prem) (prefs.getString("nd_sensitivity", "dengeli") ?: "dengeli") else "basit"
        val (ivMs, distM) = when (sens) {
            "hassas"  -> Pair(5000L, 5f)     // en hassas: 5 sn / 5 m (en yoğun iz)
            "dengeli" -> Pair(15000L, 12f)   // dengeli: 15 sn / 12 m
            else      -> Pair(45000L, 30f)   // basit: 45 sn / 30 m (pil dostu)
        }
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, ivMs)
            .setMinUpdateIntervalMillis(ivMs * 3 / 5).setMinUpdateDistanceMeters(distM).build()
        try { fused.requestLocationUpdates(req, cb, mainLooper) } catch (e: SecurityException) {}
        return START_STICKY
    }

    // 🔴 20.09 VAKASI: eski `send()` "ateşle-unut" idi — istek patlayınca `catch (e: Exception) {}`
    // TAMAMEN BOŞTU, nokta hiçbir yere yazılmadan buharlaşıyordu (şebekesiz otobüs yolculuğunda
    // TEK nokta bile sunucuya ulaşmadı, rota kalıcı olarak kayboldu).
    // Artık: ÖNCE kalıcı kuyruğa yaz, SONRA göndermeyi dene. Kuyruktan düşürme YALNIZ HTTP 2xx'te.
    // Çevrimiçiyken davranış AYNI: nokta anında gider, kuyruk boş kalır.
    private fun kaydet(loc: Location) {
        KonumKuyrugu.ekle(this, loc)
        KonumKuyrugu.bosalt(this)
    }

    private fun notification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CH, L("Rota kaydı", "Route recording"), NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
        val tap = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE)
        // TEŞHİS KULLANICIYA GÖRÜNÜR: bekleyen nokta varsa bildirimde yazar. "Rotan kaydediliyor…"
        // tek başına YANILTICIYDI — 20.09'da tek nokta bile gitmezken de aynı yazı duruyordu.
        val bekleyen = KonumKuyrugu.bekleyen(this)
        // 12 DİL. 🔴 SAYI, ÇEVRİLEN DİZENİN DIŞINDA: L() çeviriyi İNGİLİZCE metne göre arar, yani
        // "1.234 nokta bekliyor" gibi sayı GÖMÜLÜ bir anahtar her sayı için ayrı satır demekti
        // (ve hiçbiri eşleşmez, 10 dil sessizce İngilizce'ye düşerdi). Sayı ayrı tutulunca
        // anahtar sabit kalır; sıralama her dilde "<sayı> <isim>" olarak doğru okunur.
        val kayit = L("Rotan kaydediliyor…", "Recording your route…")
        val metin = if (bekleyen > 0)
            kayit + " · " + String.format(Locale.getDefault(), "%,d", bekleyen) + " " +
                L("nokta bekliyor", "points waiting")
        else kayit
        return NotificationCompat.Builder(this, CH)
            .setContentTitle("Move Log")
            .setContentText(metin)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true).setContentIntent(tap).build()
    }

    // Bildirimi YALNIZ sayı değiştiyse yeniden gönder (gereksiz bildirim trafiği olmasın).
    private fun bildirimTazele() {
        val bekleyen = KonumKuyrugu.bekleyen(this)
        if (bekleyen == sonGosterilenBekleyen) return
        sonGosterilenBekleyen = bekleyen
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .notify(NID, notification())
        } catch (e: Exception) { Log.w(ETIKET, "bildirim tazeleme: ${e.message}") }
    }

    override fun onDestroy() {
        active = false
        try { fused.removeLocationUpdates(cb) } catch (e: Exception) {}
        el.removeCallbacks(tekrar)
        try {
            agCb?.let { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
                .unregisterNetworkCallback(it) }
        } catch (e: Exception) {}
        agCb = null
        // Takip kapatılsa da kuyruk SİLİNMEZ: bekleyen noktalar için son bir gönderme denemesi.
        KonumKuyrugu.bosalt(applicationContext)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
