package com.nickdegs.movelog.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.nickdegs.movelog.data.Ride
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand
import java.text.SimpleDateFormat
import java.util.*

private fun typeLabel(t: String?) = when (t) {
    "moto" -> L("Motosiklet", "Motorcycle"); "car" -> L("Araba", "Car")
    "bike" -> L("Bisiklet", "Cycling"); "run" -> L("Koşu", "Running")
    "walk" -> L("Yürüyüş", "Walking"); else -> L("Diğer", "Other")
}
private fun typeIcon(t: String?) = when (t) {
    "moto", "bike" -> Icons.Filled.TwoWheeler; "car" -> Icons.Filled.DirectionsCar
    "run" -> Icons.Filled.DirectionsRun; "walk" -> Icons.Filled.DirectionsWalk
    else -> Icons.Filled.Route
}
private fun dayTime(r: Ride): String {
    val ts = r.ts ?: return r.date
    val fmt = SimpleDateFormat(L("d MMM yyyy · HH:mm", "MMM d, yyyy · HH:mm"), Locale.getDefault())
    return fmt.format(Date((ts * 1000).toLong()))
}

@Composable
fun RoutesScreen(store: Store) {
    val scope = rememberCoroutineScope()
    var rides by remember { mutableStateOf<List<Ride>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var playUrl by remember { mutableStateOf<String?>(null) }
    var genRide by remember { mutableStateOf<Ride?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var typeMenuFor by remember { mutableStateOf<String?>(null) }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var recording by remember { mutableStateOf(com.nickdegs.movelog.TrackingService.active) }
    // konum izni verilince kaydı başlat (eskiden MapPane içindeydi)
    val perm = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions()
    ) { res ->
        if (res[android.Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            scope.launch {
                val t = store.trackerInfo()
                if (t != null) { com.nickdegs.movelog.TrackingService.start(ctx, t.first, t.second); recording = true }
            }
        }
    }
    LaunchedEffect(Unit) { rides = store.rides(); loaded = true }

    // GPX/TCX dosya seçici (akıllı saat/Strava) -> yükle -> üretim sheet'i
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true
            val bytes = withContext(kotlinx.coroutines.Dispatchers.IO) {
                ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            }
            val res = if (bytes != null) store.uploadRoute(bytes) else null
            uploading = false
            if (res != null) {
                genRide = Ride("upload", "", "bike", null, 0.0, res.first, res.second, null, null, null, false, false)
                rides = store.rides()
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Move Log", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { if (store.premium) picker.launch("*/*") }, enabled = !uploading) {
                if (uploading) CircularProgressIndicator(Modifier.size(20.dp), color = Brand.accent, strokeWidth = 2.dp)
                else Icon(Icons.Filled.FileUpload, L("GPX/TCX yükle", "Upload GPX/TCX"), tint = Brand.accent)
            }
        }
        // GEZİ KAYDI (16.09): Harita paneli kaldırıldı; "Rota kaydını başlat / durdur" düğmesi
        // oradan buraya taşındı — kaydı başlatmanın tek yolu oydu. Davranış birebir aynı.
        Button(
            onClick = {
                if (recording) { com.nickdegs.movelog.TrackingService.stop(ctx); recording = false }
                else perm.launch(arrayOf(
                    android.Manifest.permission.ACCESS_FINE_LOCATION,
                    android.Manifest.permission.POST_NOTIFICATIONS))
            },
            colors = ButtonDefaults.buttonColors(
                containerColor = if (recording) Color(0xFFFF3B30) else Brand.accent),
            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
        ) {
            Icon(if (recording) Icons.Filled.Stop else Icons.Filled.FiberManualRecord, null)
            Spacer(Modifier.width(8.dp))
            Text(if (recording) L("Kaydı durdur", "Stop recording") else L("Rota kaydını başlat", "Start recording"))
        }
        if (loaded && rides.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(L("Henüz rota yok", "No routes yet"), color = Color(0xFF9AA4B2))
            }
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(rides) { r ->
                Surface(color = Brand.card, shape = RoundedCornerShape(20.dp)) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(typeIcon(r.type), null, tint = Brand.accent, modifier = Modifier.size(40.dp))
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(dayTime(r), color = Color.White, fontWeight = FontWeight.SemiBold)
                            Box {
                                Row(Modifier.clickable { typeMenuFor = r.id }, verticalAlignment = Alignment.CenterVertically) {
                                    Text(typeLabel(r.type), color = Color(0xFF9AA4B2), fontSize = 13.sp)
                                    Icon(Icons.Filled.ArrowDropDown, null, tint = Color(0xFF9AA4B2), modifier = Modifier.size(16.dp))
                                }
                                DropdownMenu(expanded = typeMenuFor == r.id, onDismissRequest = { typeMenuFor = null }) {
                                    listOf("moto", "car", "bike", "run", "walk").forEach { t ->
                                        DropdownMenuItem(text = { Text(typeLabel(t)) }, onClick = {
                                            typeMenuFor = null
                                            scope.launch { if (store.setRideType(r.id, t)) rides = store.rides() }
                                        })
                                    }
                                }
                            }
                        }
                        if (r.rendering) {
                            Text(L("Hazırlanıyor…", "Rendering…"), color = Brand.accent, fontSize = 13.sp)
                        } else if (r.novideo) {
                            IconButton(onClick = { genRide = r }) {
                                Icon(Icons.Filled.MovieCreation, L("Video oluştur", "Create video"), tint = Brand.accent)
                            }
                        } else {
                            IconButton(onClick = {
                                scope.launch { playUrl = store.signedVideoUrl(r.id) ?: store.videoUrl(r.id) }
                            }) { Icon(Icons.Filled.PlayCircle, null, tint = Brand.accent, modifier = Modifier.size(34.dp)) }
                        }
                    }
                }
            }
        }
    }

    playUrl?.let { url ->
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { playUrl = null },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)
        ) { VideoPlayer(url) }
    }
    genRide?.let { r ->
        GenerateSheet(store, from = r.ts ?: 0.0, to = r.to ?: 0.0, type = r.type ?: "moto") {
            genRide = null
            scope.launch { rides = store.rides() }   // üretim sonrası tazele ("Hazırlanıyor" görünsün)
        }
    }
}
