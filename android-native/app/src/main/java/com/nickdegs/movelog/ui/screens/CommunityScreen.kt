package com.nickdegs.movelog.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.nickdegs.movelog.data.*
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val sub = Color(0xFF9AA4B2)
private val gold = Color(0xFFFFD60A)

// TOPLULUK / SÜRÜŞ DÜNYASI — iOS Community18/Clubs/Leaderboard/LiveTrack/Profile(arkadaşlar) karşılığı.
// Tek dosyada iç-navigasyon (route state) ile tüm 1.4–1.8 sosyal özellikleri.
private sealed class Route {
    object Hub : Route()
    object Friends : Route()
    object Clubs : Route()
    data class ClubDetail(val id: String) : Route()
    data class Intercom(val id: String, val name: String) : Route()
    object Leaderboard : Route()
    object Safety : Route()
    object Badges : Route()
    object Wrapped : Route()
    object Shared : Route()
    object Username : Route()
    object IdeaBox : Route()
    object GroupVideo : Route()
    object Convoy : Route()
}

@Composable
fun CommunityScreen(store: Store) {
    var route by remember { mutableStateOf<Route>(Route.Hub) }
    when (val r = route) {
        is Route.Hub -> HubView(store, ultra = store.ultra) { route = it }
        is Route.Friends -> FriendsView(store) { route = Route.Hub }
        is Route.Clubs -> ClubsView(store, onOpen = { route = Route.ClubDetail(it) }) { route = Route.Hub }
        is Route.ClubDetail -> ClubDetailView(store, r.id,
            onIntercom = { name -> route = Route.Intercom(r.id, name) }) { route = Route.Clubs }
        is Route.Intercom -> IntercomView(store, r.id, r.name) { route = Route.ClubDetail(r.id) }
        is Route.Leaderboard -> LeaderboardView(store) { route = Route.Hub }
        is Route.Safety -> SafetyView(store) { route = Route.Hub }
        is Route.Badges -> BadgesView(store) { route = Route.Hub }
        is Route.Wrapped -> WrappedView(store) { route = Route.Hub }
        is Route.Shared -> SharedView(store) { route = Route.Hub }
        is Route.Username -> UsernameView(store) { route = Route.Hub }
        is Route.IdeaBox -> IdeaBoxView(store) { route = Route.Hub }
        is Route.GroupVideo -> GroupVideoView(store) { route = Route.Hub }
        is Route.Convoy -> ConvoyVoiceView(store) { route = Route.Hub }
    }
}

@Composable
private fun Bar(title: String, onBack: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Color.White) }
        Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White,
            modifier = Modifier.padding(start = if (onBack != null) 0.dp else 12.dp))
    }
}

@Composable
private fun Card(onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Surface(color = Brand.card, shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)) {
        Column(Modifier.padding(16.dp), content = content)
    }
}

private data class HubItem(val icon: ImageVector, val title: String, val desc: String, val route: Route, val ultra: Boolean = false)

@Composable
private fun HubView(store: Store, ultra: Boolean, nav: (Route) -> Unit) {
    val hubItems = listOf(
        HubItem(Icons.Filled.Group, L("Arkadaşlar", "Friends"), L("Bul, ekle, istekleri yönet", "Find, add, manage requests"), Route.Friends),
        HubItem(Icons.Filled.Groups, L("Kulüpler", "Clubs"), L("Sürüş kulübü kur ya da katıl", "Create or join a riding club"), Route.Clubs),
        HubItem(Icons.Filled.EmojiEvents, L("Liderlik", "Leaderboard"), L("Haftalık km sıralaması", "Weekly km ranking"), Route.Leaderboard),
        HubItem(Icons.Filled.Shield, L("Güvenlik", "Safety"), L("Sağ salim vardım bildirimi", "Arrived-safely alerts"), Route.Safety, true),
        HubItem(Icons.Filled.MilitaryTech, L("Rozetler", "Badges"), L("Kazandığın başarımlar", "Your achievements"), Route.Badges),
        HubItem(Icons.Filled.CardGiftcard, L("Yıl Özeti", "Year Wrapped"), L("Yıllık sürüş istatistiklerin", "Your year in rides"), Route.Wrapped),
        HubItem(Icons.Filled.Route, L("Paylaşılan Rotalar", "Shared Routes"), L("Sana gönderilen rotalar", "Routes shared with you"), Route.Shared),
        HubItem(Icons.Filled.AlternateEmail, L("Kullanıcı Adı", "Username"), L("@adını belirle, seni bulsunlar", "Set your @handle so friends find you"), Route.Username),
        HubItem(Icons.Filled.Movie, L("Grup Videosu", "Group Video"), L("Ortak sürüş videosu tercihi", "Shared ride video preference"), Route.GroupVideo),
        HubItem(Icons.Filled.Lightbulb, L("Fikir Kutusu", "Idea Box"), L("Fikrin doğrudan geliştiriciye", "Your idea straight to the developer"), Route.IdeaBox),
        HubItem(Icons.Filled.VolumeUp, L("Konvoy Sesi", "Convoy Voice"), L("Kulüp arkadaşlarının mesafesini sesli duy", "Hear clubmates' distance aloud"), Route.Convoy, true),
    )
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Sürüş Dünyan", "Your Riding World"), null)
        LazyColumn(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(bottom = 24.dp)) {
            items(hubItems) { it ->
                Card(onClick = { nav(it.route) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(it.icon, null, tint = Brand.accent, modifier = Modifier.size(28.dp))
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(it.title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                                if (it.ultra && !ultra) {
                                    Spacer(Modifier.width(6.dp))
                                    Icon(Icons.Filled.Lock, null, tint = gold, modifier = Modifier.size(14.dp))
                                }
                            }
                            Text(it.desc, color = sub, fontSize = 13.sp)
                        }
                        Icon(Icons.Filled.ChevronRight, null, tint = sub)
                    }
                }
            }
        }
    }
}

