plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.nickdegs.movelog.wear"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.nickdegs.movelog"   // telefonla AYNI kimlik (standalone Wear app)
        minSdk = 30                              // Wear OS 3 = Samsung Galaxy Watch4 ve üstü
        // 1.62: Play zorunluluğu — saat APK'si de aynı applicationId ile gidiyor.
        targetSdk = 36
        versionCode = (System.getenv("BUILD_NUMBER") ?: "1").toInt()
        versionName = "1.2"
    }

    signingConfigs {
        create("release") {
            val ks = System.getenv("MOVELOG_KEYSTORE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("MOVELOG_KS_PASS")
                keyAlias = "movelog"
                keyPassword = System.getenv("MOVELOG_KS_PASS")
            }
        }
    }
    // 16 KB sayfa boyutu (CLAUDE.md zorunlu) — saat modülünde de eksikti.
    packaging { jniLibs { useLegacyPackaging = false } }

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
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.wear.compose:compose-material:1.4.1")
    implementation("androidx.wear.compose:compose-foundation:1.4.1")
    implementation("androidx.health:health-services-client:1.0.0")       // nabız (Health Services)
    implementation("com.google.guava:guava:33.2.1-android")              // Health Services ListenableFuture (stub değil, gerçek sınıf)
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("com.google.android.gms:play-services-wearable:19.0.0")   // telefon ile kimlik köprüsü
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
}
