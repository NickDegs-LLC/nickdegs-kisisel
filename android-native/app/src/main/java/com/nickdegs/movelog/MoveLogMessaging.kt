package com.nickdegs.movelog

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// FCM push (iOS APNs karşılığı): backend DATA-only mesaj yollar -> burada bildirim kurup gösteririz.
// Bildirime dokununca "route" MainActivity'ye taşınır -> ilgili ekrana deep-link.
class MoveLogMessaging : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        val prefs = getSharedPreferences("movelog", Context.MODE_PRIVATE)
        prefs.edit().putString("nd_fcm", token).apply()
        val auth = prefs.getString("nd_token", "") ?: ""
        if (auth.isEmpty()) return
        Thread {
            try {
                val c = (URL("https://kisisel-api.nickdegs.com/api/pushtoken").openConnection() as HttpURLConnection)
                c.requestMethod = "POST"; c.connectTimeout = 12000; c.readTimeout = 15000
                c.setRequestProperty("Authorization", "Bearer $auth")
                c.setRequestProperty("Content-Type", "application/json"); c.doOutput = true
                c.outputStream.use { it.write(JSONObject().put("token", token).put("platform", "android").toString().toByteArray()) }
                c.responseCode; c.disconnect()
            } catch (e: Exception) {}
        }.start()
    }

    // Sessiz nabız tetiği geldi: bağlı Wear OS saatine token+api ile "kısa nabız ölçümü" komutu yolla.
    // Saat kendi ölçer + doğrudan sunucuya raporlar (want=false gelince durur, pil serbest). Saat yoksa sessizce geçer.
    private fun triggerWearHrPeek() {
        val token = getSharedPreferences("movelog", Context.MODE_PRIVATE).getString("nd_token", "") ?: ""
        if (token.isEmpty()) return
        try {
            val payload = "$token|https://kisisel-api.nickdegs.com".toByteArray()
            com.google.android.gms.wearable.Wearable.getNodeClient(this).connectedNodes
                .addOnSuccessListener { nodes ->
                    val mc = com.google.android.gms.wearable.Wearable.getMessageClient(this)
                    nodes.forEach { mc.sendMessage(it.id, "/movelog/hrpeek", payload) }
                }
        } catch (e: Exception) {}
    }

    override fun onMessageReceived(msg: RemoteMessage) {
        val d = msg.data
        val title = d["title"] ?: msg.notification?.title ?: "Move Log"
        val body = d["body"] ?: msg.notification?.body ?: ""
        val route = d["route"] ?: ""
        val silent = d["silent"] ?: ""
        // ANLIK NABIZ: izleyen arkadaş bakıyor -> saate "kısa nabız ölçümü başlat" de (bildirim YOK)
        if (silent == "hrpeek") { triggerWearHrPeek(); return }
        // TELSİZ KLİBİ (1.62): sunucu `silent = "ptt:<id>:<gönderen>"` yolluyor
        // (cf/api/src/routes/grup4.ts:438,467 → cron/lib-push.ts FCM data.silent).
        // Bu dal Android'de HİÇ YOKTU: aşağıdaki `silent.isNotEmpty() && body.isEmpty()` satırı
        // klibi sessizce yutuyordu, yani telsiz iOS'ta çalışıp Android'de hiç çalmıyordu.
        // iOS karşılığı: Push.swift:50-52 → Ptt.swift playIncoming(id:from:)
        if (silent.startsWith("ptt:")) { telsizKlibiCal(silent.removePrefix("ptt:")); return }
        // diğer sessiz (telsiz/beacon uyandırma) -> bildirim gösterme
        if (silent.isNotEmpty() && body.isEmpty()) return
        val ch = "movelog_push"
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(ch, "Move Log", NotificationManager.IMPORTANCE_HIGH))
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (route.isNotEmpty()) putExtra("route", route)
        }
        val pi = PendingIntent.getActivity(this, route.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        nm.notify(System.currentTimeMillis().toInt(),
            NotificationCompat.Builder(this, ch)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title).setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pi).build())
    }

    /**
     * Gelen telsiz klibini indirip çalar — iOS Ptt.swift:60-79 davranışının birebir karşılığı:
     * indir → sesi "duck"la → gönderenin adını TTS ile anons et → klibi çal.
     * Yük biçimi: "<klipId>:<gönderen adı>" (ilk ':' ayırır; adda ':' olabilir diye limit=2).
     * Klip yoksa (sunucuda süresi dolmuş: ptt/ 1 gün lifecycle) SESSİZCE çıkar — iOS de öyle yapıyor.
     */
    private fun telsizKlibiCal(yuk: String) {
        val parca = yuk.split(":", limit = 2)
        val id = parca.getOrNull(0)?.trim().orEmpty()
        val gonderen = parca.getOrNull(1)?.trim().orEmpty().ifEmpty { "Rider" }
        if (id.isEmpty()) return
        val auth = getSharedPreferences("movelog", Context.MODE_PRIVATE).getString("nd_token", "") ?: ""
        if (auth.isEmpty()) return
        Thread {
            var dosya: java.io.File? = null
            try {
                val c = (URL("https://kisisel-api.nickdegs.com/api/ptt/$id").openConnection() as HttpURLConnection)
                c.setRequestProperty("Authorization", "Bearer $auth")
                c.connectTimeout = 15000; c.readTimeout = 30000
                if (c.responseCode != 200) return@Thread          // 404 = klip yok/yetkisiz -> sessiz
                val veri = c.inputStream.readBytes()
                if (veri.size < 512) return@Thread
                dosya = java.io.File(cacheDir, "ptt_$id.m4a").apply { writeBytes(veri) }

                val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val nitelik = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
                val istek = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(nitelik).build()
                am.requestAudioFocus(istek)

                // Önce kim gönderdi anonsu, sonra klip (iOS'taki 0.9 sn gecikmenin karşılığı).
                var tts: TextToSpeech? = null
                tts = TextToSpeech(applicationContext) { durum ->
                    try {
                        if (durum == TextToSpeech.SUCCESS) {
                            tts?.language = java.util.Locale.getDefault()
                            tts?.speak("$gonderen:", TextToSpeech.QUEUE_FLUSH, null, "ptt-$id")
                        }
                    } catch (e: Exception) { }
                }
                Thread.sleep(900)

                val mp = MediaPlayer()
                mp.setAudioAttributes(nitelik)
                mp.setDataSource(dosya.absolutePath)
                mp.setOnCompletionListener {
                    try { it.release() } catch (e: Exception) { }
                    try { am.abandonAudioFocusRequest(istek) } catch (e: Exception) { }
                    try { tts?.shutdown() } catch (e: Exception) { }
                    try { dosya?.delete() } catch (e: Exception) { }
                }
                mp.setOnErrorListener { p, _, _ ->
                    try { p.release() } catch (e: Exception) { }
                    try { am.abandonAudioFocusRequest(istek) } catch (e: Exception) { }
                    true
                }
                mp.prepare(); mp.start()
            } catch (e: Exception) {
                try { dosya?.delete() } catch (e2: Exception) { }
            }
        }.start()
    }
}
