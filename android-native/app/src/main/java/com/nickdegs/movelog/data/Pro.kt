package com.nickdegs.movelog.data

import android.app.Activity
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.android.billingclient.api.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

// 05.11.2026 MOVE LOG PRO (iOS Pro.swift karşılığı): TEK SEFERLİK "pro" ürünü, abonelik YOK.
// Akış: satın al → jeton sunucuya (/api/pro/google, Play API ile doğrulanır) → sunucu onaylarsa
// acknowledge (onaylanmazsa Play 3 gün sonra otomatik iade eder; bu yüzden SIRA önemli).
// Açılışta / "Geri yükle"de queryPurchases ile mevcut satın alma sunucuya yeniden bildirilir.
const val PRO_SKU = "pro"

class ProSatis(context: Context, private val store: Store) {
    var urun by mutableStateOf<ProductDetails?>(null)
    var yukleniyor by mutableStateOf(true)
    var bekliyor by mutableStateOf(false)
    var hata by mutableStateOf<String?>(null)
    private val scope = CoroutineScope(Dispatchers.Main)

    private val dinleyici = PurchasesUpdatedListener { r, list ->
        when (r.responseCode) {
            BillingClient.BillingResponseCode.OK -> list?.forEach { isle(it) }
            BillingClient.BillingResponseCode.USER_CANCELED -> {}
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> geriYukle()
            else -> hata = "x"
        }
    }
    private val client = BillingClient.newBuilder(context.applicationContext)
        .setListener(dinleyici)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    init {
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(r: BillingResult) {
                if (r.responseCode != BillingClient.BillingResponseCode.OK) { yukleniyor = false; return }
                val p = QueryProductDetailsParams.newBuilder().setProductList(listOf(
                    QueryProductDetailsParams.Product.newBuilder().setProductId(PRO_SKU)
                        .setProductType(BillingClient.ProductType.INAPP).build())).build()
                // Billing 8: 2. parametre QueryProductDetailsResult
                client.queryProductDetailsAsync(p) { _, res ->
                    urun = res.productDetailsList.firstOrNull(); yukleniyor = false
                }
                geriYukle(sessiz = true)
            }
            override fun onBillingServiceDisconnected() {}
        })
    }

    private fun isle(p: Purchase) {
        if (!p.products.contains(PRO_SKU)) {
            // kaldırılan bahşiş vb. tüketilebilir kalıntı: kuyrukta kalmasın
            if (p.purchaseState == Purchase.PurchaseState.PURCHASED)
                client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { _, _ -> }
            return
        }
        when (p.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> scope.launch {
                bekliyor = false
                if (store.proBildir(p.purchaseToken)) {
                    if (!p.isAcknowledged) client.acknowledgePurchase(
                        AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { _ -> }
                } else hata = "sunucu"
            }
            Purchase.PurchaseState.PENDING -> bekliyor = true
            else -> {}
        }
    }

    fun geriYukle(sessiz: Boolean = false) {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP).build()) { _, list ->
            val proVar = list.any { it.products.contains(PRO_SKU) && it.purchaseState == Purchase.PurchaseState.PURCHASED }
            list.forEach { isle(it) }
            if (!proVar && !sessiz) scope.launch { hata = "yok" }
        }
    }

    fun al(activity: Activity) {
        val u = urun ?: return
        hata = null
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(u).build())).build()
        val r = client.launchBillingFlow(activity, params)
        if (r.responseCode != BillingClient.BillingResponseCode.OK) hata = "x"
    }

    fun kapat() { client.endConnection() }
}
