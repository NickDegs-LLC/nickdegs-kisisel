package com.nickdegs.movelog.wear

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.material.*
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable

// Bilekten kayıt sırasında canlı değerler (RecordService yazar, UI okur — aynı process).
object RideState {
    var active by mutableStateOf(false)
    var elapsedSec by mutableStateOf(0L)
    var speedKmh by mutableStateOf(0.0)
    var distanceKm by mutableStateOf(0.0)
    var hr by mutableStateOf(0)
}
// Telefondan gelen Traccar kimliği (deviceId + ingest URL).
object ConfigState {
    var deviceId by mutableStateOf("")
    var url by mutableStateOf("")
    val ready: Boolean get() = deviceId.isNotEmpty() && url.isNotEmpty()
}

class MainActivity : ComponentActivity() {

    private val accent = Color(0xFF0A85FF)

    // Telefon Move Log'dan Traccar kimliğini iste; cevabı /movelog/config ile gelir.
    private val onMessage = MessageClient.OnMessageReceivedListener { ev ->
        if (ev.path == "/movelog/config") {
            val parts = String(ev.data).split("|", limit = 2)
            ConfigState.deviceId = parts.getOrElse(0) { "" }
            ConfigState.url = parts.getOrElse(1) { "" }
        }
    }

    private fun requestConfig() {
        try {
            Wearable.getNodeClient(this).connectedNodes.addOnSuccessListener { nodes ->
                val mc = Wearable.getMessageClient(this)
                nodes.forEach { mc.sendMessage(it.id, "/movelog/req-config", ByteArray(0)) }
            }
        } catch (e: Exception) {}
    }

    override fun onResume() {
        super.onResume()
        Wearable.getMessageClient(this).addListener(onMessage)
        requestConfig()
    }
    override fun onPause() {
        super.onPause()
        try { Wearable.getMessageClient(this).removeListener(onMessage) } catch (e: Exception) {}
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { WearRoot() }
    }

    private fun hasPerms() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun startRide() {
        val i = Intent(this, RecordService::class.java)
            .putExtra("id", ConfigState.deviceId).putExtra("url", ConfigState.url)
        startForegroundService(i)
    }
    private fun stopRide() { stopService(Intent(this, RecordService::class.java)) }

    @Composable
    private fun WearRoot() {
        val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
            if (res[Manifest.permission.ACCESS_FINE_LOCATION] == true) startRide()
        }
        Scaffold(timeText = { TimeText() }) {
            Column(
                Modifier.fillMaxSize().padding(horizontal = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                if (RideState.active) {
                    val m = RideState.elapsedSec / 60; val s = RideState.elapsedSec % 60
                    Text("%d:%02d".format(m, s), fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    Spacer(Modifier.height(2.dp))
                    Text("${"%.1f".format(RideState.speedKmh)} km/h", color = accent, fontSize = 16.sp)
                    Text("${"%.2f".format(RideState.distanceKm)} km", color = Color(0xFF9AA4B2), fontSize = 14.sp)
                    if (RideState.hr > 0) Text("♥ ${RideState.hr}", color = Color(0xFFFF3B30), fontSize = 15.sp)
                    Spacer(Modifier.height(10.dp))
                    Button(onClick = { stopRide() }, colors = ButtonDefaults.primaryButtonColors(backgroundColor = Color(0xFFFF3B30))) {
                        Text(if (java.util.Locale.getDefault().language == "tr") "Bitir" else "Stop")
                    }
                } else {
                    Text("Move Log", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = accent)
                    Spacer(Modifier.height(6.dp))
                    val tr = java.util.Locale.getDefault().language == "tr"
                    if (!ConfigState.ready) {
                        Text(if (tr) "Telefondaki Move Log'a bağlanılıyor…" else "Connecting to Move Log on your phone…",
                            color = Color(0xFF9AA4B2), fontSize = 13.sp, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(8.dp))
                        Chip(onClick = { requestConfig() }, label = { Text(if (tr) "Tekrar dene" else "Retry") },
                            colors = ChipDefaults.secondaryChipColors())
                    } else {
                        Text(if (tr) "Sürüşünü bilekten kaydet" else "Record your ride from the wrist",
                            color = Color(0xFF9AA4B2), fontSize = 13.sp, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(10.dp))
                        Button(onClick = {
                            if (hasPerms()) startRide()
                            else permLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.BODY_SENSORS))
                        }, colors = ButtonDefaults.primaryButtonColors(backgroundColor = accent)) {
                            Text(if (tr) "Başlat" else "Start")
                        }
                    }
                }
            }
        }
    }
}
