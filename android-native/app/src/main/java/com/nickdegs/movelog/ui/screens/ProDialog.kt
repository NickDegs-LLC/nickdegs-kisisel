package com.nickdegs.movelog.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nickdegs.movelog.data.ProSatis
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand

// 05.11.2026 — Move Log Pro penceresi (iOS ProSheet karşılığı). Billing bağlantısı yalnız açıkken yaşar.
@Composable
fun ProDialog(store: Store, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val satis = remember { ProSatis(ctx, store) }
    DisposableEffect(Unit) { onDispose { satis.kapat() } }
    val sub = Color(0xFF9AA4B2)
    @Composable fun Ozellik(ikon: ImageVector, metin: String) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(ikon, null, tint = Brand.accent, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text(metin, color = Color.White, fontSize = 14.sp)
        }
    }
    AlertDialog(onDismissRequest = onClose,
        title = {
            Column {
                Text("🏍️🏍️ Move Log Pro", fontWeight = FontWeight.Bold)
                Text(L("Tek seferlik · abonelik yok", "One-time · no subscription"), color = Brand.accent, fontSize = 13.sp)
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Ozellik(Icons.Filled.Group, L("Arkadaşlarınla ortak 3D sürüş videoları", "Joint 3D ride videos with your friends"))
                Ozellik(Icons.Filled.Groups, L("Kulüp üyeleriyle grup videoları", "Group videos with your club members"))
                Ozellik(Icons.Filled.PhoneAndroid, L("Hepsi telefonunda üretilir, bulut yok", "All made on your phone, no cloud"))
                Ozellik(Icons.Filled.AllInclusive, L("Bir kez al, hep senin", "Buy once, yours forever"))
                Text(L("Rota kaydı, kendi videoların, özetler ve paylaşım kartları herkese ücretsiz kalır.",
                       "Ride tracking, your own videos, summaries and share cards stay free for everyone."), color = sub, fontSize = 12.sp)
                when {
                    store.pro -> Text(L("Pro aktif — teşekkürler! 🧡", "Pro is active — thank you! 🧡"), color = Brand.accent, fontWeight = FontWeight.SemiBold)
                    satis.yukleniyor -> CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
                    satis.urun == null -> Text(L("Şu an mağazaya ulaşılamıyor, biraz sonra tekrar dene.",
                        "Can't reach the store right now, try again later."), fontSize = 13.sp)
                    else -> Button(onClick = { (ctx as? android.app.Activity)?.let { satis.al(it) } },
                        colors = ButtonDefaults.buttonColors(containerColor = Brand.accent), modifier = Modifier.fillMaxWidth()) {
                        Text(L("Pro'yu al", "Get Pro") + " · " + (satis.urun?.oneTimePurchaseOfferDetails?.formattedPrice ?: ""))
                    }
                }
                if (satis.bekliyor) Text(L("Onay bekleniyor.", "Waiting for approval."), fontSize = 12.sp)
                when (satis.hata) {
                    null -> {}
                    "yok" -> Text(L("Bu Google hesabında Pro satın alımı bulunamadı.", "No Pro purchase found on this Google account."), color = Color(0xFFFF6B6B), fontSize = 12.sp)
                    "sunucu" -> Text(L("Satın alma alındı ama sunucuya ulaşılamadı; uygulama yeniden açılınca otomatik tamamlanır.",
                        "Purchase received but the server couldn't be reached; it completes automatically next time you open the app."), color = Color(0xFFFF6B6B), fontSize = 12.sp)
                    else -> Text(L("Satın alma tamamlanamadı.", "The purchase couldn't be completed."), color = Color(0xFFFF6B6B), fontSize = 12.sp)
                }
                // 05.11.2026 (mağaza incelemesi): satın alma ekranında Gizlilik + Kullanım Şartları bağlantıları
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    fun ac(u: String) = ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(u)))
                    TextButton(onClick = { ac("https://realvirtuality.app/movelog/privacy.html") }) {
                        Text(L("Gizlilik Politikası", "Privacy Policy"), fontSize = 12.sp, color = Brand.accent) }
                    TextButton(onClick = { ac("https://realvirtuality.app/movelog/terms.html") }) {
                        Text(L("Kullanım Şartları", "Terms of Use"), fontSize = 12.sp, color = Brand.accent) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(L("Kapat", "Close")) } },
        dismissButton = { if (!store.pro) TextButton(onClick = { satis.geriYukle() }) { Text(L("Satın alımları geri yükle", "Restore purchases")) } })
}
