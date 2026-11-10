package com.nickdegs.movelog.video

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.RectF
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.Choreographer
import android.view.PixelCopy
import android.view.Surface
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import com.nickdegs.movelog.data.API
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.roundToInt

// TELEFONDA VİDEO ÜRETİMİ — Android (03.11.2026, Barış: "Move Log ücretsiz; bulut video kalıcı kapalı,
// video yalnız telefonda üretilecek"). iOS WebRouteVideo.swift'in EŞLENİĞİ — sözleşme oradan:
//   1) POST /api/motor3d -> {"html","frames","fps","W","H"} (bulutla AYNI MapLibre motor sayfası)
//   2) sayfa ekran hiyerarşisindeki bir WebView'da yüklenir (görünmez DEĞİL: PixelCopy pencerenin
//      yüzeyini okur, WebView orada gerçekten çizilmiş olmalı; üstünü ayrı pencere olan ilerleme
//      diyaloğu örter)
//   3) _ready -> motorHazir() -> introCiz() (1 çekim, introN kez) -> kareCiz(f) ×frames -> finalCiz(k) ×outroN
//   4) ilk/son 0.8 sn siyaha kararma (iOS karart, SRC_OVER harman)
//   5) MediaCodec H.264 (Surface girişi) + MediaMuxer -> cacheDir/videolar/<ts>.mp4
//   6) POST /api/videos/upload (ham MP4) -> /api/local-renders/done
// v1'de SES/MÜZİK YOK (iOS muxMusic eşleniği yazılmadı) — seçilen müzik bu videoya girmez.
object YerelVideo {

    data class Istek(
        val from: Double, val to: Double, val type: String, val mode: String, val speed: String,
        val aspect: String, val camdist: String, val line: String, val dot: String,
        val grup: String? = null,   // 05.11: ortak sürüş anahtarı — sunucu eş izlerini ekler (yalnız 3D)
    )

    // ---- UI durumu (YerelVideoKatmani okur). Yalnız ana iş parçacığında yazılır (yuzde hariç). ----
    var calisiyor by mutableStateOf(false)
        private set
    var otomatik by mutableStateOf(false)
        private set
    var yuzde by mutableStateOf(0f)
        private set
    var asama by mutableStateOf("")
        private set
    /** Son hatanın kullanıcıya gösterilecek nedeni (iOS WebRouteVideo.sonHata). */
    var sonHata: String = ""
        private set
    /** /api/motor3d'nin son HTTP kodu (kuyruk yolu 400/404'te işi kuyruktan düşürür). */
    private var sonKod: Int = 0

    /** İş bitirme nedeni: null = sürsün. İptal düğmesi ve arka plan gözcüsü yazar, döngüler okur. */
    @Volatile private var durdur: String? = null

    fun iptal() { if (calisiyor) durdur = L("iptal edildi", "cancelled") }

    /**
     * Videoyu telefonda üret + yükle + kuyruktan düş. true = video Videolarım'da.
     * false -> [sonHata]. Aynı anda TEK üretim (iOS telefonKilidi): başka iş sürüyorsa hemen false.
     * ANA iş parçacığından çağrılmalı (Compose scope.launch zaten Main).
     */
    suspend fun uretVeYukle(act: Activity, store: Store, ist: Istek, otomatik: Boolean = false): Boolean {
        if (calisiyor) {
            sonHata = L("Başka bir video şu an üretiliyor.", "Another video is being created right now.")
            return false
        }
        calisiyor = true; this.otomatik = otomatik
        yuzde = 0f; asama = ""; sonHata = ""; sonKod = 0; durdur = null
        var dosya: File? = null
        try {
            val f = uret(act, store, ist) ?: return false
            dosya = f
            asama = L("Yükleniyor", "Uploading")
            yuzde = 0.9f
            val ok = store.yerelVideoYukle(f, ist.from, ist.to, ist.mode, ist.aspect, ist.type, ist.speed, ist.grup != null) { p ->
                yuzde = 0.9f + 0.1f * p
            }
            if (!ok) {
                // iOS ile aynı: yükleme kalıcı başarısızsa video KAYBOLMASIN -> galeriye.
                val galeri = withContext(Dispatchers.IO) { galeriyeKaydet(act.applicationContext, f) }
                sonHata = if (galeri) L("Video yüklenemedi; telefonunun galerisine kaydedildi.",
                                        "Couldn't upload the video; it was saved to your gallery.")
                          else L("Video yüklenemedi (bağlantı?).", "Couldn't upload the video (network?).")
                return false
            }
            store.localRenderDone(ist.from)
            store.videolarYenile++
            yuzde = 1f
            return true
        } finally {
            runCatching { dosya?.delete() }
            calisiyor = false; asama = ""; durdur = null
        }
    }