// ---------------- ARKADAŞLAR + KULLANICI ADI ----------------
@Composable
private fun FriendsView(store: Store, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var pairTalk by remember { mutableStateOf<Triple<String, String, Boolean>?>(null) }  // (user, ad, davetEdenMiyim)
    var vcIncoming by remember { mutableStateOf<Pair<String, String>?>(null) }           // gelen davet (user, ad)
    var busyFriends by remember { mutableStateOf<Set<String>>(emptySet()) }
    var q by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<FoundUser>>(emptyList()) }
    var incoming by remember { mutableStateOf<List<FoundUser>>(emptyList()) }
    var friends by remember { mutableStateOf<List<Convo>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    suspend fun reload() {
        friends = store.friends()
        incoming = store.friendRequests().first
    }
    LaunchedEffect(Unit) { reload() }
    // PTT meşgul + canlı telsiz daveti polling (2.5 sn)
    LaunchedEffect(Unit) {
        while (true) {
            val bs = mutableSetOf<String>()
            friends.take(8).forEach { fr -> if (store.pttBusyOf(fr.username)) bs.add(fr.username) }
            busyFriends = bs
            val st = store.vcStatus()
            if (st[0] != null && vcIncoming == null && pairTalk == null) vcIncoming = Pair(st[0]!!, st[1] ?: st[0]!!)
            delay(2500)
        }
    }
    // ÇİFT CANLI TELSİZ ekranı (davet eden bekler / kabul eden direkt bağlanır)
    pairTalk?.let { (u, nm, inviting) ->
        PairTalkView(store, u, nm, inviting) { pairTalk = null }
        return
    }
    vcIncoming?.let { (u, nm) ->
        AlertDialog(onDismissRequest = { vcIncoming = null },
            title = { Text(L("Canlı telsiz daveti 📻", "Live radio invite 📻")) },
            text = { Text(L("$nm seni canlı sesli sohbete davet ediyor", "$nm is inviting you to a live voice chat")) },
            confirmButton = {
                Button(onClick = {
                    scope.launch { store.vcRespond(u, true); pairTalk = Triple(u, nm, false); vcIncoming = null }
                }, colors = ButtonDefaults.buttonColors(containerColor = Brand.accent)) { Text(L("Kabul et", "Accept")) }
            },
            dismissButton = {
                TextButton(onClick = { scope.launch { store.vcRespond(u, false) }; vcIncoming = null }) { Text(L("Reddet", "Decline")) }
            })
    }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Arkadaşlar", "Friends"), onBack)
        Column(Modifier.padding(14.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(value = q, onValueChange = { q = it },
                label = { Text(L("@kullanıcı adı ile ara", "Search by @username")) },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                trailingIcon = {
                    IconButton(onClick = { scope.launch { busy = true; results = store.findUsers(q); busy = false } }) {
                        Icon(Icons.Filled.Search, null, tint = Brand.accent)
                    }
                })
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Brand.accent)
            results.forEach { u ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AvatarDot(u.avatarEmoji, u.name)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(u.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text("@${u.handle}", color = sub, fontSize = 12.sp)
                        }
                        when (u.status) {
                            "friend" -> Text(L("Arkadaş", "Friend"), color = sub, fontSize = 13.sp)
                            "outgoing", "requested" -> Text(L("İstek gönderildi", "Requested"), color = gold, fontSize = 13.sp)
                            else -> Button(onClick = {
                                scope.launch { store.friendRequest(u.username); results = store.findUsers(q) }
                            }, colors = ButtonDefaults.buttonColors(containerColor = Brand.accent)) {
                                Text(L("Ekle", "Add"))
                            }
                        }
                    }
                }
            }
            if (incoming.isNotEmpty()) {
                Text(L("Gelen istekler", "Friend requests"), color = Color.White, fontWeight = FontWeight.Bold)
                incoming.forEach { u ->
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AvatarDot(u.avatarEmoji, u.name)
                            Spacer(Modifier.width(10.dp))
                            Text(u.name, color = Color.White, modifier = Modifier.weight(1f))
                            TextButton(onClick = { scope.launch { store.respondFriend(u.username, false); reload() } }) {
                                Text(L("Reddet", "Ignore"), color = sub)
                            }
                            Button(onClick = { scope.launch { store.respondFriend(u.username, true); reload() } },
                                colors = ButtonDefaults.buttonColors(containerColor = Brand.accent)) {
                                Text(L("Onayla", "Accept"))
                            }
                        }
                    }
                }
            }
            Text(L("Arkadaşların", "Your friends"), color = Color.White, fontWeight = FontWeight.Bold)
            if (friends.isEmpty()) Text(L("Henüz arkadaş yok.", "No friends yet."), color = sub, fontSize = 13.sp)
            friends.forEach { f ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AvatarDot("", f.name ?: f.username)
                        Spacer(Modifier.width(10.dp))
                        Text(f.name ?: f.username, color = Color.White, modifier = Modifier.weight(1f))
                        FriendVoiceButton(store, f.username, busyFriends.contains(f.username))   // çiftler: sesli mesaj (+ çakışma kilidi)
                        IconButton(onClick = { pairTalk = Triple(f.username, f.name ?: f.username, true) }) {
                            Icon(Icons.Filled.Call, null, tint = Brand.accent, modifier = Modifier.size(22.dp))
                        }
                        if (f.online) { Spacer(Modifier.width(8.dp)); Box(Modifier.size(9.dp).background(Color(0xFF34C759), CircleShape)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun AvatarDot(emoji: String, name: String) {
    Box(Modifier.size(38.dp).background(Brand.accent.copy(alpha = 0.25f), CircleShape), contentAlignment = Alignment.Center) {
        Text(if (emoji.isNotEmpty()) emoji else name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold)
    }
}

// ---------------- ÇİFTLER: ARKADAŞA SESLİ MESAJ (ücretsiz, kulüp gerekmez) ----------------
@Composable
private fun FriendVoiceButton(store: Store, friendUser: String, peerBusy: Boolean = false) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var recording by remember { mutableStateOf(false) }
    var recorder by remember { mutableStateOf<android.media.MediaRecorder?>(null) }
    val file = remember { java.io.File(ctx.cacheDir, "pttu_$friendUser.m4a") }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun hasMic() = androidx.core.content.ContextCompat.checkSelfPermission(
        ctx, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
    IconButton(enabled = !peerBusy, onClick = {
        if (!hasMic()) { permLauncher.launch(android.Manifest.permission.RECORD_AUDIO); return@IconButton }
        if (!recording) {
            scope.launch { store.pttBusySet(friendUser, true) }   // karşı butonu kilitle ("konuşuyor")
            try {
                @Suppress("DEPRECATION") val r = android.media.MediaRecorder()
                r.setAudioSource(android.media.MediaRecorder.AudioSource.MIC)
                r.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4)
                r.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC)
                r.setOutputFile(file.absolutePath)
                r.prepare(); r.start(); recorder = r; recording = true
            } catch (e: Exception) {}
        } else {
            try { recorder?.stop() } catch (e: Exception) {}
            recorder?.release(); recorder = null; recording = false
            scope.launch {
                store.pttBusySet(friendUser, false)               // kilidi bırak
                val bytes = try { file.readBytes() } catch (e: Exception) { ByteArray(0) }
                if (bytes.size > 500) store.pttSendUser(friendUser, bytes)
            }
        }
    }) {
        Icon(if (peerBusy) Icons.Filled.GraphicEq else if (recording) Icons.Filled.Stop else Icons.Filled.Mic, null,
            tint = if (peerBusy) Color(0xFFFF9F0A) else if (recording) Color(0xFFFF3B30) else Brand.accent, modifier = Modifier.size(22.dp))
    }
}

// ---------------- KULÜPLER ----------------
@Composable
private fun ClubsView(store: Store, onOpen: (String) -> Unit, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var clubs by remember { mutableStateOf<List<Club>>(emptyList()) }
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf("") }
    suspend fun reload() { clubs = store.clubs() }
    LaunchedEffect(Unit) { reload() }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Kulüpler", "Clubs"), onBack)
        Column(Modifier.padding(14.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Card {
                Text(L("Kulüp kur", "Create a club"), color = Color.White, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true,
                    label = { Text(L("Kulüp adı", "Club name")) }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Button(onClick = {
                    scope.launch { if (name.isNotBlank()) { store.createClub(name.trim()); name = ""; reload() } }
                }, colors = ButtonDefaults.buttonColors(containerColor = Brand.accent), modifier = Modifier.fillMaxWidth()) {
                    Text(L("Oluştur", "Create"))
                }
            }
            Card {
                Text(L("Davet koduyla katıl", "Join with invite code"), color = Color.White, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = code, onValueChange = { code = it.uppercase() }, singleLine = true,
                    label = { Text(L("Kod", "Code")) }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Button(onClick = {
                    scope.launch {
                        val c = store.joinClub(code.trim())
                        msg = if (c != null) L("Katıldın!", "Joined!") else L("Kod geçersiz", "Invalid code")
                        code = ""; reload()
                    }
                }, colors = ButtonDefaults.buttonColors(containerColor = Brand.accent2), modifier = Modifier.fillMaxWidth()) {
                    Text(L("Katıl", "Join"))
                }
                if (msg.isNotEmpty()) { Spacer(Modifier.height(6.dp)); Text(msg, color = sub, fontSize = 13.sp) }
            }
            Text(L("Kulüplerin", "Your clubs"), color = Color.White, fontWeight = FontWeight.Bold)
            if (clubs.isEmpty()) Text(L("Henüz kulüp yok.", "No clubs yet."), color = sub, fontSize = 13.sp)
            clubs.forEach { c ->
                Card(onClick = { onOpen(c.id) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Groups, null, tint = Brand.accent)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(c.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(L("${c.memberCount} üye", "${c.memberCount} members"), color = sub, fontSize = 12.sp)
                        }
                        Icon(Icons.Filled.ChevronRight, null, tint = sub)
                    }
                }
            }
        }
    }
}

@Composable
private fun ClubDetailView(store: Store, id: String, onIntercom: (String) -> Unit, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var club by remember { mutableStateOf<Club?>(null) }
    LaunchedEffect(id) { club = store.clubDetail(id) }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(club?.name ?: L("Kulüp", "Club"), onBack)
        val c = club
        if (c == null) { CircularProgressIndicator(color = Brand.accent, modifier = Modifier.padding(24.dp)); return@Column }
        Column(Modifier.padding(14.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!c.code.isNullOrEmpty()) Card {
                Text(L("Davet kodu", "Invite code"), color = sub, fontSize = 12.sp)
                Text(c.code, color = Brand.accent, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            }
            // 1.9 CANLI İNTERKOM — Ultra; kulüp sesli odası
            if (store.ultra) Card(onClick = { onIntercom(c.name) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.RecordVoiceOver, null, tint = Brand.accent, modifier = Modifier.size(28.dp))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(L("Canlı interkom", "Live intercom"), color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text(L("Kulübünle gerçek zamanlı sesli konuş", "Talk live with your club"), color = sub, fontSize = 12.sp)
                    }
                    Icon(Icons.Filled.ChevronRight, null, tint = sub)
                }
            }
            // 1.9 TELSİZ (PTT) — Ultra; bas-kaydet-gönder
            if (store.ultra) PttBar(store, id)
            else Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Mic, null, tint = gold)
                    Spacer(Modifier.width(10.dp))
                    Text(L("Telsiz — Ultra üyeliği gerektirir", "Radio — requires Ultra"), color = sub, fontSize = 13.sp)
                }
            }
            Text(L("Üyeler", "Members"), color = Color.White, fontWeight = FontWeight.Bold)
            c.members?.forEach { m ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AvatarDot(m.avatarEmoji, m.name ?: m.username)
                        Spacer(Modifier.width(10.dp))
                        Text(m.name ?: m.username, color = Color.White, modifier = Modifier.weight(1f))
                        if (m.username == c.owner) Text(L("Kurucu", "Owner"), color = gold, fontSize = 12.sp)
                    }
                }
            }
            OutlinedButton(onClick = { scope.launch { store.leaveClub(id); onBack() } },
                modifier = Modifier.fillMaxWidth()) { Text(L("Kulüpten ayrıl", "Leave club"), color = Color(0xFFFF453A)) }
        }
    }
}

