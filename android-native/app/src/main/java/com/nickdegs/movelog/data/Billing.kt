package com.nickdegs.movelog.data

import android.app.Activity
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.android.billingclient.api.*
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

// Google Play Billing — "premium" aboneliği (monthly/yearly) + "boost" consumable. iOS StoreKit karşılığı.
const val BOOST_SKU = "boost_daily2x"

class Billing(
    context: Context,
    private val onPurchase: (purchaseToken: String) -> Unit,
    private val onBoost: (purchaseToken: String) -> Unit = {},
) {
    var monthly by mutableStateOf<Pair<ProductDetails, String>?>(null)   // (ürün, offerToken)
    var yearly by mutableStateOf<Pair<ProductDetails, String>?>(null)
    var ultraMonthly by mutableStateOf<Pair<ProductDetails, String>?>(null)   // ULTRA: Google 3D + kameralar + Street View
    var ultraYearly by mutableStateOf<Pair<ProductDetails, String>?>(null)
    var boost by mutableStateOf<ProductDetails?>(null)                   // consumable; Play'de yoksa null kalır (buton gizli)
    var ready by mutableStateOf(false)

    private val purchasesListener = PurchasesUpdatedListener { result, purchases ->
        if (result.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
            purchases.forEach { handle(it) }
        }
    }
    private val client = BillingClient.newBuilder(context)
        .setListener(purchasesListener)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    init { connect() }

    private fun connect() {
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(r: BillingResult) {
                if (r.responseCode == BillingClient.BillingResponseCode.OK) { ready = true; queryProducts(); restore() }
            }
            override fun onBillingServiceDisconnected() { ready = false }
        })
    }

    private fun queryProducts() {
        val params = QueryProductDetailsParams.newBuilder().setProductList(
            listOf(QueryProductDetailsParams.Product.newBuilder()
                .setProductId("premium").setProductType(BillingClient.ProductType.SUBS).build())
        ).build()
        // ⚠️ Billing 8.0.0: geri çağrının 2. parametresi List<ProductDetails> DEĞİL, QueryProductDetailsResult.
        // Ürünler res.productDetailsList içinde (7.x'ten yükseltirken kırılan tek yer).
        client.queryProductDetailsAsync(params) { _, res ->
            val p = res.productDetailsList.firstOrNull() ?: return@queryProductDetailsAsync
            p.subscriptionOfferDetails?.forEach { offer ->
                val period = offer.pricingPhases.pricingPhaseList.lastOrNull()?.billingPeriod ?: ""
                when {
                    period.contains("Y") || offer.basePlanId.contains("year") -> yearly = p to offer.offerToken
                    period.contains("M") || offer.basePlanId.contains("month") -> monthly = p to offer.offerToken
                }
            }
        }
        // ULTRA subscription (Play'de yoksa liste boş -> null kalır, buton gizli)
        val uparams = QueryProductDetailsParams.newBuilder().setProductList(
            listOf(QueryProductDetailsParams.Product.newBuilder()
                .setProductId("ultra").setProductType(BillingClient.ProductType.SUBS).build())
        ).build()
        client.queryProductDetailsAsync(uparams) { _, res ->
            val p = res.productDetailsList.firstOrNull() ?: return@queryProductDetailsAsync
            p.subscriptionOfferDetails?.forEach { offer ->
                val period = offer.pricingPhases.pricingPhaseList.lastOrNull()?.billingPeriod ?: ""
                when {
                    period.contains("Y") || offer.basePlanId.contains("year") -> ultraYearly = p to offer.offerToken
                    period.contains("M") || offer.basePlanId.contains("month") -> ultraMonthly = p to offer.offerToken
                }
            }
        }
        // Boost (consumable INAPP) — Play'de ürün yoksa liste boş döner, boost null kalır (buton gizli)
        val bparams = QueryProductDetailsParams.newBuilder().setProductList(
            listOf(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(BOOST_SKU).setProductType(BillingClient.ProductType.INAPP).build())
        ).build()
        client.queryProductDetailsAsync(bparams) { _, res -> boost = res.productDetailsList.firstOrNull() }
    }

    fun buyBoost(activity: Activity) {
        val product = boost ?: return
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(
            listOf(BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(product).build())
        ).build()
        client.launchBillingFlow(activity, params)
    }

    fun boostPrice(): String = boost?.oneTimePurchaseOfferDetails?.formattedPrice ?: ""

    fun buy(activity: Activity, sel: Pair<ProductDetails, String>?) {
        val (product, offerToken) = sel ?: return
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(
            listOf(BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(product).setOfferToken(offerToken).build())
        ).build()
        client.launchBillingFlow(activity, params)
    }

    private fun handle(p: Purchase) {
        if (p.purchaseState != Purchase.PurchaseState.PURCHASED) return
        if (BOOST_SKU in p.products) {
            // Consumable: SUNUCUDA doğrula -> o gün +1 kat, sonra consume (tekrar alınabilsin)
            onBoost(p.purchaseToken)
            client.consumeAsync(
                ConsumeParams.newBuilder().setPurchaseToken(p.purchaseToken).build()
            ) { _, _ -> }
            return
        }
        if (!p.isAcknowledged) {
            client.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()
            ) {}
        }
        onPurchase(p.purchaseToken)   // SUNUCUDA doğrula -> premium (client tek başına açamaz)
    }

    private fun restore() {
        client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()
        ) { _, purchases -> purchases.forEach { handle(it) } }
    }

    fun priceOf(sel: Pair<ProductDetails, String>?): String =
        sel?.first?.subscriptionOfferDetails?.firstOrNull { it.offerToken == sel.second }
            ?.pricingPhases?.pricingPhaseList?.lastOrNull()?.formattedPrice ?: ""
}
