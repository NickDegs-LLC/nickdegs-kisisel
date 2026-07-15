plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.nickdegs.movelog"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nickdegs.movelog"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("BUILD_NUMBER") ?: "1").toInt()
        versionName = "1.2"
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
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
    implementation("com.google.android.gms:play-services-location:21.3.0")   // FusedLocation (rota kaydı)
    implementation("org.osmdroid:osmdroid-android:6.1.20")   // OpenStreetMap (Maps API key gerekmez)
    implementation("com.android.billingclient:billing-ktx:7.1.1")
    implementation("com.google.android.play:integrity:1.4.0")   // Play Integrity (anti-tamper/sideload)
}
