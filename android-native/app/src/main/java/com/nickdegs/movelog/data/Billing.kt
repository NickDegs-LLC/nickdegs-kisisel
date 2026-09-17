package com.nickdegs.movelog.data

import android.app.Activity
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.android.billingclient.api.*
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

// Google Play Billing — "premium" aboneliği (monthly/yearly) + tüketilebilirler. iOS StoreKit karşılığı.
const val BOOST_SKU = "boost_daily2x"
// Video/Sokak paketleri (1.61) — Play ürün adları Apple'ınkilerle eşlenik: …video.uclu → video_uclu
val VIDEO_SKULARI = listOf("video_uclu", "video_besli")
val SOKAK_SKULARI = listOf("sokak_tek", "sokak_uclu")
private val TUKETILEBILIR = listOf(BOOST_SKU) + VIDEO_SKULARI + SOKAK_SKULARI

class Billing(
    context: Context,
    // Abonelik: sunucu doğrulaması BİTENE kadar acknowledge EDİLMEZ. bitti(true) gelirse ack atılır;
    // gelmezse Play satın almayı 3 gün sonra OTOMATİK İADE eder (kullanıcı parasını geri alır) ve
    // restore() bir sonraki açılışta yeniden dener. Ters sıra = para gider, premium gelmez.
    private val onPurchase: (purchaseToken: String, bitti: (Boolean) -> Unit) -> Unit,
    // Tüketilebilir: sunucu doğrulaması BİTENE kadar consume edilmez. bitti(true) gelirse tüketilir,
    // gelmezse satın alma Play'de durur ve bir sonraki açılışta restore() yeniden dener.
    private val onConsumable: (purchaseToken: String, sku: String, bitti: (Boolean) -> Unit) -> Unit =
        { _, _, _ -> },
) {
    var monthly by mutableStateOf<Pair<ProductDetails, String>?>(null)   // (ürün, offerToken)
    var yearly by mutableStateOf<Pair<ProductDetails, String>?>(null)
    var ultraMonthly by mutableStateOf<Pair<ProductDetails, String>?>(null)   // ULTRA: Google 3D + kameralar + Street View
    var ultraYearly by mutableStateOf<Pair<ProductDetails, String>?>(null)
    var boost by mutableStateOf<ProductDetails?>(null)                   // consumable; Play'de yoksa null kalır (buton gizli)
    // Paket ürünleri sku -> detay; Play'de olmayan sku haritaya hiç girmez (o kart gizli kalır)
    var paketler by mutableStateOf<Map<String, ProductDetails>>(emptyMap())
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
        // Tüketilebilirler (INAPP): boost + video/sokak paketleri. Play'de olmayan sku listeye hiç girmez.
        val bparams = QueryProductDetailsParams.newBuilder().setProductList(
            TUKETILEBILIR.map {
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(it).setProductType(BillingClient.ProductType.INAPP).build()
            }
        ).build()
        client.queryProductDetailsAsync(bparams) { _, res ->
            val hepsi = res.productDetailsList.associateBy { it.productId }
            boost = hepsi[BOOST_SKU]
            paketler = hepsi.filterKeys { it != BOOST_SKU }
        }
    }

    fun buyPaket(activity: Activity, sku: String) {
        val product = paketler[sku] ?: return
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(
            listOf(BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(product).build())
        ).build()
        client.launchBillingFlow(activity, params)
    }

    fun paketFiyati(sku: String): String =
        paketler[sku]?.oneTimePurchaseOfferDetails?.formattedPrice ?: ""

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
        val tuketilebilir = p.products.firstOrNull { it in TUKETILEBILIR }
        if (tuketilebilir != null) {
            // ÖNCE sunucuda doğrula, SONRA consume. Ters sırada doğrulama başarısız olursa
            // satın alma Play'de de silinmiş olur ve hak hiç verilemez (para gider, ürün gelmez).
            onConsumable(p.purchaseToken, tuketilebilir) { ok ->
                if (ok) client.consumeAsync(
                    ConsumeParams.newBuilder().setPurchaseToken(p.purchaseToken).build()
                ) { _, _ -> }
            }
            return
        }
        // 🔴 FİKS 17.09: ack, sunucu doğrulamasından ÖNCE atılıyordu. /api/iap/google 503 verirse
        // Play satın almayı "teslim edildi" sayıp bir daha sunmuyor → para alınmış, premium yok.
        // Artık tüketilebilir yolla (139-145) AYNI sıra: ÖNCE sunucu, SONRA ack.
        onPurchase(p.purchaseToken) { ok ->
            if (ok && !p.isAcknowledged) {
                client.acknowledgePurchase(
                    AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()
                ) {}
            }
        }
    }

    private fun restore() {
        client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()
        ) { _, purchases -> purchases.forEach { handle(it) } }
        // INAPP da taranır: doğrulaması yarıda kalmış (uygulama kapandı / ağ gitti) tüketilebilir
        // satın alma burada yeniden doğrulanır. Doğrulanmadan consume edilmediği için kaybolmaz.
        client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
        ) { _, purchases -> purchases.forEach { handle(it) } }
    }

    fun priceOf(sel: Pair<ProductDetails, String>?): String =
        sel?.first?.subscriptionOfferDetails?.firstOrNull { it.offerToken == sel.second }
            ?.pricingPhases?.pricingPhaseList?.lastOrNull()?.formattedPrice ?: ""
}
