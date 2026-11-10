package com.nickdegs.movelog.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.screens.*
import com.nickdegs.movelog.ui.theme.Brand

private data class Tab(val title: String, val icon: ImageVector)

@Composable
fun MoveLogApp(store: Store) {
    val scope = rememberCoroutineScope()
    // AÇILIŞ KAPISI: yalnızca sunucu-doğrulanmış kimlikle aç. İnternetsiz/kopya token ile ÇALIŞMAZ.
    LaunchedEffect(Unit) { if (store.auth == com.nickdegs.movelog.data.AuthState.CHECKING) store.validate() }

    // Davet derin-linki: oturum yoksa sakla, varsa kabul et (pano okunmaz).
    LaunchedEffect(com.nickdegs.movelog.AppNav.davetKod, store.auth) {
        val kod = com.nickdegs.movelog.AppNav.davetKod ?: return@LaunchedEffect
        if (store.auth == com.nickdegs.movelog.data.AuthState.CHECKING) return@LaunchedEffect
        com.nickdegs.movelog.AppNav.davetKod = null
        if (store.auth == com.nickdegs.movelog.data.AuthState.VALID) {
            val ok = store.acceptInvite(kod)
            store.davetSonuc = if (ok) L("Arkadaş eklendi 🤝", "Friend added 🤝")
                               else L("Kod geçersiz veya süresi dolmuş.", "Invalid or expired code.")
            if (ok) store.davetYenile++
        } else {
            store.bekleyenDavetSakla(kod)
        }
    }
    LaunchedEffect(store.auth) {
        if (store.auth != com.nickdegs.movelog.data.AuthState.VALID) return@LaunchedEffect
        val p = store.bekleyenDavetAl()
        if (p.isEmpty()) return@LaunchedEffect
        val ok = store.acceptInvite(p)
        store.davetSonuc = if (ok) L("Arkadaş eklendi 🤝", "Friend added 🤝")
                           else L("Kod geçersiz veya süresi dolmuş.", "Invalid or expired code.")
        if (ok) store.davetYenile++
    }

    store.davetSonuc?.let { msg ->
        AlertDialog(
            onDismissRequest = { store.davetSonuc = null },
            title = { Text(L("Davet kodu", "Invite code")) },
            text = { Text(msg) },
            confirmButton = {
                TextButton(onClick = { store.davetSonuc = null }) { Text("OK") }
            }
        )
    }

    // Açılışta: canlı-takip beacon'ı + FCM push token kaydı (bildirimler için)
    LaunchedEffect(store.auth) {
        if (store.auth == com.nickdegs.movelog.data.AuthState.VALID) { store.sendBeacon(); store.registerFcm() }
    }
    // 17.09 ASIL FIKS (olculdu): uygulama CHECKING'de asili kalinca ON PLANA DONUS hicbir seyi
    // tetiklemiyordu. LaunchedEffect(Unit) yalniz BIR KEZ kosar; asagidaki ON_RESUME dinleyicisi ise
    // erken return'lerin ALTINDA kayitlaniyor, yani ancak auth==VALID iken. Arka plandaki konum
    // servisi calismaya devam ettigi icin kullanici "internet var ama uygulama acilmiyor" goruyor ve
    // uygulamayi komple kapatmadan kurtulamiyordu (16.09'da sahada olculdu). Artik kapida da dinliyoruz.
    val kapiOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    DisposableEffect(kapiOwner) {
        val kapiObs = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME &&
                store.auth != com.nickdegs.movelog.data.AuthState.VALID) {
                scope.launch { store.validate() }
            }
        }
        kapiOwner.lifecycle.addObserver(kapiObs)
        onDispose { kapiOwner.lifecycle.removeObserver(kapiObs) }
    }

    when (store.auth) {
        com.nickdegs.movelog.data.AuthState.CHECKING -> { GateScreen(true) { scope.launch { store.validate() } }; return }
        com.nickdegs.movelog.data.AuthState.NEED_LOGIN -> { LoginScreen(store); return }
        com.nickdegs.movelog.data.AuthState.OFFLINE -> {
            GateScreen(false) { scope.launch { store.validate() } }; return
        }
        com.nickdegs.movelog.data.AuthState.BLOCKED -> { SecurityBlockScreen(); return }
        else -> {}   // VALID -> devam
    }

    // Uygulama her öne geldiğinde (ON_RESUME): yeni videoları sessizce galeriye kaydet.
    // R2'de video 1 gün durur -> kullanıcı hangi sekmede olursa olsun bu pencere içinde galeriye iner.
    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    // 10.11.2026 (Barış): öne gelişte telefon kuyruğunu (yerelq) OTOMATİK üretme KALDIRILDI — ölçüm
    // (03–10.11): 257 tarif isteği, 0 yüklenen video; kullanıcı çıkınca üretim iptal oluyordu.
    // Video yalnız kullanıcı "Video oluştur"a basınca üretilir (GenerateSheet).
    DisposableEffect(lifecycleOwner) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                scope.launch { store.autoSaveNewVideos() }
            }
        }
        lifecycleOwner.lifecycle.addObserver(obs)
        onDispose { lifecycleOwner.lifecycle.removeObserver(obs) }
    }

    var sel by remember { mutableStateOf(0) }
    // Bildirim dokunma -> ilgili sekme (videos->Rotalar, friends/wave->Sosyal, profile->Profil)
    // 10.11.2026: "Videolarım" sekmesi KALDIRILDI (video sunucuda saklanmaz) -> indeksler 1 kaydı;
    // eski "videos" bildirimleri Rotalar'a düşer.
    // 18.09: Sohbet sekmesi KALDIRILDI (yazılı sohbet + telsiz tamamen çıktı), Topluluk sadeleşip
    // "Arkadaşlar" oldu -> sekme indeksleri 1 kaydı. 'chat'/'map'/'voice' route'ları artık
    // karşılıksız; sunucu eski sürümlere göndermeye devam edebilir, sessizce yok sayılır.
    LaunchedEffect(com.nickdegs.movelog.AppNav.route) {
        val r = com.nickdegs.movelog.AppNav.route ?: return@LaunchedEffect
        when (r.substringBefore(":")) {
            "videos" -> sel = 0
            "friends", "wave" -> sel = 2
            "profile" -> sel = 3
        }
        com.nickdegs.movelog.AppNav.route = null
    }
    val tabs = listOf(
        Tab(L("Rotalar", "Routes"), Icons.Filled.Map),
        Tab(L("Özet", "Summary"), Icons.Filled.Article),
        // 18.09: "Sohbet" sekmesi kaldırıldı; "Topluluk" -> "Arkadaşlar" (yalnız arkadaş ekleme +
        // ikili sürüş videosu tercihi kalıyor). "Friends" anahtarı Strings.kt'de ZATEN var -> 12 dil hazır.
        Tab(L("Sosyal", "Social"), Icons.Filled.Groups),   // 05.11: arkadaşlar + kulüpler + ortak sürüş
        Tab(L("Profil", "Profile"), Icons.Filled.Person),
    )

    Scaffold(
        containerColor = Brand.bg,
        bottomBar = {
            NavigationBar(containerColor = Brand.card) {
                tabs.forEachIndexed { i, t ->
                    NavigationBarItem(
                        selected = sel == i,
                        onClick = { sel = i },
                        icon = { Icon(t.icon, contentDescription = t.title) },
                        label = { Text(t.title) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Brand.accent,
                            selectedTextColor = Brand.accent,
                            indicatorColor = Brand.accent.copy(alpha = 0.15f),
                        )
                    )
                }
            }
        }
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (sel) {
                0 -> RoutesScreen(store)
                // 10.11.2026: VideosScreen artık erişilemez (dosya duruyor, geri dönüş için).
                1 -> SummariesScreen(store)
                2 -> CommunityScreen(store)
                else -> ProfileScreen(store)
            }
        }
    }
    // Telefonda video üretimi sürerken tam ekran ilerleme (ayrı pencere — motor WebView'ı örter).
    com.nickdegs.movelog.video.YerelVideoKatmani()
}

