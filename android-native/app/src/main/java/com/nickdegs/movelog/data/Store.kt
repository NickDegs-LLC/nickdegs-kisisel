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

    // ---- Auth (telefon + SMS tek-kullanımlık kod; iOS ile aynı) ----
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
            Msg(m.optString("id"), m.optString("frm"), m.optString("text"), m.optLong("ts"))
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
}

data class SummaryVid(val mode: String = "flyover", val speed: String = "medium", val aspect: String = "16:9",
                      val cam: String = "orta", val music: String = "", val line: String = "#00E5FF")
data class SummaryCfg(val enabled: Boolean = true, val hour: Int = 21, val video: SummaryVid = SummaryVid())
data class Convo(val username: String, val name: String?, val online: Boolean, val unread: Int, val last: String = "")
data class Msg(val id: String, val frm: String, val text: String, val ts: Long)
data class Position(val device: String, val lat: Double, val lon: Double, val speedKmh: Double, val online: Boolean)

data class Summary(val date: String, val summary: String, val videoId: String?,
                   val from: Double? = null, val to: Double? = null)
