package com.nickdegs.movelog.data

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.android.billingclient.api.*

// 10.11.2026 — MOVE LOG TAM SÜRÜM (tek seferlik 4,99 $, abonelik YOK). Play ürünü: "tam_surum"
// (tek seferlik / tüketilmez: acknowledge edilir, ASLA consume edilmez).
// Kural: ilk 3 sürüş her şey açık; 4. sürüşten itibaren kilitli (kayıt sürer, listede kilitli görünür).
// Eski üyeler (sunucu /api/profile -> eski_uye=true) ve admin hep ücretsiz — bkz. Store.tamErisim.
// ⚠️ SUNUCU DOĞRULAMASI YOK: sahiplik tamamen cihazda Play Billing'den okunur (queryPurchasesAsync),
// acknowledge da cihazda yapılır. /api/pro/google vb. sunucu satın alma uçları ÇAĞRILMAZ.
// Sahiplik SharedPreferences'ta önbelleklenir (çevrimdışı); Play cevap verdiğinde gerçek odur.
const val TAM_SURUM_SKU = "tam_surum"
const val UCRETSIZ_SURUS = 3
private const val P_SAHIP = "nd_tam_surum"

class TamSurum(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("movelog", Context.MODE_PRIVATE)
    private val ana = Handler(Looper.getMainLooper())

    /** Bu Google hesabında tam_surum satın alınmış (PURCHASED). PENDING kilidi açmaz. */
    var sahip by mutableStateOf(prefs.getBoolean(P_SAHIP, false))
        private set
    var urun by mutableStateOf<ProductDetails?>(null)
        private set
    var yukleniyor by mutableStateOf(false)
        private set
    var bekliyor by mutableStateOf(false)
        private set
    /** null | "yok" (geri yüklemede satın alım bulunamadı) | "x" (genel hata) */
    var hata by mutableStateOf<String?>(null)

    private val dinleyici = PurchasesUpdatedListener { r, list ->
        ana.post {
            when (r.responseCode) {
                BillingClient.BillingResponseCode.OK -> list?.forEach { isle(it) }
                BillingClient.BillingResponseCode.USER_CANCELED -> {}
                BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> yenile()
                else -> hata = "x"
            }
        }
    }
    private val client = BillingClient.newBuilder(context.applicationContext)
        .setListener(dinleyici)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    // Bağlantı bekleyen işler: (başarıda, başarısızlıkta). Yalnız ana iş parçacığında dokunulur.
    private val bekleyenler = mutableListOf<Pair<() -> Unit, () -> Unit>>()
    private var baglaniyor = false

    private fun hazirla(isi: () -> Unit, olmazsa: () -> Unit = {}) {
        if (client.isReady) { isi(); return }
        bekleyenler.add(isi to olmazsa)
        if (baglaniyor) return
        baglaniyor = true
        try {
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(r: BillingResult) {
                    ana.post {
                        baglaniyor = false
                        val l = bekleyenler.toList(); bekleyenler.clear()
                        if (r.responseCode == BillingClient.BillingResponseCode.OK) l.forEach { it.first() }
                        else l.forEach { it.second() }
                    }
                }
                override fun onBillingServiceDisconnected() {
                    // Sonraki yenile()/al() yeniden bağlanır; bekleyen varsa başarısız say.
                    ana.post {
                        baglaniyor = false
                        val l = bekleyenler.toList(); bekleyenler.clear()
                        l.forEach { it.second() }
                    }
                }
            })
        } catch (e: Exception) {
            baglaniyor = false
            val l = bekleyenler.toList(); bekleyenler.clear()
            l.forEach { it.second() }
        }
    }

    private fun sahipYaz(v: Boolean) {
        sahip = v
        prefs.edit().putBoolean(P_SAHIP, v).apply()
    }

    private fun isle(p: Purchase) {
        if (!p.products.contains(TAM_SURUM_SKU)) return
        when (p.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                bekliyor = false; hata = null
                sahipYaz(true)
                onayla(p)
            }
            Purchase.PurchaseState.PENDING -> bekliyor = true
            else -> {}
        }
    }

    // Tüketilmez ürün: acknowledge (3 gün içinde yapılmazsa Play iade eder). Başarısızsa bir sonraki
    // yenile() (açılış / öne geliş) tekrar dener.
    private fun onayla(p: Purchase) {
        if (p.isAcknowledged) return
        client.acknowledgePurchase(
            AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { _ -> }
    }

    /** Ürün bilgisini (fiyat) getir — paywall açılınca ve açılışta. */
    fun urunYukle() {
        if (urun != null) return
        yukleniyor = true
        hazirla({
            val p = QueryProductDetailsParams.newBuilder().setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder().setProductId(TAM_SURUM_SKU)
                    .setProductType(BillingClient.ProductType.INAPP).build())).build()
            // Billing 8: 2. parametre QueryProductDetailsResult — ürünler productDetailsList içinde
            client.queryProductDetailsAsync(p) { _, res ->
                ana.post {
                    urun = res.productDetailsList.firstOrNull { it.productId == TAM_SURUM_SKU }
                    yukleniyor = false
                }
            }
        }, { yukleniyor = false })
    }

    /**
     * Play'e sahipliği sor (açılış, öne geliş, "Satın alımları geri yükle").
     * Play OK dönerse cevabı GERÇEK kabul eder (iade edilmişse sahip=false olur).
     * elle=true: kullanıcı geri yükle'ye bastı -> bulunamazsa / hata olursa mesaj göster.
     */
    fun yenile(elle: Boolean = false) {
        if (elle) hata = null
        hazirla({
            client.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP).build()) { r, list ->
                ana.post {
                    if (r.responseCode != BillingClient.BillingResponseCode.OK) {
                        if (elle) hata = "x"
                        return@post
                    }
                    val bizim = list.filter { it.products.contains(TAM_SURUM_SKU) }
                    val alindi = bizim.any { it.purchaseState == Purchase.PurchaseState.PURCHASED }
                    sahipYaz(alindi)
                    bekliyor = !alindi && bizim.any { it.purchaseState == Purchase.PurchaseState.PENDING }
                    bizim.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }.forEach { onayla(it) }
                    if (elle && !alindi && !bekliyor) hata = "yok"
                }
            }
        }, { if (elle) hata = "x" })
    }

    fun al(activity: Activity) {
        val u = urun ?: return
        hata = null
        hazirla({
            val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
                BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(u).build())).build()
            val r = client.launchBillingFlow(activity, params)
            if (r.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) { yenile() }
            else if (r.responseCode != BillingClient.BillingResponseCode.OK) { hata = "x" }
        }, { hata = "x" })
    }

    fun kapat() { runCatching { client.endConnection() } }
}
