package com.nickdegs.movelog.wear

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DeltaDataType
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// ANLIK NABIZ PEEK (2026-07-16): aktivite GEREKMEZ. İzleyen arkadaş canlı ekranı açınca telefon
// sessiz FCM alır -> saate "/movelog/hrpeek" komutu gelir -> bu servis kısa süreli nabız ölçer ve
// doğrudan sunucuya raporlar. Sunucu want=false dönerse (kimse bakmıyor) DURUR -> pil serbest.
// 90 sn sert emniyet. Kayıt (RecordService) zaten çalışıyorsa başlamaz (HR oradan gidiyor).
class HrPeekService : Service() {
    private var token = ""
    private var api = ""
    private var startMs = 0L
    private var stopped = false
    @Volatile private var hr = 0
    @Volatile private var reporting = false

    private val measureClient by lazy { HealthServices.getClient(this).measureClient }
    private val hrCallback = object : MeasureCallback {
        override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {}
        override fun onDataReceived(data: DataPointContainer) {
            data.getData(DataType.HEART_RATE_BPM).lastOrNull()?.let { hr = it.value.toInt() }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (RideState.active) { stopSelf(); return START_NOT_STICKY }   // kayıt varsa HR zaten gidiyor
        token = intent?.getStringExtra("token") ?: ""
        api = intent?.getStringExtra("api") ?: "https://kisisel-api.nickdegs.com"
        if (token.isEmpty()) { stopSelf(); return START_NOT_STICKY }
        startMs = System.currentTimeMillis()
        startForeground(8, notif())
        try { measureClient.registerMeasureCallback(DataType.HEART_RATE_BPM, hrCallback) } catch (e: Exception) {}
        loop()
        return START_STICKY
    }

    // 4 sn'de bir nabzı sunucuya bas; want=false ya da 90 sn -> dur.
    private fun loop() {
        if (reporting) return
        reporting = true
        Thread {
            while (!stopped) {
                if (System.currentTimeMillis() - startMs > 90_000) break   // sert emniyet
                val want = report()
                if (!want) break
                try { Thread.sleep(4000) } catch (e: InterruptedException) { break }
            }
            android.os.Handler(mainLooper).post { finishUp() }
        }.start()
    }

    // POST /api/live/hr-report {hr} -> {want:bool}. hr=0 ise sunucu değeri yok sayar, want yine döner.
    private fun report(): Boolean {
        return try {
            val c = (URL("$api/api/live/hr-report").openConnection() as HttpURLConnection)
            c.requestMethod = "POST"; c.connectTimeout = 10000; c.readTimeout = 12000
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("Content-Type", "application/json"); c.doOutput = true
            c.outputStream.use { it.write(JSONObject().put("hr", hr).toString().toByteArray()) }
            val ok = c.responseCode == 200
            val want = if (ok) JSONObject(c.inputStream.bufferedReader().readText()).optBoolean("want", false) else false
            c.disconnect()
            want
        } catch (e: Exception) { true }   // geçici ağ hatası: hemen durma, döngü emniyeti sınırlar
    }

    private fun finishUp() {
        if (stopped) return
        stopped = true
        try { measureClient.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, hrCallback) } catch (e: Exception) {}
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun notif(): Notification {
        val ch = NotificationChannel("wear_hrpeek", "Nabız paylaşımı", NotificationManager.IMPORTANCE_MIN)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        val tr = java.util.Locale.getDefault().language == "tr"
        return NotificationCompat.Builder(this, "wear_hrpeek")
            .setContentTitle("Move Log")
            .setContentText(if (tr) "Arkadaşın nabzını görüyor…" else "A friend is viewing your heart rate…")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setOngoing(true).build()
    }

    override fun onDestroy() { stopped = true; super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}