// ---------------- LİDERLİK ----------------
@Composable
private fun LeaderboardView(store: Store, onBack: () -> Unit) {
    var rows by remember { mutableStateOf<List<LeaderRow>>(emptyList()) }
    var myRank by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { val (r, m) = store.leaderboard(); rows = r; myRank = m }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Liderlik", "Leaderboard"), onBack)
        Text(L("Son 7 gün — arkadaş ve kulüp arkadaşların.", "Last 7 days — your friends and clubmates."),
            color = sub, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp))
        LazyColumn(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty()) item {
                Text(L("Henüz kimse yok — arkadaş ekle, km'ler konuşsun!", "No one yet — add friends and let the km talk!"),
                    color = sub, fontSize = 13.sp)
            }
            items(rows.withIndex().toList()) { (i, r) ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${i + 1}", color = if (i == 0) gold else sub, fontWeight = FontWeight.Bold,
                            fontSize = 18.sp, modifier = Modifier.width(30.dp))
                        AvatarDot(r.avatarEmoji, r.name)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(r.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(L("${r.rides} sürüş", "${r.rides} rides"), color = sub, fontSize = 12.sp)
                        }
                        Text("${"%.1f".format(r.km)} km", color = Brand.accent, fontWeight = FontWeight.Bold)
                    }
                }
            }
            if (myRank > 0) item {
                Text(L("Sıran: $myRank", "Your rank: $myRank"), color = gold, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}

// ---------------- GÜVENLİK ----------------
@Composable
private fun SafetyView(store: Store, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf(SafetyInfo("", true, true, "")) }
    var friends by remember { mutableStateOf<List<Convo>>(emptyList()) }
    LaunchedEffect(Unit) { info = store.safety(); friends = store.friends() }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Güvenlik", "Safety"), onBack)
        if (!store.ultra) {
            Text(L("Bu özellik Ultra üyeliği gerektirir.", "This feature requires Ultra."),
                color = gold, fontSize = 14.sp, modifier = Modifier.padding(16.dp))
        }
        Column(Modifier.padding(14.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(L("Sağ salim vardım bildirimi", "Arrived-safely alert"), color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text(L("Sürüş bitince güven kişine otomatik haber.", "Auto-notify your buddy when a ride ends."), color = sub, fontSize = 12.sp)
                    }
                    Switch(checked = info.arrive, onCheckedChange = {
                        info = info.copy(arrive = it); scope.launch { store.setSafety(null, it, null) }
                    })
                }
            }
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(L("Uzun duruş uyarısı", "Long-stop alert"), color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text(L("Uzun süre hareketsizsen güven kişine haber.", "Notify buddy if you stop for too long."), color = sub, fontSize = 12.sp)
                    }
                    Switch(checked = info.longstop, onCheckedChange = {
                        info = info.copy(longstop = it); scope.launch { store.setSafety(null, null, it) }
                    })
                }
            }
            Text(L("Güven kişisi", "Safety buddy"), color = Color.White, fontWeight = FontWeight.Bold)
            if (info.buddyName.isNotEmpty()) Text(L("Şu an: ${info.buddyName}", "Current: ${info.buddyName}"), color = Brand.accent, fontSize = 13.sp)
            friends.forEach { f ->
                Card(onClick = {
                    scope.launch { store.setSafety(f.username, null, null); info = info.copy(buddy = f.username, buddyName = f.name ?: f.username) }
                }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AvatarDot("", f.name ?: f.username)
                        Spacer(Modifier.width(10.dp))
                        Text(f.name ?: f.username, color = Color.White, modifier = Modifier.weight(1f))
                        if (info.buddy == f.username) Icon(Icons.Filled.CheckCircle, null, tint = Brand.accent)
                    }
                }
            }
        }
    }
}

