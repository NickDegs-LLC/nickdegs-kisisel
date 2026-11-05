package com.nickdegs.movelog.data

import android.app.Activity
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.android.billingclient.api.*

// 05.11.2026 — "Destek ol" bahşiş kavanozu (iOS Destek.swift karşılığı). Üç TÜKETİLEBİLİR ürün;
// HİÇBİR özellik açmaz, sunucuya bir şey yazılmaz. Satın alma gelince consume edilir (tekrar alınabilsin).
val DESTEK_SKULARI = listOf("destek_kucuk", "destek_orta", "destek_buyuk")

class Destek(context: Context) {
    var urunler by mutableStateOf<List<ProductDetails>>(emptyList())
    var hazir by mutableStateOf(false)
    var yukleniyor by mutableStateOf(true)
    var tesekkur by mutableStateOf(false)
    var bekliyor by mutableStateOf(false)
    var hata by mutableStateOf<String?>(null)

    private val dinleyici = PurchasesUpdatedListener { r, satinAlmalar ->
        when (r.responseCode) {
            BillingClient.BillingResponseCode.OK -> satinAlmalar?.forEach { isle(it, yeni = true) }
            BillingClient.BillingResponseCode.USER_CANCELED -> {}
            else -> hata = "x"
        }
    }
    private val client = BillingClient.newBuilder(context.applicationContext)
        .setListener(dinleyici)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    init { baglan() }

    private fun baglan() {
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(r: BillingResult) {
                if (r.responseCode == BillingClient.BillingResponseCode.OK) { hazir = true; urunleriGetir(); yarimKalanlar() }
                else yukleniyor = false
            }
            override fun onBillingServiceDisconnected() { hazir = false }
        })
    }

    private fun urunleriGetir() {
        val p = QueryProductDetailsParams.newBuilder().setProductList(DESTEK_SKULARI.map {
            QueryProductDetailsParams.Product.newBuilder().setProductId(it)
                .setProductType(BillingClient.ProductType.INAPP).build()
        }).build()
        // Billing 8: 2. parametre QueryProductDetailsResult — ürünler productDetailsList içinde
        client.queryProductDetailsAsync(p) { _, res ->
            urunler = res.productDetailsList.sortedBy { it.oneTimePurchaseOfferDetails?.priceAmountMicros ?: 0L }
            yukleniyor = false
        }
    }

    // Ağ kopması / bekleyen ödeme sonrası tamamlanmış ama tüketilmemiş satın almaları bitir
    private fun yarimKalanlar() {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP).build()) { _, list ->
            list.forEach { isle(it, yeni = false) }
        }
    }

    private fun isle(p: Purchase, yeni: Boolean) {
        if (p.products.none { it in DESTEK_SKULARI }) return
        when (p.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { _, _ -> }
                if (yeni) { bekliyor = false; tesekkur = true }
            }
            Purchase.PurchaseState.PENDING -> if (yeni) bekliyor = true
            else -> {}
        }
    }

    fun al(activity: Activity, u: ProductDetails) {
        hata = null; bekliyor = false
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(u).build()
        )).build()
        val r = client.launchBillingFlow(activity, params)
        if (r.responseCode != BillingClient.BillingResponseCode.OK) hata = "x"
    }

    fun kapat() { client.endConnection() }
}
