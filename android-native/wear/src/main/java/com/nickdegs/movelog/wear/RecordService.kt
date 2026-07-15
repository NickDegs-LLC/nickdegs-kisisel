package com.nickdegs.movelog.wear

import android.app.*
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DeltaDataType
import com.google.android.gms.location.*
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

// Bilekten rota kaydı: foreground service + FusedLocation -> Traccar OsmAnd ingest (telefon TrackingService karşılığı)
// + Health Services ile canlı nabız. Değerleri RideState'e yazar (UI okur).
class RecordService : Service() {
    private lateinit var fused: FusedLocationProviderClient
    private var deviceId = ""
    private var ingestUrl = ""
    private var startMs = 0L
    private var last: Location? = null
    private var meters = 0.0

    private val measureClient by lazy { HealthServices.getClient(this).measureClient }
    private val hrCallback = object : MeasureCallback {
        override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {}
        override fun onDataReceived(data: DataPointContainer) {
            val pts = data.getData(DataType.HEART_RATE_BPM)
            pts.lastOrNull()?.let { RideState.hr = it.value.toInt() }
        }
    }

    private val cb = object : LocationCallback() {
        override fun onLocationResult(res: LocationResult) {
            val loc = res.lastLocation ?: return
            last?.let { p ->
                val dt = (loc.time - p.time) / 1000.0
                if (dt > 0 && loc.distanceTo(p) / dt > 70) return   // ışınlanma filtresi
                meters += loc.distanceTo(p)
            }
            last = loc
            RideState.speedKmh = (loc.speed * 3.6)
            RideState.distanceKm = meters / 1000.0
            RideState.elapsedSec = (System.currentTimeMillis() - startMs) / 1000
            send(loc)
        }
    }

    override fun onCreate() {
        super.onCreate()
        fused = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        deviceId = intent?.getStringExtra("id") ?: ""
        ingestUrl = intent?.getStringExtra("url") ?: ""
        startMs = System.currentTimeMillis()
        meters = 0.0; last = null
        startForeground(7, notif())
        RideState.active = true; RideState.hr = 0
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 4000L)
            .setMinUpdateIntervalMillis(3000L).setMinUpdateDistanceMeters(4f).build()
        try { fused.requestLocationUpdates(req, cb, mainLooper) } catch (e: SecurityException) {}
        try { measureClient.registerMeasureCallback(DataType.HEART_RATE_BPM, hrCallback) } catch (e: Exception) {}
        return START_STICKY
    }

    private fun send(loc: Location) {
        if (deviceId.isEmpty() || ingestUrl.isEmpty()) return
        Thread {
            try {
                val sep = if (ingestUrl.contains("?")) "&" else "?"
                fun e(v: String) = URLEncoder.encode(v, "UTF-8")
                val q = "${sep}id=${e(deviceId)}&lat=${loc.latitude}&lon=${loc.longitude}" +
                    "&timestamp=${loc.time / 1000}&speed=${loc.speed * 1.94384}" +
                    "&altitude=${loc.altitude}&accuracy=${loc.accuracy}&bearing=${loc.bearing}" +
                    (if (RideState.hr > 0) "&heartRate=${RideState.hr}" else "")
                val c = (URL(ingestUrl + q).openConnection() as HttpURLConnection)
                c.requestMethod = "POST"; c.connectTimeout = 10000; c.readTimeout = 10000
                c.doOutput = true; OutputStreamWriter(c.outputStream).use { it.write("") }
                c.responseCode; c.disconnect()
            } catch (e: Exception) {}
        }.start()
    }

    private fun notif(): Notification {
        val ch = NotificationChannel("wear_track", "Rota kaydı", NotificationManager.IMPORTANCE_LOW)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        return NotificationCompat.Builder(this, "wear_track")
            .setContentTitle("Move Log")
            .setContentText("Kayıt sürüyor…")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setOngoing(true).build()
    }

    override fun onDestroy() {
        RideState.active = false
        try { fused.removeLocationUpdates(cb) } catch (e: Exception) {}
        try { measureClient.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, hrCallback) } catch (e: Exception) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
