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
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand

/** Play'den fiyat gelmezse gösterilen yedek metin (düğme o durumda pasif). */
const val TAM_SURUM_YEDEK_FIYAT = "\$4.99"

/** Banner / profil satırı için fiyat: Play'in biçimlendirdiği fiyat, yoksa yedek metin. */
fun tamSurumFiyat(store: Store): String =
    store.tamSurum.urun?.oneTimePurchaseOfferDetails?.formattedPrice ?: TAM_SURUM_YEDEK_FIYAT

private fun android.content.Context.aktivite(): android.app.Activity? {
    var c: android.content.Context? = this
    while (c is android.content.ContextWrapper) {
        if (c is android.app.Activity) return c
        c = c.baseContext
    }
    return null
}

// 10.11.2026 — Move Log Tam Sürüm penceresi (eski bahşiş / Pro pencereleriyle aynı görünüm).
// Billing bağlantısı Store.tamSurum'da yaşar (uygulama boyunca); pencere yalnız fiyatı/sahipliği tazeler.
@Composable
fun TamSurumDialog(store: Store, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val ts = store.tamSurum
    LaunchedEffect(Unit) { ts.hata = null; ts.urunYukle() }
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
                Text(L("Move Log Tam Sürüm", "Move Log Full Version"), fontWeight = FontWeight.Bold)
                Text(L("Tek seferlik · abonelik yok", "One-time · no subscription"), color = Brand.accent, fontSize = 13.sp)
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Ozellik(Icons.Filled.Route, L("Sınırsız sürüş ve rota videosu", "Unlimited rides & route videos"))
                Ozellik(Icons.Filled.Groups, L("Arkadaşlar ve kulüplerle ortak sürüş videoları", "Joint ride videos with friends and clubs"))
                Ozellik(Icons.Filled.PhoneAndroid, L("Hepsi telefonunda üretilir, bulut yok", "All made on your phone, no cloud"))
                Ozellik(Icons.Filled.AllInclusive, L("Bir kez al, hep senin", "Buy once, yours forever"))
                when {
                    ts.sahip -> Text(L("Tam sürüm aktif — teşekkürler! 🧡", "Full version is active — thank you! 🧡"),
                        color = Brand.accent, fontWeight = FontWeight.SemiBold)
                    store.tamErisim -> Text(L("Erken üyesin — her şey senin için ücretsiz kalıyor 🧡",
                        "You're an early member — everything stays free for you 🧡"),
                        color = Brand.accent, fontWeight = FontWeight.SemiBold)
                    ts.urun == null && ts.yukleniyor -> CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
                    ts.urun == null -> {
                        Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) {
                            Text(L("Tam sürümü aç", "Unlock full version") + " · " + TAM_SURUM_YEDEK_FIYAT)
                        }
                        Text(L("Şu an mağazaya ulaşılamıyor, biraz sonra tekrar dene.",
                            "Can't reach the store right now, try again later."), color = sub, fontSize = 12.sp)
                    }
                    else -> Button(onClick = { ctx.aktivite()?.let { ts.al(it) } },
                        colors = ButtonDefaults.buttonColors(containerColor = Brand.accent), modifier = Modifier.fillMaxWidth()) {
                        Text(L("Tam sürümü aç", "Unlock full version") + " · " + tamSurumFiyat(store))
                    }
                }
                if (ts.bekliyor && !ts.sahip) Text(L("Onay bekleniyor.", "Waiting for approval."), fontSize = 12.sp)
                when (ts.hata) {
                    null -> {}
                    "yok" -> Text(L("Bu Google hesabında satın alım bulunamadı.", "No purchase found on this Google account."),
                        color = Color(0xFFFF6B6B), fontSize = 12.sp)
                    else -> Text(L("Satın alma tamamlanamadı.", "The purchase couldn't be completed."),
                        color = Color(0xFFFF6B6B), fontSize = 12.sp)
                }
                // Mağaza incelemesi: satın alma ekranında Gizlilik + Kullanım Şartları bağlantıları
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    fun ac(u: String) {
                        runCatching {
                            ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(u)))
                        }
                    }
                    TextButton(onClick = { ac("https://realvirtuality.app/movelog/privacy.html") }) {
                        Text(L("Gizlilik Politikası", "Privacy Policy"), fontSize = 12.sp, color = Brand.accent) }
                    TextButton(onClick = { ac("https://realvirtuality.app/movelog/terms.html") }) {
                        Text(L("Kullanım Şartları", "Terms of Use"), fontSize = 12.sp, color = Brand.accent) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(L("Kapat", "Close")) } },
        dismissButton = {
            if (!ts.sahip) TextButton(onClick = { ts.yenile(elle = true) }) {
                Text(L("Satın alımları geri yükle", "Restore purchases"))
            }
        })
}