// ---------------- ROZETLER ----------------
@Composable
private fun BadgesView(store: Store, onBack: () -> Unit) {
    var badges by remember { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(Unit) { badges = store.badges() }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Rozetler", "Badges"), onBack)
        if (badges.isEmpty()) Text(L("Henüz rozet yok — sürmeye devam et!", "No badges yet — keep riding!"),
            color = sub, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
        LazyColumn(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(badges) { b ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.MilitaryTech, null, tint = gold, modifier = Modifier.size(30.dp))
                        Spacer(Modifier.width(12.dp))
                        Text(badgeName(b), color = Color.White, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

private fun badgeName(b: String): String = when (b) {
    "first_ride" -> L("İlk sürüş", "First ride")
    "night_owl" -> L("Gece kuşu", "Night owl")
    "century" -> L("100 km kulübü", "Century club")
    "explorer" -> L("Kaşif", "Explorer")
    "streak" -> L("Seri", "Streak")
    else -> b.replace("_", " ").replaceFirstChar { it.uppercase() }
}

// ---------------- YIL ÖZETİ ----------------
@Composable
private fun WrappedView(store: Store, onBack: () -> Unit) {
    var w by remember { mutableStateOf<WrappedStats?>(null) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { w = store.wrapped(); loaded = true }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Yıl Özeti", "Year Wrapped"), onBack)
        val s = w
        if (!loaded) { CircularProgressIndicator(color = Brand.accent, modifier = Modifier.padding(24.dp)); return@Column }
        if (s == null) { Text(L("Henüz yeterli sürüş yok.", "Not enough rides yet."), color = sub, modifier = Modifier.padding(16.dp)); return@Column }
        Column(Modifier.padding(14.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("${s.year}", color = Brand.accent, fontSize = 40.sp, fontWeight = FontWeight.Bold)
            WrapStat(L("Toplam km", "Total km"), "%.0f".format(s.km))
            WrapStat(L("Sürüş sayısı", "Rides"), "${s.rides}")
            WrapStat(L("Saat", "Hours"), "%.0f".format(s.hours))
            WrapStat(L("En uzun rota", "Longest ride"), "${"%.0f".format(s.longestKm)} km")
            WrapStat(L("Gece sürüşleri", "Night rides"), "${s.nightRides}")
        }
    }
}

@Composable
private fun WrapStat(label: String, value: String) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, color = sub, modifier = Modifier.weight(1f))
            Text(value, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        }
    }
}

// ---------------- PAYLAŞILAN ROTALAR ----------------
@Composable
private fun SharedView(store: Store, onBack: () -> Unit) {
    var routes by remember { mutableStateOf<List<SharedRoute>>(emptyList()) }
    LaunchedEffect(Unit) { routes = store.sharedRoutes() }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Paylaşılan Rotalar", "Shared Routes"), onBack)
        if (routes.isEmpty()) Text(L("Gelen rota yok.", "No shared routes."), color = sub, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
        LazyColumn(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(routes) { r ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Route, null, tint = Brand.accent)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(L("${r.fromName}'den rota", "Route from ${r.fromName}"), color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text((r.km?.let { "%.1f km".format(it) } ?: "") + (r.date?.let { " · $it" } ?: ""), color = sub, fontSize = 12.sp)
                        }
                        if (r.ridden) Icon(Icons.Filled.CheckCircle, null, tint = Color(0xFF34C759))
                    }
                }
            }
        }
    }
}

