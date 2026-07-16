package com.nickdegs.movelog

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
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

    override fun onMessageReceived(msg: RemoteMessage) {
        val d = msg.data
        val title = d["title"] ?: msg.notification?.title ?: "Move Log"
        val body = d["body"] ?: msg.notification?.body ?: ""
        val route = d["route"] ?: ""
        val silent = d["silent"] ?: ""
        // sessiz (telsiz/beacon uyandırma) -> bildirim gösterme; şimdilik yoksay (Android'de arka plan çalma yok)
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
}
