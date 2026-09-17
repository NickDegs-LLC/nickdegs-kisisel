package com.nickdegs.movelog

import android.content.Context
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.nickdegs.movelog.data.cihazKimligi
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// Wear OS (Samsung saat) köprüsü: saat "/movelog/req-config" gönderince, telefon backend'den
// Traccar kimliğini (deviceId + ingest URL) alıp "/movelog/config" ile saate yollar.
// iOS PhoneWatchLink karşılığı. Sistem tetikler (telefon app'i açık olmasa da çalışır).
class PhoneWearService : WearableListenerService() {
    override fun onMessageReceived(ev: MessageEvent) {
        if (ev.path != "/movelog/req-config") return
        val token = getSharedPreferences("movelog", Context.MODE_PRIVATE).getString("nd_token", "") ?: ""
        if (token.isEmpty()) return
        try {
            val c = (URL("https://kisisel-api.nickdegs.com/api/tracker").openConnection() as HttpURLConnection)
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("X-Device-Id", cihazKimligi(this))
            c.connectTimeout = 12000; c.readTimeout = 15000
            if (c.responseCode == 200) {
                val o = JSONObject(c.inputStream.bufferedReader().readText())
                val id = o.optString("deviceId", ""); val url = o.optString("url", "")
                if (id.isNotEmpty() && url.isNotEmpty()) {
                    Wearable.getMessageClient(this)
                        .sendMessage(ev.sourceNodeId, "/movelog/config", "$id|$url".toByteArray())
                }
            }
            c.disconnect()
        } catch (e: Exception) {}
    }
}
