package com.nickdegs.movelog.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.data.Summary
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)   // PullToRefreshBox deneysel API
@Composable
fun SummariesScreen(store: Store) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<Summary>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var yenileniyor by remember { mutableStateOf(false) }   // aşağı çek-tazele göstergesi
    var playUrl by remember { mutableStateOf<String?>(null) }
    var genFor by remember { mutableStateOf<Summary?>(null) }
    suspend fun reload() { items = store.summaries() }
    LaunchedEffect(Unit) { reload() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text(L("Özet", "Summary"), fontSize = 30.sp, fontWeight = FontWeight.Bold,
            color = Color.White, modifier = Modifier.padding(vertical = 8.dp))
        Button(
            onClick = { busy = true; scope.launch { store.summarizeToday(); reload(); busy = false } },
            enabled = !busy,
            colors = ButtonDefaults.buttonColors(containerColor = Brand.accent),
            modifier = Modifier.fillMaxWidth()
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
            else { Icon(Icons.Filled.AutoAwesome, null); Spacer(Modifier.width(8.dp)); Text(L("Bugünü özetle", "Summarize today")) }
        }
        Spacer(Modifier.height(14.dp))
        // AŞAĞI ÇEK-TAZELE (1.62): bu ekranda hiç yoktu (Barış: "aşağı kaydırsam da yenilenmiyor").
        // ⚠️ Boş-durum metni LazyColumn'un İÇİNE alındı: PullToRefreshBox nested-scroll ile çalışır,
        // dışarıda fillMaxSize bir Box kalırsa liste boşken jest HİÇ tetiklenmez — ki asıl senaryo
        // tam olarak bu (özet 30-60 sn sonra sunucuda oluşuyor, kullanıcı boş ekranı çekiyor).
        PullToRefreshBox(
            isRefreshing = yenileniyor,
            onRefresh = { yenileniyor = true; scope.launch { reload(); yenileniyor = false } },
            modifier = Modifier.fillMaxSize()
        ) {
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (items.isEmpty()) item {
                Box(Modifier.fillMaxWidth().padding(top = 64.dp), contentAlignment = Alignment.Center) {
                    Text(L("Henüz özet yok", "No summaries yet"), color = Color(0xFF9AA4B2))
                }
            }
            items(items) { s ->
                Surface(color = Brand.card, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(s.date, color = Brand.accent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Spacer(Modifier.height(6.dp))
                            Text(s.summary, color = Color.White, fontSize = 14.sp)
                        }
                        // Özet videosunu istediğin ayarlarla yeniden üret (rotalar gibi)
                        if (s.from != null && s.to != null) {
                            IconButton(onClick = { genFor = s }) {
                                Icon(Icons.Filled.Tune, L("Video ayarları", "Video settings"), tint = Brand.accent)
                            }
                        }
                        if (s.videoId != null) {
                            IconButton(onClick = {
                                scope.launch { playUrl = store.signedVideoUrl(s.videoId) ?: store.videoUrl(s.videoId) }
                            }) { Icon(Icons.Filled.PlayCircle, null, tint = Brand.accent, modifier = Modifier.size(34.dp)) }
                        }
                    }
                }
            }
        }
        }   // PullToRefreshBox
    }

    genFor?.let { s ->
        GenerateSheet(store, from = s.from ?: 0.0, to = s.to ?: 0.0, type = "moto") {
            genFor = null
            scope.launch { reload() }
        }
    }
    playUrl?.let { url ->
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { playUrl = null },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)
        ) { VideoPlayer(url) }
    }
}