    /**
     * Sunucunun telefon kuyruğundaki bekleyen işleri üret (iOS processLocalRenderQueue).
     * Açılış başına en çok 2 iş (pil nezaketi). Kullanıcı iptal ederse / uygulama arka plana düşerse
     * kalanlar denenmez (iş kuyrukta kalır, sonraki açılışta tekrar gelir).
     */
    suspend fun kuyruguIsle(act: Activity, store: Store) {
        if (calisiyor) return
        // 10.11.2026 TAM SÜRÜM: tam erişim yoksa 3. ücretsiz sürüşten SONRA başlayan işler (grup dahil)
        // üretilmez — kuyruktan da DÜŞÜLMEZ, başarısız da sayılmaz; satın alınca sonraki turda üretilir.
        // Sınırı tazelemek için rotalar çekilir; sunucuya ulaşılamazsa güvenli taraf: bu tur hiçbir şey yapma.
        if (!store.tamErisim && store.ridesOrNull() == null) return
        val isler = store.localRenders().filter { !store.tsKilitli(it.optDouble("from", 0.0)) }
        for (j in isler.take(2)) {
            if (act.isFinishing || act.isDestroyed) return
            val frm = j.optDouble("from", 0.0)
            val to = j.optDouble("to", 0.0)
            if (frm.isNaN() || to.isNaN() || frm <= 0.0 || to <= frm) continue
            val grup = j.optString("grup", "").ifEmpty { null }
            val ist = Istek(
                from = frm, to = to,
                type = j.optString("type", "moto").ifEmpty { "moto" },
                mode = if (grup != null) "3d" else j.optString("mode", "flyover").ifEmpty { "flyover" },
                grup = grup,
                speed = j.optString("speed", "medium").ifEmpty { "medium" },
                aspect = j.optString("aspect", "9:16").ifEmpty { "9:16" },
                camdist = j.optString("camdist", "orta").ifEmpty { "orta" },
                line = j.optString("line", "#00E5FF").ifEmpty { "#00E5FF" },
                dot = j.optString("dot", "#FF3B30").ifEmpty { "#FF3B30" },
            )
            val ok = uretVeYukle(act, store, ist, otomatik = true)
            if (ok) continue
            // Bu rota hiç üretilemez (iz yok / geçersiz aralık) -> kuyruktan düş, her açılışta tekrar denenmesin.
            if (sonKod == 400 || sonKod == 404 || sonKod == 422) { store.localRenderDone(frm); continue }
            return   // iptal / arka plan / ağ: kalanları bu açılışta deneme
        }
    }

    // ======================================================================================

    private fun hata(neden: String): File? { sonHata = neden; return null }

    private suspend fun uret(act: Activity, store: Store, ist: Istek): File? {
        asama = L("Harita hazırlanıyor", "Preparing map")
        val (kod, txt) = store.motorSayfasi(ist.from, ist.to, ist.type, ist.mode, ist.speed,
            ist.aspect, ist.camdist, ist.line, ist.dot, ist.grup)
        sonKod = kod
        if (kod != 200) {
            // SUNUCUNUN KENDİ MESAJI (iOS sayfaAl ile aynı): "iz yok", "aralik", "spec uretilemedi"...
            val detay = runCatching { JSONObject(txt).optString("detail", "") }.getOrDefault("")
            return hata(detay.ifEmpty {
                if (kod == 0) L("Sunucuya ulaşılamadı (bağlantı?)", "Couldn't reach the server (network?)")
                else L("Sunucu {n} döndü", "Server returned {n}").replace("{n}", "$kod")
            })
        }
        val o = runCatching { JSONObject(txt) }.getOrNull()
        val html = o?.optString("html", "") ?: ""
        val frames = o?.optInt("frames", 0) ?: 0
        val fps = o?.optInt("fps", 0) ?: 0
        val w = o?.optInt("W", 0) ?: 0
        val h = o?.optInt("H", 0) ?: 0
        if (html.isEmpty() || frames <= 1 || fps <= 0 || w <= 0 || h <= 0)
            return hata(L("Sunucu cevabı çözülemedi", "Couldn't read the server response"))
        if (durdur != null) return hata(durdur ?: "")
        return withContext(Dispatchers.Main) { motorCalistir(act, html, frames, fps, w, h) }
    }