// 16.09: CANLI TAKİP (arkadaşı canlı izleme) KALDIRILDI — Barış: harita/canlı takip her iki
// platformdan da çıkıyor. Bu görünüm zaten hiçbir yerden çağrılmıyordu (ölü kod).

// ---------------- TELSİZ (PTT) — kaydet ve kulübe gönder ----------------
@Composable
private fun PttBar(store: Store, clubId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var recording by remember { mutableStateOf(false) }
    var recorder by remember { mutableStateOf<android.media.MediaRecorder?>(null) }
    var status by remember { mutableStateOf("") }
    val file = remember { java.io.File(ctx.cacheDir, "ptt_$clubId.m4a") }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun hasMic() = androidx.core.content.ContextCompat.checkSelfPermission(
        ctx, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(L("Telsiz", "Radio"), color = Color.White, fontWeight = FontWeight.SemiBold)
                Text(
                    if (recording) L("Kaydediliyor… bitir ve gönder", "Recording… tap to send")
                    else L("Bas konuş — kulübe sesli mesaj", "Push to talk — voice to the club"),
                    color = sub, fontSize = 12.sp
                )
            }
            IconButton(onClick = {
                if (!hasMic()) { permLauncher.launch(android.Manifest.permission.RECORD_AUDIO); return@IconButton }
                if (!recording) {
                    try {
                        @Suppress("DEPRECATION") val r = android.media.MediaRecorder()
                        r.setAudioSource(android.media.MediaRecorder.AudioSource.MIC)
                        r.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4)
                        r.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC)
                        r.setOutputFile(file.absolutePath)
                        r.prepare(); r.start(); recorder = r; recording = true; status = ""
                    } catch (e: Exception) { status = L("Mikrofon hatası", "Mic error") }
                } else {
                    try { recorder?.stop() } catch (e: Exception) {}
                    recorder?.release(); recorder = null; recording = false
                    scope.launch {
                        val bytes = try { file.readBytes() } catch (e: Exception) { ByteArray(0) }
                        status = if (bytes.size > 500 && store.pttSend(clubId, bytes))
                            L("Gönderildi ✓", "Sent ✓") else L("Gönderilemedi", "Failed")
                    }
                }
            }) {
                Icon(if (recording) Icons.Filled.Stop else Icons.Filled.Mic, null,
                    tint = if (recording) Color(0xFFFF3B30) else Brand.accent, modifier = Modifier.size(34.dp))
            }
        }
        if (status.isNotEmpty()) Text(status, color = sub, fontSize = 12.sp)
    }
}

