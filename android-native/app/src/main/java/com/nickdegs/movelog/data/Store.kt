package com.nickdegs.movelog.data

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.nickdegs.movelog.KonumKuyrugu
import com.nickdegs.movelog.util.saveVideoToGallery
import com.nickdegs.movelog.ui.L

const val API = "https://kisisel-api.nickdegs.com"

// CIHAZ KIMLIGI (17.09, Baris: "herkes tek cihazdan girecek"): hesap tek cihaza baglanir.
// Kaynak Settings.Secure.ANDROID_ID = DONANIM kimligi (cihaz+imzalayan basina sabit; fabrika
// ayarlarina donusta degisir). Bazi cihazlarda null gelebilir -> uretilen UUID SharedPreferences'ta
// sabitlenir ki kimlik oturumlar arasi degismesin.
fun cihazKimligi(ctx: android.content.Context): String {
    val p = ctx.getSharedPreferences("movelog", android.content.Context.MODE_PRIVATE)
    val v = p.getString("nd_cihaz", "") ?: ""
    if (v.isNotEmpty()) return v
    val yeni = try {
        android.provider.Settings.Secure.getString(ctx.contentResolver,
            android.provider.Settings.Secure.ANDROID_ID)
    } catch (e: Exception) { null } ?: java.util.UUID.randomUUID().toString()
    p.edit().putString("nd_cihaz", yeni).apply()
    return yeni
}

/** iOS DavetLink.ayikla ile aynı: `invite=` / `code=` sonrası, 6–32 url-safe. */
fun ayiklaDavetKodu(ham: String): String {
    var s = ham.trim()
    val inv = s.indexOf("invite=", ignoreCase = true)
    val cod = s.indexOf("code=", ignoreCase = true)
    s = when {
        inv >= 0 -> s.substring(inv + 7)
        cod >= 0 -> s.substring(cod + 5)
        else -> s
    }
    s = s.substringBefore('&').substringBefore('#').trim()
    return if (s.matches(Regex("^[A-Za-z0-9_-]{6,32}$"))) s else ""
}

fun ayiklaDavetUri(uri: android.net.Uri?): String {
    if (uri == null) return ""
    uri.getQueryParameter("invite")?.let { val k = ayiklaDavetKodu(it); if (k.isNotEmpty()) return k }
    uri.getQueryParameter("code")?.let { val k = ayiklaDavetKodu(it); if (k.isNotEmpty()) return k }
    return ayiklaDavetKodu(uri.toString())
}

// Oturum durumu — uygulama yalnızca SUNUCU-DOĞRULANMIŞ kimlikle açılır (internetsiz/kopya token çalışmaz).
// BLOCKED = Play Integrity tamper/sideload tespiti (kurcalanmış/korsan kurulum).
enum class AuthState { CHECKING, VALID, NEED_LOGIN, OFFLINE, BLOCKED }
const val CLOUD_PROJECT_NUMBER = 909630333798L   // Play Integrity (film-ozet)

data class Ride(
    val id: String, val date: String, val type: String?, val mode: String?,
    val size: Double, val ts: Double?, val to: Double?, val aspect: String?,
    val speed: String?, val done: Double?, val rendering: Boolean, val novideo: Boolean,
    // FIX 05.09: sunucu /api/rides icin "failed"+"error" doner, iOS bunlari okuyor (Videos.swift),
    // Android modelinde ALAN YOKTU -> basarisiz render kartlari OYNATILABILIR gibi gorunuyor,
    // dokununca 404 aliniyordu. OLCULDU: 14 adet sahte oynatilabilir kart.
    val failed: Boolean = false, val error: String? = null,
    // 10.10: ÖRNEK İÇERİK (appreview). Kendi kaydı olmayan kullanıcı demo rotaları görür; sunucu bunları
    // silmeye/tip değiştirmeye 404 verir (18.09–10.10: 27 DELETE + 27 type 404). Kartta sil/tip menüsü gizlenir.
    val sample: Boolean = false,
)

data class Profile(val username: String?, val name: String, val premium: Boolean)