    /** JS -> Kotlin köprüsü: async motor fonksiyonlarının Promise'i burada tamamlanır. */
    // public: WebView köprü metotlarını yansımayla çağırır (gizli sınıfta erişim hatası riski).
    class Kopru {
        val bekleyen = ConcurrentHashMap<String, CompletableDeferred<String>>()
        @JavascriptInterface
        fun bitti(id: String, sonuc: String) { bekleyen.remove(id)?.complete(sonuc) }
    }

    /**
     * `ifade` bir Promise (ya da değer) döndüren JS ifadesi. evaluateJavascript Promise BEKLEMEZ;
     * bu yüzden sarmalayıcı async IIFE sonucu AndroidKopru.bitti ile geri yollar. Zaman aşımında null.
     */
    private suspend fun jsBekle(wv: WebView, kopru: Kopru, ifade: String, zamanMs: Long): String? {
        val id = UUID.randomUUID().toString()
        val d = CompletableDeferred<String>()
        kopru.bekleyen[id] = d
        val js = "(async()=>{try{const r=await ($ifade);AndroidKopru.bitti('$id',String(r));}" +
                 "catch(e){AndroidKopru.bitti('$id','HATA:'+e);}})();void 0;"
        wv.evaluateJavascript(js, null)
        val r = withTimeoutOrNull(zamanMs) { d.await() }
        kopru.bekleyen.remove(id)
        return r
    }

    private suspend fun jsDeger(wv: WebView, js: String): String? =
        suspendCancellableCoroutine { c ->
            try { wv.evaluateJavascript(js) { r -> if (c.isActive) c.resume(r) } }
            catch (e: Exception) { if (c.isActive) c.resume(null) }
        }

    private var vsSayac = 0L

    /** Sayfanın son çizimi pencereye yansısın: görsel durum hazır -> 2 vsync. (iOS afterScreenUpdates eşleniği) */
    private suspend fun kareBekle(wv: WebView) {
        withTimeoutOrNull(3000) {
            suspendCancellableCoroutine<Unit> { c ->
                wv.postVisualStateCallback(++vsSayac, object : WebView.VisualStateCallback() {
                    override fun onComplete(requestId: Long) { if (c.isActive) c.resume(Unit) }
                })
            }
        }
        repeat(2) {
            withTimeoutOrNull(500) {
                suspendCancellableCoroutine<Unit> { c ->
                    Choreographer.getInstance().postFrameCallback { if (c.isActive) c.resume(Unit) }
                }
            }
        }
    }

    /** Pencere yüzeyinden kutunun bulunduğu bölgeyi bitmap'e kopyala. */
    private suspend fun cek(act: Activity, kap: View, bmp: Bitmap): Boolean {
        val loc = IntArray(2)
        kap.getLocationInWindow(loc)
        val r = Rect(loc[0], loc[1], loc[0] + bmp.width, loc[1] + bmp.height)
        return suspendCancellableCoroutine { c ->
            try {
                PixelCopy.request(act.window, r, bmp, { sonuc ->
                    if (c.isActive) c.resume(sonuc == PixelCopy.SUCCESS)
                }, Handler(Looper.getMainLooper()))
            } catch (e: Exception) { if (c.isActive) c.resume(false) }
        }
    }