// ---------------- KULLANICI ADI (@handle) ----------------
@Composable
private fun UsernameView(store: Store, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var handle by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Kullanıcı Adı", "Username"), onBack)
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(L("Benzersiz @kullanıcı adın — arkadaşların seni bununla bulur.",
                   "Your unique @username — friends find you with it."), color = sub, fontSize = 13.sp)
            OutlinedTextField(value = handle, onValueChange = { handle = it.lowercase().filter { c -> c.isLetterOrDigit() || c == '_' || c == '.' } },
                singleLine = true, label = { Text(L("@kullanıcı adı", "@username")) }, modifier = Modifier.fillMaxWidth())
            Button(onClick = {
                scope.launch {
                    busy = true
                    val err = store.setHandle(handle.trim())
                    busy = false
                    msg = when (err) {
                        null -> L("Kaydedildi ✓", "Saved ✓")
                        "taken" -> L("Bu ad alınmış — başka dene", "That's taken — try another")
                        "invalid" -> L("Geçersiz (3–20: harf, rakam, _ .)", "Invalid (3–20: letters, digits, _ .)")
                        else -> L("Bağlantı hatası", "Connection error")
                    }
                }
            }, enabled = !busy && handle.length >= 3, colors = ButtonDefaults.buttonColors(containerColor = Brand.accent),
                modifier = Modifier.fillMaxWidth()) { Text(L("Kaydet", "Save")) }
            if (msg.isNotEmpty()) Text(msg, color = if (msg.contains("✓")) Color(0xFF34C759) else gold)
        }
    }
}

// ---------------- FİKİR KUTUSU ----------------
@Composable
private fun IdeaBoxView(store: Store, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var sent by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Fikir Kutusu", "Idea Box"), onBack)
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (sent) {
                Icon(Icons.Filled.CheckCircle, null, tint = Color(0xFF34C759), modifier = Modifier.size(48.dp))
                Text(L("Fikrin bana ulaştı — teşekkürler!", "Got your idea — thank you!"), color = Color.White, fontWeight = FontWeight.Bold)
                Text(L("Mantıklıysa bir sonraki güncellemede görebilirsin.", "If it makes sense, you might see it in the next update."), color = sub, fontSize = 13.sp)
            } else {
                Text(L("Aklındaki özelliği, öneriyi ya da derdini yaz — doğrudan geliştiriciye ulaşır. Samimi ol, biz de öyleyiz. 🏍️",
                       "Write the feature, suggestion or gripe on your mind — it goes straight to the developer. Be real, we are too. 🏍️"),
                    color = sub, fontSize = 13.sp)
                OutlinedTextField(value = text, onValueChange = { text = it }, modifier = Modifier.fillMaxWidth().height(160.dp),
                    label = { Text(L("Fikrini söyle", "Share your idea")) })
                Button(onClick = { scope.launch { if (store.sendFeedback(text.trim())) sent = true } },
                    enabled = text.trim().length >= 3, colors = ButtonDefaults.buttonColors(containerColor = Brand.accent),
                    modifier = Modifier.fillMaxWidth()) { Text(L("Gönder", "Send")) }
            }
        }
    }
}

