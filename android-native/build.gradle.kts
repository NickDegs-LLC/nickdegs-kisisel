plugins {
    // AGP 8.9.2 (05.09): Play artık targetSdk 36 istiyor; API 36'yı resmî destekleyen ilk 8.x hattı.
    // Gradle gereksinimi 8.11+ — CI'daki sürüm zaten 8.11 (koşu logu: gradle-8.11).
    id("com.android.application") version "8.9.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.20" apply false
    id("com.google.gms.google-services") version "4.4.2" apply false   // FCM push
}
