package com.nickdegs.movelog.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.platform.LocalContext
import com.nickdegs.movelog.util.saveVideoToGallery
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.nickdegs.movelog.data.Ride
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

private fun sortKey(r: Ride): Double =
    if (r.rendering) Double.MAX_VALUE else (r.done ?: r.ts ?: 0.0)

private fun fmt(ts: Double?, pat: String): String {
    if (ts == null || ts <= 0) return ""
    return SimpleDateFormat(pat, Locale.getDefault()).format(Date((ts * 1000).toLong()))
}

@Composable
fun VideosScreen(store: Store) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var rides by remember { mutableStateOf<List<Ride>>(emptyList()) }
    var playUrl by remember { mutableStateOf<String?>(null) }
    var savingId by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<Ride?>(null) }

    suspend fun reload() {
        // FIX 05.09: filtre "failed" kartlari da geciriyordu -> oynatilabilir gibi gorunup
        // dokununca 404 aliniyordu (olculdu: 14 sahte kart). Basarisiz olanlar artik ayirt edilir.
        rides = store.rides().filter { it.rendering || it.failed || (!it.novideo) }
            .sortedByDescending { sortKey(it) }
        store.autoSaveNewVideos()   // aktif oturumda yeni biten videoyu hemen galeriye kaydet
    }
    // 03.11: telefonda üretilen video yüklenince (YerelVideo -> store.videolarYenile++) listeyi tazele.
    LaunchedEffect(store.videolarYenile) { if (store.videolarYenile > 0) reload() }
    LaunchedEffect(Unit) {
        reload()
        while (true) {                                  // render olan varken 12sn'de bir tazele
            if (rides.any { it.rendering }) { delay(12000); reload() } else delay(4000)
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text(L("Videolarım", "My Videos"), fontSize = 30.sp, fontWeight = FontWeight.Bold,
            color = Color.White, modifier = Modifier.padding(vertical = 8.dp))
        if (rides.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(L("Henüz video yok", "No videos yet"), color = Color(0xFF9AA4B2))
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(rides) { r ->
                Surface(color = Brand.card, shape = RoundedCornerShape(20.dp)) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(fmt(r.ts, L("d MMM yyyy · HH:mm", "MMM d, yyyy · HH:mm")),
                                color = Color.White, fontWeight = FontWeight.SemiBold)
                            if (r.done != null) Text(L("Üretildi: ", "Created: ") + fmt(r.done, "d MMM HH:mm"),
                                color = Color(0xFF9AA4B2), fontSize = 12.sp)
                        }
                        if (r.rendering) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(Modifier.size(18.dp), color = Brand.accent, strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                                Text(L("Hazırlanıyor…", "Rendering…"), color = Brand.accent, fontSize = 13.sp)
                            }
                        } else if (r.failed) {
                            // FIX 05.09: basarisiz render OYNAT dugmesiyle cikiyordu -> 404. Artik
                            // hata karti: sebebi yazar, yalniz SIL islemi sunar (iOS ile ayni davranis).
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(r.error?.take(60) ?: L("Üretilemedi", "Couldn't be created"),
                                     color = Color(0xFFFF6B6B), fontSize = 13.sp)
                                IconButton(onClick = { pendingDelete = r }) {
                                    Icon(Icons.Filled.Delete, L("Sil", "Delete"), tint = Color(0xFFFF6B6B))
                                }
                            }
                        } else {
                            // Kaydet (galeriye indir)
                            if (savingId == r.id) CircularProgressIndicator(Modifier.size(20.dp), color = Brand.accent, strokeWidth = 2.dp)
                            else IconButton(onClick = {
                                savingId = r.id
                                scope.launch {
                                    val b = store.videoBytes(r.id)
                                    val ok = b != null && saveVideoToGallery(ctx, b, "MoveLog_${r.id}.mp4")
                                    savingId = null
                                    android.widget.Toast.makeText(ctx,
                                        if (ok) L("Galeriye kaydedildi", "Saved to gallery") else L("Kaydedilemedi", "Couldn't save"),
                                        android.widget.Toast.LENGTH_SHORT).show()
                                }
                            }) { Icon(Icons.Filled.Download, L("Kaydet", "Save"), tint = Brand.accent) }
                            // Oynat
                            IconButton(onClick = {
                                scope.launch { playUrl = store.signedVideoUrl(r.id) ?: store.videoUrl(r.id) }
                            }) { Icon(Icons.Filled.PlayCircle, null, tint = Brand.accent, modifier = Modifier.size(40.dp)) }
                            // Sil — 10.10: ÖRNEK (appreview) videoda yok; sunucu 404 veriyordu, düğme sessizce ölüydü
                            if (!r.sample) IconButton(onClick = { pendingDelete = r }) {
                                Icon(Icons.Filled.Delete, L("Sil", "Delete"), tint = Color(0xFFFF6B6B))
                            }
                        }
                    }
                }
            }
        }
    }

    pendingDelete?.let { r ->
        AlertDialog(onDismissRequest = { pendingDelete = null },
            title = { Text(L("Bu videoyu sil?", "Delete this video?")) },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch { store.deleteRide(r.id); reload(); pendingDelete = null }
                }) { Text(L("Sil", "Delete"), color = Color(0xFFFF6B6B)) }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text(L("Vazgeç", "Cancel")) } })
    }

    playUrl?.let { url ->
        Dialog(onDismissRequest = { playUrl = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            VideoPlayer(url)
        }
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
fun VideoPlayer(url: String) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val player = remember {
        ExoPlayer.Builder(ctx).build().apply {
            setMediaItem(MediaItem.fromUri(url)); prepare(); playWhenReady = true
        }
    }
    DisposableEffect(Unit) { onDispose { player.release() } }
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        AndroidView(factory = { PlayerView(it).apply { this.player = player } }, modifier = Modifier.fillMaxSize())
    }
}