// ---------------- GRUP VİDEOSU TERCİHİ ----------------
@Composable
private fun GroupVideoView(store: Store, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var pref by remember { mutableStateOf("both") }
    LaunchedEffect(Unit) { pref = store.groupVideoPref() }
    val opts = listOf(
        "both" to L("Ortak + kendi videom", "Shared + my own"),
        "group" to L("Sadece ortak video", "Shared only"),
        "solo" to L("Sadece kendi videom", "My own only"))
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Grup Videosu", "Group Video"), onBack)
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(L("Bir arkadaşınla sürünce hangi videolar üretilsin?", "When you ride with a friend, which videos are made?"),
                color = sub, fontSize = 13.sp)
            opts.forEach { (key, label) ->
                Card(onClick = { pref = key; scope.launch { store.setGroupVideoPref(key) } }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = pref == key, onClick = { pref = key; scope.launch { store.setGroupVideoPref(key) } })
                        Text(label, color = Color.White)
                    }
                }
            }
        }
    }
}

// ---------------- KONVOY SESLİ ANONSLARI (TTS) ----------------
@Composable
private fun ConvoyVoiceView(store: Store, onBack: () -> Unit) {
    val ctx = LocalContext.current
    var enabled by remember { mutableStateOf(false) }
    var clubs by remember { mutableStateOf<List<Club>>(emptyList()) }
    var status by remember { mutableStateOf("") }
    var ready by remember { mutableStateOf(false) }
    val tts = remember {
        android.speech.tts.TextToSpeech(ctx.applicationContext) { }.also { }
    }
    DisposableEffect(Unit) { onDispose { tts.stop(); tts.shutdown() } }
    LaunchedEffect(Unit) {
        val isTr = java.util.Locale.getDefault().language == "tr"
        tts.language = if (isTr) java.util.Locale("tr", "TR") else java.util.Locale.US
        ready = true
        clubs = store.clubs()
    }
    val fused = remember { com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(ctx) }
    val spokenAt = remember { mutableMapOf<String, Long>() }
    LaunchedEffect(enabled, clubs) {
        val cid = clubs.firstOrNull()?.id ?: return@LaunchedEffect
        while (enabled) {
            val riders = store.liveClub(cid)
            val me = try {
                kotlinx.coroutines.suspendCancellableCoroutine<android.location.Location?> { c ->
                    try { fused.lastLocation.addOnSuccessListener { c.resume(it) {} }.addOnFailureListener { c.resume(null) {} } }
                    catch (e: SecurityException) { c.resume(null) {} }
                }
            } catch (e: Exception) { null }
            if (me != null) {
                for (r in riders) {
                    val out = FloatArray(1)
                    android.location.Location.distanceBetween(me.latitude, me.longitude, r.lat, r.lon, out)
                    val meters = out[0].toInt()
                    val now = System.currentTimeMillis()
                    if ((spokenAt[r.user] ?: 0) + 90_000 < now) {
                        spokenAt[r.user] = now
                        val txt = if (java.util.Locale.getDefault().language == "tr")
                            "${r.name} ${if (meters >= 1000) "%.1f kilometre".format(meters / 1000.0) else "$meters metre"} uzakta"
                        else "${r.name} is ${if (meters >= 1000) "%.1f kilometers".format(meters / 1000.0) else "$meters meters"} away"
                        tts.speak(txt, android.speech.tts.TextToSpeech.QUEUE_ADD, null, r.user)
                    }
                }
                status = L("${riders.size} sürücü dinleniyor…", "Tracking ${riders.size} riders…")
            }
            delay(25_000)
        }
    }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Konvoy Sesi", "Convoy Voice"), onBack)
        if (!store.ultra) Text(L("Bu özellik Ultra üyeliği gerektirir.", "This feature requires Ultra."),
            color = gold, fontSize = 14.sp, modifier = Modifier.padding(16.dp))
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(L("Sürüş sırasında kulüp arkadaşlarının ne kadar geride/ileride olduğu kulaklığına sesli söylenir. Eller gidonda, gözler yolda.",
                   "During a ride, how far your clubmates are is spoken to your headset. Hands on the bars, eyes on the road."),
                color = sub, fontSize = 13.sp)
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.VolumeUp, null, tint = Brand.accent, modifier = Modifier.size(28.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(L("Sesli anonslar", "Voice announcements"), color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Switch(checked = enabled, enabled = ready && store.ultra, onCheckedChange = { enabled = it })
                }
            }
            if (status.isNotEmpty()) Text(status, color = sub, fontSize = 13.sp)
        }
    }
}