    /** Kare pratikte boş mu (düz beyaz ya da düz siyah)? 5×5 örnek: parlaklık ortalaması + yayılımı. */
    private fun bosMu(b: Bitmap): Boolean {
        val n = 5
        var toplam = 0; var enAz = 255; var enCok = 0
        for (i in 0 until n) for (j in 0 until n) {
            val x = ((i + 0.5) * b.width / n).toInt().coerceIn(0, b.width - 1)
            val y = ((j + 0.5) * b.height / n).toInt().coerceIn(0, b.height - 1)
            val p = b.getPixel(x, y)
            val l = (Color.red(p) * 299 + Color.green(p) * 587 + Color.blue(p) * 114) / 1000
            toplam += l; enAz = min(enAz, l); enCok = maxOf(enCok, l)
        }
        val ort = toplam / (n * n)
        return (ort > 240 && enCok - enAz < 8) || (ort < 4 && enCok - enAz < 4)
    }

    /** ANA iş parçacığında çalışır. Başarıda tamamlanmış MP4, aksi hâlde null (+ sonHata). */
    private suspend fun motorCalistir(act: Activity, html0: String, frames: Int, fps: Int, W: Int, H: Int): File? {
        val kok = act.findViewById<ViewGroup>(android.R.id.content) ?: return hata(L("Ekran bulunamadı", "Screen not found"))
        val aw = kok.width; val ah = kok.height
        if (aw <= 0 || ah <= 0) return hata(L("Ekran hazır değil", "Screen not ready"))

        // ---- YERLEŞİM ----
        // PixelCopy yalnız pencere İÇİNDE çizilmiş pikseli okur. Yatay (16:9 = 1920×1080) video dikey
        // ekrana sığmaz -> WebView 90° döndürülerek yerleştirilir, kare kodlarken geri döndürülür.
        // Ekran yine de küçükse sayfa ölçeklenir (setInitialScale) ve video o çözünürlükte yazılır.
        val dondur = W > H && ah > aw
        val ekW = if (dondur) H else W
        val ekH = if (dondur) W else H
        val yuzdeOlcek = floor(100.0 * min(1.0, min(aw.toDouble() / ekW, ah.toDouble() / ekH))).toInt()
        if (yuzdeOlcek < 25) return hata(L("Ekran video üretmek için çok küçük", "Screen too small to create the video"))
        val s = yuzdeOlcek / 100.0
        val vw = floor(W * s).toInt()                     // WebView piksel boyutu (döndürme öncesi)
        val vh = floor(H * s).toInt()
        val bw = if (dondur) vh else vw                   // ekrandaki kutu = yakalanan bitmap
        val bh = if (dondur) vw else vh

        // Kodlayıcı boyutu: tam ölçekte sunucunun W×H'si; küçültüldüyse 16'nın katına yuvarla.
        var encW = if (yuzdeOlcek == 100) W else (vw / 16) * 16
        var encH = if (yuzdeOlcek == 100) H else (vh / 16) * 16
        val boyut = desteklenenBoyut(encW, encH) ?: return hata(L("Bu cihazın video kodlayıcısı bu boyutu desteklemiyor",
            "This device's video encoder doesn't support this size"))
        encW = boyut.first; encH = boyut.second

        // ---- HTML: viewport + devicePixelRatio=1 ----
        // MapLibre tuvali CSS boyutu × devicePixelRatio açar; Android'de DPR = ekran yoğunluğu (~2.75)
        // -> 1080×1920 sayfa 2970×5280 tuval isterdi (WebGL sınırını aşar / GPU'yu boğar). Sayfa W×H
        // CSS px bekler, ölçeği setInitialScale verir -> DPR'yi 1'e sabitle (iOS'ta snapshot küçültüyordu).
        val ek = "<meta name=\"viewport\" content=\"width=$W, user-scalable=no\">" +
                 "<script>try{Object.defineProperty(window,'devicePixelRatio',{get:function(){return 1;}});}catch(e){}</script>"
        val bas = Regex("<head[^>]*>", RegexOption.IGNORE_CASE).find(html0)
        val html = if (bas != null) html0.substring(0, bas.range.last + 1) + ek + html0.substring(bas.range.last + 1)
                   else ek + html0

        val kopru = Kopru()
        val kap = FrameLayout(act).apply {
            clipChildren = true
            setBackgroundColor(Color.BLACK)
            isClickable = false; isFocusable = false
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        }
        val wv = WebView(act)
        val ayar = wv.settings
        ayar.javaScriptEnabled = true
        ayar.domStorageEnabled = true
        ayar.mediaPlaybackRequiresUserGesture = false
        ayar.useWideViewPort = true
        ayar.loadWithOverviewMode = false
        ayar.setSupportZoom(false)
        ayar.builtInZoomControls = false
        ayar.displayZoomControls = false
        wv.setInitialScale(yuzdeOlcek)                    // 1 CSS px = s fiziksel px (yoğunluktan bağımsız)
        wv.setLayerType(View.LAYER_TYPE_HARDWARE, null)   // motor WebGL (MapLibre): donanım hızlandırma ŞART
        wv.setBackgroundColor(Color.BLACK)
        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false
        wv.overScrollMode = View.OVER_SCROLL_NEVER
        wv.isFocusable = false
        wv.addJavascriptInterface(kopru, "AndroidKopru")
        kap.addView(wv, FrameLayout.LayoutParams(vw, vh))
        if (dondur) {
            // Sol-üst köşe etrafında saat yönünde 90° + vh kadar sağa: kutu (vh × vw) ekranın (0,0)'ından başlar.
            wv.pivotX = 0f; wv.pivotY = 0f
            wv.rotation = 90f
            wv.translationX = vh.toFloat()
        }
        kok.addView(kap, ViewGroup.LayoutParams(bw, bh))   // EN ÜSTE: PixelCopy bileşik pencereyi okur

        // ---- ARKA PLAN KORUMASI (iOS ArkaPlanGozcu eşi) ----
        // Uygulama arka plana düşerse (ON_STOP) pencere yüzeyi çizilmez -> boş/eski kare. Üretim İPTAL
        // (yarım video yazılmaz); iş sunucu kuyruğunda kalır, sonraki açılışta tekrar gelir.
        // ON_PAUSE dinlenmez: çoklu pencere/sistem diyaloğunda da gelir, orada kare bozulmaz.
        val gozcu = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_STOP)
                durdur = L("uygulama arka plana alındı — üretim durduruldu", "app went to background — creation stopped")
        }
        (act as? LifecycleOwner)?.lifecycle?.addObserver(gozcu)
        act.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)   // iOS isIdleTimerDisabled

        val klasor = File(act.cacheDir, "videolar").apply { mkdirs() }
        val cikti = File(klasor, "${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}.mp4")
        var kod: Kodlayici? = null
        val encThread: ExecutorCoroutineDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
        var basarili = false
        try {
            wv.loadDataWithBaseURL(API, html, "text/html", "utf-8", null)
            asama = L("Motor yükleniyor", "Loading engine")

            // 1) _ready (250 ms'de bir, en çok 60 sn)
            var hazir = false
            for (i in 0 until 240) {
                if (durdur != null) return hata(durdur ?: "")
                if (jsDeger(wv, "window._ready===true") == "true") { hazir = true; break }
                delay(250)
            }
            if (!hazir) return hata(L("Motor 60 sn içinde hazırlanamadı (harita/karo yüklenmedi?)",
                "Engine wasn't ready within 60 s (map tiles didn't load?)"))
            // 2) karo ön-ısıtma (satStyle'da 9 durak × 2.5 sn) — iOS gibi sonucu önemsiz
            jsBekle(wv, kopru, "window.motorHazir()", 120_000)
            if (durdur != null) return hata(durdur ?: "")

            // 3) kodlayıcı
            val k: Kodlayici = try {
                withContext(encThread) { Kodlayici.ac(cikti, encW, encH, fps) }
            } catch (e: Exception) {
                return hata(L("Video kodlayıcı açılamadı", "Couldn't open the video encoder") + " (${e.javaClass.simpleName})")
            }
            kod = k
            val fadeKare = (fps * 0.8).roundToInt().coerceAtLeast(1)    // bulut ffmpeg fade'inin eşi
            val introN = (fps * 1.6).roundToInt()
            val outroN = (fps * 6.0).roundToInt()                        // satStyle outro (sayfa aynı sayıyı üretir)
            val toplam = introN + frames + outroN
            var kareNo = 0
            val toplamIs = (frames + outroN).coerceAtLeast(1).toFloat()
            suspend fun yaz() {
                val kalan = toplam - kareNo - 1
                val karart = if (kareNo < fadeKare || kalan < fadeKare)
                    (1f - min(kareNo, kalan).toFloat() / fadeKare).coerceIn(0f, 1f) else 0f
                withContext(encThread) { k.yaz(bmp, dondur, karart) }
                kareNo++
            }

            // 4) intro kartı (tek çekim, introN kez)
            asama = L("Kareler çiziliyor", "Drawing frames")
            if (jsBekle(wv, kopru, "window.introCiz()", 30_000) == "true") {
                kareBekle(wv)
                if (cek(act, kap, bmp)) repeat(introN) { yaz() }
            }
            // 5) rota kareleri — kamera matematiği sayfada, bulutla birebir
            var bosKare = 0
            for (f in 0 until frames) {
                if (durdur != null) return hata(durdur ?: "")
                jsBekle(wv, kopru, "window.kareCiz($f)", 30_000)
                kareBekle(wv)
                val ok = cek(act, kap, bmp)
                if (!ok || bosMu(bmp)) {
                    // Emniyet ağı (iOS ile aynı): 20 ardışık boş kare = üretim bozuldu; yarım video yayınlama.
                    bosKare++
                    if (bosKare >= 20) return hata(L("Ekran karardı/boş kare geldi — üretim durduruldu",
                        "Blank frames from the map engine — creation stopped"))
                    if (!ok) continue
                } else bosKare = 0
                yaz()
                if (f % 5 == 0) yuzde = f / toplamIs * 0.85f
            }
            // 6) outro / dünya finali
            asama = L("Kapanış sahnesi", "Closing scene")
            for (kk in 0 until outroN) {
                if (durdur != null) return hata(durdur ?: "")
                jsBekle(wv, kopru, "window.finalCiz($kk)", 30_000)
                kareBekle(wv)
                if (cek(act, kap, bmp)) yaz()
                if (kk % 5 == 0) yuzde = (frames + kk) / toplamIs * 0.85f
            }
            asama = L("Video kapatılıyor", "Finishing video")
            yuzde = 0.88f
            val tamam = withContext(encThread) { k.bitir() }
            kod = null
            if (!tamam || kareNo <= frames / 2)
                return hata(L("Video tamamlanamadı ({n} kare)", "Video couldn't be completed ({n} frames)").replace("{n}", "$kareNo/$frames"))
            basarili = true
            return cikti
        } finally {
            val kalanKod = kod
            if (kalanKod != null) withContext(NonCancellable + encThread) { kalanKod.vazgec() }
            encThread.close()
            (act as? LifecycleOwner)?.lifecycle?.removeObserver(gozcu)
            act.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            kopru.bekleyen.values.forEach { it.cancel() }
            runCatching { kok.removeView(kap) }
            runCatching {
                wv.stopLoading()
                wv.removeJavascriptInterface("AndroidKopru")
                wv.loadUrl("about:blank")
                wv.destroy()
            }
            bmp.recycle()
            if (!basarili) runCatching { cikti.delete() }
        }
    }

    /** Cihazın AVC kodlayıcısı bu boyutu destekliyor mu; desteklemiyorsa orantılı küçült (en çok 2 kez). */
    private fun desteklenenBoyut(w: Int, h: Int): Pair<Int, Int>? {
        val adaylar = listOf(1.0, 0.75, 0.5).map { f ->
            if (f == 1.0) w to h else ((w * f).toInt() / 16 * 16) to ((h * f).toInt() / 16 * 16)
        }
        val kod = try { MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC) } catch (e: Exception) { return null }
        try {
            val cap = try { kod.codecInfo.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).videoCapabilities }
                      catch (e: Exception) { null } ?: return w to h   // bilinmiyor: dene, configure karar versin
            return adaylar.firstOrNull { (a, b) -> a > 0 && b > 0 && cap.isSizeSupported(a, b) }
        } finally { runCatching { kod.release() } }
    }

    /** Yükleme kalıcı başarısızsa videoyu Movies/MoveLog'a AKITARAK kaydet (belleğe tek parça almadan). */
    private fun galeriyeKaydet(ctx: Context, f: File): Boolean = try {
        val r = ctx.contentResolver
        val cv = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, "MoveLog_${System.currentTimeMillis()}.mp4")
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/MoveLog")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
        }
        val uri = r.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, cv)
        if (uri == null) false else {
            val yazildi = r.openOutputStream(uri)?.use { out -> FileInputStream(f).use { it.copyTo(out, 256 * 1024) }; true } ?: false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                cv.clear(); cv.put(MediaStore.Video.Media.IS_PENDING, 0); r.update(uri, cv, null, null)
            }
            yazildi
        }
    } catch (e: Exception) { false }

    /**
     * H.264 kodlayıcı (Surface girişi) + MP4 muxer. TEK iş parçacığından kullanılır (encThread).
     * ZAMAN DAMGASI: Surface.lockCanvas ile verilen karelerin damgasını sistem saati koyar (render
     * gerçek zamandan yavaş -> video yavaş oynardı). Bu yüzden çıkış örneklerine SIRAYLA
     * kareNo/fps damgası basılır; B-kare kapatılır ("max-bframes"=0) ki çıkış sırası = gösterim sırası.
     */
    private class Kodlayici private constructor(
        private val codec: MediaCodec, private val girdi: Surface, private val muxer: MediaMuxer,
        private val w: Int, private val h: Int, private val fps: Int,
    ) {
        private val info = MediaCodec.BufferInfo()
        private var iz = -1
        private var basladi = false
        private var cikanKare = 0L
        private var sonPostNs = 0L
        private var yazilimTuvali = false
        private val boya = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        private val hedef = RectF()

        companion object {
            /** Kodlayıcıyı aç; herhangi bir adım patlarsa açılanları bırakıp istisnayı yukarı at. */
            fun ac(dosya: File, w: Int, h: Int, fps: Int): Kodlayici {
                val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
                var girdi: Surface? = null
                try {
                    val f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h)
                    f.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                    f.setInteger(MediaFormat.KEY_BIT_RATE, 8_000_000)
                    f.setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                    f.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                    f.setInteger("max-bframes", 0)        // MediaFormat.KEY_MAX_B_FRAMES (API 29); eskide yok sayılır
                    codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                    val s = codec.createInputSurface()
                    girdi = s
                    codec.start()
                    val m = MediaMuxer(dosya.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                    return Kodlayici(codec, s, m, w, h, fps)
                } catch (e: Exception) {
                    runCatching { codec.stop() }
                    runCatching { codec.release() }
                    runCatching { girdi?.release() }
                    throw e
                }
            }
        }

        /** Bir kare: bitmap (gerekirse -90° geri döndürülerek) + siyah kararma (SRC_OVER) -> kodlayıcı. */
        fun yaz(bmp: Bitmap, dondur: Boolean, karartma: Float) {
            // Kareler arası en az 1/fps: kodlayıcının hız denetimi aşırı sık damga görmesin.
            val bekle = sonPostNs + 1_000_000_000L / fps - System.nanoTime()
            if (bekle > 0) Thread.sleep(bekle / 1_000_000L, (bekle % 1_000_000L).toInt())
            val c = if (yazilimTuvali) girdi.lockCanvas(null) else try { girdi.lockHardwareCanvas() } catch (e: Exception) {
                yazilimTuvali = true; girdi.lockCanvas(null)
            }
            try {
                c.drawColor(Color.BLACK, PorterDuff.Mode.SRC)
                if (dondur) {
                    // Yakalanan kare saat yönünde 90° dönük (vh × vw) -> saat yönü tersine çevir.
                    c.save()
                    c.translate(0f, h.toFloat())
                    c.rotate(-90f)
                    hedef.set(0f, 0f, h.toFloat(), w.toFloat())
                    c.drawBitmap(bmp, null, hedef, boya)
                    c.restore()
                } else {
                    hedef.set(0f, 0f, w.toFloat(), h.toFloat())
                    c.drawBitmap(bmp, null, hedef, boya)
                }
                if (karartma > 0f) {
                    // ⚠️ iOS 05.09 dersi: kopyalama kipi kareyi SİLER. drawColor(int) = SRC_OVER (harman).
                    c.drawColor(Color.argb((karartma * 255f).roundToInt().coerceIn(0, 255), 0, 0, 0))
                }
            } finally {
                girdi.unlockCanvasAndPost(c)
            }
            sonPostNs = System.nanoTime()
            bosalt(false)
        }

        private fun bosalt(son: Boolean) {
            var bosTur = 0
            while (true) {
                val i = codec.dequeueOutputBuffer(info, if (son) 10_000L else 0L)
                if (i == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (!son) return
                    if (++bosTur > 500) return                 // ~5 sn EOS gelmedi: elde olanla bitir
                } else if (i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (!basladi) { iz = muxer.addTrack(codec.outputFormat); muxer.start(); basladi = true }
                } else if (i >= 0) {
                    val buf = codec.getOutputBuffer(i)
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                    if (info.size > 0 && basladi && buf != null) {
                        info.presentationTimeUs = cikanKare * 1_000_000L / fps
                        cikanKare++
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        muxer.writeSampleData(iz, buf, info)
                    }
                    val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    codec.releaseOutputBuffer(i, false)
                    if (eos) return
                }
            }
        }

        /** Akışı kapat; MP4 geçerliyse true. */
        fun bitir(): Boolean {
            var ok = false
            try {
                codec.signalEndOfInputStream()
                bosalt(true)
                ok = basladi && cikanKare > 0
            } catch (e: Exception) { ok = false }
            runCatching { codec.stop() }
            runCatching { codec.release() }
            runCatching { girdi.release() }
            if (basladi) { if (runCatching { muxer.stop() }.isFailure) ok = false }
            runCatching { muxer.release() }
            return ok
        }

        /** Hata/iptal: her şeyi sessizce bırak (dosyayı çağıran siler). */
        fun vazgec() {
            runCatching { codec.stop() }
            runCatching { codec.release() }
            runCatching { girdi.release() }
            if (basladi) runCatching { muxer.stop() }
            runCatching { muxer.release() }
        }
    }
}

