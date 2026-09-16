package com.nickdegs.movelog.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.clickable
import kotlinx.coroutines.launch
import com.nickdegs.movelog.data.Convo
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand

// SOHBET SEKMESİ (16.09 — Barış: "haritayı androidden de kaldır").
// ESKİDEN: MapChatScreen = [Harita | Sohbet] segmenti; harita paneli arkadaşların canlı konumunu
// osmdroid üzerinde marker'larla gösteriyordu. Harita KALDIRILDI, geriye sohbet kaldı.
// "Rota kaydını başlat" düğmesi harita panelinin içindeydi -> RoutesScreen'e taşındı (tek kayıt yolu oydu).
@Composable
fun ChatScreen(store: Store) {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        ChatPane(store)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatPane(store: Store) {
    var convos by remember { mutableStateOf<List<Convo>>(emptyList()) }
    var open by remember { mutableStateOf<Convo?>(null) }
    LaunchedEffect(Unit) { convos = store.conversations() }

    open?.let { c ->
        ChatThread(store, c) { open = null }
        return
    }

    if (convos.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(L("Henüz sohbet yok", "No chats yet"), color = Color(0xFF9AA4B2))
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(convos) { c ->
            Surface(color = Brand.card, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
                onClick = { open = c }) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(44.dp).background(Brand.gradient, CircleShape), contentAlignment = Alignment.Center) {
                        Text((c.name ?: c.username).take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(c.name ?: c.username, color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text(if (c.last.isNotBlank()) c.last else "@${c.username}",
                            color = Color(0xFF9AA4B2), fontSize = 12.sp, maxLines = 1)
                    }
                    if (c.unread > 0) Badge(containerColor = Brand.accent) { Text("${c.unread}") }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatThread(store: Store, convo: Convo, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var msgs by remember { mutableStateOf<List<com.nickdegs.movelog.data.Msg>>(emptyList()) }
    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()

    suspend fun refresh() { msgs = store.chatWith(convo.username).first }
    LaunchedEffect(convo.username) {
        refresh()
        while (true) { kotlinx.coroutines.delay(5000); refresh() }   // 5sn poll
    }
    LaunchedEffect(msgs.size) { if (msgs.isNotEmpty()) listState.animateScrollToItem(msgs.size - 1) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, L("Geri", "Back"), tint = Color.White) }
            Text(convo.name ?: convo.username, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
        }
        LazyColumn(Modifier.weight(1f), state = listState, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(msgs) { m ->
                val mine = m.frm == store.me
                Row(Modifier.fillMaxWidth(),
                    horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                    Surface(color = if (mine) Brand.accent else Brand.card,
                        shape = RoundedCornerShape(16.dp), modifier = Modifier.widthIn(max = 280.dp)) {
                        if (m.type == "voice" && m.media.isNotEmpty()) VoiceBubble(store, m.media)
                        else Text(m.text, color = Color.White, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(value = draft, onValueChange = { draft = it },
                placeholder = { Text(L("Mesaj…", "Message…"), color = Color(0xFF9AA4B2)) },
                modifier = Modifier.weight(1f), shape = RoundedCornerShape(24.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                    focusedBorderColor = Brand.accent, unfocusedBorderColor = Color(0xFF2A3340)))
            Spacer(Modifier.width(8.dp))
            IconButton(enabled = draft.isNotBlank() && !sending, onClick = {
                val t = draft.trim(); draft = ""; sending = true
                scope.launch { if (store.chatSend(convo.username, t)) refresh(); sending = false }
            }) { Icon(Icons.Filled.Send, L("Gönder", "Send"), tint = Brand.accent) }
        }
    }
}

// Sohbette SESLİ MESAJ baloncuğu: dokun -> klibi indir (pttGet) -> MediaPlayer ile çal
@androidx.compose.runtime.Composable
private fun VoiceBubble(store: com.nickdegs.movelog.data.Store, pid: String) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var playing by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    var player by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<android.media.MediaPlayer?>(null) }
    Row(
        Modifier.clickable {
            if (playing) {
                try { player?.stop(); player?.release() } catch (e: Exception) {}
                player = null; playing = false; return@clickable
            }
            scope.launch {
                val bytes = store.pttGet(pid) ?: return@launch
                try {
                    val f = java.io.File(ctx.cacheDir, "vm_$pid.m4a"); f.writeBytes(bytes)
                    val mp = android.media.MediaPlayer()
                    mp.setDataSource(f.absolutePath); mp.prepare()
                    mp.setOnCompletionListener { it.release(); player = null; playing = false }
                    mp.start(); player = mp; playing = true
                } catch (e: Exception) { playing = false }
            }
        }.padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(if (playing) Icons.Filled.Stop else Icons.Filled.PlayArrow, null, tint = Color.White)
        Spacer(Modifier.width(8.dp))
        Icon(Icons.Filled.GraphicEq, null, tint = Color.White)
        Spacer(Modifier.width(8.dp))
        Text(L("Sesli mesaj", "Voice message"), color = Color.White)
    }
}