// Açılış kapısı ekranı: checking=doğrulanıyor (spinner); değilse İNTERNET GEREKLİ (yeniden dene).
@Composable
fun GateScreen(checking: Boolean, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Brand.bg).padding(28.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Move Log", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Brand.accent)
            if (checking) {
                CircularProgressIndicator(color = Brand.accent)
                Text(L("Kimlik doğrulanıyor…", "Verifying identity…"), color = Color_secondary)
            } else {
                Icon(Icons.Filled.WifiOff, null, tint = Color_secondary, modifier = Modifier.size(44.dp))
                Text(L("İnternet gerekli", "Internet required"), color = androidx.compose.ui.graphics.Color.White,
                    fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                Text(L("Bu uygulama çevrimdışı çalışmaz. Kimliğini doğrulamak için internet bağlantısı gerekir.",
                       "This app does not work offline. An internet connection is required to verify your identity."),
                    color = Color_secondary, fontSize = 13.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Button(onClick = onRetry, colors = ButtonDefaults.buttonColors(containerColor = Brand.accent)) {
                    Text(L("Yeniden dene", "Retry"))
                }
            }
        }
    }
}

// Güvenlik engeli: Play Integrity kurcalanmış/korsan kurulum tespit etti.
@Composable
fun SecurityBlockScreen() {
    Box(Modifier.fillMaxSize().background(Brand.bg).padding(28.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(Icons.Filled.GppBad, null, tint = androidx.compose.ui.graphics.Color(0xFFFF3B30), modifier = Modifier.size(56.dp))
            Text(L("Güvenlik doğrulaması başarısız", "Security check failed"),
                fontSize = 20.sp, fontWeight = FontWeight.Bold, color = androidx.compose.ui.graphics.Color.White)
            Text(L("Bu kurulum doğrulanamadı. Lütfen Move Log'u Google Play'den resmi olarak indir.",
                   "This installation couldn't be verified. Please install Move Log from Google Play."),
                color = Color_secondary, fontSize = 13.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

private val Color_secondary = androidx.compose.ui.graphics.Color(0xFF9AA4B2)
