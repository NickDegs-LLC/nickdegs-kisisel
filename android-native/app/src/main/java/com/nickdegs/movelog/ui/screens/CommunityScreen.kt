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
    object Leaderboard : Route()
    object Safety : Route()
    object Badges : Route()
    object Wrapped : Route()
    object Shared : Route()
    data class Live(val friend: String, val name: String) : Route()
}

@Composable
fun CommunityScreen(store: Store) {
    var route by remember { mutableStateOf<Route>(Route.Hub) }
    when (val r = route) {
        is Route.Hub -> HubView(store, ultra = store.ultra) { route = it }
        is Route.Friends -> FriendsView(store) { route = Route.Hub }
        is Route.Clubs -> ClubsView(store, onOpen = { route = Route.ClubDetail(it) }) { route = Route.Hub }
        is Route.ClubDetail -> ClubDetailView(store, r.id) { route = Route.Clubs }
        is Route.Leaderboard -> LeaderboardView(store) { route = Route.Hub }
        is Route.Safety -> SafetyView(store) { route = Route.Hub }
        is Route.Badges -> BadgesView(store) { route = Route.Hub }
        is Route.Wrapped -> WrappedView(store) { route = Route.Hub }
        is Route.Shared -> SharedView(store) { route = Route.Hub }
        is Route.Live -> LiveTrackView(store, r.friend, r.name) { route = Route.Hub }
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
                        if (f.online) Box(Modifier.size(9.dp).background(Color(0xFF34C759), CircleShape))
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
private fun ClubDetailView(store: Store, id: String, onBack: () -> Unit) {
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

// ---------------- CANLI TAKİP ----------------
@Composable
private fun LiveTrackView(store: Store, friend: String, name: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var tel by remember { mutableStateOf<LiveTelemetry?>(null) }
    LaunchedEffect(friend) {
        store.liveStart(friend)
        while (true) { tel = store.liveGet(friend); delay(5000) }
    }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("$name — Canlı", "$name — Live"), onBack)
        val t = tel
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (t == null) { CircularProgressIndicator(color = Brand.accent); return@Column }
            WrapStat(L("Hız", "Speed"), "${"%.0f".format(t.spd)} km/h")
            t.hr?.let { WrapStat(L("Nabız", "Heart rate"), "$it bpm") }
            WrapStat(L("Bugün", "Today"), "${"%.1f".format(t.todayKm)} km")
            t.batt?.let { WrapStat(L("Batarya", "Battery"), "%$it") }
            Button(onClick = { scope.launch { store.liveWave(friend) } },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.accent), modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.WavingHand, null); Spacer(Modifier.width(8.dp)); Text(L("El salla", "Wave"))
            }
        }
    }
}

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
