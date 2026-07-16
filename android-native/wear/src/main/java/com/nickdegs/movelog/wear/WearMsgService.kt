package com.nickdegs.movelog.wear

import android.content.Intent
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

// Telefondan gelen Wear mesajlarını arka planda (saat app'i kapalıyken bile) karşılar.
// "/movelog/hrpeek" = izleyen arkadaş nabza bakıyor -> kısa ölçüm servisini başlat (token+api gömülü).
class WearMsgService : WearableListenerService() {
    override fun onMessageReceived(ev: MessageEvent) {
        if (ev.path != "/movelog/hrpeek") return
        val parts = String(ev.data).split("|", limit = 2)
        val token = parts.getOrElse(0) { "" }
        val api = parts.getOrElse(1) { "https://kisisel-api.nickdegs.com" }
        if (token.isEmpty()) return
        try {
            startForegroundService(Intent(this, HrPeekService::class.java)
                .putExtra("token", token).putExtra("api", api))
        } catch (e: Exception) {}
    }
}
