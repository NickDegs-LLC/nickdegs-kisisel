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

// ARKADAŞLAR — 18.09: sohbet/telsiz/kulüp/liderlik/rozet/yıl-özeti/güvenlik KALDIRILDI.
// Kalan tek sosyal amaç: arkadaş ekle -> İKİLİ SÜRÜŞ VİDEOSU çifti oluşsun (grupsurus cron'u
// çiftleri `friends` tablosundan kurar). Ek olarak @kullanıcı adı, grup video tercihi,
// paylaşılan rotalar ve fikir kutusu burada kalır.
private sealed class Route {
    object Hub : Route()
    object Friends : Route()
    object Username : Route()
    object IdeaBox : Route()
    object GroupVideo : Route()
    object Clubs : Route()                          // 05.11.2026: kulüpler geri geldi (ortak sürüş)
    data class ClubDetail(val id: String) : Route()
}

@Composable
fun CommunityScreen(store: Store) {
    var route by remember { mutableStateOf<Route>(Route.Hub) }
    when (val r = route) {
        is Route.Hub -> HubView(store) { route = it }
        is Route.Friends -> FriendsView(store) { route = Route.Hub }
        is Route.Username -> UsernameView(store) { route = Route.Hub }
        is Route.IdeaBox -> IdeaBoxView(store) { route = Route.Hub }
        is Route.GroupVideo -> GroupVideoView(store) { route = Route.Hub }
        is Route.Clubs -> ClubsView(store, onOpen = { route = Route.ClubDetail(it) }) { route = Route.Hub }
        is Route.ClubDetail -> ClubDetailView(store, r.id) { route = Route.Clubs }
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

private data class HubItem(val icon: ImageVector, val title: String, val desc: String, val route: Route)

@Composable
private fun HubView(store: Store, nav: (Route) -> Unit) {
    val hubItems = listOf(
        HubItem(Icons.Filled.Group, L("Arkadaşlar", "Friends"), L("Bul, ekle, istekleri yönet", "Find, add, manage requests"), Route.Friends),
        HubItem(Icons.Filled.Groups, L("Kulüpler", "Clubs"), L("Kulüp kur ya da davet koduyla katıl", "Create a club or join with an invite code"), Route.Clubs),
        HubItem(Icons.Filled.AlternateEmail, L("Kullanıcı Adı", "Username"), L("@adını belirle, seni bulsunlar", "Set your @handle so friends find you"), Route.Username),
        HubItem(Icons.Filled.Movie, L("Grup Videosu", "Group Video"), L("Ortak sürüş videosu tercihi", "Shared ride video preference"), Route.GroupVideo),
        HubItem(Icons.Filled.Lightbulb, L("Fikir Kutusu", "Idea Box"), L("Fikrin doğrudan geliştiriciye", "Your idea straight to the developer"), Route.IdeaBox),
    )
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Sosyal", "Social"), null)
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

// 16.09: CANLI TAKİP (arkadaşı canlı izleme) KALDIRILDI — Barış: harita/canlı takip her iki
// platformdan da çıkıyor. Bu görünüm zaten hiçbir yerden çağrılmıyordu (ölü kod).

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
    var showPro by remember { mutableStateOf(false) }
    if (showPro) ProDialog(store) { showPro = false }
    LaunchedEffect(Unit) { pref = store.groupVideoPref() }
    val opts = listOf(
        "both" to L("Ortak + kendi videom", "Shared + my own"),
        "group" to L("Sadece ortak video", "Shared only"),
        "solo" to L("Sadece kendi videom", "My own only"))
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(L("Grup Videosu", "Group Video"), onBack)
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(L("Arkadaşların ya da kulüp üyelerinle birlikte sürünce hepinizin yer aldığı ortak 3D video telefonunda üretilir. Yalnız tanıdıkların algılanır.",
                   "When you ride with friends or club members, a joint 3D video featuring all of you is made on your phone. Only people you know are detected."),
                color = sub, fontSize = 13.sp)
            Text(L("Bir arkadaşınla sürünce hangi videolar üretilsin?", "When you ride with a friend, which videos are made?"),
                color = sub, fontSize = 13.sp)
            // 05.11.2026: ortak videolar Move Log Pro ile (tek seferlik)
            if (!store.pro) Card(onClick = { showPro = true }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Lock, null, tint = Brand.accent)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(L("Ortak videolar Pro ile", "Joint videos with Pro"), color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text(L("Tek seferlik satın alma, abonelik yok", "One-time purchase, no subscription"), color = sub, fontSize = 12.sp)
                    }
                    Icon(Icons.Filled.ChevronRight, null, tint = sub)
                }
            }
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

// ---------------- KULÜPLER (05.11.2026 — e761d42^ birebir, telsiz/interkom çıkarıldı) ----------------
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
                            Text(L("{n} üye", "{n} members").replace("{n}", "${c.memberCount}"), color = sub, fontSize = 12.sp)
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
    val ctx = LocalContext.current
    var me by remember { mutableStateOf("") }
    var club by remember { mutableStateOf<Club?>(null) }
    LaunchedEffect(id) { club = store.clubDetail(id); me = store.me }
    Column(Modifier.fillMaxSize().background(Brand.bg)) {
        Bar(club?.name ?: L("Kulüp", "Club"), onBack)
        val c = club
        if (c == null) { CircularProgressIndicator(color = Brand.accent, modifier = Modifier.padding(24.dp)); return@Column }
        Column(Modifier.padding(14.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!c.code.isNullOrEmpty()) Card {
                Text(L("Davet kodu", "Invite code"), color = sub, fontSize = 12.sp)
                Text(c.code, color = Brand.accent, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            }
            // 05.11: paylaş + açıklama (telsiz/interkom YOK)
            Text(L("Bu kodu motorcu arkadaşlarına gönder — girip katılsınlar. Kulüptekiler birlikte sürünce ortak 3D video telefonunda üretilir.",
                   "Send this code to your rider friends — they enter it and join. When club members ride together, a joint 3D video is made on your phone."),
                color = sub, fontSize = 12.sp)
            if (!c.code.isNullOrEmpty()) OutlinedButton(onClick = {
                val t = L("Move Log'da motorcu kulübüme katıl", "Join my rider club on Move Log") + ": ${c.name} · " +
                        L("Kod", "Code") + ": ${c.code}"
                ctx.startActivity(android.content.Intent.createChooser(
                    android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(android.content.Intent.EXTRA_TEXT, t), null))
            }, modifier = Modifier.fillMaxWidth()) { Text(L("Kodu paylaş", "Share code"), color = Brand.accent) }
            Text(L("Üyeler", "Members"), color = Color.White, fontWeight = FontWeight.Bold)
            c.members?.forEach { m ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AvatarDot(m.avatarEmoji, m.name ?: m.username)
                        Spacer(Modifier.width(10.dp))
                        Text(m.name ?: m.username, color = Color.White, modifier = Modifier.weight(1f))
                        if (m.username == c.owner) Text(L("Kurucu", "Owner"), color = gold, fontSize = 12.sp)
                        else if (c.owner == me && me.isNotEmpty()) TextButton(onClick = {
                            scope.launch { store.kickClubMember(id, m.username); club = store.clubDetail(id) }
                        }) { Text(L("Çıkar", "Remove"), color = Color(0xFFFF453A), fontSize = 12.sp) }
                    }
                }
            }
            OutlinedButton(onClick = { scope.launch { store.leaveClub(id); onBack() } },
                modifier = Modifier.fillMaxWidth()) { Text(L("Kulüpten ayrıl", "Leave club"), color = Color(0xFFFF453A)) }
        }
    }
}