// iOS Store.swift'in Kotlin karşılığı — aynı backend (kisisel-api), aynı uçlar.
class Store(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("movelog", Context.MODE_PRIVATE)

    var token by mutableStateOf(prefs.getString("nd_token", "") ?: "")
        private set
    var me by mutableStateOf("")
    var displayName by mutableStateOf("")
    // 03.11.2026 (Barış): Move Log TAMAMEN ÜCRETSİZ — abonelik/IAP/paket kalktı. Alan geriye dönük
    // uyum için duruyor ama HER ZAMAN true: sunucu da /api/profile'da herkese premium=true döner.
    // (Eski "nd_ultra" / "nd_free_tactical" / video_hak tercihleri öksüz kalır, zararsız.)
    var premium by mutableStateOf(true)
    // 05.11.2026: Move Log Pro (tek seferlik) — sunucu onaylı; ortak sürüş videolarını açar
    var pro by mutableStateOf(false)
        private set
    var loginError by mutableStateOf(false)

    // Açılış kapısı: token yoksa giriş; varsa SUNUCUDA doğrulanana kadar CHECKING.
    var auth by mutableStateOf(if ((prefs.getString("nd_token", "") ?: "").isEmpty()) AuthState.NEED_LOGIN else AuthState.CHECKING)

    val loggedIn: Boolean get() = token.isNotEmpty()

    // Token'ı sunucuya doğrulat. 200=geçerli, 401/403=geçersiz->giriş, ağ hatası=OFFLINE (uygulama açılmaz).
    suspend fun validate() {
        if (token.isEmpty()) { auth = AuthState.NEED_LOGIN; return }
        auth = AuthState.CHECKING
        val code = withContext(Dispatchers.IO) {
            try {
                val c = (URL("$API/api/profile").openConnection() as HttpURLConnection)
                c.requestMethod = "GET"; c.connectTimeout = 12000; c.readTimeout = 20000
                c.setRequestProperty("Authorization", "Bearer $token")
                c.setRequestProperty("X-Device-Id", cihazKimligi(getApplication()))
                val rc = c.responseCode
                if (rc == 200) {
                    val o = JSONObject(c.inputStream.bufferedReader().readText())
                    me = o.optString("username", me); persistPremium(true)
                }
                rc
            } catch (e: Exception) { -1 }
        }
        when {
            code == 200 -> {
                // Play Integrity (anti-tamper/sideload): kurcalanmış/korsan kurulum engellenir (fail-open).
                if (!checkIntegrity()) { auth = AuthState.BLOCKED; return }
                auth = AuthState.VALID
            }
            code == 401 || code == 403 -> { persistToken(""); auth = AuthState.NEED_LOGIN }   // geçersiz token
            else -> auth = AuthState.OFFLINE                                                   // internet yok
        }
    }

    // Play Integrity: nonce al -> token üret -> backend decode. true=geç (veya doğrulama hazır değil), false=KESİN tamper.
    private suspend fun checkIntegrity(): Boolean {
        return try {
            val nd = req("/api/integrity/nonce") ?: return true       // sunucu yoksa engelleme
            val nonce = JSONObject(nd).optString("nonce", "")
            if (nonce.isEmpty()) return true
            val itok = requestIntegrityToken(nonce) ?: return true     // token alınamadı -> engelleme yok
            val cd = req("/api/integrity", "POST", JSONObject().put("token", itok)) ?: return true
            JSONObject(cd).optBoolean("ok", true)
        } catch (e: Exception) { true }
    }

    private suspend fun requestIntegrityToken(nonce: String): String? =
        kotlinx.coroutines.suspendCancellableCoroutine { cont ->
            try {
                val mgr = com.google.android.play.core.integrity.IntegrityManagerFactory.create(getApplication())
                mgr.requestIntegrityToken(
                    com.google.android.play.core.integrity.IntegrityTokenRequest.builder()
                        .setNonce(nonce).setCloudProjectNumber(CLOUD_PROJECT_NUMBER).build()
                ).addOnSuccessListener { cont.resume(it.token()) { } }
                 .addOnFailureListener { cont.resume(null) { } }
            } catch (e: Exception) { cont.resume(null) { } }
        }

    private fun persistToken(t: String) {
        token = t; prefs.edit().putString("nd_token", t).apply()
    }
    // 03.11: değer YOK SAYILIR — uygulama ücretsiz, her kapı açık. TrackingService de nd_premium okur.
    @Suppress("UNUSED_PARAMETER")
    fun persistPremium(v: Boolean) {
        premium = true; prefs.edit().putBoolean("nd_premium", true).apply()
    }
    // ÇIKIŞTA KUYRUĞU DA TEMİZLE. Gerekçe: bekleyen noktalar ÇIKAN hesabın gezisine aittir.
    // Farklı hesapla girilirse KonumKuyrugu'ndaki K_SAHIP kapısı nasılsa siliyordu, ama SİLME ANI
    // "bir sonraki boşaltma turu" idi; çıkışta ANINDA silmek doğrusu (kullanıcı çıktım dediyse
    // verisi cihazda beklemesin). Aynı hesap tekrar girerse zaten akacaktı — o davranışı kaybetmek
    // kabul edilen takas: çıkış = bu cihazdaki oturumu bitirme niyeti.
    // 🔴 temizleArkaPlan: dosya silme G/Ç'si UI iş parçacığında YAPILMAZ (bu çağrı bir düğmeden gelir).
    fun signOut() {
        persistToken(""); prefs.edit().remove("nd_token").apply(); auth = AuthState.NEED_LOGIN
        // 🔴 KUYRUK BURADA SİLİNMEZ (22.09'da eklenip aynı gün geri alındı). Sebebi:
        // "çıkış yap / tekrar gir" kullanıcının bir şey ters gidince ilk denediği şeydir ve tam da
        // şebekesizken denenir. Silseydik 8 saatlik yolculuğun 20.000 noktası UYARISIZ, ONAYSIZ
        // giderdi — yani veri kaybını önlemek için yazılmış koda YENİ bir kayıp yolu eklemiş olurduk.
        // Hesap DEĞİŞİMİ zaten K_SAHIP kapısında yakalanıyor (başka cihaz kimliği = kuyruk silinir),
        // aynı hesap tekrar girerse noktalar akar. Silme YALNIZ deleteAccount()'ta kalır.
    }

    var davetSonuc by mutableStateOf<String?>(null)
    var davetYenile by mutableStateOf(0)

    fun bekleyenDavetSakla(kod: String) {
        val t = ayiklaDavetKodu(kod)
        if (t.isEmpty()) return
        prefs.edit().putString("bekleyenDavet", t).apply()
    }
    fun bekleyenDavetAl(): String {
        val t = prefs.getString("bekleyenDavet", "") ?: ""
        if (t.isNotEmpty()) prefs.edit().remove("bekleyenDavet").apply()
        return t
    }

    // ---- HTTP yardımcısı (auth header + JSON) ----
    private suspend fun req(path: String, method: String = "GET", body: JSONObject? = null): String? =
        withContext(Dispatchers.IO) {
            try {
                val c = (URL(API + path).openConnection() as HttpURLConnection)
                c.requestMethod = method
                c.connectTimeout = 15000; c.readTimeout = 30000
                if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
                c.setRequestProperty("X-Device-Id", cihazKimligi(getApplication()))
                // Sunucunun push/metin dilini cihaz diline sabitle (iOS ile aynı)
                c.setRequestProperty("Accept-Language", java.util.Locale.getDefault().language)
                if (body != null) {
                    c.setRequestProperty("Content-Type", "application/json")
                    c.doOutput = true
                    OutputStreamWriter(c.outputStream).use { it.write(body.toString()) }
                }
                val code = c.responseCode
                val txt = (if (code in 200..299) c.inputStream else c.errorStream)
                    ?.bufferedReader()?.readText()
                if (code in 200..299) txt else null
            } catch (e: Exception) { null }
        }

    // Durum kodlu istek (handle çakışması gibi hataları ayırt etmek için) — iOS reqCode karşılığı
    private suspend fun reqCode(path: String, method: String = "GET", body: JSONObject? = null,
                                okumaMs: Int = 30000): Pair<Int, String> =
        withContext(Dispatchers.IO) {
            try {
                val c = (URL(API + path).openConnection() as HttpURLConnection)
                c.requestMethod = method; c.connectTimeout = 15000; c.readTimeout = okumaMs
                if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
                c.setRequestProperty("X-Device-Id", cihazKimligi(getApplication()))
                c.setRequestProperty("Accept-Language", java.util.Locale.getDefault().language)
                if (body != null) {
                    c.setRequestProperty("Content-Type", "application/json"); c.doOutput = true
                    OutputStreamWriter(c.outputStream).use { it.write(body.toString()) }
                }
                val code = c.responseCode
                val txt = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
                code to txt
            } catch (e: Exception) { 0 to "" }
        }

    // ---- Auth (telefon + SMS tek-kullanımlık kod; iOS ile aynı) ----
    // SUNUCU-GÜDÜMLÜ HARİTA (2026-08-09, Barış: "harita sunucudan değişsin, sürüm gerekmesin"):
    // /api/mapconfig'ten XYZ şablonu gelir; boşsa OSM varsayılanı. Değiştirmek = sunucuda
    // map-config.json'u düzenlemek — app güncellemesi GEREKMEZ.
    var mapTiles by mutableStateOf("")
    var mapAttribution by mutableStateOf("")
    suspend fun loadMapConfig() {
        val d = req("/api/mapconfig") ?: return
        try {
            val o = JSONObject(d)
            mapTiles = o.optString("tiles", "")
            mapAttribution = o.optString("attribution", "")
        } catch (_: Exception) {}
    }

    // GOOGLE İLE GİRİŞ (2026-08-08, Barış: "Google+Apple ekle, SMS kalksın"). smsVerify ile
    // aynı oturum deseni. Yol /auth/google (BAŞINDA /api YOK — SMS'in eski /api/auth yolu 404'tü).
    suspend fun googleLogin(idToken: String): Boolean {
        val d = req("/auth/google", "POST", JSONObject().put("id_token", idToken))
            ?: run { loginError = true; return false }
        val t = JSONObject(d).optString("token", "")
        if (t.isEmpty()) { loginError = true; return false }
        persistToken(t); loginError = false
        loadProfile()
        auth = AuthState.VALID
        return true
    }

    suspend fun smsStart(phone: String): Boolean =
        req("/api/auth/sms/start", "POST", JSONObject().put("phone", phone)) != null

    suspend fun smsVerify(phone: String, code: String): Boolean {
        val d = req("/api/auth/sms/verify", "POST",
            JSONObject().put("phone", phone).put("code", code)) ?: run { loginError = true; return false }
        val t = JSONObject(d).optString("token", "")
        if (t.isEmpty()) { loginError = true; return false }
        persistToken(t); loginError = false
        loadProfile()
        auth = AuthState.VALID
        return true
    }

    // ---- Profil ----
    var avatarEmoji by mutableStateOf("")   // boşsa baş harf gösterilir

    suspend fun loadProfile() {
        loadMapConfig()   // harita şablonu profille birlikte tazelenir (açılış + her giriş)
        val d = req("/api/profile") ?: return
        val o = JSONObject(d)
        me = o.optString("username", me)
        displayName = o.optString("name", displayName)
        val av = o.optJSONObject("avatar")
        avatarEmoji = if (av?.optString("type") == "emoji") av.optString("value", "") else ""
        pro = o.optBoolean("pro", false)
        persistPremium(true)
    }

    /** 05.11.2026: Play satın alma jetonunu sunucuya doğrulat (/api/pro/google). Başarıda pro=true. */
    suspend fun proBildir(purchaseToken: String): Boolean {
        val d = req("/api/pro/google", "POST", JSONObject().put("token", purchaseToken)) ?: return false
        val ok = runCatching { JSONObject(d).optBoolean("pro", false) }.getOrDefault(false)
        if (ok) pro = true
        return ok
    }

    suspend fun setAvatarEmoji(emoji: String): Boolean {
        val av = JSONObject().put("type", "emoji").put("value", emoji)
        val d = req("/api/profile", "PUT", JSONObject().put("avatar", av)) ?: return false
        avatarEmoji = emoji
        return JSONObject(d).has("username")
    }

    // ---- İsim / Arkadaşlar (Profil) ----
    suspend fun setName(name: String): Boolean {
        val d = req("/api/profile", "PUT", JSONObject().put("name", name)) ?: return false
        displayName = JSONObject(d).optString("name", name)
        return true
    }

    suspend fun friends(): List<Convo> {
        val d = req("/api/friends") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("friends") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Convo(o.optString("username", ""), o.optString("name", null),
                o.optBoolean("online", false), 0)
        }
    }

    suspend fun addFriend(username: String): Boolean {
        val u = username.trim().removePrefix("@")
        if (u.isEmpty()) return false
        val d = req("/api/friends", "POST", JSONObject().put("username", u)) ?: return false
        return JSONObject(d).optBoolean("ok", false)
    }

    // Günlük özet ayarları (premium): açık mı + saat + gün özeti VİDEOSU render seçenekleri
    suspend fun summarySettings(): SummaryCfg {
        val d = req("/api/summary/settings") ?: return SummaryCfg()
        val o = JSONObject(d)
        val v = o.optJSONObject("video") ?: JSONObject()
        return SummaryCfg(o.optBoolean("enabled", true), o.optInt("hour", 21),
            SummaryVid(v.optString("mode", "flyover"), v.optString("speed", "medium"),
                v.optString("aspect", "16:9"), v.optString("cam", "orta"),
                v.optString("music", ""), v.optString("line", "#00E5FF")))
    }

    suspend fun setSummarySettings(cfg: SummaryCfg): Boolean {
        val v = JSONObject().put("mode", cfg.video.mode).put("speed", cfg.video.speed)
            .put("aspect", cfg.video.aspect).put("cam", cfg.video.cam)
            .put("music", cfg.video.music).put("line", cfg.video.line)
        val body = JSONObject().put("enabled", cfg.enabled).put("hour", cfg.hour).put("video", v)
        return req("/api/summary/settings", "PUT", body) != null
    }

    // Hesabı kalıcı sil (App Store/Play uyumu) -> token temizle, girişe dön
    suspend fun deleteAccount(): Boolean {
        val ok = req("/api/account", "DELETE") != null
        if (ok) {
            persistToken(""); prefs.edit().remove("nd_token").apply(); auth = AuthState.NEED_LOGIN
            // Hesap SİLİNDİ: bekleyen noktaların gideceği yer kalmadı, cihazda tutmak anlamsız
            // (üstelik hesap silme taahhüdüyle çelişir). Kuyruğu da sil.
            KonumKuyrugu.temizleArkaPlan(getApplication<Application>())
        }
        return ok
    }

    // Algılama hassasiyeti (yerel, premium): "hassas" / "dengeli" / "basit"
    var sensitivity: String
        get() = prefs.getString("nd_sensitivity", "dengeli") ?: "dengeli"
        set(v) { prefs.edit().putString("nd_sensitivity", v).apply() }

    // ---- Rotalar ----
    suspend fun rides(): List<Ride> {
        val d = req("/api/rides") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("rides") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Ride(
                id = o.getString("id"), date = o.optString("date", ""),
                type = o.optString("type", null), mode = o.optString("mode", null),
                size = o.optDouble("size", 0.0),
                ts = if (o.has("ts")) o.optDouble("ts") else null,
                to = if (o.has("to")) o.optDouble("to") else null,
                aspect = o.optString("aspect", null), speed = o.optString("speed", null),
                done = if (o.has("done")) o.optDouble("done") else null,
                rendering = o.optBoolean("rendering", false),
                novideo = o.optBoolean("novideo", false),
                failed = o.optBoolean("failed", false),
                error = o.optString("error", null),
                sample = o.optBoolean("sample", false),
            )
        // FIX 05.09: iOS Routes.swift'teki dedupedByRide karsiligi Android'de YOKTU -> ayni rota
        // icin uc parcali rid + up_* cogalmasi yuzunden LISTEDE KOPYA KART cikiyordu (olculdu:
        // 97 kayit / 70 gercek rota). Ayni date_ts icin tek kart: rendering > en yeni done.
        }.groupBy { "${it.date}_${(it.ts ?: 0.0).toLong()}" }
            .values.map { grup ->
                grup.firstOrNull { it.rendering } ?: grup.maxByOrNull { it.done ?: 0.0 } ?: grup.first()
            }
            .sortedByDescending { it.ts ?: 0.0 }
    }

    fun videoUrl(id: String) = "$API/api/rides/$id/video"
    suspend fun signedVideoUrl(id: String): String? {
        val d = req("/api/rides/$id/videourl") ?: return null
        return JSONObject(d).optString("url", null)
    }

    suspend fun setRideType(id: String, type: String): Boolean =
        req("/api/rides/$id/type", "POST", JSONObject().put("type", type)) != null

    suspend fun deleteRide(id: String): Boolean =
        req("/api/rides/$id", "DELETE") != null

    // Videoyu indir (galeriye kaydetmek için) — presigned R2 (header'sız) ya da backend yedeği (auth'lu).
    suspend fun videoBytes(id: String): ByteArray? = withContext(Dispatchers.IO) {
        try {
            val url = signedVideoUrl(id) ?: videoUrl(id)
            val c = (URL(url).openConnection() as HttpURLConnection)
            if (url.contains("/api/")) {
                c.setRequestProperty("Authorization", "Bearer $token")
                c.setRequestProperty("X-Device-Id", cihazKimligi(getApplication()))
            }
            c.connectTimeout = 15000; c.readTimeout = 90000
            if (c.responseCode in 200..299) c.inputStream.readBytes() else null
        } catch (e: Exception) { null }
    }

    // OTOMATİK GALERİ KAYDI (Barış 2026-07-26): video biter bitmez sessizce galeriye (Movies/MoveLog) iner.
    // Sunucu/depolama şişmesin diye R2'de video yalnızca 1 gün durur -> KALICI kopya kullanıcının galerisinde.
    // İlk kurulumda mevcut videolar "işlendi" işaretlenir (eski kütüphaneyi galeriye BOŞALTMAYIZ); sonra yalnızca YENİ videolar.
    // API 29+ MediaStore izin gerektirmez; uygulama her öne geldiğinde çağrılır (1 günlük R2 penceresine yetişir).
    suspend fun autoSaveNewVideos() {
        // OTO-KAYIT İPTAL (Barış 2026-08-01, iOS 1.56 ile AYNI karar): uygulama açıkken sürekli tetikleniyordu.
        // Kullanıcı MANUEL kaydeder (Videolarım'daki "kaydet" butonu). Re-enable: nd_autosave_enabled=true.
        if (!prefs.getBoolean("nd_autosave_enabled", false)) return
        val app = getApplication<Application>()
        val saved = prefs.getStringSet("nd_autosaved_ids", emptySet())!!.toMutableSet()
        val done = rides().filter { !it.rendering && !it.novideo }.map { it.id }
        if (!prefs.getBoolean("nd_autosave_init", false)) {   // İLK KURULUM: geçmiş videoları "işlendi" say, boşaltma
            saved.addAll(done)
            prefs.edit().putStringSet("nd_autosaved_ids", saved).putBoolean("nd_autosave_init", true).apply()
            return
        }
        val todo = done.filter { it !in saved }
        if (todo.isEmpty()) return
        for (id in todo) {
            val b = videoBytes(id) ?: continue   // inemezse işaretlenmez -> sonraki öne gelişte tekrar denenir (R2'de 1 gün var)
            if (saveVideoToGallery(app, b, "MoveLog_$id.mp4")) {
                saved.add(id)
                prefs.edit().putStringSet("nd_autosaved_ids", saved).apply()
            }
        }
    }

    // ---- Özetler (Özet sekmesi; iOS /api/activities) ----
    suspend fun summaries(): List<Summary> {
        val d = req("/api/activities") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("activities") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Summary(o.optString("date", ""), o.optString("summary", ""),
                if (o.isNull("video_id")) null else o.optString("video_id", null),
                if (o.isNull("from")) null else o.optDouble("from"),
                if (o.isNull("to")) null else o.optDouble("to"))
        }
    }
    suspend fun summarizeToday(): Boolean = req("/api/activities/summarize", "POST", JSONObject()) != null

    // ---- PAYLAŞILABİLİR KART (26.10): sunucu PNG üretir (1080×1920 dikey / 1080×1080 kare) ----
    // path örn. "/api/rides/<id>/kart?f=dikey" ya da "/api/summary/kart?f=kare".
    // 200 değilse sunucunun {"detail": "..."} açıklamasıyla exception fırlatır (404 = iz/sürüş yok,
    // 502/503 = kart üretilemedi) -> ekran bu mesajı Toast'ta gösterir.
    suspend fun kartIndir(path: String): ByteArray = withContext(Dispatchers.IO) {
        val c = (URL(API + path).openConnection() as HttpURLConnection)
        try {
            c.connectTimeout = 15000; c.readTimeout = 60000   // kart çizimi birkaç sn sürebilir
            if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("X-Device-Id", cihazKimligi(getApplication()))
            c.setRequestProperty("Accept-Language", java.util.Locale.getDefault().language)
            val code = c.responseCode
            if (code in 200..299) return@withContext c.inputStream.use { it.readBytes() }
            val txt = c.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            val detay = runCatching { JSONObject(txt).optString("detail", "") }.getOrDefault("")
            throw Exception(detay.ifEmpty {
                when (code) {
                    404 -> L("Bu kart için kayıtlı iz yok.", "No recorded track for this card.")
                    502, 503 -> L("Kart şu an üretilemedi, biraz sonra tekrar dene.", "Couldn't create the card right now, try again shortly.")
                    else -> L("Kart indirilemedi ({n}).", "Couldn't download the card ({n}).").replace("{n}", "$code")
                }
            })
        } finally { c.disconnect() }
    }

    // Kartı indir -> cacheDir/kartlar/<dosyaAdi> -> FileProvider URI -> paylaşım menüsü.
    // Authority manifest'teki ile AYNI olmalı: "${applicationId}.kartlar" (res/xml/kart_paths.xml).
    suspend fun kartPaylas(ctx: Context, path: String, dosyaAdi: String) {
        val bytes = kartIndir(path)
        val uri = withContext(Dispatchers.IO) {
            val dir = java.io.File(ctx.cacheDir, "kartlar").apply { mkdirs() }
            val f = java.io.File(dir, dosyaAdi)
            f.writeBytes(bytes)
            androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".kartlar", f)
        }
        val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(android.content.Intent.EXTRA_STREAM, uri)
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = android.content.Intent.createChooser(send, L("Kartı paylaş", "Share card"))
        if (ctx !is android.app.Activity) chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(chooser)
    }

    // ---- Video üret (iOS generateRide ile aynı gövde) ----
    // HTTP durumunu döner: 200 = istek kabul edildi, diğer = hata (03.11: 402/hak kapısı YOK).
    // 03.11 ÜCRETSİZ MOD: bulut üretimi kalıcı kapalı; sunucu işi TELEFON KUYRUĞUNA (yerelq) yazar ve
    // {"ok":true,"yerel":true} döner -> çağıran videoyu YerelVideo ile telefonda üretir.
    // 10.11.2026: GenerateSheet artık bunu ÇAĞIRMAZ (iOS gibi doğrudan /api/motor3d -> telefonda üretim);
    // çağrılırsa sunucu kuyruğa iş yazar ve o iş hiç "bitti" işaretlenmez. Geri dönüş için duruyor.
    /** Son uretim isteginin sunucudan gelen ACIKLAMASI (bos = hata yok). */
    var sonUretimHatasi: String = ""
        private set
    /** Son 200 yanıtı "telefonda üret" (yerel=true) mi dedi. false = sunucu bulutta üretiyor (eski mod). */
    var sonUretimYerel: Boolean = false
        private set
    /** Videolarım'ı tazeleme tetiği — telefonda üretilen video yüklenince artar. */
    var videolarYenile by mutableStateOf(0)

    suspend fun generate(from: Double, to: Double, type: String, mode: String, aspect: String,
                         speed: String, camdist: String = "orta", music: String = "", line: String = "", cam: String = "", dot: String = ""): Int {
        val b = JSONObject().put("from", from).put("to", to).put("type", type).put("mode", mode)
            .put("aspect", aspect).put("speed", speed).put("premium", true).put("camdist", camdist).put("cam", cam)
        if (music.isNotEmpty()) b.put("music", music)
        if (line.isNotEmpty()) b.put("line", line)
        if (dot.isNotEmpty()) b.put("dot", dot)
        val (code, txt) = reqCode("/api/rides/generate", "POST", b)
        // FIX 05.09: sunucunun 429/503 aciklamalari (butce doldu, Traccar/bakim, kapasite)
        // hicbir yerde gosterilmiyordu -> ekran sessizce donuyordu. Metni burada sakla.
        sonUretimHatasi = if (code == 200) "" else
            runCatching { JSONObject(txt).optString("detail", JSONObject(txt).optString("error", "")) }
                .getOrDefault("")
        sonUretimYerel = false
        if (code != 200) return code
        sonUretimYerel = runCatching { JSONObject(txt).optBoolean("yerel", false) }.getOrDefault(false)
        // 200 gövdesinde ok=false gelirse bunu başarı sayma (sunucu yumuşak hata döndürebiliyor)
        return if (runCatching { JSONObject(txt).optBoolean("ok", false) }.getOrDefault(false)) 200 else 0
    }

    // ==================== TELEFONDA VİDEO (03.11 — iOS WebRouteVideo/Store eşleniği) ====================
    // Motor sayfası: POST /api/motor3d -> {"html","frames","fps","W","H"} (sunucu: cf/api/src/routes/motor3d.ts).
    // Sayfa üretimi map-match + karo ön-hazırlık yüzünden uzun sürebilir -> iOS gibi 190 sn okuma payı.
    suspend fun motorSayfasi(from: Double, to: Double, type: String, mode: String, speed: String,
                             aspect: String, camdist: String, line: String, dot: String,
                             grup: String? = null): Pair<Int, String> {
        val b = JSONObject().put("from", from).put("to", to).put("type", type).put("mode", mode)
            .put("speed", speed).put("aspect", aspect).put("camdist", camdist).put("line", line).put("dot", dot)
        if (!grup.isNullOrEmpty()) b.put("grup", grup)   // 05.11: ortak sürüş
        return reqCode("/api/motor3d", "POST", b, okumaMs = 190_000)
    }

    // Sunucunun "telefon üretsin" kuyruğu (KV yerelq). iOS Store.localRenders ile aynı.
    // 10.11.2026: yalnız ortak sürüş (grup) önerisini bulmak için okunur — kuyruk artık otomatik işlenmez.
    suspend fun localRenders(): List<JSONObject> {
        val d = req("/api/local-renders?grup=1") ?: return emptyList()   // 05.11: ortak sürüş işlerini de al
        val arr = runCatching { JSONObject(d).optJSONArray("pending") }.getOrNull() ?: return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }
    /**
     * 10.11.2026: bu sürüş için sunucunun önerdiği ORTAK sürüş anahtarı (arkadaş/kulüp birlikte sürdüyse).
     * Sunucu önerileri yerel kuyrukta `grup` alanıyla tutar; video artık OTOMATİK üretilmez, kullanıcı
     * GenerateSheet'te ister. Eşleşme: grup dolu ve işin `from`'u [rideFrom − 600 sn, rideTo] içinde
     * (iOS Store.grupAnahtari ile aynı). Bulunamazsa / ağ hatasında null.
     * NOT: telefon /api/videos/upload ve /api/local-renders/done ÇAĞIRMAZ (video sunucuda saklanmaz).
     */
    suspend fun grupAnahtari(from: Double, to: Double): String? {
        for (j in localRenders()) {
            if (j.isNull("grup")) continue          // optString JSON null için "null" döndürür
            val g = j.optString("grup", "")
            if (g.isEmpty()) continue
            val f = j.optDouble("from", Double.NaN)
            if (f.isNaN()) continue
            if (f >= from - 600.0 && f <= to) return g
        }
        return null
    }

    suspend fun musicList(): List<Pair<String, String>> {
        val d = req("/api/music") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("stock") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i); o.optString("id") to o.optString("name")
        }
    }

    // ---- KULLANICI MÜZİK KÜTÜPHANESİ (bir kez yükle, hep kullan) — iOS ile aynı ----
    suspend fun musicLibrary(): List<Pair<String, String>> {
        val d = req("/api/music/library") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("tracks") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i); o.optString("id") to o.optString("name")
        }
    }
    suspend fun musicLibraryAdd(name: String, bytes: ByteArray): String? = withContext(Dispatchers.IO) {
        try {
            if (bytes.size >= 20_000_000) return@withContext null
            val dataUrl = "data:audio/m4a;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            val c = (URL(API + "/api/music/library").openConnection() as HttpURLConnection)
            c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = 120000   // büyük dosya: uzun timeout
            if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
                c.setRequestProperty("X-Device-Id", cihazKimligi(getApplication()))
            c.setRequestProperty("Content-Type", "application/json"); c.doOutput = true
            val body = JSONObject().put("name", name).put("data", dataUrl)
            OutputStreamWriter(c.outputStream).use { it.write(body.toString()) }
            val code = c.responseCode
            if (code in 200..299) {
                val txt = c.inputStream.bufferedReader().readText()
                JSONObject(txt).optString("id", null)
            } else null
        } catch (e: Exception) { null }
    }

    // ---- Rota kaydı: Traccar cihaz id + OsmAnd ingest URL (iOS /api/tracker) ----
    suspend fun trackerInfo(): Pair<String, String>? {
        val d = req("/api/tracker") ?: return null
        val o = JSONObject(d)
        val id = if (o.isNull("deviceId")) null else o.optString("deviceId", null)
        val url = if (o.isNull("url")) null else o.optString("url", null)
        return if (id != null && url != null) id to url else null
    }

    // 03.11: Play satın alma doğrulama uçları (verifyGooglePurchase / verifyGoogleBoost) KALDIRILDI —
    // uygulama ücretsiz, Billing yok.

    // ---- GPX/TCX yükle (ham body; iOS uploadRoute ile aynı) -> (from,to,km) ----
    suspend fun uploadRoute(bytes: ByteArray): Triple<Double, Double, Double>? = withContext(Dispatchers.IO) {
        try {
            val c = (URL("$API/api/rides/upload").openConnection() as HttpURLConnection)
            c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = 40000
            c.setRequestProperty("Authorization", "Bearer $token")
                c.setRequestProperty("X-Device-Id", cihazKimligi(getApplication()))
            c.setRequestProperty("Content-Type", "application/octet-stream")
            c.doOutput = true; c.outputStream.use { it.write(bytes) }
            if (c.responseCode !in 200..299) return@withContext null
            val o = JSONObject(c.inputStream.bufferedReader().readText())
            Triple(o.optDouble("from"), o.optDouble("to"), o.optDouble("km", 0.0))
        } catch (e: Exception) { null }
    }


    // ---- Canlı konumlar (Harita) ----
    suspend fun positions(): List<Position> {
        // FIX 05.09: "/api/positions" sunucuda YOK (404 olcuLDU) -> Android canli arkadas haritasi
        // HER ZAMAN bostu. Dogru uc "/api/gps/live"; hiz alani da "speed_kmh" (camelCase degil).
        val d = req("/api/gps/live") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("positions") ?: (JSONObject(d).optJSONArray("data") ?: JSONArray())
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Position(o.optString("device", o.optString("name", "")),
                o.optDouble("lat"), o.optDouble("lon"),
                o.optDouble("speed_kmh", o.optDouble("speedKmh", o.optDouble("spd", 0.0))),
                o.optBoolean("online", false))
        }
    }

    // ==================== 1.4+ ARKADAŞLIK / KULLANICI ADI / FİKİR KUTUSU ====================
    // Benzersiz @kullanıcıadı ayarla: null=başarılı; "taken"|"invalid"|"network"
    suspend fun setHandle(handle: String): String? {
        val (code, _) = reqCode("/api/handle", "PUT", JSONObject().put("handle", handle))
        return when (code) { 200 -> null; 409 -> "taken"; 400 -> "invalid"; else -> "network" }
    }
    suspend fun findUsers(q: String): List<FoundUser> {
        val esc = java.net.URLEncoder.encode(q, "UTF-8")
        val d = req("/api/users/find?q=$esc") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("users") ?: JSONArray()
        return (0 until arr.length()).map { parseFound(arr.getJSONObject(it)) }
    }
    // "requested" | "friends" | null(hata)
    suspend fun friendRequest(username: String): String? {
        val (code, d) = reqCode("/api/friends/request", "POST",
            JSONObject().put("username", username.trim().removePrefix("@")))
        if (code != 200) return null
        return JSONObject(d).optString("status", null)
    }
    // (incoming, outgoing) bekleyen istekler
    suspend fun friendRequests(): Pair<List<FoundUser>, List<FoundUser>> {
        val d = req("/api/friends/requests") ?: return emptyList<FoundUser>() to emptyList()
        val o = JSONObject(d)
        fun list(k: String): List<FoundUser> {
            val arr = o.optJSONArray(k) ?: JSONArray()
            return (0 until arr.length()).map { parseFound(arr.getJSONObject(it)) }
        }
        return list("incoming") to list("outgoing")
    }
    suspend fun respondFriend(username: String, accept: Boolean): Boolean =
        reqCode("/api/friends/respond", "POST",
            JSONObject().put("username", username).put("accept", accept)).first == 200
    suspend fun sendFeedback(text: String): Boolean =
        reqCode("/api/feedback", "POST", JSONObject().put("text", text)).first == 200
    suspend fun invite(): String {
        val d = req("/api/invite", "POST", JSONObject()) ?: return ""
        return JSONObject(d).optString("link", "")
    }
    /** iOS Store.acceptInvite ile aynı sözleşme: POST /api/invite/accept {token} */
    suspend fun acceptInvite(token: String): Boolean {
        val kod = ayiklaDavetKodu(token)
        if (kod.isEmpty()) return false
        val d = req("/api/invite/accept", "POST", JSONObject().put("token", kod)) ?: return false
        return try { JSONObject(d).optBoolean("ok", false) } catch (_: Exception) { false }
    }
    // GRUP SÜRÜŞ video tercihi (1.7): both | group | solo
    suspend fun groupVideoPref(): String {
        val d = req("/api/groupvideo") ?: return "both"
        return JSONObject(d).optString("pref", "both")
    }
    suspend fun setGroupVideoPref(pref: String): Boolean =
        req("/api/groupvideo", "PUT", JSONObject().put("pref", pref)) != null


    suspend fun liveStart(friend: String): Boolean {
        val d = req("/api/live/start", "POST", JSONObject().put("user", friend)) ?: return false
        return JSONObject(d).optBoolean("fresh", false)
    }
    suspend fun liveGet(friend: String): LiveTelemetry? {
        val d = req("/api/live/$friend") ?: return null
        return parseTelemetry(JSONObject(d))
    }
    suspend fun liveWave(friend: String): Boolean =
        req("/api/live/wave", "POST", JSONObject().put("user", friend)) != null
    // ANLIK NABIZ PEEK (izleyen): arkadaşı uyandır + "nabzını istiyorum" penceresini taze tut.
    // Canlı ekran açıkken periyodik çağrılır; arkadaşın saati kısa ölçüm yapıp raporlar (liveGet merge eder).
    suspend fun hrRequest(friend: String): Int? {
        val d = req("/api/live/hr-request", "POST", JSONObject().put("user", friend)) ?: return null
        val o = JSONObject(d)
        return if (o.isNull("hr")) null else o.optInt("hr")
    }
    /** dönen: (url, token, peerName) */
    // CANLI TAKİP BEACON: app açılınca batarya+konum bildir -> arkadaş kayıt yapmasa bile son durum taze
    suspend fun sendBeacon() {
        val ctx = getApplication<Application>()
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as? android.os.BatteryManager ?: return
        val batt = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
        if (batt < 0 || batt > 100) return
        var lat: Double? = null; var lon: Double? = null
        try {
            if (androidx.core.content.ContextCompat.checkSelfPermission(ctx,
                    android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                val loc = kotlinx.coroutines.suspendCancellableCoroutine<android.location.Location?> { c ->
                    com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(ctx)
                        .lastLocation.addOnSuccessListener { c.resume(it) {} }.addOnFailureListener { c.resume(null) {} }
                }
                lat = loc?.latitude; lon = loc?.longitude
            }
        } catch (e: Exception) {}
        val b = JSONObject().put("batt", batt).put("charging", bm.isCharging)
        if (lat != null && lon != null) b.put("lat", lat).put("lon", lon)
        req("/api/live/beacon", "POST", b)
    }
    // FCM push token'ını backend'e kaydet (platform=android -> backend FCM ile gönderir)
    suspend fun registerFcm() {
        val token = try {
            kotlinx.coroutines.suspendCancellableCoroutine<String?> { c ->
                com.google.firebase.messaging.FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { c.resume(it) {} }.addOnFailureListener { c.resume(null) {} }
            }
        } catch (e: Exception) { null } ?: return
        getApplication<Application>().getSharedPreferences("movelog", Context.MODE_PRIVATE)
            .edit().putString("nd_fcm", token).apply()
        req("/api/pushtoken", "POST", JSONObject().put("token", token).put("platform", "android"))
    }
    // 05.11.2026: KULÜPLER geri geldi (ortak sürüş için) — e761d42^ birebir
    suspend fun clubs(): List<Club> {
        val d = req("/api/clubs") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("clubs") ?: JSONArray()
        return (0 until arr.length()).map { parseClub(arr.getJSONObject(it)) }
    }
    suspend fun createClub(name: String): Club? {
        val d = req("/api/clubs", "POST", JSONObject().put("name", name)) ?: return null
        return parseClub(JSONObject(d))
    }
    suspend fun joinClub(code: String): Club? {
        val d = req("/api/clubs/join", "POST", JSONObject().put("code", code)) ?: return null
        return parseClub(JSONObject(d))
    }
    suspend fun clubDetail(id: String): Club? {
        val d = req("/api/clubs/$id") ?: return null
        return parseClub(JSONObject(d))
    }
    suspend fun leaveClub(id: String): Boolean = req("/api/clubs/leave", "POST", JSONObject().put("id", id)) != null
    suspend fun kickClubMember(id: String, user: String): Boolean =
        req("/api/clubs/kick", "POST", JSONObject().put("id", id).put("user", user)) != null
    suspend fun renameClub(id: String, name: String): Club? {
        val d = req("/api/clubs/rename", "POST", JSONObject().put("id", id).put("name", name)) ?: return null
        return parseClub(JSONObject(d))
    }
    suspend fun liveClub(cid: String): List<ClubRider> {
        val d = req("/api/live/club/$cid") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("riders") ?: JSONArray()
        return (0 until arr.length()).map {
            val r = arr.getJSONObject(it)
            ClubRider(r.optString("user", ""), r.optString("name", ""), r.optDouble("lat", 0.0),
                r.optDouble("lon", 0.0), r.optDouble("spd", 0.0), r.optInt("age", 0), r.optInt("course", 0))
        }
    }


    // ---- parse yardımcıları ----
    private fun avatarEmojiOf(o: JSONObject): String {
        val av = o.optJSONObject("avatar") ?: return ""
        return if (av.optString("type") == "emoji") av.optString("value", "") else ""
    }
    private fun parseFound(o: JSONObject) = FoundUser(o.optString("username", ""), o.optString("name", ""),
        o.optString("handle", ""), avatarEmojiOf(o), o.optString("status", "none"))
    private fun parseClub(o: JSONObject): Club {
        val memArr = o.optJSONArray("members")
        val members = if (memArr != null) (0 until memArr.length()).map {
            val m = memArr.getJSONObject(it)
            ClubMember(m.optString("username", ""), if (m.isNull("name")) null else m.optString("name", null),
                avatarEmojiOf(m), m.optBoolean("online", false))
        } else null
        return Club(o.optString("id", ""), o.optString("name", ""), o.optString("owner", ""),
            o.optInt("member_count", o.optInt("memberCount", 0)), o.optInt("created", 0),
            if (o.isNull("code")) null else o.optString("code", null), members)
    }
    private fun parseTelemetry(o: JSONObject): LiveTelemetry {
        val ta = o.optJSONArray("trail")
        val trail = if (ta != null) (0 until ta.length()).map {
            val p = ta.getJSONArray(it); listOf(p.optDouble(0), p.optDouble(1))
        } else null
        return LiveTelemetry(o.optDouble("lat", 0.0), o.optDouble("lon", 0.0), o.optDouble("spd", 0.0),
            if (o.has("hr") && !o.isNull("hr")) o.optInt("hr") else null,
            o.optInt("alt", 0), o.optInt("age", 0), o.optDouble("today_km", o.optDouble("todayKm", 0.0)),
            o.optString("name", ""), if (o.has("batt")) o.optInt("batt") else null,
            if (o.has("charging")) o.optBoolean("charging") else null,
            if (o.has("course")) o.optInt("course") else null, trail,
            if (o.has("ride_min")) o.optInt("ride_min") else null,
            if (o.has("avg_kmh")) o.optDouble("avg_kmh") else null,
            if (o.has("max_kmh")) o.optDouble("max_kmh") else null,
            if (o.has("temp")) o.optDouble("temp") else null,
            if (o.has("wcode")) o.optInt("wcode") else null)
    }
}

