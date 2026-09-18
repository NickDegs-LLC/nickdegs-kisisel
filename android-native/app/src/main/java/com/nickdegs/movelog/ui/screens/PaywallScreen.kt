package com.nickdegs.movelog.ui.screens

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.android.billingclient.api.ProductDetails
import kotlinx.coroutines.launch
import com.nickdegs.movelog.data.Billing
import com.nickdegs.movelog.data.Store
import com.nickdegs.movelog.ui.L
import com.nickdegs.movelog.ui.theme.Brand

@Composable
fun PaywallScreen(store: Store, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val activity = ctx as? Activity
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    // satın alma -> token'ı SUNUCUDA doğrula (client tek başına premium açamaz)
    // ack YALNIZ sunucu doğruladıysa atılır (Billing.handle) — doğrulanmazsa Play 3 günde iade eder
    val billing = remember {
        Billing(ctx, onPurchase = { token, bitti -> scope.launch { bitti(store.verifyGooglePurchase(token)) } })
    }
    var sel by remember { mutableStateOf(1) }   // 0=aylık, 1=yıllık (varsayılan)

    val benefits = listOf(
        L("3B flyover & sinematik videolar", "3D flyover & cinematic videos"),
        L("Filigtransız 1080p dışa aktarım", "1080p export, no watermark"),
        L("GPX/TCX dosyadan video", "Video from GPX/TCX file"),
        L("Müzik, kamera mesafesi, otonom süre", "Music, camera distance, auto length"),
        L("Anı fotoğrafları, POI mekan adları", "Memory photos, POI place names"),
    )

    Column(Modifier.fillMaxSize().background(Brand.bg).padding(20.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, null, tint = Color.White) }
        }
        Text(L("Move Log Premium", "Move Log Premium"), fontSize = 30.sp, fontWeight = FontWeight.Bold,
            color = Color.White, modifier = Modifier.padding(top = 4.dp))
        Text(L("Sürüşlerini sinematik videoya dönüştür", "Turn your rides into cinematic videos"),
            color = Color(0xFF9AA4B2), modifier = Modifier.padding(top = 4.dp, bottom = 18.dp))

        benefits.forEach { b ->
            Row(Modifier.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Check, null, tint = Brand.accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text(b, color = Color.White, fontSize = 15.sp)
            }
        }
        Spacer(Modifier.height(20.dp))

        PlanCard(L("Yıllık", "Yearly"), billing.priceOf(billing.yearly), L("En iyi değer", "Best value"),
            sel == 1) { sel = 1 }
        Spacer(Modifier.height(10.dp))
        PlanCard(L("Aylık", "Monthly"), billing.priceOf(billing.monthly), null, sel == 0) { sel = 0 }

        // 18.09: ULTRA yükseltme bloğu KALDIRILDI — tek abonelik katmanı var: Premium.

        Spacer(Modifier.weight(1f))
        Button(
            onClick = { activity?.let { billing.buy(it, if (sel == 1) billing.yearly else billing.monthly) } },
            enabled = billing.ready && (if (sel == 1) billing.yearly else billing.monthly) != null,
            colors = ButtonDefaults.buttonColors(containerColor = Brand.accent),
            modifier = Modifier.fillMaxWidth().height(52.dp)
        ) { Text(L("Premium'a geç", "Go Premium"), fontWeight = FontWeight.Bold, fontSize = 16.sp) }
        Text(L("Otomatik yenilenir, istediğin zaman iptal. Şartlar ve Gizlilik app.nickdegs.com.",
               "Auto-renews, cancel anytime. Terms & Privacy at app.nickdegs.com."),
            color = Color(0xFF6B7280), fontSize = 11.sp, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun PlanCard(title: String, price: String, badge: String?, selected: Boolean, onClick: () -> Unit) {
    Surface(
        color = if (selected) Brand.accent.copy(alpha = 0.15f) else Brand.card,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)
            .border(2.dp, if (selected) Brand.accent else Color.Transparent, RoundedCornerShape(18.dp))
    ) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    if (badge != null) {
                        Spacer(Modifier.width(8.dp))
                        Surface(color = Brand.accent, shape = RoundedCornerShape(8.dp)) {
                            Text(badge, color = Color.White, fontSize = 11.sp,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
                        }
                    }
                }
                Text(price.ifEmpty { "—" }, color = Color(0xFF9AA4B2), fontSize = 14.sp)
            }
            RadioButton(selected = selected, onClick = onClick,
                colors = RadioButtonDefaults.colors(selectedColor = Brand.accent))
        }
    }
}
