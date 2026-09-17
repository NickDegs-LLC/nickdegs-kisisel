package com.nickdegs.movelog.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.shape.CircleShape
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
import com.nickdegs.movelog.data.Billing
import com.nickdegs.movelog.data.Convo
import com.nickdegs.movelog.data.SOKAK_SKULARI
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.data.VIDEO_SKULARI
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(store: Store) {
    val scope = rememberCoroutineScope()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var showPaywall by remember { mutableStateOf(false) }
    var editName by remember { mutableStateOf(false) }
    var addFriend by remember { mutableStateOf(false) }
    var davetGiris by remember { mutableStateOf(false) }
    var davetGirisi by remember { mutableStateOf("") }
    var friends by remember { mutableStateOf<List<Convo>>(emptyList()) }
    var boostMsg by remember { mutableStateOf<String?>(null) }
    var sens by remember { mutableStateOf(store.sensitivity) }
    var hrShare by remember { mutableStateOf(store.hrShareLocal) }
    var sumOn by remember { mutableStateOf(true) }
    var sumHour by remember { mutableStateOf(21) }
    var sumVid by remember { mutableStateOf(com.nickdegs.movelog.data.SummaryVid()) }
    var showHour by remember { mutableStateOf(false) }
    var showSumVid by remember { mutableStateOf(false) }
    var showDelete by remember { mutableStateOf(false) }
    var showAvatar by remember { mutableStateOf(false) }
    fun saveSummary() { scope.launch { store.setSummarySettings(com.nickdegs.movelog.data.SummaryCfg(sumOn, sumHour, sumVid)) } }
    val billing = remember {
        // Tüketilebilir: doğrulama BİTMEDEN consume edilmez (bitti(ok) çağrısı Billing içinde tüketir).
        // 17.09 gece (Cursor e2e #5): Profil örneği de restore()'da aboneliği doğrulayıp ack'lesin.
        Billing(ctx, onPurchase = { t, bitti -> scope.launch { bitti(store.verifyGooglePurchase(t)) } },
                onConsumable = { t, sku, bitti ->
            scope.launch {
                val ok = store.verifyGoogleBoost(t, sku)
                bitti(ok)
                if (ok) boostMsg = when {
                    sku in VIDEO_SKULARI -> L("Video hakkın eklendi 🎬", "Video credits added 🎬")
                    sku in SOKAK_SKULARI -> L("Sokak hakkın eklendi 🛣️", "Street credits added 🛣️")
                    else -> L("Bugünkü limitin 2 katına çıktı 🚀", "Today's limit doubled 🚀")
                }
            }
        })
    }
    LaunchedEffect(Unit) {
        store.loadProfile(); friends = store.friends()
        val s = store.summarySettings(); sumOn = s.enabled; sumHour = s.hour; sumVid = s.video
    }
    LaunchedEffect(store.davetYenile) {
        if (store.davetYenile > 0) friends = store.friends()
    }
    val shown = store.displayName.ifBlank { store.me }.ifBlank { "Move Log" }

    LazyColumn(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Spacer(Modifier.height(12.dp))
            Box(Modifier.size(96.dp).background(Brand.gradient, CircleShape).clickable { showAvatar = true },
                contentAlignment = Alignment.Center) {
                if (store.avatarEmoji.isNotEmpty())
                    Text(store.avatarEmoji, fontSize = 48.sp)
                else
                    Text(shown.take(1).uppercase(), fontSize = 40.sp, color = Color.White, fontWeight = FontWeight.Bold)
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clickable { editName = true }) {
                Text(shown, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Spacer(Modifier.width(8.dp))
                Icon(Icons.Filled.Edit, L("İsmi düzenle", "Edit name"), tint = Color(0xFF9AA4B2), modifier = Modifier.size(18.dp))
            }
            Text(L("İsmin video başında görünür", "Your name appears at the start of videos"),
                color = Color(0xFF9AA4B2), fontSize = 12.sp)
        }

        // Premium kartı
        item {
            Surface(color = Brand.card, shape = RoundedCornerShape(22.dp),
                modifier = Modifier.fillMaxWidth().clickable { if (!store.premium) showPaywall = true }) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Star, null, tint = Brand.accent)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(if (store.premium) L("Premium üyesin", "You're Premium")
                             else L("Move Log Premium", "Move Log Premium"), color = Color.White, fontWeight = FontWeight.Bold)
                        Text(if (store.premium) L("Tüm özellikler açık", "All features unlocked")
                             else L("3B videolar, filigransız, müzik", "3D videos, no watermark, music"),
                            color = Color(0xFF9AA4B2), fontSize = 13.sp)
                    }
                }
            }
        }

        // Günlük 2× Boost (consumable) — premium üyeye, ürün Play'de yüklüyse
        if (store.premium && billing.boost != null) {
            item {
                Surface(color = Brand.card, shape = RoundedCornerShape(22.dp),
                    modifier = Modifier.fillMaxWidth().clickable { (ctx as? android.app.Activity)?.let { billing.buyBoost(it) } }) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Bolt, null, tint = Brand.accent)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(L("Günlük 2× Boost", "Daily 2× Boost"), color = Color.White, fontWeight = FontWeight.Bold)
                            Text(boostMsg ?: L("Bugünkü video limitini ikiye katla", "Double today's video limit"),
                                color = Color(0xFF9AA4B2), fontSize = 13.sp)
                        }
                        Text(billing.boostPrice(), color = Brand.accent, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        // Tek seferlik paketler (1.61) — abonelik istemeyene. Play'de olmayan sku kart üretmez.
        items((VIDEO_SKULARI + SOKAK_SKULARI).filter { billing.paketler.containsKey(it) }) { sku ->
            val sokakMi = sku in SOKAK_SKULARI
            val adet = when (sku) { "video_uclu" -> 3; "video_besli" -> 5; "sokak_tek" -> 1; else -> 3 }
            Surface(color = Brand.card, shape = RoundedCornerShape(22.dp),
                modifier = Modifier.fillMaxWidth().clickable {
                    (ctx as? android.app.Activity)?.let { billing.buyPaket(it, sku) } }) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (sokakMi) Icons.Filled.Streetview else Icons.Filled.Movie, null, tint = Brand.accent)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (sokakMi) L("$adet sokak videosu", "$adet street videos")
                             else L("$adet video paketi", "$adet video pack"),
                            color = Color.White, fontWeight = FontWeight.Bold)
                        Text(L("Aboneliksiz, tek seferlik", "One-time, no subscription"),
                            color = Color(0xFF9AA4B2), fontSize = 13.sp)
                    }
                    Text(billing.paketFiyati(sku), color = Brand.accent, fontWeight = FontWeight.Bold)
                }
            }
        }

        // Arkadaş daveti (iOS Profile.swift ile aynı uçlar)
        item {
            Column(Modifier.fillMaxWidth()) {
                Text(L("Davet", "Invite"), color = Color(0xFF9AA4B2), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                Surface(color = Brand.card, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = {
                            scope.launch {
                                val link = store.invite()
                                if (link.isNotEmpty()) {
                                    val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(android.content.Intent.EXTRA_TEXT, link)
                                    }
                                    ctx.startActivity(android.content.Intent.createChooser(
                                        send, L("Davet linkini paylaş", "Share invite link")))
                                }
                            }
                        }) { Text(L("Davet linki oluştur", "Create invite link"), color = Brand.accent) }
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { davetGiris = true }) {
                            Text(L("Kodum var", "I have a code"), color = Brand.accent)
                        }
                    }
                }
            }
        }

        // Arkadaşlar
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(L("Arkadaşlar", "Friends"), color = Color(0xFF9AA4B2), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { addFriend = true }) {
                    Icon(Icons.Filled.PersonAdd, null, tint = Brand.accent, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(L("Ekle", "Add"), color = Brand.accent)
                }
            }
        }
        items(friends) { f ->
            Surface(color = Brand.card, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(38.dp).background(Brand.gradient, CircleShape), contentAlignment = Alignment.Center) {
                        Text((f.name ?: f.username).take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(f.name ?: f.username, color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text("@${f.username}", color = Color(0xFF9AA4B2), fontSize = 12.sp)
                    }
                }
            }
        }

        // Algılama hassasiyeti (premium)
        item {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(L("Algılama hassasiyeti", "Detection sensitivity"), color = Color(0xFF9AA4B2),
                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    val opts = listOf("hassas" to L("Hassas", "High"), "dengeli" to L("Dengeli", "Balanced"), "basit" to L("Basit", "Simple"))
                    opts.forEachIndexed { i, (id, label) ->
                        SegmentedButton(
                            selected = sens == id,
                            onClick = { if (store.premium || id == "basit") { sens = id; store.sensitivity = id } else showPaywall = true },
                            shape = SegmentedButtonDefaults.itemShape(i, opts.size)
                        ) { Text(label) }
                    }
                }
                if (!store.premium) Text(L("Hassas ve Dengeli için Premium gerekir.", "High and Balanced require Premium."),
                    color = Color(0xFF9AA4B2), fontSize = 12.sp)
            }
        }

        // Günlük özet (premium)
        item {
            Surface(color = Brand.card, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(L("Günlük özet", "Daily summary"), color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(L("Her gün ${"%02d".format(sumHour)}:00'da aktivite özeti", "Activity summary daily at ${"%02d".format(sumHour)}:00"),
                                color = Color(0xFF9AA4B2), fontSize = 12.sp)
                        }
                        if (sumOn) TextButton(onClick = { showHour = true }) { Text("${"%02d".format(sumHour)}:00", color = Brand.accent) }
                        Switch(checked = sumOn, onCheckedChange = { sumOn = it; saveSummary() })
                    }
                    if (sumOn) {
                        Spacer(Modifier.height(4.dp))
                        Row(Modifier.fillMaxWidth().clickable { showSumVid = true },
                            verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Movie, null, tint = Brand.accent, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(L("Özet videosu ayarları", "Summary video settings"), color = Color.White, fontSize = 14.sp)
                            Spacer(Modifier.weight(1f))
                            Text("${sumVid.mode} · ${sumVid.aspect}", color = Color(0xFF9AA4B2), fontSize = 12.sp)
                            Icon(Icons.Filled.ChevronRight, null, tint = Color(0xFF9AA4B2))
                        }
                    }
                }
            }
        }

        // Nabız paylaşımı (anlık nabız peek gizliliği)
        item {
            Surface(color = Brand.card, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(L("Nabzımı arkadaşlarım görebilsin", "Let friends see my heart rate"),
                            color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text(L("Canlı takipte arkadaşın anlık nabzını görebilir (saat gerekir). Kapatırsan gizlenir.",
                               "Friends can see your live heart rate on live-track (watch required). Turn off to hide."),
                            color = Color(0xFF9AA4B2), fontSize = 12.sp)
                    }
                    Spacer(Modifier.width(8.dp))
                    Switch(checked = hrShare, onCheckedChange = { hrShare = it; scope.launch { store.hrShare(it) } })
                }
            }
        }

        item {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = { store.signOut() }, modifier = Modifier.fillMaxWidth()) {
                Text(L("Çıkış", "Sign out"))
            }
            TextButton(onClick = { showDelete = true }, modifier = Modifier.fillMaxWidth()) {
                Text(L("Hesabı sil", "Delete account"), color = Color(0xFFFF6B6B))
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (showHour) {
        AlertDialog(onDismissRequest = { showHour = false },
            title = { Text(L("Özet saati", "Summary time")) },
            text = {
                LazyColumn(Modifier.height(280.dp)) {
                    items((0..23).toList()) { h ->
                        Text("${"%02d".format(h)}:00", color = if (h == sumHour) Brand.accent else Color.White,
                            fontWeight = if (h == sumHour) FontWeight.Bold else FontWeight.Normal,
                            modifier = Modifier.fillMaxWidth().clickable {
                                sumHour = h; showHour = false; saveSummary()
                            }.padding(vertical = 10.dp))
                    }
                }
            }, confirmButton = {})
    }

    if (showSumVid) {
        AlertDialog(onDismissRequest = { showSumVid = false; saveSummary() },
            title = { Text(L("Özet videosu", "Summary video")) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SumChips(L("Görünüm", "Mode"), listOf("flat" to L("Düz","Flat"), "flyover" to "Flyover", "3d" to L("3B","3D")),
                        sumVid.mode) { sumVid = sumVid.copy(mode = it) }
                    SumChips(L("Süre", "Duration"), listOf("fast" to L("Kısa","Short"), "medium" to L("Orta","Medium"), "slow" to L("Uzun","Long"), "auto" to L("Otonom","Auto")),
                        sumVid.speed) { sumVid = sumVid.copy(speed = it) }
                    SumChips(L("En-boy", "Aspect"), listOf("16:9" to "16:9", "9:16" to "9:16"),
                        sumVid.aspect) { sumVid = sumVid.copy(aspect = it) }
                    SumChips(L("Kamera", "Camera"), listOf("yakin" to L("Yakın","Near"), "orta" to L("Orta","Medium"), "uzak" to L("Uzak","Far")),
                        sumVid.cam) { sumVid = sumVid.copy(cam = it) }
                    SumChips(L("Müzik", "Music"), listOf("" to L("Yok","None"), "stock:chill" to "Chill", "stock:epic" to "Epic", "stock:upbeat" to "Upbeat", "stock:lofi" to "Lo-Fi", "stock:cinematic" to "Cinematic"),
                        sumVid.music) { sumVid = sumVid.copy(music = it) }
                    Text(L("Rota rengi", "Route color"), color = Color(0xFF9AA4B2), fontSize = 13.sp)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        listOf("#00E5FF","#FF3B30","#39FF14","#FFD60A","#FF7AB6","#FFFFFF","#7C4DFF","#FF8C00").forEach { hex ->
                            Box(Modifier.size(32.dp).clip(CircleShape)
                                .background(Color(android.graphics.Color.parseColor(hex)))
                                .border(if (sumVid.line.equals(hex, true)) 3.dp else 0.dp, Color.White, CircleShape)
                                .clickable { sumVid = sumVid.copy(line = hex) })
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showSumVid = false; saveSummary() }) { Text(L("Tamam", "Done")) } })
    }

    if (showAvatar) {
        val emojis = listOf("🦊","🦁","🐯","🐺","🐻","🐼","🐶","🐱","🦅","🦉","🐴","🦄",
            "🏍️","🚗","🚲","🛵","🚙","✈️","🚁","⛵️","🏎️","🛻","🚜","🛴",
            "🏃","🚶","🚴","🏔️","🌊","🏕️","🌅","🌍","🌙","☀️","🌈","🛣️",
            "⚡️","🔥","⭐️","🎯","🏆","💎","🎸","🎮","📷","🧭","🗺️","❤️")
        AlertDialog(onDismissRequest = { showAvatar = false },
            title = { Text(L("Avatar seç", "Pick an avatar")) },
            text = {
                androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
                    columns = androidx.compose.foundation.lazy.grid.GridCells.Fixed(6),
                    modifier = Modifier.height(300.dp)
                ) {
                    gridItems(emojis) { e ->
                        Text(e, fontSize = 30.sp, modifier = Modifier.padding(6.dp).clickable {
                            showAvatar = false; scope.launch { store.setAvatarEmoji(e) }
                        })
                    }
                }
            }, confirmButton = {
                if (store.avatarEmoji.isNotEmpty())
                    TextButton(onClick = { showAvatar = false; scope.launch { store.setAvatarEmoji("") } }) {
                        Text(L("Kaldır", "Remove"), color = Color(0xFFFF6B6B))
                    }
            })
    }

    if (showDelete) {
        AlertDialog(onDismissRequest = { showDelete = false },
            title = { Text(L("Hesabı sil?", "Delete account?")) },
            text = { Text(L("Tüm verilerin kalıcı olarak silinir. Bu işlem geri alınamaz.", "All your data is permanently deleted. This cannot be undone.")) },
            confirmButton = {
                TextButton(onClick = { showDelete = false; scope.launch { store.deleteAccount() } }) {
                    Text(L("Sil", "Delete"), color = Color(0xFFFF6B6B))
                }
            },
            dismissButton = { TextButton(onClick = { showDelete = false }) { Text(L("Vazgeç", "Cancel")) } })
    }

    if (editName) {
        var v by remember { mutableStateOf(store.displayName.ifBlank { store.me }) }
        AlertDialog(onDismissRequest = { editName = false },
            title = { Text(L("İsmini düzenle", "Edit your name")) },
            text = {
                OutlinedTextField(value = v, onValueChange = { v = it }, singleLine = true,
                    label = { Text(L("Ad Soyad", "Full name")) })
            },
            confirmButton = {
                TextButton(onClick = {
                    val n = v.trim(); editName = false
                    if (n.isNotEmpty()) scope.launch { store.setName(n) }
                }) { Text(L("Kaydet", "Save")) }
            },
            dismissButton = { TextButton(onClick = { editName = false }) { Text(L("Vazgeç", "Cancel")) } })
    }

    if (addFriend) {
        var u by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { addFriend = false },
            title = { Text(L("Arkadaş ekle", "Add friend")) },
            text = {
                OutlinedTextField(value = u, onValueChange = { u = it }, singleLine = true,
                    label = { Text(L("Kullanıcı adı", "Username")) }, prefix = { Text("@") })
            },
            confirmButton = {
                TextButton(onClick = {
                    val name = u.trim(); addFriend = false
                    if (name.isNotEmpty()) scope.launch { if (store.addFriend(name)) friends = store.friends() }
                }) { Text(L("Ekle", "Add")) }
            },
            dismissButton = { TextButton(onClick = { addFriend = false }) { Text(L("Vazgeç", "Cancel")) } })
    }

    if (davetGiris) {
        AlertDialog(onDismissRequest = { davetGiris = false; davetGirisi = "" },
            title = { Text(L("Davet kodu", "Invite code")) },
            text = {
                OutlinedTextField(
                    value = davetGirisi,
                    onValueChange = { davetGirisi = it },
                    singleLine = true,
                    label = { Text(L("Kodu yapıştır", "Paste the code")) },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val kod = davetGirisi
                    davetGiris = false
                    davetGirisi = ""
                    scope.launch {
                        val ok = store.acceptInvite(kod)
                        store.davetSonuc = if (ok) L("Arkadaş eklendi 🤝", "Friend added 🤝")
                                           else L("Kod geçersiz veya süresi dolmuş.", "Invalid or expired code.")
                        if (ok) { store.davetYenile++; friends = store.friends() }
                    }
                }) { Text(L("Kabul et", "Accept")) }
            },
            dismissButton = { TextButton(onClick = { davetGiris = false; davetGirisi = "" }) {
                Text(L("Vazgeç", "Cancel"))
            } })
    }

    if (showPaywall) {
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { showPaywall = false },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)
        ) { PaywallScreen(store) { showPaywall = false } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SumChips(title: String, opts: List<Pair<String, String>>, sel: String, onSel: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, color = Color(0xFF9AA4B2), fontSize = 13.sp)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            opts.forEach { (id, label) ->
                FilterChip(selected = sel == id, onClick = { onSel(id) }, label = { Text(label) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Brand.accent, selectedLabelColor = Color.White))
            }
        }
    }
}