// ---------------- CANLI İNTERKOM (LiveKit sesli oda) ----------------
// ==================== ÇİFT CANLI TELSİZ (2 kişilik, 2026-07-19) ====================
// 📻 davet -> karşı taraf kabul -> LiveKit odası. Oda çiftten türetilir, token sadece o ikiliye = max 2.
@Composable
private fun PairTalkView(store: Store, peer: String, peerName: String, inviting: Boolean, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf(if (inviting) "inviting" else "connecting") }
    var peerIn by remember { mutableStateOf(false) }
    var muted by remember { mutableStateOf(false) }
    val room = remember { io.livekit.android.LiveKit.create(ctx.applicationContext) }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun hasMic() = androidx.core.content.ContextCompat.checkSelfPermission(
        ctx, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
    DisposableEffect(peer) { onDispose { try { room.disconnect() } catch (e: Exception) {} } }
    LaunchedEffect(peer) {
        if (!hasMic()) permLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
        var tr = 0; while (!hasMic() && tr < 30) { delay(500); tr++ }
        if (!hasMic()) { state = "denied"; return@LaunchedEffect }
        if (inviting) {
            store.vcInvite(peer)
            var tries = 0
            while (tries < 45) {           // 90 sn kabul bekle
                delay(2000)
                if (store.vcStatus()[2] == peer) break
                tries++
            }
            if (tries >= 45) { state = "timeout"; return@LaunchedEffect }
        }
        state = "connecting"
        val tok = store.vcToken(peer) ?: run { state = "error"; return@LaunchedEffect }
        try {
            room.connect(tok.first, tok.second)
            room.localParticipant.setMicrophoneEnabled(true)
            state = "connected"
            while (true) { peerIn = room.remoteParticipants.isNotEmpty(); delay(1500) }
        } catch (e: Exception) { state = "error" }
    }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("$peerName — Canlı Telsiz", "$peerName — Live Radio"), onBack)
        Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center) {
            when (state) {
                "inviting" -> { CircularProgressIndicator(color = Brand.accent); Spacer(Modifier.height(14.dp))
                    Text(L("Davet gönderildi — kabul bekleniyor…", "Invite sent — waiting for accept…"), color = sub) }
                "connecting" -> { CircularProgressIndicator(color = Brand.accent); Spacer(Modifier.height(14.dp))
                    Text(L("Bağlanıyor…", "Connecting…"), color = sub) }
                "connected" -> {
                    Box(Modifier.size(120.dp).background(Brand.accent.copy(alpha = 0.2f), CircleShape),
                        contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Call, null, tint = if (peerIn) Color(0xFF34C759) else Brand.accent,
                            modifier = Modifier.size(52.dp))
                    }
                    Spacer(Modifier.height(18.dp))
                    Text(if (peerIn) L("Canlı — bağlı 📻", "Live — connected 📻")
                         else L("Bağlandın — arkadaşın bekleniyor…", "Connected — waiting for friend…"),
                        color = Color.White, fontWeight = FontWeight.Bold)
                    Text(L("2 kişilik canlı telsiz — kalabalık için kulüp interkomu", "2-person radio — use club intercom for groups"),
                        color = sub, fontSize = 12.sp, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(22.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        Button(onClick = {
                            muted = !muted
                            scope.launch { try { room.localParticipant.setMicrophoneEnabled(!muted) } catch (e: Exception) {} }
                        }) { Text(if (muted) L("Aç", "Unmute") else L("Sustur", "Mute")) }
                        Button(onClick = onBack, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF3B30))) {
                            Text(L("Bitir", "End"))
                        }
                    }
                }
                "denied" -> Text(L("Mikrofon izni gerekli.", "Microphone permission required."), color = gold)
                "timeout" -> Text(L("Davet kabul edilmedi.", "Invite not accepted."), color = gold)
                else -> Text(L("Bağlanılamadı.", "Couldn't connect."), color = gold)
            }
        }
    }
}

@Composable
private fun IntercomView(store: Store, clubId: String, clubName: String, onBack: () -> Unit) {
    val ctx = LocalContext.current
    var state by remember { mutableStateOf("connecting") }   // connecting|connected|error|denied
    var count by remember { mutableStateOf(0) }
    val room = remember { io.livekit.android.LiveKit.create(ctx.applicationContext) }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun hasMic() = androidx.core.content.ContextCompat.checkSelfPermission(
        ctx, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED

    DisposableEffect(clubId) { onDispose { try { room.disconnect() } catch (e: Exception) {} } }
    LaunchedEffect(clubId) {
        if (!hasMic()) permLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
        var tries = 0
        while (!hasMic() && tries < 30) { delay(500); tries++ }
        if (!hasMic()) { state = "denied"; return@LaunchedEffect }
        val tok = store.intercomToken(clubId) ?: run { state = "error"; return@LaunchedEffect }
        try {
            room.connect(tok.first, tok.second)
            room.localParticipant.setMicrophoneEnabled(true)
            state = "connected"
            while (true) { count = room.remoteParticipants.size; delay(2000) }
        } catch (e: Exception) { state = "error" }
    }

    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("$clubName — İnterkom", "$clubName — Intercom"), onBack)
        Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center) {
            when (state) {
                "connecting" -> {
                    CircularProgressIndicator(color = Brand.accent)
                    Spacer(Modifier.height(16.dp)); Text(L("Bağlanıyor…", "Connecting…"), color = sub)
                }
                "connected" -> {
                    Box(Modifier.size(120.dp).background(Brand.accent.copy(alpha = 0.2f), CircleShape),
                        contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Mic, null, tint = Brand.accent, modifier = Modifier.size(56.dp))
                    }
                    Spacer(Modifier.height(20.dp))
                    Text(L("Bağlısın — konuşabilirsin", "You're live — start talking"),
                        color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text(L("Odada $count kişi daha", "$count others in the room"), color = sub)
                    Spacer(Modifier.height(24.dp))
                    Button(onClick = onBack, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF3B30))) {
                        Text(L("Ayrıl", "Leave"))
                    }
                }
                "denied" -> Text(L("Mikrofon izni gerekli.", "Microphone permission required."),
                    color = gold, textAlign = TextAlign.Center)
                else -> Text(L("Bağlanılamadı. Tekrar dene.", "Couldn't connect. Try again."),
                    color = gold, textAlign = TextAlign.Center)
            }
        }
    }
}
