plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")   // FCM push (google-services.json)
}

android {
    namespace = "com.nickdegs.movelog"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nickdegs.movelog"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("BUILD_NUMBER") ?: "1").toInt()
        versionName = "1.60"
    }

    signingConfigs {
        create("release") {
            val ks = System.getenv("MOVELOG_KEYSTORE")   // Capacitor ile aynı keystore + alias "movelog"
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("MOVELOG_KS_PASS")
                keyAlias = "movelog"
                keyPassword = System.getenv("MOVELOG_KS_PASS")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("MOVELOG_KEYSTORE") != null) signingConfigs.getByName("release") else null
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.02")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    // GOOGLE İLE GİRİŞ (2026-08-08): Credential Manager + Google ID. serverClientId =
    // film-ozet web client'ı (google-services.json'daki type-3). SMS UI kaldırıldı;
    // NOT: eski SMS çağrıları /api/auth/... yanlış yoldaydı (backend /auth/...) -> zaten 404'tü.
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
    implementation("com.google.android.gms:play-services-location:21.3.0")   // FusedLocation (rota kaydı)
    implementation("org.osmdroid:osmdroid-android:6.1.20")   // OpenStreetMap (Maps API key gerekmez)
    implementation("com.android.billingclient:billing-ktx:8.0.0")   // Play zorunlulugu: 7.x 31 Agu 2026'da reddedilecek
    implementation("com.google.android.play:integrity:1.4.0")   // Play Integrity (anti-tamper/sideload)
    implementation("io.livekit:livekit-android:2.18.2")   // 1.9 canlı interkom (kulüp sesli oda)
    implementation("com.google.android.gms:play-services-wearable:19.0.0")   // Wear OS saat köprüsü
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-messaging-ktx")   // FCM push bildirimleri
}