data class SummaryVid(val mode: String = "flyover", val speed: String = "medium", val aspect: String = "16:9",
                      val cam: String = "orta", val music: String = "", val line: String = "#00E5FF")
data class SummaryCfg(val enabled: Boolean = true, val hour: Int = 21, val video: SummaryVid = SummaryVid())
data class Convo(val username: String, val name: String?, val online: Boolean, val unread: Int, val last: String = "")
data class Msg(val id: String, val frm: String, val text: String, val ts: Long,
               val type: String = "text", val media: String = "")   // type="voice" -> media=pid (sesli mesaj)
data class Position(val device: String, val lat: Double, val lon: Double, val speedKmh: Double, val online: Boolean)

data class Summary(val date: String, val summary: String, val videoId: String?,
                   val from: Double? = null, val to: Double? = null)

// ---- 1.4+ / 1.7 / 1.8 / 1.9 modelleri (iOS Store.swift birebir) ----
data class FoundUser(val username: String, val name: String, val handle: String,
                     val avatarEmoji: String, val status: String)   // none|outgoing|incoming|friend|requested
data class ClubMember(val username: String, val name: String?, val avatarEmoji: String, val online: Boolean)
data class Club(val id: String, val name: String, val owner: String, val memberCount: Int,
                val created: Int, val code: String?, val members: List<ClubMember>?)
data class ClubRider(val user: String, val name: String, val lat: Double, val lon: Double,
                     val spd: Double, val age: Int, val course: Int)
data class LeaderRow(val username: String, val name: String, val km: Double, val rides: Int, val avatarEmoji: String)
data class SafetyInfo(val buddy: String, val arrive: Boolean, val longstop: Boolean, val buddyName: String)
data class WrappedStats(val year: Int, val km: Double, val rides: Int, val hours: Double,
                        val longestKm: Double, val nightRides: Int, val badges: List<String>)
data class SharedRoute(val id: String, val fromName: String, val from: String, val km: Double?,
                       val date: String?, val ts: Int, val rideId: String, val ridden: Boolean)
data class LiveTelemetry(val lat: Double, val lon: Double, val spd: Double, val hr: Int?, val alt: Int,
                         val age: Int, val todayKm: Double, val name: String, val batt: Int?, val charging: Boolean?,
                         val course: Int?, val trail: List<List<Double>>?, val rideMin: Int?,
                         val avgKmh: Double?, val maxKmh: Double?, val temp: Double?, val wcode: Int?)
