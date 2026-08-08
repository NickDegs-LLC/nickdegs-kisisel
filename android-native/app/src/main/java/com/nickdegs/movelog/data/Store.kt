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
import com.nickdegs.movelog.util.saveVideoToGallery

const val API = "https://kisisel-api.nickdegs.com"

// Oturum durumu — uygulama yalnızca SUNUCU-DOĞRULANMIŞ kimlikle açılır (internetsiz/kopya token çalışmaz).
// BLOCKED = Play Integrity tamper/sideload tespiti (kurcalanmış/korsan kurulum).
enum class AuthState { CHECKING, VALID, NEED_LOGIN, OFFLINE, BLOCKED }
const val CLOUD_PROJECT_NUMBER = 909630333798L   // Play Integrity (film-ozet)

data class Ride(
    val id: String, val date: String, val type: String?, val mode: String?,
    val size: Double, val ts: Double?, val to: Double?, val aspect: String?,
    val speed: String?, val done: Double?, val rendering: Boolean, val novideo: Boolean,
)

data class Profile(val username: String?, val name: String, val premium: Boolean)

// iOS Store.swift'in Kotlin karşılığı — aynı backend (kisisel-api), aynı uçlar.
class Store(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("movelog", Context.MODE_PRIVATE)

    var token by mutableStateOf(prefs.getString("nd_token", "") ?: "")
        private set
    var me by mutableStateOf("")
    var displayName by mutableStateOf("")
    var premium by mutableStateOf(prefs.getBoolean("nd_premium", false))
    var ultra by mutableStateOf(prefs.getBoolean("nd_ultra", false))   // Ultra tier: Google 3D + kamera modları + Street View
    var freeTactical by mutableStateOf(prefs.getBoolean("nd_free_tactical", false))   // yeni kullanıcı TEK-SEFERLİK bedava aksiyon (iOS 1.57 paritesi)
    val canTactical: Boolean get() = ultra || freeTactical                            // Ultra VEYA bedava hak -> taktik açık
    var hrShareLocal by mutableStateOf(prefs.getBoolean("nd_hrshare", true))   // "Nabzımı arkadaşlarım görebilsin" (varsayılan AÇIK)
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
                val rc = c.responseCode
                if (rc == 200) {
                    val o = JSONObject(c.inputStream.bufferedReader().readText())
                    me = o.optString("username", me); persistPremium(o.optBoolean("premium", premium)); persistUltra(o.optBoolean("ultra", ultra))
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
    fun persistPremium(v: Boolean) {
        premium = v; prefs.edit().putBoolean("nd_premium", v).apply()
    }
    fun persistUltra(v: Boolean) {
        ultra = v; prefs.edit().putBoolean("nd_ultra", v).apply()
    }
    fun signOut() { persistToken(""); prefs.edit().remove("nd_token").apply(); auth = AuthState.NEED_LOGIN }

    // ---- HTTP yardımcısı (auth header + JSON) ----
    private suspend fun req(path: String, method: String = "GET", body: JSONObject? = null): String? =
        withContext(Dispatchers.IO) {
            try {
                val c = (URL(API + path).openConnection() as HttpURLConnection)
                c.requestMethod = method
                c.connectTimeout = 15000; c.readTimeout = 30000
                if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
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
    private suspend fun reqCode(path: String, method: String = "GET", body: JSONObject? = null): Pair<Int, String> =
        withContext(Dispatchers.IO) {
            try {
                val c = (URL(API + path).openConnection() as HttpURLConnection)
                c.requestMethod = method; c.connectTimeout = 15000; c.readTimeout = 30000
                if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
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
        val d = req("/api/profile") ?: return
        val o = JSONObject(d)
        me = o.optString("username", me)
        displayName = o.optString("name", displayName)
        val av = o.optJSONObject("avatar")
        avatarEmoji = if (av?.optString("type") == "emoji") av.optString("value", "") else ""
        persistPremium(o.optBoolean("premium", premium)); persistUltra(o.optBoolean("ultra", ultra))
        // TEK-SEFERLİK BEDAVA AKSİYON (iOS 1.57 paritesi): yeni kullanıcıya 1 ücretsiz taktik video hakkı.
        freeTactical = o.optBoolean("free_tactical", false)
        prefs.edit().putBoolean("nd_free_tactical", freeTactical).apply()
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
        if (ok) { persistToken(""); prefs.edit().remove("nd_token").apply(); auth = AuthState.NEED_LOGIN }
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
            )
        }
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
            if (url.contains("/api/")) c.setRequestProperty("Authorization", "Bearer $token")
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

    // ---- Video üret (iOS generateRide ile aynı gövde) ----
    suspend fun generate(from: Double, to: Double, type: String, mode: String, aspect: String,
                         speed: String, camdist: String = "orta", music: String = "", line: String = "", cam: String = "", dot: String = ""): Boolean {
        val b = JSONObject().put("from", from).put("to", to).put("type", type).put("mode", mode)
            .put("aspect", aspect).put("speed", speed).put("premium", true).put("camdist", camdist).put("cam", cam)
        if (music.isNotEmpty()) b.put("music", music)
        if (line.isNotEmpty()) b.put("line", line)
        if (dot.isNotEmpty()) b.put("dot", dot)
        val d = req("/api/rides/generate", "POST", b) ?: return false
        return JSONObject(d).optBoolean("ok", false)
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

    // ---- Play satın almasını SUNUCUDA doğrula (client'a güvenme) -> premium ----
    suspend fun verifyGooglePurchase(token: String): Boolean {
        val d = req("/api/iap/google", "POST", JSONObject().put("token", token)) ?: return false
        val ok = JSONObject(d).optBoolean("ok", false)
        if (ok) persistPremium(true)
        return ok
    }

    // Boost (consumable) -> o gün render limiti +1 kat
    suspend fun verifyGoogleBoost(token: String): Boolean {
        val d = req("/api/iap/google/boost", "POST", JSONObject().put("token", token)) ?: return false
        return JSONObject(d).optBoolean("ok", false)
    }

    // ---- GPX/TCX yükle (ham body; iOS uploadRoute ile aynı) -> (from,to,km) ----
    suspend fun uploadRoute(bytes: ByteArray): Triple<Double, Double, Double>? = withContext(Dispatchers.IO) {
        try {
            val c = (URL("$API/api/rides/upload").openConnection() as HttpURLConnection)
            c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = 40000
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("Content-Type", "application/octet-stream")
            c.doOutput = true; c.outputStream.use { it.write(bytes) }
            if (c.responseCode !in 200..299) return@withContext null
            val o = JSONObject(c.inputStream.bufferedReader().readText())
            Triple(o.optDouble("from"), o.optDouble("to"), o.optDouble("km", 0.0))
        } catch (e: Exception) { null }
    }

    // ---- Sohbet (Harita sekmesi içi) ----
    suspend fun conversations(): List<Convo> {
        val d = req("/api/chat/list") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("conversations") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            val last = o.optJSONObject("last")?.optString("text") ?: ""
            Convo(o.optString("username", ""), o.optString("name", null),
                o.optBoolean("online", false), o.optInt("unread", 0), last)
        }
    }

    // Bir kişiyle mesajlar + karşı profil
    suspend fun chatWith(other: String): Pair<List<Msg>, String> {
        val d = req("/api/chat/with/$other") ?: return emptyList<Msg>() to other
        val o = JSONObject(d)
        val arr = o.optJSONArray("messages") ?: JSONArray()
        val msgs = (0 until arr.length()).map { i ->
            val m = arr.getJSONObject(i)
            Msg(m.optString("id"), m.optString("frm"), m.optString("text"), m.optLong("ts"),
                m.optString("type", "text"), m.optString("media", ""))
        }
        val name = o.optJSONObject("peer")?.optString("name") ?: other
        return msgs to name
    }

    suspend fun chatSend(to: String, text: String): Boolean {
        val body = JSONObject().put("to", to).put("text", text)
        val d = req("/api/chat/send", "POST", body) ?: return false
        return JSONObject(d).optBoolean("ok", false)
    }

    // ---- Canlı konumlar (Harita) ----
    suspend fun positions(): List<Position> {
        val d = req("/api/positions") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("positions") ?: (JSONObject(d).optJSONArray("data") ?: JSONArray())
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Position(o.optString("device", o.optString("name", "")),
                o.optDouble("lat"), o.optDouble("lon"),
                o.optDouble("speedKmh", o.optDouble("spd", 0.0)), o.optBoolean("online", false))
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
    // GRUP SÜRÜŞ video tercihi (1.7): both | group | solo
    suspend fun groupVideoPref(): String {
        val d = req("/api/groupvideo") ?: return "both"
        return JSONObject(d).optString("pref", "both")
    }
    suspend fun setGroupVideoPref(pref: String): Boolean =
        req("/api/groupvideo", "PUT", JSONObject().put("pref", pref)) != null

    // ==================== 1.7 KULÜPLER + LİDERLİK ====================
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
    // Haftalık km — arkadaşlar + kulüp arkadaşları; (satırlar, kendi_sıram)
    suspend fun leaderboard(): Pair<List<LeaderRow>, Int> {
        val d = req("/api/leaderboard") ?: return emptyList<LeaderRow>() to 0
        val o = JSONObject(d)
        val arr = o.optJSONArray("week") ?: JSONArray()
        val rows = (0 until arr.length()).map {
            val r = arr.getJSONObject(it)
            LeaderRow(r.optString("username", ""), r.optString("name", ""),
                r.optDouble("km", 0.0), r.optInt("rides", 0), avatarEmojiOf(r))
        }
        return rows to o.optInt("me", 0)
    }

    // ==================== 1.8 GÜVENLİK / ROZET / WRAPPED / CANLI TAKİP / PAYLAŞIM ====================
    suspend fun safety(): SafetyInfo {
        val d = req("/api/safety") ?: return SafetyInfo("", true, true, "")
        val o = JSONObject(d); val bp = o.optJSONObject("buddy_profile")
        return SafetyInfo(o.optString("buddy", ""), o.optBoolean("arrive", true),
            o.optBoolean("longstop", true), bp?.optString("name", "") ?: "")
    }
    suspend fun setSafety(buddy: String?, arrive: Boolean?, longstop: Boolean?): Boolean {
        val b = JSONObject()
        if (buddy != null) b.put("buddy", buddy)
        if (arrive != null) b.put("arrive", arrive)
        if (longstop != null) b.put("longstop", longstop)
        return req("/api/safety", "PUT", b) != null
    }
    suspend fun badges(): List<String> {
        val d = req("/api/badges") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("badges") ?: JSONArray()
        return (0 until arr.length()).map { arr.getString(it) }
    }
    suspend fun wrapped(): WrappedStats? {
        val d = req("/api/wrapped") ?: return null
        val o = JSONObject(d); val ba = o.optJSONArray("badges") ?: JSONArray()
        return WrappedStats(o.optInt("year", 0), o.optDouble("km", 0.0), o.optInt("rides", 0),
            o.optDouble("hours", 0.0), o.optDouble("longest_km", 0.0), o.optInt("night_rides", 0),
            (0 until ba.length()).map { ba.getString(it) })
    }
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
    // GİZLİLİK: "Nabzımı arkadaşlarım görebilsin" (varsayılan AÇIK).
    suspend fun hrShare(on: Boolean): Boolean {
        hrShareLocal = on; prefs.edit().putBoolean("nd_hrshare", on).apply()
        return req("/api/live/hr-share", "POST", JSONObject().put("on", on)) != null
    }
    // ==================== ÇİFT CANLI TELSİZ (2 kişilik canlı sesli sohbet) ====================
    suspend fun vcInvite(friend: String): Boolean =
        req("/api/voicecall/invite", "POST", JSONObject().put("user", friend)) != null
    suspend fun vcRespond(from: String, accept: Boolean): Boolean =
        req("/api/voicecall/respond", "POST", JSONObject().put("user", from).put("accept", accept)) != null
    /** dönen: (inviteFrom, inviteName, goPeer, goName) */
    suspend fun vcStatus(): Array<String?> {
        val d = req("/api/voicecall/status") ?: return arrayOf(null, null, null, null)
        val o = JSONObject(d)
        fun s(k: String) = if (o.isNull(k)) null else o.optString(k)
        return arrayOf(s("invite_from"), s("invite_name"), s("go_peer"), s("go_name"))
    }
    /** dönen: (url, token, peerName) */
    suspend fun vcToken(peer: String): Triple<String, String, String>? {
        val esc = java.net.URLEncoder.encode(peer, "UTF-8")
        val d = req("/api/voicecall/token?peer=$esc") ?: return null
        val o = JSONObject(d)
        val u = o.optString("url"); val t = o.optString("token")
        if (u.isEmpty() || t.isEmpty()) return null
        return Triple(u, t, o.optString("peer_name", peer))
    }
    // PTT ÇAKIŞMA: basılı tutarken karşı tarafın butonu pasifleşsin
    suspend fun pttBusySet(friend: String, on: Boolean) {
        req("/api/ptt/busy", "POST", JSONObject().put("user", friend).put("on", on))
    }
    suspend fun pttBusyOf(friend: String): Boolean {
        val esc = java.net.URLEncoder.encode(friend, "UTF-8")
        val d = req("/api/ptt/busy/$esc") ?: return false
        return JSONObject(d).optBoolean("busy", false)
    }
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
    suspend fun liveClub(cid: String): List<ClubRider> {
        val d = req("/api/live/club/$cid") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("riders") ?: JSONArray()
        return (0 until arr.length()).map {
            val r = arr.getJSONObject(it)
            ClubRider(r.optString("user", ""), r.optString("name", ""), r.optDouble("lat", 0.0),
                r.optDouble("lon", 0.0), r.optDouble("spd", 0.0), r.optInt("age", 0), r.optInt("course", 0))
        }
    }
    suspend fun shareRoute(rideId: String, toUser: String? = null, toClub: String? = null): Boolean {
        val b = JSONObject().put("ride_id", rideId)
        if (toUser != null) b.put("to_user", toUser)
        if (toClub != null) b.put("to_club", toClub)
        val d = req("/api/routes/share", "POST", b) ?: return false
        return JSONObject(d).optBoolean("ok", false)
    }
    suspend fun sharedRoutes(): List<SharedRoute> {
        val d = req("/api/routes/shared") ?: return emptyList()
        val arr = JSONObject(d).optJSONArray("routes") ?: JSONArray()
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            SharedRoute(o.optString("id", ""), o.optString("from_name", ""), o.optString("from", ""),
                if (o.has("km") && !o.isNull("km")) o.optDouble("km") else null,
                if (o.isNull("date")) null else o.optString("date", null),
                o.optInt("ts", 0), o.optString("ride_id", ""), o.optBoolean("ridden", false))
        }
    }

    // ==================== 1.9 İNTERKOM + TELSİZ ====================
    // (url, token, room) — LiveKit odası
    suspend fun intercomToken(cid: String): Triple<String, String, String>? {
        val d = req("/api/intercom/$cid/token") ?: return null
        val o = JSONObject(d); val u = o.optString("url", ""); val t = o.optString("token", "")
        if (u.isEmpty() || t.isEmpty()) return null
        return Triple(u, t, o.optString("room", ""))
    }
    suspend fun pttSend(club: String, data: ByteArray): Boolean = withContext(Dispatchers.IO) {
        try {
            val c = (URL("$API/api/ptt/send?club=$club").openConnection() as HttpURLConnection)
            c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = 30000
            c.setRequestProperty("Content-Type", "audio/mp4")
            if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
            c.doOutput = true; c.outputStream.use { it.write(data) }
            c.responseCode in 200..299
        } catch (e: Exception) { false }
    }
    // ÇİFTLER: bir arkadaşa sesli mesaj (kulüp gerekmez, ÜCRETSİZ). /api/ptt/send-user
    suspend fun pttSendUser(user: String, data: ByteArray): Boolean = withContext(Dispatchers.IO) {
        try {
            val c = (URL("$API/api/ptt/send-user?user=$user").openConnection() as HttpURLConnection)
            c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = 30000
            c.setRequestProperty("Content-Type", "audio/mp4")
            if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
            c.doOutput = true; c.outputStream.use { it.write(data) }
            c.responseCode in 200..299
        } catch (e: Exception) { false }
    }
    suspend fun pttGet(id: String): ByteArray? = withContext(Dispatchers.IO) {
        try {
            val c = (URL("$API/api/ptt/$id").openConnection() as HttpURLConnection)
            if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
            c.connectTimeout = 15000; c.readTimeout = 30000
            if (c.responseCode == 200) c.inputStream.readBytes() else null
        } catch (e: Exception) { null }
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
