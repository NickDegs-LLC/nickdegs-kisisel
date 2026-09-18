# Move Log — R8 kuralları (1.62, 2026-09-05)
#
# NEDEN: CLAUDE.md zorunlu ayarlar tablosu R8'i (isMinifyEnabled + isShrinkResources) şart koşuyor —
# Play Console "optimizasyon düşük" uyarısı bu yüzden çıkıyordu. Aynı yerdeki ⚠️ uyarı da geçerli:
# "R8'i test etmeden açma". CI yalnız INTERNAL track'e yüklüyor (android-native.yml: track: internal),
# yani production'a çıkmadan önce iç testte doğrulama YAPISAL olarak zorunlu — bu dosya o testin
# geçmesi için gereken minimum korumaları içeriyor.
#
# Bu projede reflection'a dayalı JSON kütüphanesi (Gson/Moshi/kotlinx.serialization) KULLANILMIYOR;
# tüm ayrıştırma org.json ile ELLE yapılıyor (data/Store.kt) → model sınıfları R8'e karşı güvenli,
# ayrıca -keep gerekmiyor. Riskli olanlar aşağıda tek tek gerekçesiyle korunuyor.

# ── Kotlin/Compose çekirdeği ────────────────────────────────────────────────
# Compose kendi consumer kurallarını getirir; ek olarak coroutine iç sınıfları uyarı üretmesin.
-dontwarn kotlinx.coroutines.**
-keepclassmembers class kotlin.Metadata { *; }

# ── LiveKit kuralları KALDIRILDI (18.09) ────────────────────────────────────
# Canlı telsiz/interkom uygulamadan çıktı, livekit-android bağımlılığı da kaldırıldı.

# ── Google ile giriş (Credential Manager + Google ID) ───────────────────────
# googleid kütüphanesi Bundle anahtarlarını sınıf adıyla çözüyor.
-keep class com.google.android.libraries.identity.googleid.** { *; }
-keep class androidx.credentials.** { *; }
-dontwarn androidx.credentials.**

# ── Firebase / FCM ─────────────────────────────────────────────────────────
# FirebaseMessagingService alt sınıfı manifest'ten adıyla örnekleniyor (MoveLogMessaging).
-keep class com.nickdegs.movelog.MoveLogMessaging { *; }
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# ── Play Billing / Integrity / Wearable / Location ──────────────────────────
-keep class com.android.billingclient.** { *; }
-keep class com.google.android.play.core.** { *; }
-keep class com.google.android.gms.wearable.** { *; }
-dontwarn com.google.android.gms.**

# ── osmdroid: 16.09'da bağımlılık TAMAMEN kaldırıldı (canlı konum haritası çıktı),
#    bu yüzden keep/dontwarn kuralına da gerek kalmadı.

# ── media3 / ExoPlayer ─────────────────────────────────────────────────────
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# ── Wear köprüsü: veri katmanı yolu adları ─────────────────────────────────
-keep class com.nickdegs.movelog.wear.** { *; }

# Yığın izleri okunabilir kalsın (Play Console'a mapping.txt zaten yükleniyor).
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile
