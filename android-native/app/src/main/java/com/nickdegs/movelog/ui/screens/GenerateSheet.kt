package com.nickdegs.movelog.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material3.*
import androidx.compose.ui.Alignment
import androidx.compose.runtime.*
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand
import com.nickdegs.movelog.video.YerelVideo
import kotlinx.coroutines.launch

private data class Opt(val id: String, val label: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GenerateSheet(store: Store, from: Double, to: Double, type: String, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf("flyover") }
    var speed by remember { mutableStateOf("medium") }
    var aspect by remember { mutableStateOf("16:9") }
    var cam by remember { mutableStateOf("orta") }
    var camAngle by remember { mutableStateOf("") }   // 3D kamera açısı: ""=yandan, chase, pacman
    var music by remember { mutableStateOf("") }
    var line by remember { mutableStateOf("#00E5FF") }
    var dot by remember { mutableStateOf("#FF3B30") }   // takip noktası rengi ("line" = çizgiyle aynı)
    var stock by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var userTracks by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var musicUploading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    // FIX 05.09: uretim hatasi mesaji (400/429/503) — oncesinde hicbir yerde gosterilmiyordu
    var hataMetni by remember { mutableStateOf("") }
    val ctx = LocalContext.current
    LaunchedEffect(Unit) {
        stock = store.musicList(); userTracks = store.musicLibrary()
        // YÜKLÜ MÜZİK OTOMATİK SEÇİLİ (iOS 1.57 paritesi): kullanıcı müzik yüklediyse ve henüz seçim yapmadıysa
        // son yüklediği seçili gelsin -> "eklendi" görünür + videoda kullanılır (eskiden boş/sessiz kalıyordu).
        if (userTracks.isNotEmpty() && music.isEmpty()) music = "lib:" + userTracks.first().first
    }
    val pickAudio = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            musicUploading = true
            scope.launch {
                val bytes = try { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } } catch (e: Exception) { null }
                val nm = (uri.lastPathSegment ?: "Müzik").substringAfterLast('/').substringBeforeLast('.')
                if (bytes == null) { musicUploading = false }
                else {
                    val mid = store.musicLibraryAdd(nm, bytes)
                    userTracks = store.musicLibrary()
                    musicUploading = false
                    if (mid != null) music = "lib:" + mid
                }
            }
        }
    }

    // 18.09: "🎖️ Tactical" modu + taktik süre/en-boy/müzik listeleri KALDIRILDI (Ultra ile birlikte).
    val modes = listOf(Opt("flat", L("Düz", "Flat")), Opt("flyover", "Flyover"), Opt("3d", L("3B", "3D")))
    val speeds = listOf(Opt("fast", L("Kısa", "Short")), Opt("medium", L("Orta", "Medium")),
        Opt("slow", L("Uzun", "Long")), Opt("auto", L("Otonom", "Auto")))
    val aspects = listOf(Opt("16:9", "16:9"), Opt("9:16", "9:16"))
    val cams = listOf(Opt("yakin", L("Yakın", "Near")), Opt("orta", L("Orta", "Medium")), Opt("uzak", L("Uzak", "Far")))
    val lineColors = listOf("#00E5FF", "#FF3B30", "#39FF14", "#FFD60A", "#FF7AB6", "#FFFFFF", "#7C4DFF", "#FF8C00")

    ModalBottomSheet(onDismissRequest = onClose, containerColor = Brand.card) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(L("Video oluştur", "Create video"), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White)
            // 03.11: ücretsiz — "video hakkın" sayacı kalktı. Video artık TELEFONDA üretilir.
            Text(L("Video telefonunda üretilir; bitene kadar ekranı açık tut.",
                   "The video is created on your phone; keep the screen on until it finishes."),
                color = Color(0xFF9AA4B2), fontSize = 13.sp)
            Picker(L("Görünüm", "Mode"), modes, mode) { mode = it }
            // 18.09: tactical dalı ve Ultra kamera açısı bloğu kaldırıldı; bu üç picker KALIYOR
            // (eskiden else gövdesindeydi — video üretiminin çekirdek ayarları).
            Picker(L("Süre", "Duration"), speeds, speed) { speed = it }
            Picker(L("En-boy", "Aspect"), aspects, aspect) { aspect = it }
            Picker(L("Kamera mesafesi", "Camera distance"), cams, cam) { cam = it }
            // MÜZİK (KALACAK özellik): "Yok" + kullanıcının yüklediği kütüphane + stok parçalar.
            val musicOpts = listOf(Opt("", L("Yok", "None"))) +
                userTracks.map { Opt("lib:${it.first}", "🎵 ${it.second}") } +
                stock.map { Opt("stock:${it.first}", it.second) }
            Picker(L("Müzik", "Music"), musicOpts, music) { music = it }
            // 🔑 18.09: müzik YÜKLEME butonu eskiden SADECE tactical modunda görünüyordu. Tactical
            // kalkarken koşul da kaldırıldı — yoksa müzik yüklemenin TEK yolu kaybolurdu (müzik KALIYOR).
            run {
                Button(onClick = { pickAudio.launch("audio/*") }, enabled = !musicUploading,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF23303F)),
                    modifier = Modifier.fillMaxWidth()) {
                    if (musicUploading) { CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp)); Text(L("Yükleniyor…", "Uploading…")) }
                    else Text(L("Yeni müzik yükle… (max 20MB)", "Upload new music… (max 20MB)"))
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(L("Rota çizgisi", "Route line"), color = Color(0xFF9AA4B2), fontSize = 13.sp)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    // Çizgisiz (sadece nokta) seçeneği
                    Box(Modifier.size(34.dp)
                        .clip(androidx.compose.foundation.shape.CircleShape)
                        .background(Color(0xFF2A3340))
                        .border(if (line == "none") 3.dp else 0.dp, Color.White, androidx.compose.foundation.shape.CircleShape)
                        .clickable { line = "none" }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Block, L("Çizgisiz", "No line"), tint = Color(0xFF9AA4B2), modifier = Modifier.size(18.dp))
                    }
                    // Liquid glass (şeffaf frosted çizgi) seçeneği
                    Box(Modifier.size(34.dp)
                        .clip(androidx.compose.foundation.shape.CircleShape)
                        .background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(Color(0x66FFFFFF), Color(0x22AEE6FF))))
                        .border(if (line == "glass") 3.dp else 1.dp, if (line == "glass") Color.White else Color(0x88FFFFFF), androidx.compose.foundation.shape.CircleShape)
                        .clickable { line = "glass" }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.WaterDrop, L("Cam", "Glass"), tint = Color(0xCCFFFFFF), modifier = Modifier.size(17.dp))
                    }
                    // Renksiz tam şeffaf (en minimal cam — basit görünüm) seçeneği
                    Box(Modifier.size(34.dp)
                        .clip(androidx.compose.foundation.shape.CircleShape)
                        .background(Color(0x14FFFFFF))
                        .border(if (line == "clear") 3.dp else 1.dp, if (line == "clear") Color.White else Color(0x66FFFFFF), androidx.compose.foundation.shape.CircleShape)
                        .clickable { line = "clear" }, contentAlignment = Alignment.Center) {
                        Box(Modifier.size(20.dp).border(1.dp, Color(0x88FFFFFF), androidx.compose.foundation.shape.CircleShape))
                    }
                    lineColors.forEach { hex ->
                        Box(Modifier.size(34.dp)
                            .clip(androidx.compose.foundation.shape.CircleShape)
                            .background(Color(android.graphics.Color.parseColor(hex)))
                            .border(if (line.equals(hex, true)) 3.dp else 0.dp, Color.White, androidx.compose.foundation.shape.CircleShape)
                            .clickable { line = hex })
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(L("Takip noktası", "Tracking dot"), color = Color(0xFF9AA4B2), fontSize = 13.sp)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    // Çizgiyle aynı renk
                    Box(Modifier.size(34.dp)
                        .clip(androidx.compose.foundation.shape.CircleShape)
                        .background(if (line.startsWith("#")) Color(android.graphics.Color.parseColor(line)) else Color(0x59FFFFFF))
                        .border(if (dot == "line") 3.dp else 1.dp, if (dot == "line") Color.White else Color(0x4DFFFFFF), androidx.compose.foundation.shape.CircleShape)
                        .clickable { dot = "line" }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Link, L("Çizgiyle aynı", "Match line"), tint = Color(0xE6FFFFFF), modifier = Modifier.size(16.dp))
                    }
                    (listOf("#FF3B30") + lineColors.filter { it != "#FF3B30" }).forEach { hex ->
                        Box(Modifier.size(34.dp)
                            .clip(androidx.compose.foundation.shape.CircleShape)
                            .background(Color(android.graphics.Color.parseColor(hex)))
                            .border(if (dot.equals(hex, true)) 3.dp else 0.dp, Color.White, androidx.compose.foundation.shape.CircleShape)
                            .clickable { dot = hex })
                    }
                }
            }
            Button(
                onClick = onClick@{
                    val act = ctx as? android.app.Activity
                    if (act == null || YerelVideo.calisiyor) {
                        android.widget.Toast.makeText(ctx, L("Başka bir video şu an üretiliyor.",
                            "Another video is being created right now."), android.widget.Toast.LENGTH_SHORT).show()
                        return@onClick
                    }
                    busy = true; hataMetni = ""
                    scope.launch {
                        val dotHex = if (dot == "line") (if (line.startsWith("#")) line else "#FFFFFF") else dot
                        // 1) Sunucuya bildir: ayarlar kaydedilir, iş TELEFON KUYRUĞUNA (yerelq) yazılır.
                        //    Üretim yarıda kalırsa (iptal/arka plan/ağ) iş kuyrukta durur, sonraki açılışta
                        //    MoveLogApp'teki ON_RESUME kancası onu otomatik üretir.
                        val kod = store.generate(from, to, type, mode, aspect, speed, cam, music, line,
                            if (mode == "3d") camAngle else "", dotHex)
                        if (kod != 200) {
                            busy = false
                            // FIX 05.09: sunucunun kendi açıklamasını göster (400/429/503...).
                            hataMetni = store.sonUretimHatasi.ifEmpty {
                                if (kod == 0) L("Sunucuya ulaşılamadı (bağlantı?)", "Couldn't reach the server (network?)")
                                else L("Video oluşturulamadı (sunucu $kod)", "Couldn't create the video (server $kod)")
                            }
                            return@launch
                        }
                        if (!store.sonUretimYerel) { busy = false; onClose(); return@launch }   // eski bulut modu: sunucu üretir
                        // 2) TELEFONDA üret -> yükle -> kuyruktan düş (tam ekran ilerleme: YerelVideoKatmani)
                        val ok = YerelVideo.uretVeYukle(act, store, YerelVideo.Istek(
                            from = from, to = to, type = type, mode = mode, speed = speed, aspect = aspect,
                            camdist = cam, line = line, dot = dotHex))
                        busy = false
                        if (ok) {
                            android.widget.Toast.makeText(ctx, L("Video hazır — Videolarım'da.", "Video ready — in My Videos."),
                                android.widget.Toast.LENGTH_SHORT).show()
                            onClose()
                        } else {
                            val neden = YerelVideo.sonHata.ifEmpty { L("Video üretilemedi.", "Couldn't create the video.") }
                            hataMetni = neden
                            android.widget.Toast.makeText(ctx, neden, android.widget.Toast.LENGTH_LONG).show()
                        }
                    }
                },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = Brand.accent),
                modifier = Modifier.fillMaxWidth().height(50.dp)
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Text(L("Video oluştur", "Create video"), fontWeight = FontWeight.SemiBold)
            }
            if (hataMetni.isNotEmpty()) {
                Text(hataMetni, color = Color(0xFFFF6B6B), fontSize = 13.sp,
                     modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Picker(title: String, opts: List<Opt>, sel: String, onSel: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, color = Color(0xFF9AA4B2), fontSize = 13.sp)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            opts.forEach { o ->
                FilterChip(
                    selected = sel == o.id, onClick = { onSel(o.id) },
                    label = { Text(o.label) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Brand.accent,
                        selectedLabelColor = Color.White,
                    )
                )
            }
        }
    }
}