/**
 * Telefonda üretim sürerken TAM EKRAN ilerleme katmanı. AYRI PENCERE (Dialog) olması ŞART:
 * motor WebView'ı Activity penceresinin en üstünde gerçekten çizilir (PixelCopy onu okur); bu
 * diyalog onun üstünü örter ama Activity penceresinin yüzeyine karışmaz. MoveLogApp'te bir kez çağrılır.
 */
@Composable
fun YerelVideoKatmani() {
    if (!YerelVideo.calisiyor) return
    Dialog(
        onDismissRequest = {},
        properties = DialogProperties(usePlatformDefaultWidth = false,
            dismissOnBackPress = false, dismissOnClickOutside = false)
    ) {
        Box(Modifier.fillMaxSize().background(Brand.bg), contentAlignment = Alignment.Center) {
            Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(if (YerelVideo.otomatik) L("Bekleyen videon üretiliyor", "Creating your pending video")
                     else L("Video üretiliyor", "Creating video"),
                    color = androidx.compose.ui.graphics.Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                LinearProgressIndicator(progress = { YerelVideo.yuzde.coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(), color = Brand.accent)
                Text("%" + (YerelVideo.yuzde.coerceIn(0f, 1f) * 100).toInt() +
                        (if (YerelVideo.asama.isNotEmpty()) " · " + YerelVideo.asama else ""),
                    color = androidx.compose.ui.graphics.Color(0xFF9AA4B2), fontSize = 14.sp)
                Text(L("Video telefonunda üretilir; bitene kadar ekranı açık tut ve uygulamadan çıkma.",
                       "The video is created on your phone; keep the screen on and stay in the app until it finishes."),
                    color = androidx.compose.ui.graphics.Color(0xFF9AA4B2), fontSize = 13.sp, textAlign = TextAlign.Center)
                if (YerelVideo.yuzde < 0.9f) {
                    OutlinedButton(onClick = { YerelVideo.iptal() }) { Text(L("İptal", "Cancel")) }
                }
            }
        }
    }
}
