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
import androidx.compose.material.icons.filled.Groups
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
    // 10.11.2026 (Barış): video SUNUCUYA GİTMEZ. Telefonda üretilir, sonuç ekranında izlenir;
    // "Galeriye kaydet"e basılmazsa kapatınca silinir. hazir = üretilmiş geçici MP4 (cacheDir/videolar).
    var hazir by remember { mutableStateOf<java.io.File?>(null) }
    // Ortak sürüş: sunucu bu sürüş için grup önerdiyse anahtar (yoksa null) + kullanıcının tercihi.
    var grup by remember { mutableStateOf<String?>(null) }
    var ortak by remember { mutableStateOf(true) }
    val ctx = LocalContext.current
    LaunchedEffect(from, to) { grup = store.grupAnahtari(from, to) }
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
            // 10.11.2026: ortak sürüş (arkadaş/kulüp) — yalnız sunucu bu sürüş için grup önerdiyse.
            // Açıkken video 3B motorla ve grup anahtarıyla üretilir (eşler yalnız 3B'de çizilir).
            if (grup != null) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFF23303F))
                        .clickable { ortak = !ortak }.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Groups, null, tint = Brand.accent, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(L("Arkadaşlarınla ortak video", "Joint video with your friends"),
                            color = Color.White, fontSize = 15.sp, modifier = Modifier.weight(1f))
                        Switch(checked = ortak, onCheckedChange = { ortak = it },
                            colors = SwitchDefaults.colors(checkedTrackColor = Brand.accent))
                    }
                    Text(L("Bu sürüşte arkadaşların da vardı; ortak video 3B olarak hepinizi birlikte gösterir.",
                           "Your friends rode with you; the joint video shows all of you together in 3D."),
                        color = Color(0xFF9AA4B2), fontSize = 12.sp)
                }
            }
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
                        // 10.11.2026: /api/rides/generate ÇAĞRILMAZ (iOS gibi): o uç sunucu kuyruğuna iş
                        // yazıyordu. Doğrudan motor sayfası (/api/motor3d) -> TELEFONDA üretim. YÜKLEME YOK,
                        // /api/local-renders/done YOK. (tam ekran ilerleme: YerelVideoKatmani)
                        val ortakAnahtar = if (ortak) grup else null
                        val f = YerelVideo.telefondaUret(act, store, YerelVideo.Istek(
                            from = from, to = to, type = type,
                            mode = if (ortakAnahtar != null) "3d" else mode,   // ortak video yalnız 3B motorda
                            speed = speed, aspect = aspect,
                            camdist = cam, line = line, dot = dotHex, grup = ortakAnahtar))
                        busy = false
                        if (f != null) {
                            hazir = f   // sonuç ekranı (VideoSonuc) açılır
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
    hazir?.let { f ->
        VideoSonuc(f) {
            runCatching { f.delete() }
            hazir = null
            onClose()
        }
    }
}

/**
 * 10.11.2026 (Barış): ÜRETİM SONUCU — video yalnız bu telefonda, geçici dosyada; sunucuya yüklenmez.
 * "Galeriye kaydet" -> Movies/MoveLog; "Paylaş" -> paylaşım menüsü (FileProvider, cacheDir/videolar);
 * "Kapat" -> kaydedilmediyse onay sorar, dosya silinir. Ekrandan hangi yoldan çıkılırsa çıkılsın
 * (ör. Activity yeniden kurulursa) geçici dosya onDispose'da silinir. iOS VideoSonucView eşi.
 */
@Composable
private fun VideoSonuc(dosya: java.io.File, onKapat: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var kaydediliyor by remember { mutableStateOf(false) }
    var kaydedildi by remember { mutableStateOf(false) }
    var kayitHata by remember { mutableStateOf(false) }
    var soruyor by remember { mutableStateOf(false) }
    DisposableEffect(dosya) { onDispose { runCatching { dosya.delete() } } }

    fun kapatIste() {
        if (kaydedildi) onKapat() else soruyor = true
    }

    androidx.compose.ui.window.Dialog(
        onDismissRequest = { kapatIste() },   // geri tuşu: kaydedilmediyse önce sor
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false,
            dismissOnBackPress = true, dismissOnClickOutside = false)
    ) {
        Column(Modifier.fillMaxSize().background(Brand.bg).padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(L("Videon hazır 🎬", "Your video is ready 🎬"), color = Color.White,
                fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
            Box(Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(18.dp))) {
                VideoPlayer(android.net.Uri.fromFile(dosya).toString())   // VideosScreen.kt (Media3 ExoPlayer)
            }
            Button(
                onClick = {
                    kaydediliyor = true; kayitHata = false
                    scope.launch {
                        val ok = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                            YerelVideo.galeriyeKaydet(ctx.applicationContext, dosya)
                        }
                        kaydediliyor = false; kaydedildi = ok; kayitHata = !ok
                    }
                },
                enabled = !kaydediliyor && !kaydedildi,
                colors = ButtonDefaults.buttonColors(containerColor = Brand.accent),
                modifier = Modifier.fillMaxWidth().height(50.dp)
            ) {
                if (kaydediliyor) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Text(if (kaydedildi) L("Galeriye kaydedildi", "Saved to gallery") else L("Galeriye kaydet", "Save to gallery"),
                    fontWeight = FontWeight.SemiBold)
            }
            if (kayitHata) {
                Text(L("Galeriye kaydedilemedi.", "Couldn't save to the gallery."), color = Color(0xFFFF6B6B), fontSize = 13.sp)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(
                    onClick = {
                        // Manifest'teki mevcut FileProvider ("<paket>.kartlar"); res/xml/kart_paths.xml'de
                        // cacheDir/videolar/ yolu açık.
                        runCatching {
                            val uri = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".kartlar", dosya)
                            val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                type = "video/mp4"
                                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            val chooser = android.content.Intent.createChooser(send, L("Paylaş", "Share"))
                            if (ctx !is android.app.Activity) chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                            ctx.startActivity(chooser)
                        }.onFailure {
                            android.widget.Toast.makeText(ctx, L("Paylaşılamadı", "Couldn't share"),
                                android.widget.Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.weight(1f)
                ) { Text(L("Paylaş", "Share")) }
                OutlinedButton(onClick = { kapatIste() }, modifier = Modifier.weight(1f)) {
                    Text(L("Kapat", "Close"))
                }
            }
            if (!kaydedildi) {
                Text(L("Video sunucuda saklanmaz. Kaydetmezsen kapatınca silinir.",
                       "Videos aren't stored on our servers. If you don't save it, it's deleted when you close."),
                    color = Color(0xFF9AA4B2), fontSize = 12.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
    if (soruyor) {
        AlertDialog(
            onDismissRequest = { soruyor = false },
            title = { Text(L("Video kaydedilmedi. Kapatırsan silinecek.", "The video isn't saved. Closing deletes it.")) },
            confirmButton = {
                TextButton(onClick = { soruyor = false; onKapat() }) {
                    Text(L("Sil ve kapat", "Delete and close"), color = Color(0xFFFF6B6B))
                }
            },
            dismissButton = { TextButton(onClick = { soruyor = false }) { Text(L("Vazgeç", "Cancel")) } }
        )
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
